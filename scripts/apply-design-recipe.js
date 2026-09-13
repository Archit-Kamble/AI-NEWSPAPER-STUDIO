// Dresses a disposable edition's blocks from a measured layout's recipe.
//
//   node scripts/apply-design-recipe.js <editionId> [pageNumber=templateKey ...]
//
// With page arguments it first puts those pages on those layouts (the same
// updatePage a desk's Layout picker calls), then applies the recipe to every
// page whose layout has one: styles and panels through saveSection, pictures
// through sectionImage.add. Both are the paths a desk's own edits take, so the
// palette boundary, the corridor snap and the panel clamp all apply.
//
// 2099-* EDITIONS ONLY, like fill-edition-copy.js. A section save here is a
// full replace for the fields it covers, so running it on a block that carries
// copy would blank the copy. Fill the copy AFTERWARDS:
//
//   node scripts/fill-edition-copy.js <editionId>
//
// Pictures are stand-ins from public/uploads - never the reference's own
// photographs.

require('dotenv').config();
const pool = require('../src/config/db');
const pageService = require('../src/services/page.service');
const sectionService = require('../src/services/pageSection.service');
const imageService = require('../src/services/sectionImage.service');
const { recipeFor, pageThemeFor } = require('../src/layout/design-recipes');
const pageRepository = require('../src/repositories/page.repository');
const { syncTemplates } = require('../src/layout/syncTemplates');

const ED = Number(process.argv[2]);
const assignments = process.argv.slice(3).map((arg) => {
  const [page, key] = arg.split('=');
  return { pageNumber: Number(page), templateKey: key };
});

async function main() {
  if (!Number.isInteger(ED)) throw new Error('usage: apply-design-recipe.js <editionId> [page=templateKey ...]');
  const { rows: [edition] } = await pool.query(
    "SELECT id, to_char(publication_date, 'YYYY-MM-DD') AS date FROM newspapers WHERE id = $1", [ED]);
  if (!edition) throw new Error(`no edition ${ED}`);
  if (!edition.date.startsWith('2099-')) throw new Error(`edition ${ED} is dated ${edition.date}; this script only dresses 2099 fixtures`);

  // The server mirrors templates.js into the `templates` table at boot, and
  // pages.template_key has a foreign key onto it - so a layout added since the
  // server last started cannot be assigned until the same sync has run.
  if (assignments.length) await syncTemplates();

  for (const { pageNumber, templateKey } of assignments) {
    const { rows: [page] } = await pool.query('SELECT id FROM pages WHERE newspaper_id = $1 AND page_number = $2', [ED, pageNumber]);
    if (!page) throw new Error(`edition ${ED} has no page ${pageNumber}`);
    if (!recipeFor(templateKey)) throw new Error(`no recipe for layout ${templateKey}`);
    await pageService.updatePage(page.id, { templateKey });
    // A layout measured on its own column grid needs the edition on that grid,
    // or a desk dragging a block snaps it back onto sixteen columns.
    const layout = require('../src/layout/templates').templates[templateKey];
    if (layout.grid) {
      await pool.query('UPDATE newspapers SET grid_columns = $2, grid_gutter_mm = $3 WHERE id = $1',
        [ED, layout.grid.columns, layout.grid.gutterMm]);
    }
    // A layout change keeps any block that carries content - right for a desk,
    // and on a fixture it leaves the previous layout's carried adverts
    // overlapping the new frames. This script only runs on 2099 fixtures, so
    // what the new layout does not name goes.
    const { templates } = require('../src/layout/templates');
    const wanted = new Set(templates[templateKey].sections.map((section) => section.key));
    const { rows: present } = await pool.query('SELECT section_key FROM page_sections WHERE page_id = $1', [page.id]);
    for (const { section_key: key } of present) {
      if (!wanted.has(key)) { await sectionService.deleteSection(page.id, key); console.log(`page ${pageNumber}: removed ${key}, not in ${templateKey}`); }
    }
    // The reference is printed in colour on every page; a fixture page left on
    // the ladder's one-colour forme previews grey and cannot be compared.
    await pageService.setColour(page.id, true);
    console.log(`page ${pageNumber} -> ${templateKey}`);
  }

  const { rows: pages } = await pool.query(
    'SELECT id, page_number, template_key FROM pages WHERE newspaper_id = $1 ORDER BY page_number', [ED]);
  // Given pages to assign, only those pages are dressed - dressing the rest
  // again would blank the copy on every other page of the fixture.
  const only = new Set(assignments.map((a) => a.pageNumber));
  for (const page of pages) {
    if (only.size && !only.has(page.page_number)) continue;
    const recipe = recipeFor(page.template_key);
    if (!recipe) continue;
    // The section the folio names - the theme column alone, never the styler.
    await pageRepository.setStyleTheme(page.id, pageThemeFor(page.template_key));
    const { rows: sizes } = await pool.query(
      'SELECT section_key, width_px, height_px FROM page_sections WHERE page_id = $1', [page.id]);
    const sizeOf = new Map(sizes.map((row) => [row.section_key, row]));
    for (const [sectionKey, entry] of Object.entries(recipe)) {
      const size = sizeOf.get(sectionKey);
      if (!size) { console.log(`p${page.page_number} ${sectionKey}: not on this page, skipped`); continue; }
      // `at: [x, y, width, height]` is a share of the block - how the later
      // pages are written - resolved here against the block the page really
      // has, so a recipe survives a block being a grid step wider or narrower.
      const place = (item) => {
        if (!Array.isArray(item.at)) return item;
        const [fx, fy, fw, fh] = item.at;
        const { at, ...rest } = item;
        const w = Number(size.width_px), h = Number(size.height_px);
        return { ...rest, x: Math.round(fx * w), y: Math.round(fy * h), width: Math.round(fw * w), height: Math.round(fh * h) };
      };
      const saved = await sectionService.saveSection(page.id, sectionKey, {
        ...entry.style,
        insetPanels: (entry.panels || []).map(place),
        // A hand-written advertisement, set by the paper's own advert card.
        ...(entry.advert ? { smartCardKey: 'advert', smartCardData: entry.advert } : {}),
        // A placeholder kicker, only so a kicker-tab treatment has a tab to
        // draw on a fixture; the writer replaces it with the story's own.
        ...(entry.fixtureKicker ? { kicker: entry.fixtureKicker } : {}),
      });
      if (saved?.error) throw new Error(`p${page.page_number} ${sectionKey}: ${saved.error}`);

      const existing = (await imageService.list(page.id, sectionKey)) || [];
      for (const image of existing) await imageService.remove(page.id, sectionKey, image.id);
      for (const picture of (entry.pictures || []).map(place)) {
        const added = await imageService.add(page.id, sectionKey, {
          url: `/uploads/${picture.file}`, x: picture.x, y: picture.y,
          width: picture.width, height: picture.height, fitMode: picture.fitMode || 'cover',
          ...(picture.standOffPx !== undefined ? { standOffPx: picture.standOffPx } : {}),
        });
        if (!added || added.error) throw new Error(`p${page.page_number} ${sectionKey}: picture refused ${added?.error || ''}`);
      }
      console.log(`p${page.page_number} ${sectionKey.padEnd(16)} dressed, ${(entry.panels || []).length} panel(s), ${(entry.pictures || []).length} picture(s)`);
    }
  }
}

main().then(() => pool.end()).catch((error) => { console.error(error.message); pool.end(); process.exit(1); });
