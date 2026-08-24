const newsService = require('../services/news.service');

async function create(req, res) {
  try {
    const result = await newsService.createNews({
      body: req.body,
      files: req.files,
      sessionUser: req.session.user,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(201).json(result.item);
  } catch (err) {
    console.error('Create News Error:', err);
    res.status(500).json({ error: 'Failed to create news' });
  }
}

async function list(req, res) {
  res.json(await newsService.listNews(req.query, req.session.user));
}

async function listByStatus(req, res) {
  res.json(await newsService.listNews({ status: req.params.status }, req.session.user));
}

async function getOne(req, res) {
  const result = await newsService.getNews(req.params.id, req.session.user);
  if (result.notFound) return res.status(404).json({ error: 'Not found' });
  if (result.forbidden) return res.status(403).json({ error: 'You can only view your own filings.' });
  res.json(result.item);
}

async function update(req, res) {
  const result = await newsService.updateNews(req.params.id, {
    body: req.body,
    files: req.files,
    sessionUser: req.session.user,
  });
  if (result.notFound) return res.status(404).json({ error: 'Not found' });
  if (result.forbidden) return res.status(403).json({ error: 'You can only edit your own filings.' });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result.item);
}

async function updateStatus(req, res) {
  const result = await newsService.updateNewsStatus(req.params.id, req.body.status, {
    reviewerId: req.session.user?.id,
    reviewNote: req.body.reviewNote,
  });
  if (result.error) return res.status(400).json({ error: result.error });
  if (result.notFound) return res.status(404).json({ error: 'Not found' });
  res.json(result.item);
}

module.exports = { create, list, listByStatus, getOne, update, updateStatus };
