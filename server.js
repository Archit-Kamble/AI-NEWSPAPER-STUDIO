require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const dotenv = require("dotenv");
const multer = require("multer");
const { templates } = require('./src/layout/templates');
const { upload } = require('./src/middleware/upload');
const newsRoutes = require('./src/routes/news.routes');
const newspaperRoutes = require('./src/routes/newspaper.routes');
const {
  authenticateUser,
  createPage,
  updatePage,
  listPages,
  addArticleToPage,
  savePageSection,
} = require("./src/db");

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

  app.post("/api/auth/login", async (req, res) => {
    const { email, password, role } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email and password required" });

    const user = await authenticateUser(email, password);
    if (!user || user.role !== role)
      return res.status(401).json({ error: "Invalid credentials" });

    req.session.user = user;
    res.json({ user });
  });

  app.get("/api/auth/me", (req, res) => {
    res.json({ user: req.session.user || null });
  });

  // News API
  app.use("/api/news", newsRoutes);

  app.post("/api/uploads/images", upload.array("images"), (req, res) => {
    const files = req.files || [];
    res.status(201).json({
      imageUrls: files.map((file) => `/uploads/${file.filename}`),
      imageFiles: files.map((file) => file.filename),
    });
  });

  // Newspaper API
  app.use("/api/newspapers", newspaperRoutes);

  // Templates API
  app.get("/api/templates", (req, res) => {
    res.json(Object.values(templates));
  });

  // Page API
  app.post("/api/newspapers/:newspaperId/pages", async (req, res) => {
    const page = await createPage({
      newspaperId: parseInt(req.params.newspaperId),
      pageNumber: req.body.pageNumber || 1,
      sectionName: req.body.sectionName || "Page 1",
      language: req.body.language || "mr",
      templateKey: req.body.templateKey || req.body.template || "front",
    });
    res.status(201).json(page);
  });

  app.get("/api/newspapers/:newspaperId/pages", async (req, res) => {
    const pages = await listPages(parseInt(req.params.newspaperId, 10));
    res.json(pages);
  });

  app.patch("/api/pages/:pageId", async (req, res) => {
    const page = await updatePage(parseInt(req.params.pageId, 10), req.body);
    if (!page) return res.status(404).json({ error: "Not found" });
    res.json(page);
  });

  app.put("/api/pages/:pageId/sections/:sectionId", async (req, res) => {
    const payload = req.body;
    const page = await savePageSection(
      parseInt(req.params.pageId, 10),
      req.params.sectionId,
      {
        newsItemId: payload.newsItemId || payload.sourceNewsId,
        headline: payload.headline || payload.title,
        headlineFontPx: payload.headlineFontPx,
        subheading: payload.subheading || payload.subtitle,
        subheadingFontPx: payload.subheadingFontPx,
        body: payload.body || payload.description,
        bodyFontPx: payload.bodyFontPx,
        category: payload.category,
        location: payload.location,
        tags: payload.tags,
        reporterName: payload.reporterName,
        aiNotes: payload.aiNotes,
      },
    );
    if (!page) return res.status(404).json({ error: "Not found" });
    res.json(page);
  });

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
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

module.exports = { createApp };
