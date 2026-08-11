const pool = require('../config/db');
const repo = require('../repositories/pageGuide.repository');

// A guide is clamped to the page it is on, the same way clampToBlock() keeps
// a picture inside its block (sectionImage.service.js) - reused here as the
// same PRINCIPLE, not the same function, because the bound is the page's own
// width/height (from the newspaper), not a block's.
async function pageRow(pageId) {
  const { rows } = await pool.query(
    `SELECT p.id, n.page_width_px, n.page_height_px
       FROM pages p JOIN newspapers n ON n.id = p.newspaper_id
      WHERE p.id = $1`,
    [parseInt(pageId, 10)],
  );
  return rows[0] || null;
}

function clampPosition(page, orientation, value) {
  // A horizontal guide runs left-to-right, so it is placed by its Y (how far
  // down the page); a vertical guide runs top-to-bottom, placed by its X.
  const max = orientation === 'horizontal' ? Number(page.page_height_px) : Number(page.page_width_px);
  return Math.max(0, Math.min(Math.round(Number(value) || 0), Math.round(max)));
}

async function list(pageId) {
  const page = await pageRow(pageId);
  if (!page) return null;
  return repo.listByPage(page.id);
}

async function add(pageId, body) {
  const page = await pageRow(pageId);
  if (!page) return null;
  const orientation = body.orientation === 'vertical' ? 'vertical' : 'horizontal';
  const position = clampPosition(page, orientation, body.positionPx);
  await repo.create(page.id, orientation, position);
  return repo.listByPage(page.id);
}

async function move(pageId, guideId, body) {
  const page = await pageRow(pageId);
  if (!page) return null;
  const existing = await repo.findById(parseInt(guideId, 10));
  if (!existing || existing.page_id !== page.id) return null;

  const position = clampPosition(page, existing.orientation, body.positionPx);
  const updated = await repo.updatePosition(existing.id, position);
  if (!updated) return null;
  return repo.listByPage(page.id);
}

async function remove(pageId, guideId) {
  const page = await pageRow(pageId);
  if (!page) return null;
  const existing = await repo.findById(parseInt(guideId, 10));
  if (!existing || existing.page_id !== page.id) return null;

  const removed = await repo.remove(existing.id);
  if (!removed) return null;
  return repo.listByPage(page.id);
}

module.exports = { list, add, move, remove };
