const pool = require('../config/db');
const { getTemplate, getTemplateForPage, isStructuralTemplateFrame } = require('../layout/templates');
const { typeScaleFor } = require('../layout/geometry');
const { printsColourByDefault } = require('../layout/formes');

// Creating a block from a template happens in two places - a new page and a
// layout change - and the two must not drift apart, so the statement and its
// values are written once. A template decides the block's kind and its rule
// treatment as well as its rectangle: an advert slot is not an article, and a
// boxed brief is boxed from the moment the page exists.
//
// A NEW BLOCK IS SET IN THE PAPER'S OWN FACES, and this is not a nicety.
// `newspapers.body_family`/`display_family` are written ONTO the blocks when a
// desk sets the house style (newspaper.repository.js's setHouseStyle says why:
// resolving a fallback at read time would have to be threaded through the
// thirty-odd services that compose a stored row, and any one that forgot would
// measure a block in one face and print it in another). That write can only
// reach the blocks that EXIST when it runs - so every block added afterwards
// was born carrying NULL, which the compositor answers with its own serif/sans
// default. Measured on a real edition set in Mukta/Khand: press "+ Block" and
// the new block sets its story in Sahas Serif and its headline in the sans,
// on a page where nothing else does. This is the other half of the desk's
// report that changing the paper's face "works sometime, sometime not".
//
// Read as a sub-select on the page rather than passed in, so all four insert
// paths (a new page, a layout change, a template repair, and a hand-drawn
// block) get it without a second round trip and without any of them being able
// to forget. NULL stays NULL when the paper has chosen nothing, which is
// exactly the behaviour every existing row already has.
const HOUSE_FACE_SQL = (column) => `(SELECT n.${column} FROM pages p
     JOIN newspapers n ON n.id = p.newspaper_id WHERE p.id = $1)`;

const insertSectionSql = `
  INSERT INTO page_sections (page_id, section_key, x_px, y_px, width_px, height_px, z_index,
                             headline_font_px, subheading_font_px, body_font_px,
                             block_type, story_type, editorial_priority,
                             border_style, headline_style, feature_key,
                             font_family, display_family)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          ${HOUSE_FACE_SQL('body_family')}, ${HOUSE_FACE_SQL('display_family')})`;

function insertSectionValues(pageId, section, index) {
  const type = typeScaleFor(section.width, section.height);
  return [
    pageId, section.key, section.x, section.y, section.width, section.height, index,
    type.headlineFontPx, type.subheadingFontPx, type.bodyFontPx,
    section.blockType || 'article', section.storyType || 'STANDARD', section.editorialPriority || 3,
    section.borderStyle || 'none', section.headlineStyle || 'plain',
    section.featureKey || null,
  ];
}

async function create(newspaperId, pageNumber, templateKey = 'front') {
  const template = getTemplateForPage(templateKey, pageNumber);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const page = await createInTransaction(newspaperId, pageNumber, templateKey, client);
    await refreshFormes(newspaperId, client);
    await client.query('COMMIT');
    return findById(page.id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createInTransaction(newspaperId, pageNumber, templateKey, client) {
  const template = getTemplateForPage(templateKey, pageNumber);
  const { rows } = await client.query(
      `INSERT INTO pages (newspaper_id, page_number, template_key) VALUES ($1, $2, $3) RETURNING *`,
      [newspaperId, pageNumber, template.key]
  );
  const page = rows[0];
  for (let index = 0; index < template.sections.length; index += 1) {
    await client.query(insertSectionSql, insertSectionValues(page.id, template.sections[index], index));
  }
  return page;
}

// Colour is bought a forme at a time, and which pages a forme covers depends on
// how many pages the edition has. So the defaults are recomputed whenever the
// edition grows or shrinks - except on pages where the desk has said otherwise.
async function refreshFormes(newspaperId, client = pool) {
  const { rows } = await client.query(
    'SELECT id, page_number FROM pages WHERE newspaper_id = $1 ORDER BY page_number',
    [newspaperId],
  );
  const total = rows.length;
  for (const page of rows) {
    await client.query(
      'UPDATE pages SET prints_colour = $2 WHERE id = $1 AND colour_overridden = FALSE',
      [page.id, printsColourByDefault(page.page_number, total)],
    );
  }
  return total;
}

async function setColourForme(pageId, printsColour) {
  const { rows } = await pool.query(
    `UPDATE pages SET prints_colour = $2, colour_overridden = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING *`,
    [pageId, printsColour === true],
  );
  return rows[0] || null;
}

async function findByNewspaper(newspaperId, { tx } = {}) {
  const db = tx || pool;
  const { rows } = await db.query('SELECT * FROM pages WHERE newspaper_id = $1 ORDER BY page_number', [newspaperId]);
  return Promise.all(rows.map((page) => hydrate(page, db)));
}

// The one join a rate quote needs: the section, joined to its page for the
// page number and colour forme, and the newspaper id to look the paper up by.
async function findSectionForRate(pageId, sectionKey) {
  const { rows } = await pool.query(
    `SELECT ps.*, p.page_number, p.prints_colour, p.newspaper_id
       FROM page_sections ps JOIN pages p ON p.id = ps.page_id
      WHERE ps.page_id = $1 AND ps.section_key = $2`,
    [pageId, sectionKey],
  );
  return rows[0] || null;
}

async function findById(id, { tx } = {}) {
  const db = tx || pool;
  const { rows } = await db.query('SELECT * FROM pages WHERE id = $1', [id]);
  return rows[0] ? hydrate(rows[0], db) : null;
}

async function hydrate(page, db = pool) {
  const { rows: sections } = await db.query(
    `SELECT * FROM page_sections WHERE page_id = $1 ORDER BY z_index, id`, [page.id]
  );
  // Pictures placed in a block are layout, not an attachment: the page canvas
  // has to draw them or a composed page looks empty of photographs.
  //
  // ma.width_px/height_px are aliased in too - `si.*` alone leaves a cutout's
  // exclusion (exclusion.js, through image-geometry.js's resolvePlacedImage())
  // to fall back to the placement frame's own size for "the source's natural
  // dimensions", which is only right while the frame happens to share the
  // source's aspect ratio. A server consumer of a hydrated page (preflight,
  // press readiness, any exact composition) needs the SAME source dimensions
  // the browser already has, or it can silently compose a different Contain/
  // Cover fit than what a desk is actually looking at.
  const { rows: images } = await db.query(
    `SELECT si.*, ma.url, ma.width_px AS source_width_px, ma.height_px AS source_height_px
       FROM section_images si
       JOIN media_assets ma ON ma.id = si.media_asset_id
       JOIN page_sections ps ON ps.id = si.page_section_id
      WHERE ps.page_id = $1
      ORDER BY si.z_index, si.id`,
    [page.id],
  );
  const bySection = new Map();
  for (const image of images) {
    if (!bySection.has(image.page_section_id)) bySection.set(image.page_section_id, []);
    bySection.get(image.page_section_id).push(image);
  }
  // The page's own overlay pictures ride on every section, because that is
  // where the compositor asks for them: obstaclesOf() takes a section and
  // nothing else, and a block cannot be composed correctly without knowing
  // what is laid over it. Carried by reference, not copied.
  const overlays = Array.isArray(page.overlay_images) ? page.overlay_images : [];
  return {
    ...page,
    sections: sections.map((s) => ({
      ...s,
      images: bySection.get(s.id) || [],
      page_overlays: overlays,
    })),
  };
}

async function updateTemplate(pageId, templateKey) {
  const { rows: current } = await pool.query('SELECT page_number FROM pages WHERE id = $1', [pageId]);
  if (!current[0]) return null;
  const template = getTemplateForPage(templateKey, current[0].page_number);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE pages SET template_key = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [pageId, template.key]);
    // Changing a page's layout must never destroy an editor's work. Only blocks
    // that are genuinely empty - no linked story and nothing written into them -
    // are cleared out to make room for the new template. Anything carrying
    // content survives at its current position; the editor can see it on the
    // canvas and decide whether to move or delete it.
    await client.query(
      `DELETE FROM page_sections
        WHERE page_id = $1
          AND news_item_id IS NULL
          AND COALESCE(headline, '') = ''
          AND COALESCE(subheading, '') = ''
          AND COALESCE(body, '') = ''
          AND COALESCE(caption, '') = ''
          AND COALESCE(image_url, '') = ''`,
      [pageId],
    );
    const { rows: existing } = await client.query('SELECT section_key FROM page_sections WHERE page_id = $1', [pageId]);
    const existingKeys = new Set(existing.map((section) => section.section_key));
    for (let index = 0; index < template.sections.length; index += 1) {
      const section = template.sections[index];
      if (existingKeys.has(section.key)) {
        await client.query(
          `UPDATE page_sections
              SET x_px = $3, y_px = $4, width_px = $5, height_px = $6, z_index = $7,
                  block_type = $8,
                  -- A template recommends semantics for an empty frame. Once
                  -- a desk has filled it, semantic identity belongs to that
                  -- story and a layout switch must not overwrite it.
                  story_type = CASE WHEN news_item_id IS NULL
                    AND COALESCE(headline, '') = '' AND COALESCE(subheading, '') = ''
                    AND COALESCE(body, '') = '' AND COALESCE(caption, '') = ''
                    AND COALESCE(image_url, '') = '' THEN $9 ELSE story_type END,
                  editorial_priority = CASE WHEN news_item_id IS NULL
                    AND COALESCE(headline, '') = '' AND COALESCE(subheading, '') = ''
                    AND COALESCE(body, '') = '' AND COALESCE(caption, '') = ''
                    AND COALESCE(image_url, '') = '' THEN $10 ELSE editorial_priority END,
                  border_style = $11, headline_style = $12, feature_key = $13,
                  updated_at = CURRENT_TIMESTAMP
           WHERE page_id = $1 AND section_key = $2`,
          [pageId, section.key, section.x, section.y, section.width, section.height, index,
           section.blockType || 'article', section.storyType || 'STANDARD', section.editorialPriority || 3,
           section.borderStyle || 'none', section.headlineStyle || 'plain',
           section.featureKey || null]
        );
      } else {
        await client.query(insertSectionSql, insertSectionValues(pageId, section, index));
      }
    }
    await client.query('COMMIT');
    return findById(pageId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function geometryDiff(page, sections) {
  const template = getTemplateForPage(page.template_key, page.page_number);
  const storedByKey = new Map(sections.map((section) => [section.section_key, section]));
  const missing = template.sections.filter((section) => !storedByKey.has(section.key)).map((section) => section.key);
  const changes = template.sections.flatMap((target) => {
    const current = storedByKey.get(target.key);
    if (!current || current.is_custom) return [];
    const before = { x: Number(current.x_px), y: Number(current.y_px), width: Number(current.width_px), height: Number(current.height_px) };
    const after = { x: target.x, y: target.y, width: target.width, height: target.height };
    return Object.keys(after).some((key) => before[key] !== after[key])
      ? [{ pageId: page.id, pageNumber: page.page_number, sectionKey: target.key, before, after }]
      : [];
  });
  return { missing, changes };
}

async function previewEditionTemplateGeometry(newspaperId, client = pool) {
  const { rows: pages } = await client.query(
    'SELECT id, page_number, template_key FROM pages WHERE newspaper_id = $1 ORDER BY page_number, id', [newspaperId],
  );
  const result = [];
  for (const page of pages) {
    const { rows: sections } = await client.query(
      'SELECT section_key, x_px, y_px, width_px, height_px, COALESCE(is_custom, FALSE) AS is_custom FROM page_sections WHERE page_id = $1', [page.id],
    );
    const diff = geometryDiff(page, sections);
    result.push({ pageId: page.id, pageNumber: page.page_number, templateKey: page.template_key, ...diff });
  }
  return result;
}

// Applies only the four physical geometry columns for template-owned frames.
// It deliberately does not use updateTemplate(): that operation changes frame
// treatments and is inappropriate for a finished edition.
async function reapplyEditionTemplateGeometry(newspaperId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const preview = await previewEditionTemplateGeometry(newspaperId, client);
    // Missing template frames are reported by the preview and deliberately
    // left absent.  Creating one would invent an advert or overwrite the
    // desk's layout; existing matching frames can still be corrected safely.
    for (const page of preview) {
      for (const change of page.changes) {
        await client.query(
          `UPDATE page_sections
              SET x_px = $3, y_px = $4, width_px = $5, height_px = $6, updated_at = CURRENT_TIMESTAMP
            WHERE page_id = $1 AND section_key = $2 AND COALESCE(is_custom, FALSE) = FALSE`,
          [page.pageId, change.sectionKey, change.after.x, change.after.y, change.after.width, change.after.height],
        );
      }
    }
    const after = await previewEditionTemplateGeometry(newspaperId, client);
    if (after.some((page) => page.changes.length)) throw new Error('Geometry reapply verification failed');
    await client.query('COMMIT');
    return { before: preview, after };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Explicit fixture-only compatibility operation. The public fixture route is
// still restricted in page.service; it now has the same preservation contract.
async function reapplyTemplateGeometry(pageId) {
  const { rows: pages } = await pool.query('SELECT page_number, template_key FROM pages WHERE id = $1', [pageId]);
  if (!pages[0]) return null;
  const page = pages[0]; const template = getTemplateForPage(page.template_key, page.page_number);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let index = 0; index < template.sections.length; index += 1) {
      const section = template.sections[index];
      await client.query(`UPDATE page_sections SET x_px = $3, y_px = $4, width_px = $5, height_px = $6, updated_at = CURRENT_TIMESTAMP
        WHERE page_id = $1 AND section_key = $2 AND COALESCE(is_custom, FALSE) = FALSE`, [pageId, section.key, section.x, section.y, section.width, section.height]);
    }
    await client.query('COMMIT'); return findById(pageId);
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

// Recreates a page's REQUIRED structural furniture (templates.js's
// STRUCTURAL_FRAME_KEYS - today just the sold corner beside the nameplate)
// when its row is missing, without touching anything else on the page. An
// edition whose masthead-advert row was deleted before deletion was guarded
// (pageSection.service.js) still shows a blank reserved area rather than an
// actual frame; this repairs that, idempotently, on request.
//
// Deliberately not createSection() above: that assigns a `block-N` key and
// is_custom = TRUE, exactly the shape of a desk's own hand-drawn block. A
// structural frame is template-owned furniture, not custom editorial
// content, and must insert with the template's OWN key and geometry through
// the same statement `create()` uses for a brand new page - one insertion
// path, not a second copy of it for the repair case.
async function ensureStructuralTemplateFrames(pageId, { tx } = {}) {
  const db = tx || pool;
  const { rows: pages } = await db.query('SELECT id, page_number, template_key FROM pages WHERE id = $1', [pageId]);
  const page = pages[0];
  if (!page) return null;

  const template = getTemplateForPage(page.template_key, page.page_number);
  const { rows: existing } = await db.query('SELECT section_key FROM page_sections WHERE page_id = $1', [pageId]);
  const existingKeys = new Set(existing.map((row) => row.section_key));

  const created = [];
  for (let index = 0; index < template.sections.length; index += 1) {
    const section = template.sections[index];
    if (!isStructuralTemplateFrame(section) || existingKeys.has(section.key)) continue;
    await db.query(insertSectionSql, insertSectionValues(page.id, section, index));
    created.push(section.key);
  }
  return { created };
}

// Blocks drawn by hand on the canvas. A page is no longer limited to whatever
// its template declared - a dense inside page needs fifteen or twenty items,
// and an editor adds them where the page needs them.
async function createSection(pageId, geometry) {
  const { rows: existing } = await pool.query(
    `SELECT section_key FROM page_sections WHERE page_id = $1 AND section_key LIKE 'block-%'`,
    [pageId],
  );
  // Keys stay unique per page and stable once assigned, so the numbering picks
  // up after the highest one ever used rather than reusing a deleted key.
  const highest = existing.reduce((max, row) => {
    const n = parseInt(String(row.section_key).replace('block-', ''), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  const sectionKey = `block-${highest + 1}`;

  const { rows: zRows } = await pool.query(
    'SELECT COALESCE(MAX(z_index), 0) + 1 AS z FROM page_sections WHERE page_id = $1',
    [pageId],
  );

  const type = typeScaleFor(geometry.width, geometry.height);
  const { rows } = await pool.query(
    `INSERT INTO page_sections (page_id, section_key, x_px, y_px, width_px, height_px, z_index, is_custom,
                                headline_font_px, subheading_font_px, body_font_px,
                                font_family, display_family)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, $9, $10,
             ${HOUSE_FACE_SQL('body_family')}, ${HOUSE_FACE_SQL('display_family')}) RETURNING *`,
    [pageId, sectionKey, geometry.x, geometry.y, geometry.width, geometry.height, zRows[0].z,
     type.headlineFontPx, type.subheadingFontPx, type.bodyFontPx],
  );
  return rows[0];
}

async function deleteSection(pageId, sectionKey) {
  const { rowCount } = await pool.query('DELETE FROM page_sections WHERE page_id = $1 AND section_key = $2', [
    pageId,
    sectionKey,
  ]);
  return rowCount > 0;
}

// Moving and resizing a block is a separate write from editing its story: it
// happens on every drag frame, so it touches four columns and nothing else.
async function saveSectionGeometry(pageId, sectionKey, geometry) {
  const { rows } = await pool.query(
    `UPDATE page_sections
        SET x_px = $3, y_px = $4, width_px = $5, height_px = $6, updated_at = CURRENT_TIMESTAMP
      WHERE page_id = $1 AND section_key = $2 RETURNING *`,
    [pageId, sectionKey, geometry.x, geometry.y, geometry.width, geometry.height],
  );
  return rows[0] || null;
}

// Saving a section must not throw away what it was not asked about.
//
// This used to write `updates.headlineFontPx || 34` and so on, so any save that
// did not carry the presentational fields silently reset them: a block sized to
// its measure by typeScaleFor went back to a 34px headline the first time
// anything else about it was saved, and its character budget collapsed with it.
//
// Content columns keep the old behaviour, because for them a missing value
// genuinely does mean "clear it" - an editor deleting a headline must delete it.
// Presentational columns have no meaningful empty state, so a value that was not
// sent leaves the column alone.
// Saving a section must not throw away what it was not asked about.
//
// This used to write `updates.headlineFontPx || 34` and so on, so any save that
// did not carry the presentational fields silently reset them: a block sized to
// its measure by typeScaleFor went back to a 34px headline the first time
// anything else about it was saved, and its character budget collapsed with it.
//
// Content columns keep the old behaviour, because for them a missing value
// genuinely does mean "clear it" - an editor deleting a headline must delete it.
// Presentational columns have no meaningful empty state, so a value that was not
// sent leaves the column alone.
async function saveSection(pageId, sectionKey, updates) {
  const { rows } = await pool.query(
    `UPDATE page_sections
     SET news_item_id = $3, headline = $4, headline_font_px = COALESCE($5, headline_font_px),
         subheading = $6, subheading_font_px = COALESCE($7, subheading_font_px),
         body = $8, body_font_px = COALESCE($9, body_font_px),
         category = $10, location = $11, tags = $12, reporter_name = $13,
         ai_notes = $14, caption = $15, language = $16, status = $17, ai_generated = $18,
         image_url = $19, image_rotation = $20, image_zoom = $21, image_fit = $22,
         image_flip_h = $23, image_flip_v = $24,
         font_family = $25, font_weight = COALESCE($26, font_weight), font_italic = $27, font_underline = $28,
         text_align = COALESCE($29, text_align),
         -- 0 is the wire's word for AUTO (section-model.js): NULL means the
         -- desk has not said and the engine works the count out. Without the
         -- sentinel, COALESCE would make handing that decision back to the
         -- engine impossible - a null reads as "the payload did not mention
         -- this field", which is the behaviour every other column here wants.
         column_count = CASE WHEN $30 = 0 THEN NULL ELSE COALESCE($30, column_count) END,
         margin_px = COALESCE($31, margin_px), line_height = COALESCE($32, line_height),
         letter_spacing_px = COALESCE($33, letter_spacing_px),
         paragraph_spacing_px = COALESCE($34, paragraph_spacing_px),
         list_style = COALESCE($35, list_style), drop_cap_lines = COALESCE($36, drop_cap_lines),
         border_style = COALESCE($37, border_style), border_width_px = COALESCE($38, border_width_px),
         border_color = COALESCE($39, border_color),
         headline_style = COALESCE($40, headline_style), accent_color = COALESCE($41, accent_color),
         kicker = $42,
         smart_card_key = $43, smart_card_data = $44,
         story_type = COALESCE($45, story_type),
         editorial_priority = COALESCE($46, editorial_priority),
         headline_align = COALESCE($47, headline_align),
         subheading_align = COALESCE($48, subheading_align),
         -- NOT coalesced, deliberately: NULL is the paper's own white, and
         -- "no tint" is a value a desk chooses. COALESCE would make clearing
         -- a tint impossible.
         background_color = $49,
         -- Coalesced, so a save that does not mention panels leaves them
         -- alone; the panel editor sends the whole array, and an empty array
         -- (never null) is how the last one is taken off.
         inset_panels = COALESCE($50, inset_panels),
         display_family = COALESCE($51, display_family),
         -- Coalesced like every other presentational column: a payload that
         -- does not mention the dateline leaves it exactly as it was. The
         -- editor sends a real boolean whenever it sends anything at all.
         show_dateline = COALESCE($52, show_dateline),
         headline_locked = COALESCE($53, headline_locked),
         subheading_locked = COALESCE($54, subheading_locked),
         updated_at = CURRENT_TIMESTAMP
     WHERE page_id = $1 AND section_key = $2 RETURNING *`,
    [pageId, sectionKey, updates.newsItemId || null, updates.headline || null, updates.headlineFontPx || null,
      updates.subheading || null, updates.subheadingFontPx || null, updates.body || null, updates.bodyFontPx || null,
      updates.category || null, updates.location || null, updates.tags || null, updates.reporterName || null,
      updates.aiNotes || null, updates.caption || null, updates.language || null, updates.status || 'empty',
      updates.aiGenerated === true, updates.imageUrl || null, updates.imageRotation || 0,
      updates.imageZoom || 1, updates.imageFit || 'cover',
      updates.imageFlipH === true, updates.imageFlipV === true,
      updates.fontFamily || null, updates.fontWeight || null, updates.fontItalic === true,
      updates.fontUnderline === true, updates.textAlign || null,
      // Passed through as-is, INCLUDING 0 - which is the wire's word for AUTO
      // and is turned into NULL by the CASE above. `|| null` would have eaten
      // it and left the explicit count exactly where it was.
      Number.isInteger(updates.columnCount) ? updates.columnCount : null,
      Number.isFinite(updates.marginPx) ? updates.marginPx : null,
      updates.lineHeight || null,
      Number.isFinite(updates.letterSpacingPx) ? updates.letterSpacingPx : null,
      Number.isFinite(updates.paragraphSpacingPx) ? updates.paragraphSpacingPx : null,
      updates.listStyle || null,
      Number.isInteger(updates.dropCapLines) ? updates.dropCapLines : null,
      updates.borderStyle || null,
      Number.isFinite(updates.borderWidthPx) ? updates.borderWidthPx : null,
      updates.borderColor || null,
      updates.headlineStyle || null,
      updates.accentColor || null,
      updates.kicker || null,
      // Cleared together or set together: a card key with no payload is a block
      // that claims to hold a sudoku and cannot draw one. `null` for both is how
      // a card is discarded.
      updates.smartCardKey || null,
      updates.smartCardKey && updates.smartCardData ? JSON.stringify(updates.smartCardData) : null,
      updates.storyType || null,
      Number.isInteger(updates.editorialPriority)
        ? Math.min(5, Math.max(1, updates.editorialPriority))
        : null,
      // COALESCE like every other presentational column: a payload that does
      // not mention the headline's alignment leaves it exactly as it was.
      updates.headlineAlign || null,
      updates.subheadingAlign || null,
      updates.backgroundColor || null,
      updates.insetPanels === undefined ? null : JSON.stringify(updates.insetPanels),
      updates.displayFamily || null,
      typeof updates.showDateline === 'boolean' ? updates.showDateline : null,
      typeof updates.headlineLocked === 'boolean' ? updates.headlineLocked : null,
      typeof updates.subheadingLocked === 'boolean' ? updates.subheadingLocked : null]
  );
  return rows[0] || null;
}

const COMPOSED_STORY_COLUMNS = Object.freeze([
  'news_item_id', 'story_type', 'editorial_priority', 'kicker', 'headline', 'subheading', 'body', 'caption',
  'category', 'location', 'tags', 'reporter_name', 'ai_notes', 'language', 'status', 'ai_generated',
  'editorial_presentation',
]);

// B7B's narrow persistence seam. Composition may change editorial content but
// must never reset the destination frame's geometry, treatment or image state.
async function saveComposedStoryContent(pageId, sectionKey, story) {
  const { rows } = await pool.query(
    `UPDATE page_sections SET news_item_id = $3, story_type = $4, editorial_priority = $5,
       kicker = $6, headline = $7, subheading = $8, body = $9, caption = $10,
       category = $11, location = $12, tags = $13, reporter_name = $14,
       ai_notes = $15, language = $16, status = $17, ai_generated = $18, editorial_presentation = $19,
       updated_at = CURRENT_TIMESTAMP WHERE page_id = $1 AND section_key = $2 RETURNING *`,
    [pageId, sectionKey, story.newsItemId || null, story.storyType || 'STANDARD', story.editorialPriority || 3,
      story.kicker || null, story.headline || null, story.subheading || null, story.body || null, story.caption || null,
      story.category || null, story.location || null, story.tags || null, story.reporterName || null,
      story.aiNotes || null, story.language || 'Marathi', story.status || 'needs_review', story.aiGenerated === true,
      story.editorialPresentation ? JSON.stringify(story.editorialPresentation) : null],
  );
  return rows[0] || null;
}

async function saveComposedStoryBatch(pageId, items = [], { tx } = {}) {
  // The normal one-page caller still gets a self-contained transaction.  The
  // edition composer supplies its own client so every page is staged under one
  // outer COMMIT/ROLLBACK boundary.
  const client = tx || await pool.connect(); const ownsTransaction = !tx;
  try {
    if (ownsTransaction) await client.query('BEGIN');
    for (const item of items) {
      const story = item.story || {};
      const { rowCount } = await client.query(
        `UPDATE page_sections SET news_item_id = $3, story_type = $4, editorial_priority = $5,
         kicker = $6, headline = $7, subheading = $8, body = $9, caption = $10,
         category = $11, location = $12, tags = $13, reporter_name = $14,
         ai_notes = $15, language = $16, status = $17, ai_generated = $18, editorial_presentation = $19,
         updated_at = CURRENT_TIMESTAMP WHERE page_id = $1 AND section_key = $2`,
        [pageId, item.sectionKey, story.newsItemId || null, story.storyType || 'STANDARD', story.editorialPriority || 3,
          story.kicker || null, story.headline || null, story.subheading || null, story.body || null, story.caption || null,
          story.category || null, story.location || null, story.tags || null, story.reporterName || null,
          story.aiNotes || null, story.language || 'Marathi', story.status || 'needs_review', story.aiGenerated === true,
          story.editorialPresentation ? JSON.stringify(story.editorialPresentation) : null],
      );
      if (rowCount !== 1) throw new Error(`Composition target not found: ${item.sectionKey}`);
    }
    if (ownsTransaction) await client.query('COMMIT');
  } catch (error) { if (ownsTransaction) await client.query('ROLLBACK'); throw error; } finally { if (ownsTransaction) client.release(); }
  return findById(pageId, { tx: client });
}

/** The page's overlay pictures, replaced wholesale. */
async function setOverlays(pageId, overlays) {
  const { rows } = await pool.query(
    'UPDATE pages SET overlay_images = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
    [pageId, JSON.stringify(overlays || [])],
  );
  return rows[0] ? hydrate(rows[0]) : null;
}

/**
 * WHAT A BLOCK IS FOR - its kind, and which standing feature it carries.
 *
 * `feature_key` was written only by the layout/template path, and CLAUDE.md
 * recorded it as read-only to the desk: the layout decided what a frame was
 * reserved for, and nobody else could. That is right for a template and wrong
 * for a newsroom - the desk's report was "we cannot make this block rashi or
 * lead or anchor". A page is made up by a person, and which box carries the
 * horoscope this morning is their decision, not the template's.
 *
 * Only these two columns, and neither of them is copy: a purpose is not a
 * story, so nothing a desk has written can be lost by setting one.
 */
async function setPurpose(pageId, sectionKey, { blockType, featureKey }) {
  const { rows } = await pool.query(
    `UPDATE page_sections
        SET block_type = COALESCE($3, block_type),
            feature_key = $4,
            updated_at = CURRENT_TIMESTAMP
      WHERE page_id = $1 AND section_key = $2
      RETURNING id, section_key, block_type, feature_key`,
    [pageId, sectionKey, blockType || null, featureKey || null],
  );
  return rows[0] || null;
}

module.exports = {
  setPurpose,
  setOverlays,
  create,
  createInTransaction,
  refreshFormes,
  setColourForme,
  findByNewspaper,
  findById,
  findSectionForRate,
  updateTemplate,
  reapplyTemplateGeometry,
  previewEditionTemplateGeometry,
  reapplyEditionTemplateGeometry,
  saveSection,
  saveComposedStoryContent,
  saveComposedStoryBatch,
  COMPOSED_STORY_COLUMNS,
  createSection,
  deleteSection,
  saveSectionGeometry,
  ensureStructuralTemplateFrames,
};
