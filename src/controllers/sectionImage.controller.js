const service = require('../services/sectionImage.service');

const notFound = (res) => res.status(404).json({ error: 'Not found' });

async function list(req, res) {
  const images = await service.list(req.params.pageId, req.params.sectionId);
  if (!images) return notFound(res);
  res.json(images);
}

async function add(req, res) {
  const images = await service.add(req.params.pageId, req.params.sectionId, req.body, req.session?.user?.id);
  if (!images) return notFound(res);
  res.status(201).json(images);
}

async function move(req, res) {
  const images = await service.move(req.params.pageId, req.params.sectionId, req.params.imageId, req.body);
  if (!images) return notFound(res);
  res.json(images);
}

async function remove(req, res) {
  const images = await service.remove(req.params.pageId, req.params.sectionId, req.params.imageId);
  if (!images) return notFound(res);
  res.json(images);
}

// Replaces the picture with a background-removed cut-out. The alpha mask then
// feeds the character grid, so copy wraps the subject rather than its box.
async function cutout(req, res) {
  const origin = `${req.protocol}://${req.get('host')}`;
  const result = await service.cutout(req.params.pageId, req.params.sectionId, req.params.imageId, origin);
  if (result.error) return res.status(result.status || 500).json({ error: result.error });
  res.json(result.images);
}

module.exports = { list, add, move, remove, cutout };
