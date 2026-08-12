const pool = require('../config/db');
const pageRepository = require('../repositories/page.repository');
const { ladderFor, isSupportedEditionPageCount } = require('../layout/ladder');

const meaningfulFields = ['news_item_id', 'headline', 'subheading', 'body', 'kicker', 'caption', 'image_url', 'smart_card_key', 'smart_card_data', 'carried_from_section_id'];

function roleKey(rung) { return `${rung.templateKey}:${rung.why}`; }

function workReasons(page) {
  const reasons = [];
  for (const section of page.sections || []) {
    if (section.is_custom) reasons.push('custom block');
    if (meaningfulFields.some((field) => section[field] !== null && section[field] !== undefined && section[field] !== '')) reasons.push('editorial content');
    if ((section.images || []).length) reasons.push('image placement');
  }
  return [...new Set(reasons)];
}

function planEditionResize(pages, requestedCount) {
  if (!isSupportedEditionPageCount(requestedCount)) return { code: 'INVALID_EDITION_PAGE_COUNT', requestedCount };
  const target = ladderFor(requestedCount);
  const currentLadder = new Map(ladderFor(pages.length).map((rung) => [rung.pageNumber, rung]));
  const unused = new Set(pages.map((page) => page.id));
  const retained = []; const created = [];
  for (const rung of target) {
    const match = pages.find((page) => unused.has(page.id) && roleKey(currentLadder.get(page.page_number) || { templateKey: page.template_key, why: '' }) === roleKey(rung));
    if (match) { unused.delete(match.id); retained.push({ page: match, rung }); }
    else created.push(rung);
  }
  const removed = pages.filter((page) => unused.has(page.id));
  const blockers = removed.map((page) => ({ pageNumber: page.page_number, role: page.template_key, reasons: workReasons(page) })).filter((page) => page.reasons.length);
  return { currentCount: pages.length, requestedCount, retained, created, removed, blockers };
}

async function resizeEdition(newspaperId, requestedCount) {
  if (!isSupportedEditionPageCount(requestedCount)) return { ok: false, code: 'INVALID_EDITION_PAGE_COUNT', requestedCount };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pages = await pageRepository.findByNewspaper(newspaperId);
    const plan = planEditionResize(pages, requestedCount);
    if (plan.blockers.length) { await client.query('ROLLBACK'); return { ok: false, code: 'EDITION_RESIZE_HAS_CONTENT', ...plan }; }
    // First move retained pages out of the unique (newspaper_id,page_number)
    // namespace, then assign their target positions.
    for (const item of plan.retained) await client.query('UPDATE pages SET page_number = $2 WHERE id = $1', [item.page.id, -item.page.id]);
    for (const page of plan.removed) await client.query('DELETE FROM pages WHERE id = $1', [page.id]);
    for (const item of plan.retained) await client.query('UPDATE pages SET page_number = $2 WHERE id = $1', [item.page.id, item.rung.pageNumber]);
    for (const rung of plan.created) await pageRepository.createInTransaction(newspaperId, rung.pageNumber, rung.templateKey, client);
    await pageRepository.refreshFormes(newspaperId, client);
    const { rows: finalPages } = await client.query('SELECT page_number, template_key FROM pages WHERE newspaper_id = $1 ORDER BY page_number', [newspaperId]);
    const expected = ladderFor(requestedCount);
    if (finalPages.length !== expected.length || finalPages.some((page, index) => page.page_number !== expected[index].pageNumber || page.template_key !== expected[index].templateKey)) throw new Error('Edition resize invariant failed');
    await client.query('COMMIT');
    return { ok: true, plan, pageCount: finalPages.length, ladder: expected };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

module.exports = { planEditionResize, resizeEdition, workReasons };
