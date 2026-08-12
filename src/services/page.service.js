const pageRepository = require('../repositories/page.repository');
const newspaperRepository = require('../repositories/newspaper.repository');

async function createPage(newspaperId, body) {
  return pageRepository.create(
    parseInt(newspaperId),
    body.pageNumber || 1,
    body.templateKey || body.template || 'front',
  );
}

async function listPages(newspaperId) {
  return pageRepository.findByNewspaper(parseInt(newspaperId, 10));
}

async function updatePage(id, updates) {
  if (!updates.templateKey && !updates.template) return pageRepository.findById(parseInt(id, 10));
  return pageRepository.updateTemplate(parseInt(id, 10), updates.templateKey || updates.template);
}

// Which pages print in colour. Defaulted from the press forme, overridable,
// and used to warn when a photograph is about to print grey.
async function setColour(id, printsColour) {
  return pageRepository.setColourForme(parseInt(id, 10), printsColour);
}
async function reapplyFixtureGeometry(id) {
  const page = await pageRepository.findById(parseInt(id, 10));
  if (!page) return null;
  const newspaper = await newspaperRepository.findById(page.newspaper_id);
  if (!String(newspaper?.publication_date || '').startsWith('2099-')) return { error: 'FIXTURE_ONLY' };
  return pageRepository.reapplyTemplateGeometry(page.id);
}

module.exports = { createPage, listPages, updatePage, setColour, reapplyFixtureGeometry };
