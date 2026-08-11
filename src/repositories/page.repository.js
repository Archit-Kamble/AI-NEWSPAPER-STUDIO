const pool = require('../config/db');
const { getTemplate } = require('../layout/templates');
const { typeScaleFor } = require('../layout/geometry');
const { printsColourByDefault } = require('../layout/formes');

// Creating a block from a template happens in two places - a new page and a
// layout change - and the two must not drift apart, so the statement and its
// values are written once. A template decides the block's kind and its rule
// treatment as well as its rectangle: an advert slot is not an article, and a
// boxed brief is boxed from the moment the page exists.
const insertSectionSql = `
  INSERT INTO page_sections (page_id, section_key, x_px, y_px, width_px, height_px, z_index,
                             headline_font_px, subheading_font_px, body_font_px,
                             block_type, story_type, editorial_priority,
                             border_style, headline_style, feature_key)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`;

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
  const template = getTemplate(templateKey);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO pages (newspaper_id, page_number, template_key) VALUES ($1, $2, $3) RETURNING *`,
      [newspaperId, pageNumber, template.key]
    );
    const page = rows[0];
    for (let index = 0; index < template.sections.length; index += 1) {
      const section = template.sections[index];
      await client.query(insertSectionSql, insertSectionValues(page.id, section, index));
    }
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

async function findByNewspaper(newspaperId) {
  const { rows } = await pool.query('SELECT * FROM pages WHERE newspaper_id = $1 ORDER BY page_number', [newspaperId]);
  return Promise.all(rows.map((page) => hydrate(page)));
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

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM pages WHERE id = $1', [id]);
  return rows[0] ? hydrate(rows[0]) : null;
}

async function hydrate(page) {
  const { rows: sections } = await pool.query(
    `SELECT * FROM page_sections WHERE page_id = $1 ORDER BY z_index, id`, [page.id]
  );
  // Pictures placed in a block are layout, not an attachment: the page canvas
  // has to draw them or a composed page looks empty of photographs.
  const { rows: images } = await pool.query(
    `SELECT si.*, ma.url
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
  return { ...page, sections: sections.map((s) => ({ ...s, images: bySection.get(s.id) || [] })) };
}

async function updateTemplate(pageId, templateKey) {
  const template = getTemplate(templateKey);
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
                                headline_font_px, subheading_font_px, body_font_px)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, $9, $10) RETURNING *`,
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
         text_align = COALESCE($29, text_align), column_count = COALESCE($30, column_count),
         margin_px = COALESCE($31, margin_px), line_height = COALESCE($32, line_height),
         letter_spacing_px = COALESCE($33, letter_spacing_px),
         paragraph_spacing_px = COALESCE($34, paragraph_spacing_px),
         list_style = COALESCE($35, list_style), drop_cap = $36,
         border_style = COALESCE($37, border_style), border_width_px = COALESCE($38, border_width_px),
         border_color = COALESCE($39, border_color),
         headline_style = COALESCE($40, headline_style), accent_color = COALESCE($41, accent_color),
         kicker = $42,
         smart_card_key = $43, smart_card_data = $44,
         story_type = COALESCE($45, story_type),
         editorial_priority = COALESCE($46, editorial_priority),
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
      updates.fontUnderline === true, updates.textAlign || null, updates.columnCount || null,
      Number.isFinite(updates.marginPx) ? updates.marginPx : null,
      updates.lineHeight || null,
      Number.isFinite(updates.letterSpacingPx) ? updates.letterSpacingPx : null,
      Number.isFinite(updates.paragraphSpacingPx) ? updates.paragraphSpacingPx : null,
      updates.listStyle || null, updates.dropCap === true,
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
        : null]
  );
  return rows[0] || null;
}

module.exports = {
  create,
  refreshFormes,
  setColourForme,
  findByNewspaper,
  findById,
  findSectionForRate,
  updateTemplate,
  saveSection,
  createSection,
  deleteSection,
  saveSectionGeometry,
};
