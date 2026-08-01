require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const dotenv = require("dotenv");
const multer = require("multer");
const fs = require("fs");
const crypto = require("crypto");
const {
  authenticateUser,
  createNews,
  updateNews,
  listNews,
  getNewsByStatus,
  createNewspaper,
  updateNewspaper,
  listNewspapers,
  getNews,
  getLatestNewspaper,
  createPage,
  updatePage,
  listPages,
  addArticleToPage,
  savePageSection,
} = require("./src/db");

dotenv.config();

const uploadsDir = path.join(__dirname, "public/uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Do not let two files selected in the same upload overwrite each other.
    const extension = path.extname(file.originalname);
    cb(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: { files: 10, fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith("image/"));
  },
});

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
  // News API
  app.post("/api/news", upload.array("images"), async (req, res) => {
    try {
      const payload = req.body;

      if (!payload.title) {
        return res.status(400).json({ error: "Title required" });
      }

      const imageUrls = Array.isArray(req.files)
        ? req.files.map((file) => `/uploads/${file.filename}`)
        : [];

      console.log("========== CREATE NEWS ==========");
      console.log("req.files =", req.files);
      console.log("imageUrls =", imageUrls);
      console.log("payload =", payload);

      const item = await createNews({
        newspaper_id: null,
        title: payload.title || "",
        subheading: payload.subheading || payload.subtitle || "",
        description: payload.description || "",
        category: payload.category || "",
        location: payload.location || "",
        city: payload.city || "",
        tags: payload.tags || "",
        reporter_name: payload.reporterName || req.session.user?.name || "",
        image_urls: imageUrls,
        status: payload.status || "draft",
        created_by: req.session.user?.id ?? null,
      });
      console.log("saved =", item);
      console.log("===============================");

      res.status(201).json(item);
    } catch (err) {
      console.error("Create News Error:", err);
      res.status(500).json({ error: "Failed to create news" });
    }
  });

  app.get("/api/news", async (req, res) => {
    const { status, language, reporterId } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (language) filter.language = language;
    if (reporterId) filter.created_by = parseInt(reporterId, 10);
    const news = await listNews(filter);
    res.json(news);
  });

  app.get("/api/news/status/:status", async (req, res) => {
    res.json(await getNewsByStatus(req.params.status));
  });

  app.get("/api/news/:id", async (req, res) => {
    const item = await getNews(parseInt(req.params.id, 10));

    if (!item) {
      return res.status(404).json({ error: "Not found" });
    }

    res.json(item);
  });

  app.patch("/api/news/:id", upload.array("images"), async (req, res) => {
    const payload = req.body;
    const existing = await getNews(parseInt(req.params.id, 10));

    if (!existing) {
      return res.status(404).json({ error: "Not found" });
    }
    const updates = {
      newspaper_id: existing.newspaper_id,
      title: payload.title,
      subheading: payload.subheading || payload.subtitle || "",
      description: payload.description || "",
      category: payload.category || "",
      location: payload.location || "",
      city: payload.city || "",
      tags: payload.tags || "",
      reporter_name: payload.reporterName || "",
      image_urls: existing.image_urls || [],
      status: payload.status || "draft",
      created_by: existing.created_by,
    };

    if (req.files && req.files.length) {
      updates.image_urls = req.files.map((file) => "/uploads/" + file.filename);
    }

    const item = await updateNews(parseInt(req.params.id, 10), updates);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  });

  app.patch("/api/news/:id/status", (req, res) => {
    const status = req.body.status;
    if (!["draft", "pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Invalid news status" });
    }
    const item = updateNews(parseInt(req.params.id, 10), { status });
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  });

  app.post("/api/uploads/images", upload.array("images"), (req, res) => {
    const files = req.files || [];
    res.status(201).json({
      imageUrls: files.map((file) => `/uploads/${file.filename}`),
      imageFiles: files.map((file) => file.filename),
    });
  });

  // Newspaper API
  app.post("/api/newspapers", (req, res) => {
    const today = new Date().toISOString().split("T")[0];
    const newspaper = createNewspaper({
      name: req.body.name || "साहस",
      date: req.body.date || today,
      language: req.body.language || "mr",
      template: req.body.template || "classic",
      pageCount: req.body.pageCount || 4,
      pageSize: req.body.pageSize || { width: 330, height: 530, unit: "mm" },
      liveArea: req.body.liveArea || { width: 310, height: 510, unit: "mm" },
      colorMode: "CMYK",
      status: "draft",
    });
    res.status(201).json(newspaper);
  });

  app.get("/api/newspapers", (req, res) => {
    res.json(listNewspapers());
  });

  app.get("/api/newspapers/latest", (req, res) => {
    const newspaper = getLatestNewspaper();
    res.json(newspaper || null);
  });

  app.get("/api/newspapers/:id", (req, res) => {
    const newspaper = listNewspapers().find(
      (n) => n.id === parseInt(req.params.id),
    );
    if (!newspaper) return res.status(404).json({ error: "Not found" });
    res.json(newspaper);
  });

  app.patch("/api/newspapers/:id", (req, res) => {
    const newspaper = updateNewspaper(parseInt(req.params.id), req.body);
    if (!newspaper) return res.status(404).json({ error: "Not found" });
    res.json(newspaper);
  });

  // Page API
  app.post("/api/newspapers/:newspaperId/pages", (req, res) => {
    const page = createPage({
      newspaperId: parseInt(req.params.newspaperId),
      pageNumber: req.body.pageNumber || 1,
      sectionName: req.body.sectionName || "Page 1",
      language: req.body.language || "mr",
      template: req.body.template || "standard",
    });
    res.status(201).json(page);
  });

  app.get("/api/newspapers/:newspaperId/pages", (req, res) => {
    const pages = listPages(parseInt(req.params.newspaperId));
    res.json(pages);
  });

  app.patch("/api/pages/:pageId", (req, res) => {
    const page = updatePage(parseInt(req.params.pageId), req.body);
    if (!page) return res.status(404).json({ error: "Not found" });
    res.json(page);
  });

  app.put("/api/pages/:pageId/sections/:sectionId", (req, res) => {
    const page = savePageSection(
      parseInt(req.params.pageId, 10),
      req.params.sectionId,
      req.body,
    );
    if (!page) return res.status(404).json({ error: "Not found" });
    res.json(page);
  });

  app.post("/api/pages/:pageId/articles", (req, res) => {
    const page = addArticleToPage(parseInt(req.params.pageId), req.body);
    if (!page) return res.status(404).json({ error: "Not found" });
    res.json(page);
  });

  app.post(
    "/api/newspapers/:id/final-files",
    publicationUpload.fields([
      { name: "scribusFile", maxCount: 1 },
      { name: "printPdf", maxCount: 1 },
    ]),
    (req, res) => {
      const files = req.files || {};
      const updates = {};
      if (files.scribusFile?.[0])
        updates.scribusFile = `/uploads/${files.scribusFile[0].filename}`;
      if (files.printPdf?.[0])
        updates.printPdf = `/uploads/${files.printPdf[0].filename}`;
      if (!Object.keys(updates).length)
        return res
          .status(400)
          .json({ error: "Choose a Scribus .sla file or final PDF" });
      updates.status = files.printPdf?.[0] ? "finalised" : "draft";
      const newspaper = updateNewspaper(parseInt(req.params.id, 10), updates);
      if (!newspaper) return res.status(404).json({ error: "Not found" });
      res.json(newspaper);
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
