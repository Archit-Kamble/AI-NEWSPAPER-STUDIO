// District editions.
//
// A district daily is not fifteen newspapers. It is one newspaper with two or
// three pages swapped: page one, the national and state pages and the leader
// are common to every district, while pages two and four carry that district's
// own news. Lokmat prints about fifteen editions this way off one core.
//
// The model that follows from that: a child edition OWNS only the pages that
// differ. Every other page is served from its parent. So page one is made up
// once, and correcting a headline on it corrects it in every district - which
// is the entire reason to work this way rather than copying the edition
// fifteen times.
//
// A copied edition would be fifteen chances to fix a mistake in fourteen
// places. This has one.

const pool = require('../config/db');
const pageRepository = require('../repositories/page.repository');

/**
 * Creates a district edition of a parent edition.
 *
 * `localPages` are the page numbers this district makes up for itself. They are
 * created from the parent's layout so the district desk starts from the same
 * page shape, but empty - it is their news that goes in.
 */
async function createDistrictEdition(parentId, { district, localPages = [], name } = {}) {
  const { rows: parents } = await pool.query('SELECT * FROM newspapers WHERE id = $1', [parentId]);
  const parent = parents[0];
  if (!parent) return null;
  if (parent.parent_edition_id) {
    return { error: 'A district edition cannot itself have district editions.' };
  }
  if (!district) return { error: 'A district edition needs a district.' };

  const { rows: parentPages } = await pool.query(
    'SELECT page_number, template_key FROM pages WHERE newspaper_id = $1 ORDER BY page_number',
    [parentId],
  );
  const known = new Set(parentPages.map((page) => page.page_number));
  const wanted = [...new Set(localPages.map(Number))].filter((n) => known.has(n));
  if (!wanted.length) {
    return { error: 'A district edition needs at least one page of its own that the parent also has.' };
  }

  const { rows } = await pool.query(
    `INSERT INTO newspapers (name, template, publication_date, status, parent_edition_id, district,
                             page_width_px, page_height_px, matter_width_px, matter_height_px, color_mode)
     VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [name || `${parent.name} — ${district}`, parent.template, parent.publication_date, parentId, district,
     parent.page_width_px, parent.page_height_px, parent.matter_width_px, parent.matter_height_px,
     parent.color_mode],
  );
  const child = rows[0];

  for (const pageNumber of wanted.sort((a, b) => a - b)) {
    const template = parentPages.find((page) => page.page_number === pageNumber).template_key;
    await pageRepository.create(child.id, pageNumber, template);
  }

  return { edition: child, localPages: wanted.sort((a, b) => a - b) };
}

/**
 * Every page of an edition as it will actually print.
 *
 * For a parent edition that is simply its own pages. For a district edition it
 * is its own pages, with the parent's page filling every number the district
 * did not take over. Each page says which it is, so the workspace can show a
 * common page as belonging to the parent rather than letting a district desk
 * edit what fifteen other districts share.
 */
async function pagesOf(newspaperId) {
  const { rows: papers } = await pool.query('SELECT * FROM newspapers WHERE id = $1', [newspaperId]);
  const paper = papers[0];
  if (!paper) return null;

  const own = await pageRepository.findByNewspaper(newspaperId);
  if (!paper.parent_edition_id) {
    return own.map((page) => ({ ...page, origin: 'own' }));
  }

  const parentPages = await pageRepository.findByNewspaper(paper.parent_edition_id);
  const ownNumbers = new Set(own.map((page) => page.page_number));

  const merged = [
    ...own.map((page) => ({ ...page, origin: 'local' })),
    ...parentPages
      .filter((page) => !ownNumbers.has(page.page_number))
      .map((page) => ({ ...page, origin: 'common', ownerEditionId: paper.parent_edition_id })),
  ];
  return merged.sort((a, b) => a.page_number - b.page_number);
}

/**
 * The district editions printed off one parent.
 */
async function siblingsOf(newspaperId) {
  const { rows } = await pool.query(
    `SELECT id, name, district, status FROM newspapers
      WHERE parent_edition_id = $1 ORDER BY district`,
    [newspaperId],
  );
  return rows;
}

module.exports = { createDistrictEdition, pagesOf, siblingsOf };
