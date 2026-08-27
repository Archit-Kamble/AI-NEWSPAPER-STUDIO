const features = require('../features');

// The day's standing features - राशिभविष्य, सूर्योदय-सूर्यास्त, दिनविशेष,
// सुविचार. Content that changes daily and needs no reporter. See
// src/features/index.js for how computed, curated, written and sourced-feed
// cards are kept distinct.
function list(req, res) {
  res.json(features.list());
}

// Everything buildable for a date, with the model-written boxes done in a
// single call rather than one per box.
async function buildAll(req, res) {
  const date = req.body?.date || req.query.date;
  if (!date) return res.status(400).json({ error: 'A date is required.' });
  res.json(await features.buildAll(date, {
    charsPerSign: Number(req.body?.charsPerSign) || undefined,
    tier: req.body?.tier,
  }));
}

async function buildOne(req, res) {
  const date = req.body?.date || req.query.date;
  if (!date) return res.status(400).json({ error: 'A date is required.' });
  const result = await features.build(req.params.key, date, {
    charsPerSign: Number(req.body?.charsPerSign) || undefined,
    tier: req.body?.tier,
  });
  if (result.error) return res.status(result.upstream ? 502 : result.unconfigured ? 503 : 400).json(result);
  res.json(result);
}

module.exports = { list, buildAll, buildOne };
