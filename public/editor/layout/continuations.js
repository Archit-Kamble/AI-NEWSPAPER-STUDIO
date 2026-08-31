// TWO BLOCKS, ONE STORY - WHICH TWO, AND WHICH WAY ROUND.
//
// `page_sections.continued_from_section_id` has recorded this since carry-over
// was written, and NOTHING in the browser had ever read it. Not one file under
// public/ mentioned the column. So a desk could split a story across a page
// turn and afterwards:
//
//   * nothing on either block said the two were one story, and
//   * there was no way to put it back. `jump.service.js`'s `reunite()` has
//     existed as long as `carryOver()` has, with its own route, and no control
//     anywhere in the product could reach it.
//
// That is the rule this codebase already states, broken: "A device must be
// removable, and the way out lives beside the way in." Carry over is not even
// a device a desk can undo by hand - putting the copy back means finding the
// second leg, cutting its words out, stripping two furniture lines nobody
// typed, and pasting the result onto the end of the first.
//
// This module is the ONE answer to both questions, told the edition once and
// read by whoever draws or acts on a block - the same shape as `grid.js`'s
// geometry and `masthead.js`'s identity, and for the same reason: the renderers
// in this product are fed, they do not reach for the store.

// sectionId -> the blocks that continue it, in page order.
let legs = new Map();
// sectionId -> the block it continues from.
let sources = new Map();

/**
 * Told whenever the edition's pages load or reload. Everything is keyed on the
 * numeric section id, which is what the column stores - never on a section
 * key, which is only unique within its own page.
 */
export function setContinuations(pages) {
  legs = new Map();
  sources = new Map();
  const list = Array.isArray(pages) ? pages : [];
  for (const page of list) {
    for (const section of page.sections || []) {
      const from = Number(section.continued_from_section_id) || null;
      if (!from) continue;
      const leg = {
        id: Number(section.id),
        pageId: page.id,
        pageNumber: Number(page.page_number) || 0,
        sectionKey: section.section_key,
      };
      if (!legs.has(from)) legs.set(from, []);
      legs.get(from).push(leg);
      sources.set(leg.id, from);
    }
  }
  for (const list_ of legs.values()) list_.sort((a, b) => a.pageNumber - b.pageNumber || a.id - b.id);
}

/** The blocks this one is continued INTO. Empty for an ordinary block. */
export function legsOf(section) {
  const id = Number(section?.id);
  return (id && legs.get(id)) || [];
}

/** True when this block is itself the second leg of somebody else's story. */
export function isContinuation(section) {
  return sources.has(Number(section?.id));
}

/** Where a leg is continued from, as a `{pageNumber, sectionKey}`, or null. */
export function sourceOf(section, pages) {
  const from = sources.get(Number(section?.id));
  if (!from) return null;
  for (const page of Array.isArray(pages) ? pages : []) {
    const found = (page.sections || []).find((s) => Number(s.id) === from);
    if (found) return { pageNumber: Number(page.page_number) || 0, sectionKey: found.section_key };
  }
  return null;
}

/** "page 3, block-2" / "pages 3 and 4" - for a title or a notice. */
export function legsSentence(list) {
  if (!list.length) return '';
  if (list.length === 1) return `page ${list[0].pageNumber}, block "${list[0].sectionKey}"`;
  return `${list.length} blocks, on page${list.length > 1 ? 's' : ''} ${[...new Set(list.map((l) => l.pageNumber))].join(' and ')}`;
}
