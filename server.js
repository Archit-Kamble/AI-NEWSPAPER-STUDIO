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
const pool = require('./src/config/db');
const { deskWrites, requireAdmin, requireDesk, requireSignIn } = require('./src/middleware/auth');
const { syncTemplates } = require('./src/layout/syncTemplates');
const { upload, verifyUploadedImages } = require('./src/middleware/upload');
const { PostgresSessionStore } = require('./src/middleware/sessionStore');
const { guardIdParams } = require('./src/middleware/params');
const newsRoutes = require('./src/routes/news.routes');
const newspaperRoutes = require('./src/routes/newspaper.routes');
const pageRoutes = require('./src/routes/page.routes');
const authRoutes = require('./src/routes/auth.routes');
const featureRoutes = require('./src/routes/feature.routes');
const staffRoutes = require('./src/routes/staff.routes');
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

function createApp(options = {}) {
  assertSessionSecretConfigured();
  const app = express();
  app.set("sessionStore", options.sessionStore || new PostgresSessionStore());

  // A BROWSER MUST NOT GUESS WHAT A STORED FILE IS.
  //
  // `nosniff` is the layer under the upload whitelist: even if something got
  // onto disk with a name this paper did not choose, a browser may not decide
  // from the bytes that it is a document and run it. The other two are
  // ordinary hygiene for an application that holds a newsroom's session -
  // it is never framed, and it does not leak the edition being worked on into
  // a third party's referer log.
  // The e-paper routes below hang off the app rather than a router, so the
  // id guard is registered here as well. Without it `/epaper/abc` reaches the
  // repository as NaN and answers 500 instead of "that is not an edition".
  guardIdParams(app);

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "same-origin");
    next();
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
  // Session comes before the e-paper image gate so a signed-in desk can
  // preview a private release, while anonymous visitors remain limited to
  // the single selected public issue.
  app.use(
    session({
      // A desk's login outlives a restart, and expired sessions are swept.
      // Without a store this is express-session's MemoryStore, which leaks and
      // signs the whole desk out whenever the process restarts.
      store: app.get("sessionStore"),
      secret: process.env.SESSION_SECRET || "dev-secret",
      resave: false,
      saveUninitialized: false,
      // The cookie carries a desk's authority over the whole paper.
      // `secure` was hard-coded false, so on any HTTPS deployment it was
      // also sent over plain HTTP; it follows the deployment now. `sameSite`
      // stops another site's page driving a desk's session by making the
      // browser attach the cookie to its own cross-site request.
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 12 * 60 * 60 * 1000,
      },
    }),
  );
  // Generated e-paper assets sit under public/uploads for deployment
  // simplicity, but they are not ordinary static uploads. This route comes
  // first so a guessed PNG URL cannot reveal an edition before Publish or
  // after the desk removes its public copy.
  app.get("/uploads/epaper/:id/:filename", asyncRoute(newspaperController.epaperAsset));
  app.use(express.static(path.join(__dirname, "public")));

  // A HEALTH CHECK THAT DOES NOT CHECK ANYTHING IS WORSE THAN NONE.
  //
  // This answered `{status:"ok"}` unconditionally, without touching the
  // database. So a monitor watching it stayed green while every real request
  // returned 500 - the one situation the check exists to catch. It asks the
  // database the cheapest question there is now, and says which part is down.
  app.get("/api/health", asyncRoute(async (req, res) => {
    try {
      await pool.query("SELECT 1");
    } catch (error) {
      console.error(`[${new Date().toISOString()}] health: database unreachable`, error.message);
      return res.status(503).json({ status: "degraded", database: "unreachable" });
    }
    return res.json({ status: "ok", database: "ok" });
  }));

  app.use("/api/auth", authRoutes);

  // Owner-only identity and publication setup. These routes intentionally sit
  // outside the deskWrites mount: a colleague's profile and contact details are
  // private and cannot become public merely because GET is normally read-only.
  //
  // It is `/api/staff`, not `/api/reporters`, because it stopped being about
  // reporters: an owner adds and blocks editors and Sampadaks here too, and a
  // route named for one of the four roles it manages is the fault this project
  // states as "every control names the object it acts on".
  app.use('/api/staff', requireAdmin, staffRoutes);
  app.use('/api/settings', requireAdmin, settingsRoutes);

  // News API
  // Reporters file here, so signing in is enough; the desk-only check is on
  // the make-up routes below.
  app.use("/api/news", requireSignIn, newsRoutes);

  app.post("/api/uploads/images", requireSignIn, upload.array("images"), asyncRoute(verifyUploadedImages), (req, res) => {
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

  // AN API PATH THAT DOES NOT EXIST SAYS SO, IN JSON.
  //
  // The SPA catch-all below answered EVERY unmatched path with index.html and
  // a 200 - including `/api/*`. So a mistyped or removed endpoint came back as
  // a successful HTML document: `response.ok` was TRUE, and the caller's
  // `.json()` then threw a parse error from inside an async handler with
  // nothing on screen to say why. That is the same silent failure this
  // codebase already fixed for the five unchecked page re-reads, arriving
  // through the router instead. An API route must never resolve to the
  // application shell.
  app.use("/api", (req, res) => {
    res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` });
  });

  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  return app;
}

// ONE STRAY PROMISE MUST NOT TAKE THE PAPER OFF THE AIR.
//
// Node terminates the process on an unhandled rejection - verified on the
// version this runs under - and there was no handler anywhere. So a single
// forgotten `.catch()` in any service, on any request, killed the server for
// the whole newsroom, in the middle of an edition, and left NOTHING in any log
// to say what had happened. That is the same fault the catch-all error handler
// was written to fix, one level up, where it is fatal instead of merely
// silent.
//
// The two are deliberately treated differently. A rejected promise is a bug in
// one request and the process is still sound, so it is recorded and the paper
// stays up. An uncaught exception may have unwound the stack anywhere, so the
// process is no longer trustworthy: it is recorded and the server is closed
// down deliberately, for the supervisor to restart, rather than left serving
// from an unknown state.
function installCrashHandlers(server) {
  process.on("unhandledRejection", (reason) => {
    console.error(
      `[${new Date().toISOString()}] UNHANDLED REJECTION - the edition is unchanged and the server is still up`,
      reason instanceof Error ? (reason.stack || reason.message) : reason,
    );
  });

  process.on("uncaughtException", (error) => {
    console.error(
      `[${new Date().toISOString()}] UNCAUGHT EXCEPTION - shutting down; the supervisor should restart`,
      error?.stack || error,
    );
    shutdown(server, 1);
  });
}

// A DEPLOY IN THE MIDDLE OF A SAVE MUST NOT LOSE THE BLOCK.
//
// Without this, SIGTERM kills the process outright and every request in flight
// dies with it - including a block being written. Refusing new connections and
// letting the open ones finish costs a few seconds and is the difference
// between a restart and a lost story. The timer is the backstop for a request
// that never finishes.
let shuttingDown = false;
function shutdown(server, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("Shutting down: finishing requests already in flight...");
  const force = setTimeout(() => {
    console.error("Shutdown timed out; exiting anyway.");
    process.exit(code || 1);
  }, 10000);
  force.unref?.();
  server.close(() => {
    pool.end().catch(() => {}).finally(() => process.exit(code));
  });
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  const sessionStore = new PostgresSessionStore();
  const app = createApp({ sessionStore });

  // Each of these is reported as ITSELF. They used to share one `.catch`
  // labelled "Publication settings load failed", so a template-sync failure
  // was logged as a settings failure - a misleading line is worse than none at
  // four in the morning. Neither is fatal: the server still listens, so the
  // health check can be reached and can say what is wrong.
  const ready = sessionStore.ready()
    .catch((error) => { console.error("Session store unavailable:", error.message); })
    .then(() => syncTemplates()
      .then((count) => console.log(`Synced ${count} layouts`))
      .catch((error) => { console.error("Layout sync failed:", error.message); }))
    .then(() => hydratePublicationIdentity()
      .catch((error) => { console.error("Publication settings load failed:", error.message); }));

  ready.finally(() => {
    const server = app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
    });
    installCrashHandlers(server);
    process.on("SIGTERM", () => shutdown(server, 0));
    process.on("SIGINT", () => shutdown(server, 0));
  });
}

module.exports = { createApp };
