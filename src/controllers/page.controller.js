const pageService = require('../services/page.service');

async function create(req, res) {
  const page = await pageService.createPage(req.params.newspaperId, req.body);
  res.status(201).json(page);
}

async function list(req, res) {
  const pages = await pageService.listPages(req.params.newspaperId);
  res.json(pages);
}

async function update(req, res) {
  const page = await pageService.updatePage(req.params.pageId, req.body);
  if (!page) return res.status(404).json({ error: 'Not found' });
  res.json(page);
}

module.exports = { create, list, update };
