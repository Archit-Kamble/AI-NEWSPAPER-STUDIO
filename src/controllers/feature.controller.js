const features = require('../features');

// The day's standing features - राशिभविष्य, सूर्योदय-सूर्यास्त, दिनविशेष,
// सुविचार. Content that changes daily and needs no reporter. See
// src/features/index.js for how each one is classified and why the ones that
// would need a market or weather feed deliberately do not run.
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
  if (result.error) return res.status(result.unconfigured ? 503 : 400).json(result);
  res.json(result);
}

module.exports = { list, buildAll, buildOne };
