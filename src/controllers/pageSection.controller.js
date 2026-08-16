const pageSectionService = require('../services/pageSection.service');
const storyWriter = require('../services/storyWriter.service');
const jump = require('../services/jump.service');
const fit = require('../services/fit.service');

async function update(req, res) {
  const result = await pageSectionService.saveSection(req.params.pageId, req.params.sectionId, req.body);
  if (result?.error) return res.status(400).json({ error: result.error });
  const page = result;
  if (!page) return res.status(404).json({ error: 'Not found' });
  res.json(page);
}

// Draw a new block on the page. The body carries the rectangle the editor
// dragged out; the service snaps it to the column grid before it is stored.
async function create(req, res) {
  const page = await pageSectionService.createSection(req.params.pageId, req.body);
  if (!page) return res.status(404).json({ error: 'Page not found' });
  res.status(201).json(page);
}

async function remove(req, res) {
  const page = await pageSectionService.deleteSection(req.params.pageId, req.params.sectionId);
  if (!page) return res.status(404).json({ error: 'Not found' });
  // A frame the page reserves is not the desk's to remove. Told plainly,
  // because "nothing happened" would read as a bug.
  if (page.error === 'STRUCTURAL_FRAME_PROTECTED') {
    return res.status(409).json({
      error: 'This block is part of the page itself and cannot be removed. Clear its contents instead.',
      code: page.error,
      sectionKey: page.sectionKey,
    });
  }
  res.json(page);
}

// Move or resize a block. Separate from `update` because it happens on drag and
// touches only the four geometry columns.
async function move(req, res) {
  const page = await pageSectionService.moveSection(req.params.pageId, req.params.sectionId, req.body);
  if (!page) return res.status(404).json({ error: 'Not found' });
  res.json(page);
}

// Write a story into one block from a few words.
//
// The desk types "जंतरमंतर आंदोलन" and gets back a headline, a subheading and
// body copy measured to the space that block actually has - the character
// grid does the measuring, the same grid the worklist, the fit action and
// preflight use. It returns a PROPOSAL and writes nothing: AI assists, it
// never owns (VISION.md), so the desk accepts it and the block it lands in is
// marked needs_review.
async function write(req, res) {
  const result = await storyWriter.write(
    parseInt(req.params.pageId, 10),
    req.params.sectionKey,
    {
      seed: req.body?.seed,
      notes: req.body?.notes,
      tier: req.body?.tier,
      language: req.body?.language,
    },
  );
  if (result.error) return res.status(result.unconfigured ? 503 : 400).json(result);
  res.json(result);
}

// Filling the space a block has LEFT. Not a rewrite: what is already written
// - possibly a reporter's copy - is kept word for word and carried on into
// the white space under it. A proposal, like everything else the AI does.
async function fill(req, res) {
  const result = await storyWriter.fillRemaining(
    parseInt(req.params.pageId, 10),
    req.params.sectionKey,
    { notes: req.body?.notes, tier: req.body?.tier, language: req.body?.language },
  );
  if (result.error) return res.status(result.unconfigured ? 503 : 400).json(result);
  res.json(result);
}

// Jump lines. A story that will not fit does not get cut - it continues on
// another page, with the two lines a reader follows.
async function carryOver(req, res) {
  const result = await jump.carryOver(parseInt(req.params.pageId, 10), req.params.sectionKey, req.body || {});
  if (result.error) return res.status(400).json(result);
  res.json(result);
}

async function reunite(req, res) {
  const result = await jump.reunite(parseInt(req.params.pageId, 10), req.params.sectionKey);
  if (result.error) return res.status(400).json(result);
  res.json(result);
}

// Making a story fit. GET answers what would fit it; POST does it. A desk
// sees the change before it happens rather than after.
async function fitPreview(req, res) {
  const result = await fit.fitSection(parseInt(req.params.pageId, 10), req.params.sectionKey);
  if (!result) return res.status(404).json({ error: 'No such block.' });
  res.json(result);
}

async function fitApply(req, res) {
  const result = await fit.fitSection(parseInt(req.params.pageId, 10), req.params.sectionKey, { apply: true });
  if (!result) return res.status(404).json({ error: 'No such block.' });
  res.json(result);
}

// What a block of space is worth, by column-centimetre and position.
async function rate(req, res) {
  const quote = await pageSectionService.rateFor(parseInt(req.params.pageId, 10), req.params.sectionKey);
  if (!quote) return res.status(404).json({ error: 'No such block.' });
  res.json(quote);
}

module.exports = {
  update, create, remove, move,
  write, fill, carryOver, reunite, fitPreview, fitApply, rate,
};
