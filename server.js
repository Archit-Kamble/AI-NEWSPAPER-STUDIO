require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const dotenv = require("dotenv");
const multer = require("multer");
const { templates } = require('./src/layout/templates');
const { geometryOf } = require('./src/layout/geometry');
const { identityFor } = require('./src/layout/identity');
const features = require('./src/features');
const ai = require('./src/services/ai');
const storyWriter = require('./src/services/storyWriter.service');
const jump = require('./src/services/jump.service');
const fit = require('./src/services/fit.service');
const signoff = require('./src/services/signoff.service');
const pageRepository = require('./src/repositories/page.repository');
const pool = require('./src/config/db');
const { quote } = require('./src/layout/rateCard');
const { asyncRoute } = require('./src/middleware/asyncRoute');
const { deskWrites, requireDesk, requireSignIn } = require('./src/middleware/auth');
const { syncTemplates } = require('./src/layout/syncTemplates');
const { upload } = require('./src/middleware/upload');
const newsRoutes = require('./src/routes/news.routes');
const newspaperRoutes = require('./src/routes/newspaper.routes');
const pageRoutes = require('./src/routes/page.routes');
const authRoutes = require('./src/routes/auth.routes');
const newspaperController = require('./src/controllers/newspaper.controller');

dotenv.config();

// A quote for one block. The arithmetic lives in src/layout/rateCard.js; this
// only fetches the three things it needs - the block, its page, and how many
// pages the edition has, because position is most of the price.
async function advertRate(pageId, sectionKey) {
  const { rows } = await pool.query(
    `SELECT ps.*, p.page_number, p.prints_colour, p.newspaper_id
       FROM page_sections ps JOIN pages p ON p.id = ps.page_id
      WHERE ps.page_id = $1 AND ps.section_key = $2`,
    [pageId, sectionKey],
  );
  const section = rows[0];
  if (!section) return null;

  const { rows: counts } = await pool.query(
    'SELECT COUNT(*)::int AS total FROM pages WHERE newspaper_id = $1',
    [section.newspaper_id],
  );
  const { rows: papers } = await pool.query('SELECT * FROM newspapers WHERE id = $1', [section.newspaper_id]);

  return quote(section, section, { totalPages: counts[0].total, newspaper: papers[0] });
}

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

  // The day's standing features - राशिभविष्य, सूर्योदय-सूर्यास्त, दिनविशेष,
  // सुविचार. Content that changes daily and needs no reporter. See
  // src/features/index.js for how each one is classified and why the ones that
  // would need a market or weather feed deliberately do not run.
  app.get("/api/features", (req, res) => {
    res.json(features.list());
  });

  // Which provider writes this paper's copy, who covers for it, and the tiers
  // of effort on offer. The editor reads this to build its dropdown - so the
  // menu describes the newsroom that is actually configured rather than a fixed
  // list of names, and says plainly when nothing is set up at all.
  app.get("/api/ai/status", requireDesk, (req, res) => {
    res.json(ai.status());
  });

  // Write a story into one block from a few words.
  //
  // The desk types "जंतरमंतर आंदोलन" and gets back a headline, a subheading and
  // body copy measured to the space that block actually has - the character
  // grid does the measuring, the same grid the worklist, the fit action and
  // preflight use. It returns a PROPOSAL and writes nothing: AI assists, it
  // never owns (VISION.md), so the desk accepts it and the block it lands in is
  // marked needs_review.
  app.post("/api/pages/:pageId/sections/:sectionKey/write", requireDesk, asyncRoute(async (req, res) => {
    const result = await storyWriter.write(
      parseInt(req.params.pageId, 10),
      req.params.sectionKey,
      {
        seed: req.body?.seed,
        notes: req.body?.notes,
        tier: req.body?.tier,
        language: req.body?.language,
      },
    );
    if (result.error) return res.status(result.unconfigured ? 503 : 400).json(result);
    res.json(result);
  }));

  // Filling the space a block has LEFT. Not a rewrite: what is already written
  // - possibly a reporter's copy - is kept word for word and carried on into
  // the white space under it. A proposal, like everything else the AI does.
  app.post("/api/pages/:pageId/sections/:sectionKey/fill", requireDesk, asyncRoute(async (req, res) => {
    const result = await storyWriter.fillRemaining(
      parseInt(req.params.pageId, 10),
      req.params.sectionKey,
      { notes: req.body?.notes, tier: req.body?.tier, language: req.body?.language },
    );
    if (result.error) return res.status(result.unconfigured ? 503 : 400).json(result);
    res.json(result);
  }));

  // Everything buildable for a date, with the model-written boxes done in a
  // single call rather than one per box.
  app.post("/api/features/build", requireDesk, asyncRoute(async (req, res) => {
    const date = req.body?.date || req.query.date;
    if (!date) return res.status(400).json({ error: "A date is required." });
    res.json(await features.buildAll(date, {
      charsPerSign: Number(req.body?.charsPerSign) || undefined,
      tier: req.body?.tier,
    }));
  }));

  app.post("/api/features/:key", requireDesk, asyncRoute(async (req, res) => {
    const date = req.body?.date || req.query.date;
    if (!date) return res.status(400).json({ error: "A date is required." });
    const result = await features.build(req.params.key, date, {
      charsPerSign: Number(req.body?.charsPerSign) || undefined,
      tier: req.body?.tier,
    });
    if (result.error) return res.status(result.unconfigured ? 503 : 400).json(result);
    res.json(result);
  }));

  // Jump lines. A story that will not fit does not get cut - it continues on
  // another page, with the two lines a reader follows.
  app.post("/api/pages/:pageId/sections/:sectionKey/carry-over", requireDesk, asyncRoute(async (req, res) => {
    const result = await jump.carryOver(parseInt(req.params.pageId, 10), req.params.sectionKey, req.body || {});
    if (result.error) return res.status(400).json(result);
    res.json(result);
  }));

  app.post("/api/pages/:pageId/sections/:sectionKey/reunite", requireDesk, asyncRoute(async (req, res) => {
    const result = await jump.reunite(parseInt(req.params.pageId, 10), req.params.sectionKey);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  }));

  // Which pages print in colour. Defaulted from the press forme, overridable,
  // and used to warn when a photograph is about to print grey.
  app.patch("/api/pages/:pageId/colour", requireDesk, asyncRoute(async (req, res) => {
    const page = await pageRepository.setColourForme(parseInt(req.params.pageId, 10), req.body?.printsColour);
    if (!page) return res.status(404).json({ error: "No such page." });
    res.json(page);
  }));

  // What a block of space is worth, by column-centimetre and position.
  app.get("/api/pages/:pageId/sections/:sectionKey/rate", requireDesk, asyncRoute(async (req, res) => {
    const quote = await advertRate(parseInt(req.params.pageId, 10), req.params.sectionKey);
    if (!quote) return res.status(404).json({ error: "No such block." });
    res.json(quote);
  }));

  // Making a story fit. GET answers what would fit it; POST does it. A desk
  // sees the change before it happens rather than after.
  app.get("/api/pages/:pageId/sections/:sectionKey/fit", requireDesk, asyncRoute(async (req, res) => {
    const result = await fit.fitSection(parseInt(req.params.pageId, 10), req.params.sectionKey);
    if (!result) return res.status(404).json({ error: "No such block." });
    res.json(result);
  }));

  app.post("/api/pages/:pageId/sections/:sectionKey/fit", requireDesk, asyncRoute(async (req, res) => {
    const result = await fit.fitSection(parseInt(req.params.pageId, 10), req.params.sectionKey, { apply: true });
    if (!result) return res.status(404).json({ error: "No such block." });
    res.json(result);
  }));

  app.patch("/api/pages/:pageId/state", requireDesk, asyncRoute(async (req, res) => {
    const result = await signoff.setPageState(parseInt(req.params.pageId, 10), req.body?.state, req.session.user);
    if (!result) return res.status(404).json({ error: "No such page." });
    if (result.error) return res.status(409).json(result);
    res.json(result);
  }));

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
