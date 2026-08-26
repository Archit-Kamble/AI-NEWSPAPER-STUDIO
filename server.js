require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const dotenv = require("dotenv");
const multer = require("multer");
const { templates } = require('./src/layout/templates');
const { geometryOf } = require('./src/layout/geometry');
const { identityFor } = require('./src/layout/identity');
const ai = require('./src/services/ai');
const { asyncRoute } = require('./src/middleware/asyncRoute');
const { deskWrites, requireAdmin, requireDesk, requireSignIn } = require('./src/middleware/auth');
const { syncTemplates } = require('./src/layout/syncTemplates');
const { upload } = require('./src/middleware/upload');
const newsRoutes = require('./src/routes/news.routes');
const newspaperRoutes = require('./src/routes/newspaper.routes');
const pageRoutes = require('./src/routes/page.routes');
const authRoutes = require('./src/routes/auth.routes');
const featureRoutes = require('./src/routes/feature.routes');
const reporterRoutes = require('./src/routes/reporter.routes');
const settingsRoutes = require('./src/routes/settings.routes');
const newspaperController = require('./src/controllers/newspaper.controller');
const { hydratePublicationIdentity } = require('./src/services/settings.service');

dotenv.config();

// The session secret signs every desk's login cookie. "dev-secret" is fine on
// a desk machine on a newsroom LAN in development - it is not fine on a
// production deploy, where anyone who knows this codebase is public would
// know the fallback and could forge a session. Only enforced when
// NODE_ENV=production is actually set, so local dev and npm test - which
// never set it - are unaffected.
function assertSessionSecretConfigured() {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET !== "dev-secret") return;
  throw new Error(
    "SESSION_SECRET must be set to a real secret when NODE_ENV=production. " +
    "Refusing to start with the development fallback.",
  );
}

function createApp() {
  assertSessionSecretConfigured();
  const app = express();

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
  // Session comes before the e-paper image gate so a signed-in desk can
  // preview a private release, while anonymous visitors remain limited to
  // the single selected public issue.
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "dev-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    }),
  );
  // Generated e-paper assets sit under public/uploads for deployment
  // simplicity, but they are not ordinary static uploads. This route comes
  // first so a guessed PNG URL cannot reveal an edition before Publish or
  // after the desk removes its public copy.
  app.get("/uploads/epaper/:id/:filename", asyncRoute(newspaperController.epaperAsset));
  app.use(express.static(path.join(__dirname, "public")));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authRoutes);

  // Owner-only identity and publication setup. These routes intentionally sit
  // outside the deskWrites mount: reporter profile/contact data is private and
  // cannot become public merely because GET is normally read-only.
  app.use('/api/reporters', requireAdmin, reporterRoutes);
  app.use('/api/settings', requireAdmin, settingsRoutes);

  // News API
  // Reporters file here, so signing in is enough; the desk-only check is on
  // the make-up routes below.
  app.use("/api/news", requireSignIn, newsRoutes);

  app.post("/api/uploads/images", requireSignIn, upload.array("images"), (req, res) => {
    const files = req.files || [];
    res.status(201).json({
      imageUrls: files.map((file) => `/uploads/${file.filename}`),
      imageFiles: files.map((file) => file.filename),
    });
  });

  // Newspaper API
  app.use("/api/newspapers", deskWrites, newspaperRoutes);

  // Templates API
  app.get("/api/templates", (req, res) => {
    res.json(Object.values(templates));
  });

  // Print geometry API. The px-per-mm scale, the matter box, the column grid and
  // the baseline are computed in src/layout/geometry.js and served from here, so
  // the browser never carries a second copy of the numbers that decide how the
  // page prints (CLAUDE.md: no duplicated data catalogs, never mix px and mm
  // silently).
  app.get("/api/geometry", (req, res) => {
    res.json(geometryOf({}));
  });

  // Masthead identity API - the standing furniture of the paper.
  //
  // Given an edition's date and page count it also returns that edition's
  // volume and issue number, computed in src/layout/identity.js from the date
  // the paper was founded. The desk never keys a number that a date already
  // determines.
  app.get("/api/identity", (req, res) => {
    res.json(identityFor(req.query.date, req.query.pages));
  });

  // Standing features API
  app.use("/api/features", deskWrites, featureRoutes);

  // Which provider writes this paper's copy, who covers for it, and the tiers
  // of effort on offer. The editor reads this to build its dropdown - so the
  // menu describes the newsroom that is actually configured rather than a fixed
  // list of names, and says plainly when nothing is set up at all.
  app.get("/api/ai/status", requireDesk, (req, res) => {
    res.json(ai.status());
  });

  // The desk has a private list of released snapshots. The link given to
  // another website is simply /epaper: it opens the one radio-selected issue
  // and carries no id, token or write capability.
  app.get("/api/epapers", requireDesk, asyncRoute(newspaperController.epaperList));
  app.get("/epaper/preview/:id", requireDesk, asyncRoute(newspaperController.epaperPreviewHtml));
  app.get("/epaper", asyncRoute(newspaperController.selectedEpaperHtml));
  app.get("/epaper/:id/pdf", asyncRoute(newspaperController.epaperPdf));
  app.get("/epaper/:id", asyncRoute(newspaperController.epaperHtml));
  app.get("/_internal/epaper-canvas/:token", asyncRoute(newspaperController.epaperCanvasCaptureHtml));

  // Page API
  app.use("/api", deskWrites, pageRoutes);

  // EVERY FAILURE THAT REACHES HERE IS RECORDED, AND ONLY THE ONES THE CALLER
  // CAUSED ARE BLAMED ON THE CALLER.
  //
  // This used to answer every error with `400 Bad Request` and the error's own
  // `message`, and log nothing at all. Three things were wrong with that, and
  // all three cost a newsroom time on the one day it matters:
  //
  //   - a bug in this software, a dropped database connection or a missing
  //     font file was reported to the desk as "you sent something wrong". A
  //     desk told that will retype the request, which cannot help.
  //   - the raw internal message went to the browser. `relation
  //     "page_sections" does not exist` is not a sentence for a sub-editor and
  //     is not a sentence for the public either.
  //   - NOTHING WAS LOGGED. A failure left no trace anywhere, so the only
  //     record of it was whatever the desk remembered.
  //
  // Multer's own errors are genuinely the caller's (a file too large, an
  // unexpected field) and keep their message and their 400. An error a service
  // raised deliberately can say so by carrying `status`. Everything else is
  // ours: 500, a sentence a person can act on, and the real one in the log.
  app.use((error, req, res, next) => {
    if (!error) return next();

    const status = error instanceof multer.MulterError
      ? 400
      : Number(error.status || error.statusCode) || 500;

    // One line per failure, always - including the ones answered as 400, so a
    // run of malformed requests is visible too.
    console.error(
      `[${new Date().toISOString()}] ${status} ${req.method} ${req.originalUrl}`,
      status >= 500 ? (error.stack || error.message) : (error.message || error),
    );

    if (res.headersSent) return next(error);
    return res.status(status).json({
      error: status >= 500
        ? "Something went wrong on the server. The edition is unchanged; try again, and tell the desk if it keeps happening."
        : (error.message || "That request could not be accepted."),
    });
  });

  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  const port = process.env.PORT || 3000;

  // Layouts live in src/layout/templates.js; the templates table exists only to
  // satisfy pages.template_key's foreign key, so it is brought into line before
  // the server accepts a request.
  syncTemplates()
    .then((count) => console.log(`Synced ${count} layouts`))
    .then(() => hydratePublicationIdentity())
    .catch((error) => console.error('Publication settings load failed:', error.message))
    .finally(() => {
      app.listen(port, () => {
        console.log(`Server running on http://localhost:${port}`);
      });
    });
}

module.exports = { createApp };
