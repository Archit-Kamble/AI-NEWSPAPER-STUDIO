const pool = require('../config/db');
const { getTemplate } = require('../layout/templates');

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
      await client.query(
        `INSERT INTO page_sections (page_id, section_key, x_px, y_px, width_px, height_px, z_index)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [page.id, section.key, section.x, section.y, section.width, section.height, index]
      );
    }
    await client.query('COMMIT');
    return findById(page.id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function findByNewspaper(newspaperId) {
  const { rows } = await pool.query('SELECT * FROM pages WHERE newspaper_id = $1 ORDER BY page_number', [newspaperId]);
  return Promise.all(rows.map((page) => hydrate(page)));
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM pages WHERE id = $1', [id]);
  return rows[0] ? hydrate(rows[0]) : null;
}

async function hydrate(page) {
  const { rows: sections } = await pool.query(
    `SELECT * FROM page_sections WHERE page_id = $1 ORDER BY z_index, id`, [page.id]
  );
  return { ...page, sections };
}

async function updateTemplate(pageId, templateKey) {
  const template = getTemplate(templateKey);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE pages SET template_key = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [pageId, template.key]);
    await client.query('DELETE FROM page_sections WHERE page_id = $1 AND news_item_id IS NULL', [pageId]);
    const { rows: existing } = await client.query('SELECT section_key FROM page_sections WHERE page_id = $1', [pageId]);
    const existingKeys = new Set(existing.map((section) => section.section_key));
    for (let index = 0; index < template.sections.length; index += 1) {
      const section = template.sections[index];
      if (existingKeys.has(section.key)) {
        await client.query(
          `UPDATE page_sections SET x_px = $3, y_px = $4, width_px = $5, height_px = $6, z_index = $7, updated_at = CURRENT_TIMESTAMP
           WHERE page_id = $1 AND section_key = $2`,
          [pageId, section.key, section.x, section.y, section.width, section.height, index]
        );
      } else {
        await client.query(
          `INSERT INTO page_sections (page_id, section_key, x_px, y_px, width_px, height_px, z_index)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [pageId, section.key, section.x, section.y, section.width, section.height, index]
        );
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

async function saveSection(pageId, sectionKey, updates) {
  const { rows } = await pool.query(
    `UPDATE page_sections
     SET news_item_id = $3, headline = $4, headline_font_px = $5, subheading = $6, subheading_font_px = $7,
         body = $8, body_font_px = $9, category = $10, location = $11, tags = $12, reporter_name = $13,
         ai_notes = $14, updated_at = CURRENT_TIMESTAMP
     WHERE page_id = $1 AND section_key = $2 RETURNING *`,
    [pageId, sectionKey, updates.newsItemId || null, updates.headline || null, updates.headlineFontPx || 34,
      updates.subheading || null, updates.subheadingFontPx || 20, updates.body || null, updates.bodyFontPx || 16,
      updates.category || null, updates.location || null, updates.tags || null, updates.reporterName || null, updates.aiNotes || null]
  );
  return rows[0] || null;
}

module.exports = { create, findByNewspaper, findById, updateTemplate, saveSection };
