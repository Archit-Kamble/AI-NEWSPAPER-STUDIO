const settingsService = require('../services/settings.service');

async function general(req, res) { res.json(await settingsService.generalSettings()); }
async function saveGeneral(req, res) {
  const result = await settingsService.saveGeneralSettings(req.body, req.session.user);
  if (result.error) return res.status(400).json(result);
  res.json(result.settings);
}

module.exports = { general, saveGeneral };
