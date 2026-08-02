const pageSectionService = require('../services/pageSection.service');

async function update(req, res) {
  const page = await pageSectionService.saveSection(req.params.pageId, req.params.sectionId, req.body);
  if (!page) return res.status(404).json({ error: 'Not found' });
  res.json(page);
}

module.exports = { update };
