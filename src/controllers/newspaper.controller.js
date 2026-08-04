const newspaperService = require('../services/newspaper.service');
const editionStartService = require('../services/editionStart.service');
const { ladderFor } = require('../layout/ladder');

async function create(req, res) {
  const newspaper = await newspaperService.createNewspaper(req.body, req.session.user);
  res.status(201).json(newspaper);
}

// Start an edition: open the one for the date if it exists, otherwise make it,
// build its page ladder, carry the booked adverts forward and fill the day's
// standing features. One call, because it is one decision.
async function start(req, res) {
  const result = await editionStartService.startEdition(req.body, req.session.user);
  res.status(result.created ? 201 : 200).json(result);
}

// What a given page count would produce, so the desk can see the ladder before
// committing to it rather than after.
async function ladder(req, res) {
  res.json(ladderFor(req.query.pages));
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

module.exports = { create, start, ladder, list, latest, getOne, update, saveFinalFiles };
