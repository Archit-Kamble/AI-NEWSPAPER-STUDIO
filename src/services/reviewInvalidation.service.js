const pool = require('../config/db');

async function invalidatePage(pageId, { tx } = {}) {
  const db = tx || pool;
  const { rows } = await db.query(
    `UPDATE pages SET production_state = CASE WHEN production_state = 'passed' THEN 'making_up' ELSE production_state END,
                      signoff_fingerprint = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING *`, [pageId],
  );
  return rows[0] || null;
}

async function revokeSection(sectionId, { tx } = {}) {
  const db = tx || pool;
  const { rows } = await db.query(
    `UPDATE page_sections
        SET status = CASE WHEN status IN ('ready','published') THEN CASE WHEN ai_generated THEN 'needs_review' ELSE 'editing' END ELSE status END,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING *`, [sectionId],
  );
  if (rows[0]) await invalidatePage(rows[0].page_id, { tx: db });
  return rows[0] || null;
}

module.exports = { invalidatePage, revokeSection };
