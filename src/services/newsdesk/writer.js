// Writing the plan the desk approved — one cheap call per story, four at a
// time.
//
// Everything expensive already happened. The retrieval is done, the events are
// clustered, the facts are chosen and a person has read the plan and cut what
// they did not want. So this stage is deliberately the dumbest one in the run:
// it hands each block its own Fact Packet and asks the ordinary writer for
// ordinary copy.
//
// THREE THINGS IT DELIBERATELY DOES NOT DO.
//
//   It does not retrieve again. The packet IS the retrieval, and asking the
//   feeds a second time could return a different set of facts from the ones
//   the desk approved in the preview - the worse of the two failures.
//
//   It does not ask for a length. The writer is asked for a reservoir, as it
//   always is, and the exact compositor picks the prefix that fits. Asking for
//   "about 70% of the block" is a character count wearing a percentage
//   costume, and it guarantees the underfill that costs a paid repair.
//
//   It does not save. Every block comes back as a proposal the desk accepts one
//   at a time, exactly as a single block does. VISION.md: AI assists, it never
//   owns.

const storyWriter = require('../storyWriter.service');
const { mapLimit } = require('./parallel');

/**
 * Writers in the air at once.
 *
 * Four, not eight. bulk-generate.js caps at two for a stated reason - a
 * provider has a requests-per-minute ceiling - and `rateLimit` is classified
 * "no retry, straight to the understudy", so a burst does not fail loudly: it
 * silently moves the rest of the paper onto a fallback whose plan truncates a
 * full-page lead. Four is a measured step up from two, not a guess at the
 * ceiling; raise it against a measurement.
 */
const CONCURRENCY = 4;

/** The repetitive writing work is what the cheap tier is FOR. */
const WRITER_TIER = 'basic';

/** Primary plus one understudy. A five-deep chain is minutes per block. */
const MAX_PROVIDERS = 2;

/**
 * One planned story as the context a writer already knows how to read.
 *
 * Same shape `information.fetchContext()` returns, so it enters storyWriter at
 * exactly the point a live retrieval would and every promise downstream - the
 * brief, the schema, the settle loop, the fingerprint, the byline - is the one
 * already tested.
 *
 * `status` is the honest one: a story resting on any checked publisher is
 * `verified`; one resting only on an open search is `unverified`, and the
 * writer then attributes rather than asserts. This is the single most
 * important line here - a packet must never launder unchecked material into
 * the heading that means "this was checked".
 */
function packetFor(story) {
  return {
    query: story.angle || story.headlineHint,
    category: 'current_news',
    retrievedAt: new Date().toISOString(),
    status: story.verified ? 'verified' : 'unverified',
    facts: story.facts || [],
    disagreements: story.disagreements || [],
    doNotClaim: story.doNotClaim || [],
    sources: story.sources || [],
    mustVerify: !story.verified,
  };
}

/**
 * The brief for one block.
 *
 * `angle` is the subject; the planner's `headlineHint` is offered as a steer
 * rather than as the headline, because the headline has to be SET - it is
 * sized to fill its own measure inside a line budget, and a hint written
 * without the block in front of it cannot know that.
 */
function seedFor(story) {
  return story.angle || story.headlineHint || '';
}

function notesFor(story) {
  return [
    story.headlineHint ? `Suggested angle for the headline: ${story.headlineHint}` : '',
    story.importance >= 4 ? 'This is one of the day\'s main stories.' : '',
  ].filter(Boolean).join(' ');
}

/**
 * Write every story in an approved plan.
 *
 * @param {object[]} stories  from the plan, after the desk has cut it
 * @returns {{results, written, failed}} results in plan order - a desk reads a
 *   page from the top, and the workers finish out of order.
 */
async function writePlan(stories = [], {
  onProgress, signal, tier = WRITER_TIER, concurrency = CONCURRENCY,
  // THE SAME THINGS A SINGLE BLOCK CAN BE ASKED FOR. This run makes up a whole
  // paper and could ask for less than the panel that writes one block - so
  // every option there is offered here, and every one of them ends in the same
  // storyWriter.write(). Defaults match that panel's, so a desk who changes
  // nothing gets exactly what this did before.
  writeHeadline = true, writeSubheading = true, reason = false,
  writeChart = false, chartType = 'bar',
} = {}) {
  // WHAT EACH BLOCK IS ASKED FOR IS THE BLOCK'S OWN DECISION.
  //
  // These four used to be one setting for the whole run, so a desk who wanted
  // a deck on the lead got one on all thirty-one, and a chart of figures was
  // either on every block or none. A page is not made up that way: the anchor
  // carries a deck, the fillers do not, and exactly one story that morning has
  // figures worth plotting.
  //
  // The run's own settings are the DEFAULT, so a desk who changes nothing gets
  // precisely what this did before; a story that carries its own `asks`
  // overrides them for that block alone. Deliberately resolved per story here
  // rather than in the controller: `writePlan` is the one place that knows
  // which block each story is for.
  const asksFor = (story) => {
    const own = story && typeof story.asks === 'object' && story.asks ? story.asks : {};
    const pick = (key, fallback) => (own[key] === undefined ? fallback : own[key]);
    return {
      writeHeadline: pick('writeHeadline', writeHeadline) !== false,
      writeSubheading: pick('writeSubheading', writeSubheading) !== false,
      reason: pick('reason', reason) === true,
      writeChart: pick('writeChart', writeChart) === true,
      chartType: pick('chartType', chartType) || 'bar',
    };
  };

  const results = await mapLimit(stories, concurrency, async (story) => {
    const asks = asksFor(story);
    const result = await storyWriter.write(story.pageId, story.sectionKey, {
      seed: seedFor(story),
      notes: notesFor(story),
      tier,
      maxProviders: MAX_PROVIDERS,
      providedContext: packetFor(story),
      ...asks,
    });

    if (result.error) {
      // THE FAILURE NAMES ITS BLOCK. It used to be caught by `mapLimit`'s own
      // guard in some paths and come back as a bare `{ error }`, which the
      // panel then printed as "pundefined/?" - and, worse, a row with no
      // sectionKey cannot be written again, so the story was unrecoverable.
      return {
        page: story.page, sectionKey: story.sectionKey, pageId: story.pageId,
        error: result.error, story,
      };
    }
    return {
      page: story.page,
      sectionKey: story.sectionKey,
      pageId: story.pageId,
      proposal: result.proposal,
      fit: result.fit,
      provider: result.provider,
      // The plan's own evidence travels with the proposal. A bulk row that
      // cannot be audited is less trustworthy than the single proposal it came
      // from, even though both went through the same endpoint.
      retrieval: {
        status: story.verified ? 'verified' : 'unverified',
        sources: story.sources,
        mustVerify: !story.verified,
      },
      tagKey: story.tagKey,
      importance: story.importance,
      repeats: story.repeats || null,
      // The plan row this came from, so the panel can send exactly this story
      // again when a provider had a bad minute - without the desk paying for a
      // second research pass to get it back.
      story,
    };
  }, { onProgress, signal });

  // AND A THROW NAMES ITS BLOCK TOO.
  //
  // `mapLimit` catches a thrown error so one bad block cannot take the batch
  // down, but it cannot know this shape - it returns a bare `{ error }` with
  // no page and no sectionKey. The panel printed those as "pundefined/?", and
  // a row with no sectionKey cannot be written again, so that story was
  // unrecoverable however many calls the desk had already paid for. Backfilled
  // by index, which is exactly what `mapLimit` guarantees: results in the
  // order of the input.
  const named = results.map((row, index) => {
    if (row && row.sectionKey) return row;
    const story = stories[index];
    return {
      page: story?.page,
      sectionKey: story?.sectionKey,
      pageId: story?.pageId,
      error: (row && row.error) || 'The writer did not answer for this block.',
      story,
    };
  });

  return {
    results: named,
    written: named.filter((r) => r && !r.error).length,
    failed: named.filter((r) => !r || r.error).length,
  };
}

module.exports = { writePlan, packetFor, seedFor, CONCURRENCY, WRITER_TIER };
