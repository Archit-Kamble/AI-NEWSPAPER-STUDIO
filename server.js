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
const pageRoutes = require('./src/routes/page.routes');
const {
  authenticateUser,
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
  app.use("/api", pageRoutes);

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
