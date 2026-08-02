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
  res.json(await newsService.listNews(req.query));
}

async function listByStatus(req, res) {
  res.json(await newsService.getNewsByStatus(req.params.status));
}

async function getOne(req, res) {
  const item = await newsService.getNews(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
}

async function update(req, res) {
  const result = await newsService.updateNews(req.params.id, {
    body: req.body,
    files: req.files,
  });
  if (result.notFound) return res.status(404).json({ error: 'Not found' });
  res.json(result.item);
}

async function updateStatus(req, res) {
  const result = await newsService.updateNewsStatus(req.params.id, req.body.status);
  if (result.error) return res.status(400).json({ error: result.error });
  if (result.notFound) return res.status(404).json({ error: 'Not found' });
  res.json(result.item);
}

module.exports = { create, list, listByStatus, getOne, update, updateStatus };
