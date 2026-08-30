// Has this paper already got this story?
//
// Three different questions wear the word "duplicate", and they want different
// machinery:
//
//   1. Two retrieved items that are the SAME WIRE COPY, syndicated. Cheap,
//      deterministic, and worth collapsing before anything expensive reads the
//      pool - they are literally the same sentences.
//   2. Two items about the same EVENT in different words. That is a judgement,
//      it is what the planner's one call is for, and no token overlap will do
//      it.
//   3. A story this paper has ALREADY PLACED, in this edition or last
//      Tuesday's. Nothing in the product asked this before.
//
// This module does 1 and 3, deterministically, for nothing. It never asks a
// model: a duplicate check that costs a call and cannot be audited is worse
// than no duplicate check.
//
// AND IT NEVER DELETES. Day two of a running story is not a duplicate, it is
// the story - a paper that silently drops its own follow-ups is worse than one
// that occasionally repeats itself. Everything here MARKS, with the headline it
// matched and where, and the desk decides.

const { contentWords } = require('../information/words');

// Below this the overlap is a coincidence. Two headlines sharing three real
// Marathi words are talking about the same thing; two sharing "पाणी" are not,
// which is why there is an absolute floor as well as a ratio - a ratio alone
// makes every two-word headline a duplicate of every other.
const MIN_SHARED_WORDS = 3;

// Same event, near-certainly, when this much of the shorter headline is shared.
//
// Measured over 92 real retrieved headlines - 4186 pairs - rather than chosen:
//
//   0.70  0 pairs        0.50  3 pairs, all three genuine
//   0.60  0 pairs        0.45  7 pairs, still genuine but nearing coincidence
//
// 0.6 catches NOTHING on real Marathi headlines, which is the useful finding:
// two papers reporting one event share fewer words than they look like they
// do. The floor of MIN_SHARED_WORDS is what actually prevents false positives
// - "पाणीपुरवठा योजनेला गळती" against "पाणीपुरवठा बंद" scores 0.50 on ONE
// shared word and is correctly refused - so the ratio can afford to be this
// permissive.
const PLACED_THRESHOLD = 0.5;

/** Same wire copy, near-certainly. Deliberately far stricter than the above. */
const SYNDICATION_THRESHOLD = 0.85;

function tokenSet(text) {
  return new Set(contentWords(text));
}

/**
 * How much of the SHORTER text the two share.
 *
 * Containment rather than Jaccard, because the two sides are not the same kind
 * of thing: a candidate's headline is compared against a placed block's
 * headline, and one paper's summary of an event is routinely twice the length
 * of another's. Jaccard punishes that difference; containment asks the question
 * actually being asked - is the shorter one contained in the longer?
 */
function containment(a, b) {
  if (!a.size || !b.size) return { score: 0, shared: 0 };
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const word of small) if (large.has(word)) shared += 1;
  return { score: shared / small.size, shared };
}

function isMatch({ score, shared }, threshold) {
  return shared >= MIN_SHARED_WORDS && score >= threshold;
}

/**
 * Collapse items that are the same syndicated copy.
 *
 * Returns one representative per group, carrying the rest as `alsoRan` - the
 * others are not thrown away, because "five papers carried this" is exactly
 * the signal the planner scores a story on, and the desk's audit trail needs
 * every link. A representative is chosen by trust first: a checked publisher's
 * copy of a wire story is the one to keep.
 */
function collapseSyndicated(items = [], { trustRank = () => 0 } = {}) {
  const groups = [];
  for (const item of items) {
    const words = tokenSet(item.title);
    const group = groups.find((g) => isMatch(containment(g.words, words), SYNDICATION_THRESHOLD));
    if (group) {
      group.members.push(item);
      continue;
    }
    groups.push({ words, members: [item] });
  }

  return groups.map((group) => {
    const [best, ...rest] = [...group.members].sort((a, b) => trustRank(a) - trustRank(b));
    return rest.length ? { ...best, alsoRan: rest } : best;
  });
}

/**
 * Mark every candidate the paper has already run.
 *
 * `placed` is this edition's own blocks; `earlier` is what ran in the days
 * before it. They are reported separately because they mean different things
 * to a desk: the first is "you have this on page 4 already", the second is
 * "we ran this yesterday" - which may still be worth a follow-up, and often
 * is.
 */
function markDuplicates(candidates = [], { placed = [], earlier = [] } = {}) {
  const placedSets = placed.map((row) => ({ row, words: tokenSet(`${row.headline} ${row.subheading || ''}`) }));
  const earlierSets = earlier.map((row) => ({ row, words: tokenSet(row.headline) }));

  return candidates.map((candidate) => {
    const words = tokenSet(candidate.title);

    for (const entry of placedSets) {
      const hit = containment(entry.words, words);
      if (isMatch(hit, PLACED_THRESHOLD)) {
        return {
          ...candidate,
          duplicate: {
            where: 'edition',
            headline: entry.row.headline,
            page: entry.row.page_number,
            sectionKey: entry.row.section_key,
            score: Number(hit.score.toFixed(2)),
          },
        };
      }
    }

    for (const entry of earlierSets) {
      const hit = containment(entry.words, words);
      if (isMatch(hit, PLACED_THRESHOLD)) {
        return {
          ...candidate,
          duplicate: {
            where: 'earlier',
            headline: entry.row.headline,
            publishedOn: entry.row.publication_date,
            score: Number(hit.score.toFixed(2)),
          },
        };
      }
    }

    return candidate;
  });
}

module.exports = {
  collapseSyndicated,
  markDuplicates,
  containment,
  tokenSet,
  MIN_SHARED_WORDS,
  PLACED_THRESHOLD,
  SYNDICATION_THRESHOLD,
};
