const pageSectionService = require('../services/pageSection.service');
const storyWriter = require('../services/storyWriter.service');
const jump = require('../services/jump.service');
const copyFit = require('../services/copyFit.service');
const pageRepository = require('../repositories/page.repository');
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
      // Only ever FALSE on request. An absent flag means the ordinary block -
      // a story with a headline and a deck over it - so an older caller, and
      // every server-side caller, behaves exactly as it did.
      // Only ever TRUE on request, so nothing that does not ask changes.
      lookUp: req.body?.lookUp === true,
      reason: req.body?.reason === true,
      searchWeb: req.body?.searchWeb === true,
      writeHeadline: req.body?.writeHeadline !== false,
      writeSubheading: req.body?.writeSubheading !== false,
      // A chart of the story's own figures, from the same call. Only ever TRUE
      // on request, so nothing that does not ask changes.
      writeChart: req.body?.writeChart === true,
      chartType: req.body?.chartType,
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
  try {
    const result = await fit.fitSection(parseInt(req.params.pageId, 10), req.params.sectionKey);
    if (!result) return res.status(404).json({ error: 'No such block.' });
    res.json(result);
  } catch (error) {
    if (error.message === 'EXACT_SHAPER_NOT_READY') {
      return res.status(503).json({ error: 'Real Marathi text shaping is not available right now. Try again in a moment.' });
    }
    throw error;
  }
}

async function fitApply(req, res) {
  try {
    const result = await fit.fitSection(parseInt(req.params.pageId, 10), req.params.sectionKey, { apply: true });
    if (!result) return res.status(404).json({ error: 'No such block.' });
    res.json(result);
  } catch (error) {
    if (error.message === 'EXACT_SHAPER_NOT_READY') {
      return res.status(503).json({ error: 'Real Marathi text shaping is not available right now. Try again in a moment.' });
    }
    throw error;
  }
}

// What a block of space is worth, by column-centimetre and position.
async function rate(req, res) {
  const quote = await pageSectionService.rateFor(parseInt(req.params.pageId, 10), req.params.sectionKey);
  if (!quote) return res.status(404).json({ error: 'No such block.' });
  res.json(quote);
}

/**
 * What this block is for, and - if asked - the feature put into it now.
 *
 * Addressed by `sectionKey` like every other production action on a block
 * (write, fill, carry-over, fit, rate), because that is how a block is
 * addressed once it is on a page.
 */
async function purpose(req, res) {
  const result = await pageSectionService.setPurpose(
    parseInt(req.params.pageId, 10), req.params.sectionKey, req.body || {},
  );
  if (result.notFound) return res.status(404).json({ error: 'Block not found.' });
  if (result.error) return res.status(400).json(result);
  res.json(result);
}

/**
 * ONE STORY, WRITTEN ACROSS TWO BLOCKS.
 *
 * The desk's report: "select one block then select another block in the next
 * page, and the APIs call for both blocks - the 1st with heading, subheading
 * and body, the 2nd with only body and an appropriate start, and the 1st with
 * an appropriate ending like continue in page 3."
 *
 * That is a jump, and this product already writes one correctly - carryOver()
 * has produced the jump line, the pick-up line and the link between the two
 * blocks since it was written. What was missing was the WRITING: a story
 * briefed for one block and then split leaves the second leg nearly empty.
 *
 * So this is one AI call, briefed for the pair: the landing block's own room is
 * measured by the same engine and added to the source's, and the settle trim is
 * skipped because here the overflow is not a failure - it is the second leg.
 * Nothing is left unmeasured: the SPLIT measures both blocks before it writes
 * either, and refuses in as many words when the tail is more than the landing
 * can hold.
 *
 * It returns a PROPOSAL, like every other thing the AI writes. Nothing reaches
 * the database here.
 */
async function writeAcross(req, res) {
  const pageId = parseInt(req.params.pageId, 10);
  const toPageId = parseInt(req.body?.toPageId, 10);
  const toSectionKey = String(req.body?.toSectionKey || '');
  if (!Number.isInteger(toPageId) || !toSectionKey) {
    return res.status(400).json({ error: 'Choose the block the story carries on into.' });
  }

  const source = await pageRepository.findById(pageId);
  if (!source) return res.status(404).json({ error: 'Block not found.' });
  const landing = await jump.landingRoom(toPageId, toSectionKey, { fromPageNumber: source.page_number });
  if (!landing) return res.status(404).json({ error: 'That continuation block does not exist.' });
  if (Number(landing.target.newspaper_id) !== Number(source.newspaper_id)) {
    return res.status(400).json({ error: 'A story cannot continue into a different edition.' });
  }
  if (Number(landing.target.id) === Number(req.body?.fromSectionId)) {
    return res.status(400).json({ error: 'A story cannot continue into itself.' });
  }
  if (landing.room < 40) {
    return res.status(400).json({ error: 'That block is too small to hold a continuation and its pick-up line.' });
  }

  const result = await storyWriter.write(pageId, req.params.sectionKey, {
    seed: req.body?.seed,
    notes: req.body?.notes,
    tier: req.body?.tier,
    language: req.body?.language,
    lookUp: req.body?.lookUp === true,
    reason: req.body?.reason === true,
    searchWeb: req.body?.searchWeb === true,
    writeHeadline: req.body?.writeHeadline !== false,
    writeSubheading: req.body?.writeSubheading !== false,
    extraBodyChars: landing.room,
  });
  if (result.error) return res.status(result.unconfigured ? 503 : 400).json(result);

  // TRIMMED TO THE PAIR, FOR FREE.
  //
  // The reservoir overshoots on purpose - missing long is repaired by a
  // deterministic cut and missing short costs a paid call - and here nothing
  // had cut it, because the settle trim was skipped so the second leg would
  // have something to hold. Measured on the first real run: the story came
  // back 4136 characters for 4101 of room, and the split refused by 35.
  //
  // So the pair is measured again with the display type the model actually
  // wrote (the source's room could not be known before that) and the copy is
  // cut at a sentence boundary to fit. No provider call, and never a truncation
  // mid-sentence - the same rule trimToFit() follows for one block.
  const rooms = await jump.roomsFor(pageId, req.params.sectionKey, {
    toPageId, toSectionKey,
    headline: result.proposal.headline,
    subheading: result.proposal.subheading,
  });
  if (rooms && result.proposal.body.length > rooms.total) {
    const sentences = copyFit.splitSentences(result.proposal.body);
    let kept = [];
    for (const sentence of sentences) {
      const candidate = copyFit.joinSentences([...kept, sentence]);
      if (candidate.length > rooms.total) break;
      kept = [...kept, sentence];
    }
    if (kept.length) result.proposal.body = copyFit.joinSentences(kept);
  }

  res.json({
    ...result,
    // Where the second leg goes, so the desk's own Accept can carry it over
    // through the route that already writes both lines and links the pair.
    across: {
      toPageId,
      toSectionKey,
      pageNumber: landing.pageNumber,
      room: landing.room,
    },
  });
}

module.exports = {
  writeAcross,
  purpose,
  update, create, remove, move,
  write, fill, carryOver, reunite, fitPreview, fitApply, rate,
};
