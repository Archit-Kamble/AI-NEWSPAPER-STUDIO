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
const { recipeFor } = require('../src/layout/design-recipes');
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
    console.log(`page ${pageNumber} -> ${templateKey}`);
  }

  const { rows: pages } = await pool.query(
    'SELECT id, page_number, template_key FROM pages WHERE newspaper_id = $1 ORDER BY page_number', [ED]);
  for (const page of pages) {
    const recipe = recipeFor(page.template_key);
    if (!recipe) continue;
    for (const [sectionKey, entry] of Object.entries(recipe)) {
      const saved = await sectionService.saveSection(page.id, sectionKey, {
        ...entry.style,
        insetPanels: entry.panels || [],
        // A placeholder kicker, only so a kicker-tab treatment has a tab to
        // draw on a fixture; the writer replaces it with the story's own.
        ...(entry.fixtureKicker ? { kicker: entry.fixtureKicker } : {}),
      });
      if (saved?.error) throw new Error(`p${page.page_number} ${sectionKey}: ${saved.error}`);

      const existing = (await imageService.list(page.id, sectionKey)) || [];
      for (const image of existing) await imageService.remove(page.id, sectionKey, image.id);
      for (const picture of entry.pictures || []) {
        const added = await imageService.add(page.id, sectionKey, {
          url: `/uploads/${picture.file}`, x: picture.x, y: picture.y,
          width: picture.width, height: picture.height, fitMode: 'cover',
        });
        if (!added || added.error) throw new Error(`p${page.page_number} ${sectionKey}: picture refused ${added?.error || ''}`);
      }
      console.log(`p${page.page_number} ${sectionKey.padEnd(16)} dressed, ${(entry.panels || []).length} panel(s), ${(entry.pictures || []).length} picture(s)`);
    }
  }
}

main().then(() => pool.end()).catch((error) => { console.error(error.message); pool.end(); process.exit(1); });
