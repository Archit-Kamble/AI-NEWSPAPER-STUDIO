const service = require('../services/pageGuide.service');

const notFound = (res) => res.status(404).json({ error: 'Not found' });

async function list(req, res) {
  const guides = await service.list(req.params.pageId);
  if (!guides) return notFound(res);
  res.json(guides);
}

async function create(req, res) {
  const guides = await service.add(req.params.pageId, req.body);
  if (!guides) return notFound(res);
  res.status(201).json(guides);
}

async function move(req, res) {
  const guides = await service.move(req.params.pageId, req.params.guideId, req.body);
  if (!guides) return notFound(res);
  res.json(guides);
}

async function remove(req, res) {
  const guides = await service.remove(req.params.pageId, req.params.guideId);
  if (!guides) return notFound(res);
  res.json(guides);
}

module.exports = { list, create, move, remove };
