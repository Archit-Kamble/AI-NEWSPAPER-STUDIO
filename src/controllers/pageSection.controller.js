const pageSectionService = require('../services/pageSection.service');

async function update(req, res) {
  const page = await pageSectionService.saveSection(req.params.pageId, req.params.sectionId, req.body);
  if (!page) return res.status(404).json({ error: 'Not found' });
  res.json(page);
}

// Draw a new block on the page. The body carries the rectangle the editor
// dragged out; the service snaps it to the column grid before it is stored.
async function create(req, res) {
  const page = await pageSectionService.createSection(req.params.pageId, req.body);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  res.status(201).json(page);
}

async function remove(req, res) {
  const page = await pageSectionService.deleteSection(req.params.pageId, req.params.sectionId);
  if (!page) return res.status(404).json({ error: 'Not found' });
  res.json(page);
}

// Move or resize a block. Separate from `update` because it happens on drag and
// touches only the four geometry columns.
async function move(req, res) {
  const page = await pageSectionService.moveSection(req.params.pageId, req.params.sectionId, req.body);
  if (!page) return res.status(404).json({ error: 'Not found' });
  res.json(page);
}

module.exports = { update, create, remove, move };
