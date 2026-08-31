// The Newsdesk Run — plan phase.
//
// A desk says what tomorrow's paper should be made of, page by page, and this
// produces a REVIEWABLE PLAN: which story goes in which block, what facts it
// rests on, which publishers carry it, and which blocks it could not fill.
//
// Nothing is written and nothing is saved. The plan is shown, the desk cuts
// what it does not want, and only then does the writing phase spend a call per
// block. That checkpoint is the whole safety argument for the feature: one
// expensive call before it, cheap calls after it, a person in between.
//
// Six of the seven steps below cost nothing.

const retrieval = require('./retrieval');
const dedupe = require('./dedupe');
const blocksOf = require('./blocks');
const planner = require('./planner');
const newsdeskRepository = require('../../repositories/newsdesk.repository');
const pageRepository = require('../../repositories/page.repository');
const newspaperRepository = require('../../repositories/newspaper.repository');
const settings = require('../settings.service');
const { identityFor } = require('../../layout/identity');
const freshness = require('../information/freshness');
const trust = require('../information/trust');

/** How far back a duplicate check looks, in days. */
const REPEAT_WINDOW_DAYS = 7;

function trustRank(item) {
  if (item.openWeb) return 2;
  return trust.CAN_VERIFY_ALONE.has(item.trust) ? 0 : 1;
}

// The same identity every other surface reads - the masthead, the folio, the
// e-paper and Scribus all go through identityFor(). The paper's own place is
// what a "local" tag means, so it is load-bearing here rather than decorative.
async function paperIdentity() {
  try {
    await settings.hydratePublicationIdentity();
  } catch {
    // Its defaults are real (सातारा); a settings read failing must not stop a
    // desk planning a paper.
  }
  const identity = identityFor();
  return {
    publicationName: identity?.publicationName || identity?.title || null,
    placeOfPublication: identity?.placeOfPublication || null,
  };
}

/**
 * The tags a brief actually asks for, in one flat list.
 * A tag asked for on three pages is retrieved once.
 */
function tagsIn(brief) {
  return [...new Set((brief.pages || []).flatMap((page) => (page.wants || [])
    .filter((want) => want.demand !== 'avoid' && Number(want.count) > 0)
    .map((want) => want.tagKey)))];
}

/**
 * Plan an edition's empty blocks.
 *
 * @param {number} newspaperId
 * @param {{pages: [{page, wants: [{tagKey, count, demand}]}], freshness: string}} brief
 */
async function planEdition(newspaperId, brief = {}, { callBudget, place: chosen, placeQuery } = {}) {
  const paper = await newspaperRepository.findById(newspaperId);
  if (!paper) return { error: 'That edition does not exist.', status: 404 };

  const identity = await paperIdentity();
  // WHERE "LOCAL" IS FOR THIS RUN.
  //
  // It was the paper's own place of publication and nothing else, so a desk
  // who wanted a Sangli story on page three had no way to say so - a district
  // daily's local news is a NAMED district, and a query for सातारा finds
  // different stories from one for सांगली. The desk's choice wins where they
  // made one; the paper's own place is what it falls back to, which is exactly
  // what every existing caller gets.
  //
  // Checked against the one place catalogue on the way in: this reaches a
  // search query, and a misspelt district returns nothing while looking
  // exactly like a district with no news today.
  const { placeOf, placeQuery: queryFor } = await import('../../../public/editor/layout/places.js');
  const asked = chosen ? placeOf(chosen) : null;
  const place = String(placeQuery || (asked ? queryFor(asked) : '') || identity.placeOfPublication || '').trim();

  // 1 — which blocks are open, and how they rank. Free.
  const pages = await pageRepository.findByNewspaper(newspaperId);
  const wantedPages = new Set((brief.pages || []).map((p) => Number(p.page)));
  const scoped = wantedPages.size ? pages.filter((p) => wantedPages.has(Number(p.page_number))) : pages;
  const { unbriefed, commissioned, byPageUnbriefed } = await blocksOf.emptyBlocks(scoped, { place });
  const blocks = unbriefed;
  if (!blocks.length) {
    return {
      error: commissioned.length
        ? `Every empty block on those pages already carries a headline. Those are written from their own headlines — this run finds stories for blocks with nothing in them.`
        : 'There are no empty blocks to fill on those pages.',
      status: 400,
      byPage: byPageUnbriefed,
      commissioned: commissioned.length,
    };
  }

  // 2 — retrieval, once per tag. Free.
  const tagKeys = tagsIn(brief);
  if (!tagKeys.length) return { error: 'The brief asks for nothing.', status: 400 };
  const windowMs = freshness.deskWindowMs(brief.freshness);
  const pool = await retrieval.retrieve({ tagKeys, place, windowMs });

  // 3 — what the paper already carries. Free.
  const [placed, earlier] = await Promise.all([
    newsdeskRepository.placedInEdition(newspaperId),
    newsdeskRepository.printedBefore(newspaperId, { days: REPEAT_WINDOW_DAYS }),
  ]);

  // 4 — collapse identical wire copy, then mark what we have already run. Free.
  const collapsed = dedupe.collapseSyndicated(pool.items, { trustRank });
  const marked = dedupe.markDuplicates(collapsed, { placed, earlier });

  if (!marked.length) {
    return {
      error: 'Nothing was retrieved for this brief. The feeds may be unreachable, or the window may be too short.',
      status: 200,
      retrieval: pool.stats,
      errors: pool.errors,
    };
  }

  // 5 — the one paid call.
  const planned = await planner.plan({
    brief, blocks, pool: marked, placed, identity, callBudget,
  });
  if (planned.error) return { error: planned.error, status: 502, attempts: planned.attempts, retrieval: pool.stats };

  return {
    newspaperId,
    publicationDate: paper.publication_date,
    brief,
    identity,
    stories: planned.stories,
    leftEmpty: planned.leftEmpty,
    rejected: planned.rejected,
    counts: planned.counts,
    blocksOffered: planned.blocksOffered,
    // Written from their own headlines rather than planned - the desk already
    // said what these are about.
    commissioned: commissioned.map((block) => ({
      page: block.page, pageId: block.pageId, sectionKey: block.sectionKey,
      seed: block.seed, rung: block.rung,
    })),
    // What the desk must know BEFORE it fires the writing phase.
    review: {
      total: planned.stories.length,
      unverified: planned.stories.filter((s) => !s.verified).length,
      repeats: planned.stories.filter((s) => s.repeats).length,
      blocksLeftEmpty: blocks.length - planned.stories.length,
    },
    retrieval: {
      ...pool.stats,
      candidates: pool.items.length,
      afterSyndication: collapsed.length,
      duplicatesMarked: marked.filter((i) => i.duplicate).length,
      byTag: pool.byTag,
      errors: pool.errors,
    },
    provider: planned.provider,
    tier: planned.tier,
    handover: planned.handover,
    attempts: planned.attempts,
    promptChars: planned.promptChars,
  };
}

module.exports = { planEdition, tagsIn, REPEAT_WINDOW_DAYS };
