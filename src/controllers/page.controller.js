const pageService = require('../services/page.service');
const signoffService = require('../services/signoff.service');

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

// Which pages print in colour. Defaulted from the press forme, overridable,
// and used to warn when a photograph is about to print grey.
async function overlays(req, res) {
  const page = await pageService.setOverlays(req.params.pageId, req.body?.overlays);
  if (!page) return res.status(404).json({ error: 'No such page.' });
  res.json(page);
}

async function colour(req, res) {
  const page = await pageService.setColour(req.params.pageId, req.body?.printsColour);
  if (!page) return res.status(404).json({ error: 'No such page.' });
  res.json(page);
}

// Where the edition stands, and passing a page for press. A page cannot be
// passed while preflight still finds errors on it.
async function state(req, res) {
  const result = await signoffService.setPageState(parseInt(req.params.pageId, 10), req.body?.state, req.session.user);
  if (!result) return res.status(404).json({ error: 'No such page.' });
  if (result.error) return res.status(409).json(result);
  res.json(result);
}
async function reapplyFixtureGeometry(req, res) {
  const page = await pageService.reapplyFixtureGeometry(req.params.pageId);
  if (!page) return res.status(404).json({ error: 'No such page.' });
  if (page.error) return res.status(403).json(page);
  res.json(page);
}

// Recreates a page's required structural furniture (the sold corner beside
// the nameplate today) when its row is missing - repairing a known
// invariant, not a layout decision, so it is safe to call on any real page.
async function repairStructuralFrames(req, res) {
  const result = await pageService.repairStructuralFrames(req.params.pageId);
  if (!result) return res.status(404).json({ error: 'No such page.' });
  res.json(result);
}

module.exports = {
  overlays, create, list, update, colour, state, reapplyFixtureGeometry, repairStructuralFrames };
