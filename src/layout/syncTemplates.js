// Keeps the `templates` table in step with src/layout/templates.js.
//
// `pages.template_key` has a foreign key onto `templates`, so a layout that
// exists only in JavaScript cannot be used - adding one to templates.js used to
// mean also remembering to add a row to schema.sql, and forgetting crashed page
// creation. That is the duplicated-catalog failure CLAUDE.md warns about.
//
// templates.js stays the single source of truth; this mirrors it into the table
// the foreign key needs, once, at boot.

const pool = require('../config/db');
const { templates } = require('./templates');
const { geometryOf } = require('./geometry');

async function syncTemplates() {
  const g = geometryOf({});
  const entries = Object.values(templates);

  for (const template of entries) {
    await pool.query(
      `INSERT INTO templates (template_key, name, page_width_px, page_height_px)
            VALUES ($1, $2, $3, $4)
       ON CONFLICT (template_key)
       DO UPDATE SET name = EXCLUDED.name,
                     page_width_px = EXCLUDED.page_width_px,
                     page_height_px = EXCLUDED.page_height_px`,
      [template.key, template.name, g.pageWidthPx, g.pageHeightPx],
    );
  }

  return entries.length;
}

module.exports = { syncTemplates };
