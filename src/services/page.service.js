const pageRepository = require('../repositories/page.repository');

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

module.exports = { createPage, listPages, updatePage };
