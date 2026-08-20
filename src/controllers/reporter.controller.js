const reporterService = require('../services/reporter.service');

async function list(req, res) { res.json(await reporterService.listReporters(req.query)); }

async function getOne(req, res) {
  const profile = await reporterService.reporterProfile(req.params.id);
  if (!profile) return res.status(404).json({ error: 'Reporter not found.' });
  res.json(profile);
}

async function create(req, res) {
  const result = await reporterService.createReporter(req.body);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result.reporter);
}

async function update(req, res) {
  const result = await reporterService.updateReporter(req.params.id, req.body);
  if (result.notFound) return res.status(404).json({ error: 'Reporter not found.' });
  if (result.error) return res.status(400).json(result);
  res.json(result.reporter);
}

async function access(req, res) {
  const result = await reporterService.setReporterAccess(req.params.id, req.body?.active);
  if (result.notFound) return res.status(404).json({ error: 'Reporter not found.' });
  if (result.error) return res.status(400).json(result);
  res.json(result.reporter);
}

module.exports = { list, getOne, create, update, access };
