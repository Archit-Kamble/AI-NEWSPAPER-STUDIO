require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const dotenv = require("dotenv");
const multer = require("multer");
const publicationRepository = require('./src/repositories/publication.repository');
const { templates } = require('./src/layout/templates');
const { storage, upload } = require('./src/middleware/upload');
const newsRoutes = require('./src/routes/news.routes');
const {
  authenticateUser,
  createNewspaper,
  updateNewspaper,
  listNewspapers,
  getNewspaper,
  getLatestNewspaper,
  createPage,
  updatePage,
  listPages,
  addArticleToPage,
  savePageSection,
} = require("./src/db");

dotenv.config();

const publicationUpload = multer({
  storage,
  limits: { files: 2, fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed =
      file.fieldname === "scribusFile"
        ? /\.sla$/i.test(file.originalname)
        : file.fieldname === "printPdf" &&
          (file.mimetype === "application/pdf" ||
            /\.pdf$/i.test(file.originalname));
    cb(
      allowed
        ? null
        : new Error("Upload a Scribus .sla file and/or a PDF file"),
      allowed,
    );
  },
});

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
  app.post("/api/newspapers", async (req, res) => {
    const today = new Date().toISOString().split("T")[0];
    const newspaper = await createNewspaper({
      name: req.body.name || "साहस",
      date: req.body.date || today,
      language: req.body.language || "mr",
      template: req.body.template || "classic",
      pageCount: req.body.pageCount || 4,
      pageSize: req.body.pageSize || { width: 330, height: 530, unit: "mm" },
      liveArea: req.body.liveArea || { width: 310, height: 510, unit: "mm" },
      colorMode: "CMYK",
      status: "draft",
      createdBy: req.session.user?.id,
    });
    res.status(201).json(newspaper);
  });

  app.get("/api/newspapers", async (req, res) => {
    res.json(await listNewspapers());
  });

  app.get("/api/newspapers/latest", async (req, res) => {
    const newspaper = await getLatestNewspaper();
    res.json(newspaper || null);
  });

  async function withPublicationFiles(newspaper) {
    if (!newspaper) return null;
    const files = await publicationRepository.latestByNewspaper(newspaper.id);
    return files.reduce((result, file) => {
      if (file.file_type === 'scribus_project') result.scribusFile = file.storage_path;
      if (file.file_type === 'print_pdf') result.printPdf = file.storage_path;
      return result;
    }, { ...newspaper });
  }

  app.get("/api/newspapers/:id", async (req, res) => {
    const newspaper = await withPublicationFiles(await getNewspaper(parseInt(req.params.id, 10)));
    if (!newspaper) return res.status(404).json({ error: "Not found" });
    res.json(newspaper);
  });



  app.patch("/api/newspapers/:id", async (req, res) => {
    const newspaper = await updateNewspaper(parseInt(req.params.id, 10), req.body);
    if (!newspaper) return res.status(404).json({ error: "Not found" });
    res.json(newspaper);
  });

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

  app.post(
    "/api/newspapers/:id/final-files",
    publicationUpload.fields([
      { name: "scribusFile", maxCount: 1 },
      { name: "printPdf", maxCount: 1 },
    ]),
    async (req, res) => {
      const files = req.files || {};
      if (!files.scribusFile?.[0] && !files.printPdf?.[0])
        return res
          .status(400)
          .json({ error: "Choose a Scribus .sla file or final PDF" });
      const newspaperId = parseInt(req.params.id, 10);
      const newspaper = await getNewspaper(newspaperId);
      if (!newspaper) return res.status(404).json({ error: "Not found" });
      const response = { ...newspaper };
      if (files.scribusFile?.[0]) {
        const file = await publicationRepository.save(newspaperId, 'scribus_project', `/uploads/${files.scribusFile[0].filename}`, req.session.user?.id);
        response.scribusFile = file.storage_path;
      }
      if (files.printPdf?.[0]) {
        const file = await publicationRepository.save(newspaperId, 'print_pdf', `/uploads/${files.printPdf[0].filename}`, req.session.user?.id);
        response.printPdf = file.storage_path;
        response.status = 'finalised';
        await updateNewspaper(newspaperId, { status: 'finalised' });
      }
      res.json(response);
    },
  );

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
