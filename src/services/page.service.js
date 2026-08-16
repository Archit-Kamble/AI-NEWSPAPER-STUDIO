const pageRepository = require('../repositories/page.repository');
const newspaperRepository = require('../repositories/newspaper.repository');
const reviewInvalidation = require('./reviewInvalidation.service');

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

// Recreates a page's required structural furniture (see templates.js's
// STRUCTURAL_FRAME_KEYS) when its row is missing - a repair of a known
// invariant, never a creative layout choice, so it never touches an
// editorial frame. Idempotent: a page already carrying every structural
// frame reports `created: []` on every call.
async function repairStructuralFrames(id) {
  const pageId = parseInt(id, 10);
  const page = await pageRepository.findById(pageId);
  if (!page) return null;

  const repair = await pageRepository.ensureStructuralTemplateFrames(pageId);
  if (repair.created.length) await reviewInvalidation.invalidatePage(pageId);

  return { ...repair, page: await pageRepository.findById(pageId) };
}

module.exports = { createPage, listPages, updatePage, setColour, reapplyFixtureGeometry, repairStructuralFrames };
