const newsImage = require('../services/newsImage.service');
const service = require('../services/sectionImage.service');
const pictureLink = require('../services/pictureLink.service');

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

/**
 * A PICTURE FROM A LINK, placed on this block.
 *
 * The desk has the URL - a wire photograph, an agency link, something sent by
 * email - and had no way to give it to a block short of downloading it by hand
 * and uploading it again.
 *
 * It ends in the SAME `service.add()` an uploaded picture does, so the corridor
 * snap, the default frame, the runaround and the exports all work on it without
 * knowing where it came from. What is different is only how the bytes arrived,
 * and pictureLink.service.js is where that is made safe: this is the one route
 * that makes the SERVER fetch an address somebody typed.
 */
async function addFromLink(req, res) {
  const fetched = await pictureLink.fetchPicture(req.body?.link);
  if (fetched.error) return res.status(400).json({ error: fetched.error });

  const images = await service.add(
    req.params.pageId, req.params.sectionId,
    { ...fetched.picture, ...(req.body?.caption ? { caption: req.body.caption } : {}) },
    req.session?.user?.id,
  );
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


/**
 * Candidate pictures for this block. PROPOSES only - nothing is placed.
 *
 * The response is a list a desk looks at and then drags onto the block through
 * the ordinary placement route, which is what keeps the human in the loop
 * where it matters: where a picture sits decides how the copy sets around it.
 */
async function propose(req, res) {
  const section = await service.sectionFor(req.params.pageId, req.params.sectionId);
  if (!section) return res.status(404).json({ error: 'No such block.' });
  const { candidates, warning } = await newsImage.propose(section, {
    count: req.body?.count,
    ownerId: req.session?.user?.id || null,
  });
  res.json({ candidates, warning, placed: false });
}

module.exports = {
  addFromLink,
  propose, list, add, move, remove, cutout };
