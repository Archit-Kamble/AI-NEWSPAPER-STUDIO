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
const editionFeatures = require('./src/services/editionFeatures.service');
const jump = require('./src/services/jump.service');
const districtEditions = require('./src/services/districtEdition.service');
const epaper = require('./src/services/epaper.service');
const scribus = require('./src/services/scribus.service');
const plainTextModule = require('./src/layout/plain-text');
const preflight = require('./src/services/preflight.service');
const worklist = require('./src/services/worklist.service');
const fit = require('./src/services/fit.service');
const pressPackage = require('./src/services/pressPackage.service');
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

  // Fills every block on an edition that the layout marked as a standing
  // feature, for that edition's own date. One press, one pass, and one model
  // call for everything a model writes.
  app.post("/api/newspapers/:id/features", requireDesk, asyncRoute(async (req, res) => {
    const result = await editionFeatures.fillEdition(parseInt(req.params.id, 10), { tier: req.body?.tier });
    if (!result) return res.status(404).json({ error: "No such edition." });
    res.json(result);
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

  // District editions: one paper with some pages swapped, not many papers.
  app.post("/api/newspapers/:id/district-editions", requireDesk, asyncRoute(async (req, res) => {
    const result = await districtEditions.createDistrictEdition(parseInt(req.params.id, 10), req.body || {});
    if (!result) return res.status(404).json({ error: "No such edition." });
    if (result.error) return res.status(400).json(result);
    res.status(201).json(result);
  }));

  app.get("/api/newspapers/:id/district-editions", asyncRoute(async (req, res) => {
    res.json(await districtEditions.siblingsOf(parseInt(req.params.id, 10)));
  }));

  // Every page as it will print - a district edition's own pages, with its
  // parent's filling the numbers it did not take over.
  app.get("/api/newspapers/:id/printed-pages", asyncRoute(async (req, res) => {
    const pages = await districtEditions.pagesOf(parseInt(req.params.id, 10));
    if (!pages) return res.status(404).json({ error: "No such edition." });
    res.json(pages);
  }));

  // The e-paper: the edition as structured data with hotspot rectangles, and as
  // a plain readable page that a search engine can actually index.
  app.get("/api/newspapers/:id/epaper", asyncRoute(async (req, res) => {
    const edition = await epaper.buildEdition(parseInt(req.params.id, 10));
    if (!edition) return res.status(404).json({ error: "No such edition." });
    res.json(edition);
  }));

  app.get("/epaper/:id", asyncRoute(async (req, res) => {
    const edition = await epaper.buildEdition(parseInt(req.params.id, 10));
    if (!edition) return res.status(404).type("html").send("<h1>No such edition.</h1>");
    res.type("html").send(epaper.renderHtml(edition));
  }));

  // Preflight. Everything that must be true before a page reaches the plate:
  // pictures with enough real resolution for 300 dpi, copy that fits, nothing
  // outside the matter, nothing overlapping, no jump that leads nowhere.
  app.get("/api/newspapers/:id/preflight", requireDesk, asyncRoute(async (req, res) => {
    const report = await preflight.checkEdition(parseInt(req.params.id, 10));
    if (!report) return res.status(404).json({ error: "No such edition." });
    res.json(report);
  }));

  // What this edition still needs: every block that is not finished, in page
  // order, with the exact number of characters it holds. The question a night
  // desk asks constantly, answered without clicking through every block.
  app.get("/api/newspapers/:id/worklist", requireDesk, asyncRoute(async (req, res) => {
    const list = await worklist.forEdition(parseInt(req.params.id, 10));
    if (!list) return res.status(404).json({ error: "No such edition." });
    res.json(list);
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

  // Where the edition stands, and passing a page for press. A page cannot be
  // passed while preflight still finds errors on it.
  app.get("/api/newspapers/:id/status", requireDesk, asyncRoute(async (req, res) => {
    const status = await signoff.editionStatus(parseInt(req.params.id, 10));
    if (!status) return res.status(404).json({ error: "No such edition." });
    res.json(status);
  }));

  app.get("/api/newspapers/:id/history", requireDesk, asyncRoute(async (req, res) => {
    res.json(await signoff.history(parseInt(req.params.id, 10)));
  }));

  app.patch("/api/pages/:pageId/state", requireDesk, asyncRoute(async (req, res) => {
    const result = await signoff.setPageState(parseInt(req.params.pageId, 10), req.body?.state, req.session.user);
    if (!result) return res.status(404).json({ error: "No such page." });
    if (result.error) return res.status(409).json(result);
    res.json(result);
  }));

  // The press file. Generates a Scribus document of the whole edition, in
  // millimetres and CMYK, which the page designer opens, adjusts and exports as
  // the final PDF - the pipeline CLAUDE.md describes, whose middle was missing.
  app.get("/api/newspapers/:id/scribus", requireDesk, asyncRoute(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM newspapers WHERE id = $1", [parseInt(req.params.id, 10)]);
    if (!rows[0]) return res.status(404).json({ error: "No such edition." });
    const pages = await districtEditions.pagesOf(rows[0].id);
    await plainTextModule.load();
    const sla = scribus.buildDocument(rows[0], pages);

    await signoff.record(rows[0].id, req.session.user?.id, "Scribus document generated");
    const date = String(rows[0].publication_date).slice(0, 10);
    res.type("application/vnd.scribus")
      .set("Content-Disposition", `attachment; filename="sahas-${date}.sla"`)
      .send(sla);
  }));

  // The press package. The .sla alone is not a deliverable - it points at
  // pictures by path, and those paths mean nothing once the file has been
  // downloaded. This ships the document and the photographs it uses together,
  // which is what "package for output" means in every layout application.
  app.get("/api/newspapers/:id/press-package", requireDesk, asyncRoute(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM newspapers WHERE id = $1", [parseInt(req.params.id, 10)]);
    if (!rows[0]) return res.status(404).json({ error: "No such edition." });

    const pages = await districtEditions.pagesOf(rows[0].id);
    await plainTextModule.load();
    const sla = scribus.buildDocument(rows[0], pages);
    const { zip, pictures, missing } = await pressPackage.build(rows[0], pages, sla);

    await signoff.record(
      rows[0].id, req.session.user?.id,
      `Press package generated (${pages.length} pages, ${pictures} pictures${missing.length ? `, ${missing.length} missing` : ""})`,
    );
    const date = String(rows[0].publication_date).slice(0, 10);
    res.type("application/zip")
      .set("Content-Disposition", `attachment; filename="sahas-${date}-press.zip"`)
      .set("X-Pictures-Included", String(pictures))
      .set("X-Pictures-Missing", String(missing.length))
      .send(zip);
  }));

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
