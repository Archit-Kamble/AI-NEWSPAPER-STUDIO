// The empty blocks of an edition, described to the planner in ORDINALS.
//
// The planner assigns a story to a block, and to do that it has to know that
// page one's anchor is the biggest frame in the paper and a page-five filler
// is not. What it must NEVER be given is the frame's dimensions.
//
// The reason is measured and it is one of this project's most expensive
// findings: the pre-write reservation, which estimates how much copy a block
// holds BEFORE its headline exists, over-promises on 49 of 96 real block
// geometries, and the same block's real capacity varies by a factor of 1.5-3
// depending only on how long the headline turns out to be. A model handed
// "268x304 px" will compute a character count from it, and that count will be
// wrong on half the page. So it gets a RANK and a coarse label, from which no
// character count can be derived, and the exact compositor decides length
// afterwards - which is the whole compositor-as-controller design.
//
// Which blocks are eligible is deliberately NOT re-decided here.
// `candidatesOn()` in bulk-generate.js already owns that rule - an advert is
// sold, a photo block wants a photograph, a feature is standing furniture, a
// reporter's story belongs to the reporter, and written copy is never
// overwritten - and a second copy of it would drift.

let bulkModule;
async function bulk() {
  if (!bulkModule) bulkModule = await import('../../../public/editor/external-editor/bulk-generate.js');
  return bulkModule;
}

// Coarse, and coarse on purpose. Five rungs a sub-editor would recognise,
// derived from the block's share of its own page rather than from pixels, so
// the label means the same thing on a broadsheet and a tabloid.
const RUNGS = [
  { key: 'lead', minShare: 0.22 },
  { key: 'large', minShare: 0.12 },
  { key: 'medium', minShare: 0.06 },
  { key: 'small', minShare: 0.03 },
  { key: 'brief', minShare: 0 },
];

function rungFor(share) {
  return (RUNGS.find((rung) => share >= rung.minShare) || RUNGS[RUNGS.length - 1]).key;
}

/**
 * Every writable empty block in the edition, ranked.
 *
 * @param {object[]} pages  hydrated pages, each with `sections`
 * @returns {{blocks, byPage, total}} `blocks` in page order, each carrying the
 *   ordinal facts the planner may reason from and nothing it could measure with.
 */
async function emptyBlocks(pages = [], { place = '' } = {}) {
  const { candidatesOn } = await bulk();

  // Ranked across the WHOLE edition, not per page: "the biggest frame in the
  // paper" is what decides where the day's biggest story goes, and a page-three
  // anchor that outranks page one's is a real and useful thing to be told.
  const areaOf = (section) => Number(section.width_px || 0) * Number(section.height_px || 0);
  const everyEditorial = pages.flatMap((page) => (page.sections || []).map((s) => areaOf(s))).filter((a) => a > 0);
  const ranked = [...everyEditorial].sort((a, b) => b - a);
  const rankOf = (area) => ranked.indexOf(area) + 1;

  const blocks = [];
  for (const page of pages) {
    const { ready } = candidatesOn(page, { place });
    const pageArea = (page.sections || []).reduce((sum, s) => sum + areaOf(s), 0) || 1;
    const byKey = new Map((page.sections || []).map((s) => [s.section_key, s]));

    for (const candidate of ready) {
      const section = byKey.get(candidate.sectionKey);
      if (!section) continue;
      const area = areaOf(section);
      const share = area / pageArea;
      blocks.push({
        page: page.page_number,
        pageId: page.id,
        sectionKey: candidate.sectionKey,
        // The ordinals, and nothing else.
        sizeRank: rankOf(area),
        rung: rungFor(share),
        // A block that already carries a photograph wants a story the picture
        // is ABOUT; one with room for a picture can be given a story worth
        // illustrating. Both are editorial facts, neither is a measurement.
        hasPicture: Boolean(section.image_url) || Number(section.image_count || 0) > 0,
        // The desk's own steer, when the layout gave the frame one.
        category: String(section.category || '').trim() || null,
        location: String(section.location || '').trim() || null,
        // A block with a headline and no copy is briefed from that headline;
        // this run is for the ones with nothing in them at all.
        seed: candidate.seed,
        fromToday: candidate.fromToday,
      });
    }
  }

  blocks.sort((a, b) => a.page - b.page || a.sizeRank - b.sizeRank);

  const byPage = {};
  for (const block of blocks) byPage[block.page] = (byPage[block.page] || 0) + 1;

  return { blocks, byPage, total: blocks.length };
}

module.exports = { emptyBlocks, rungFor, RUNGS };
