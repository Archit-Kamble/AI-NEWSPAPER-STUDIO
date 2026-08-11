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
const { deskWrites, requireDesk, requireSignIn } = require('./src/middleware/auth');
const { syncTemplates } = require('./src/layout/syncTemplates');
const { upload } = require('./src/middleware/upload');
const newsRoutes = require('./src/routes/news.routes');
const newspaperRoutes = require('./src/routes/newspaper.routes');
const pageRoutes = require('./src/routes/page.routes');
const authRoutes = require('./src/routes/auth.routes');
const featureRoutes = require('./src/routes/feature.routes');
const newspaperController = require('./src/controllers/newspaper.controller');

dotenv.config();

function createApp() {
  const app = express();

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
  app.use(express.static(path.join(__dirname, "public")));
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "dev-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    }),
  );

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authRoutes);

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

  // The e-paper as a plain readable page a search engine can index. Public,
  // like the JSON form at GET /api/newspapers/:id/epaper - not part of that
  // router's mount path, so it stays wired directly here.
  app.get("/epaper/:id", asyncRoute(newspaperController.epaperHtml));

  // Page API
  app.use("/api", deskWrites, pageRoutes);

  app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ error: error.message });
    }
    if (error) {
      return res.status(400).json({ error: error.message || "Upload failed" });
    }
    next();
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
    .catch((error) => console.error('Layout sync failed:', error.message))
    .finally(() => {
      app.listen(port, () => {
        console.log(`Server running on http://localhost:${port}`);
      });
    });
}

module.exports = { createApp };
