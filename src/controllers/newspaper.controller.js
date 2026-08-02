const newspaperService = require('../services/newspaper.service');

async function create(req, res) {
  const newspaper = await newspaperService.createNewspaper(req.body, req.session.user);
  res.status(201).json(newspaper);
}

async function list(req, res) {
  res.json(await newspaperService.listNewspapers());
}

async function latest(req, res) {
  const newspaper = await newspaperService.getLatestNewspaper();
  res.json(newspaper || null);
}

async function getOne(req, res) {
  const newspaper = await newspaperService.getNewspaper(req.params.id);
  if (!newspaper) return res.status(404).json({ error: 'Not found' });
  res.json(newspaper);
}

async function update(req, res) {
  const newspaper = await newspaperService.updateNewspaper(req.params.id, req.body);
  if (!newspaper) return res.status(404).json({ error: 'Not found' });
  res.json(newspaper);
}

async function saveFinalFiles(req, res) {
  const result = await newspaperService.saveFinalFiles(
    req.params.id,
    req.files || {},
    req.session.user,
  );
  if (result.error) return res.status(400).json({ error: result.error });
  if (result.notFound) return res.status(404).json({ error: 'Not found' });
  res.json(result.item);
}

module.exports = { create, list, latest, getOne, update, saveFinalFiles };
