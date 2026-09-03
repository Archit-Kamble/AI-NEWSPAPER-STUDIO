// DRESSING A PAGE, AND THEN A WHOLE PAPER.
//
// `styleForPage()` in public/editor/layout/page-styles.js decides what every
// block on one page should wear. This is the half that reads the page out of
// the database, hands that function the geometry it needs, and writes the
// answer back through the one section save every other writer goes through -
// so the corridor snap, the palette boundary and the history step all apply to
// a block this dressed exactly as they do to one a desk dressed by hand.
//
// TWO ROUTES AND ONE OF THEM ONLY LOOKS. `propose` composes the answer and
// changes nothing; `apply` writes it. A desk sees the count of blocks about to
// change before anything changes, which is the shape every other expensive or
// irreversible action in this product already has - the AI proposal, the
// placement repair, the house-style restyle.

const pageRepository = require('../repositories/page.repository');
const newspaperRepository = require('../repositories/newspaper.repository');
const pageSectionService = require('./pageSection.service');
const ai = require('./ai');

let catalogue = null;
async function styles() {
  // The same dynamic import() the character grid, the block kinds and the ink
  // palette are already reached by from Node.
  if (!catalogue) catalogue = await import('../../public/editor/layout/page-styles.js');
  return catalogue;
}

// The page's own grid, from the one geometry every other surface reads - never
// a second copy of the gutter, or the colour this styler keeps apart could
// drift from the hairline column-rules.js draws between the very same blocks.
const { geometryOf } = require('../layout/geometry');

/**
 * What every block on this page would wear. Reads; never writes.
 *
 * `theme` is the desk's own choice when it makes one; otherwise the page's
 * stored theme; otherwise a guess from the page number and what is on it. The
 * guess is deliberately conservative - see `guessTheme`.
 */
async function proposeForPage(pageId, { theme } = {}) {
  const id = parseInt(pageId, 10);
  const page = await pageRepository.findById(id);
  if (!page) return { error: 'That page does not exist.' };

  const { styleForPage, sanitiseTheme, themeOf, guessTheme } = await styles();
  const paper = await newspaperRepository.findById(page.newspaper_id);
  const pages = await pageRepository.findByNewspaper(page.newspaper_id).catch(() => []);

  const asked = sanitiseTheme(theme);
  const stored = sanitiseTheme(page.style_theme);
  const chosen = asked || stored
    || guessTheme({ pageNumber: page.page_number, pageCount: pages.length || paper?.page_count });

  const geometry = geometryOf(paper || {});
  const changes = styleForPage({
    sections: page.sections || [],
    theme: chosen,
    geometry,
    pageNumber: page.page_number,
    pageCount: pages.length || paper?.page_count,
  });

  // WHAT WOULD ACTUALLY MOVE. A page already wearing its theme proposes no
  // change at all, which is what makes this safe to press twice - and it is
  // the number the desk is shown before they press it.
  const current = new Map((page.sections || []).map((s) => [s.section_key, s]));
  const moving = changes.filter((change) => {
    const row = current.get(change.sectionKey);
    if (!row) return false;
    return (row.background_color || null) !== (change.patch.backgroundColor || null)
      || (row.border_ink || null) !== (change.patch.borderInk || null)
      || (row.headline_ink || null) !== (change.patch.headlineInk || null)
      || (row.border_style || 'none') !== change.patch.borderStyle
      || Number(row.border_radius_px || 0) !== Number(change.patch.borderRadiusPx || 0)
      || (row.headline_style || 'plain') !== change.patch.headlineStyle;
  });

  return {
    pageId: id,
    pageNumber: page.page_number,
    theme: chosen,
    themeName: themeOf(chosen)?.label || chosen,
    themeMarathi: themeOf(chosen)?.marathi || '',
    dressed: changes.filter((c) => c.patch.backgroundColor).length,
    blocks: changes.length,
    changing: moving.length,
    changes,
  };
}

/**
 * Write it.
 *
 * Through `pageSectionService.saveSection`, never straight to SQL: that is
 * where the palette boundary lives, and a block dressed round it would be the
 * one place a foreign colour could reach a style attribute.
 *
 * THE COPY IS CARRIED, WORD FOR WORD. A section save is a full replace for the
 * fields it covers - CLAUDE.md states this about any API caller and it has
 * blanked a real block once - so every patch re-sends the headline, the deck
 * and the body exactly as they were read.
 */
async function applyToPage(pageId, { theme } = {}) {
  const proposal = await proposeForPage(pageId, { theme });
  if (proposal.error) return proposal;

  const page = await pageRepository.findById(proposal.pageId);
  const current = new Map((page.sections || []).map((s) => [s.section_key, s]));

  let saved = 0;
  const refused = [];
  for (const change of proposal.changes) {
    const row = current.get(change.sectionKey);
    if (!row) continue;
    // eslint-disable-next-line no-await-in-loop
    const result = await pageSectionService.saveSection(proposal.pageId, change.sectionKey, {
      headline: row.headline,
      subheading: row.subheading,
      body: row.body,
      ...change.patch,
    });
    if (result?.error) refused.push({ sectionKey: change.sectionKey, error: result.error });
    else saved += 1;
  }

  await pageRepository.setStyleTheme(proposal.pageId, proposal.theme);
  return { ...proposal, saved, refused };
}

/**
 * WHICH LOOK EACH PAGE SHOULD WEAR - one call for the whole edition.
 *
 * This is the ONE decision in dressing a paper that is semantic rather than
 * geometric: "page twelve is the world page" is a judgement about what is on
 * it, and a model reading the headlines makes it well. Everything after it -
 * which block takes which hue, what touches what, how much of the page is
 * dressed - is a constraint problem that code solves better, and `styleForPage`
 * solves it seeing the whole page at once, which no per-block call can.
 *
 * So it is ONE call for a whole newspaper, not one per block. A per-block
 * choice cannot avoid giving two touching stories the same ground, because no
 * block's call can see its neighbours.
 *
 * IT MAY ONLY CHOOSE FROM THE CATALOGUE. A theme decides a block's ground and
 * its rule ink, both of which are interpolated into a style attribute, so a
 * name the model invents is discarded and the deterministic guess answers
 * instead - never a colour a model made up.
 *
 * And it is never required: `guessTheme()` reads the same evidence off the
 * page for nothing, so a paper with no AI configured still gets dressed.
 */
async function proposeThemes(newspaperId) {
  const id = parseInt(newspaperId, 10);
  const pages = await pageRepository.findByNewspaper(id);
  const { PAGE_THEMES, sanitiseTheme, guessTheme } = await styles();

  const described = [];
  for (const summary of pages) {
    // eslint-disable-next-line no-await-in-loop
    const page = await pageRepository.findById(summary.id);
    const headlines = (page.sections || [])
      .map((section) => String(section.headline || '').trim())
      .filter(Boolean)
      .slice(0, 8);
    described.push({ page: page.page_number, headlines, fallback: guessTheme({ pageNumber: page.page_number, pageCount: pages.length }) });
  }

  const fallback = Object.fromEntries(described.map((one) => [one.page, one.fallback]));
  if (!ai.isConfigured()) return { themes: fallback, source: 'derived' };

  const catalogue = PAGE_THEMES
    .map((theme) => `  ${theme.key} - ${theme.label} (${theme.marathi})`)
    .join('\n');
  const listing = described
    .map((one) => `Page ${one.page}: ${one.headlines.length ? one.headlines.join(' | ') : '(nothing written yet)'}`)
    .join('\n');

  const prompt = [
    'You are the chief sub-editor of a Marathi district daily deciding how each page of tomorrow\'s',
    'paper should LOOK, from what is on it. Choose one theme for each page, from this list only:',
    '',
    catalogue,
    '',
    'Rules. Page one is always "front". A page whose stories are mostly one subject takes that',
    'subject\'s theme. A page you cannot place takes "city". Never invent a theme name.',
    '',
    'The pages and their headlines:',
    listing,
  ].join('\n');

  const schema = {
    type: 'object',
    properties: {
      pages: {
        type: 'array',
        items: {
          type: 'object',
          properties: { page: { type: 'integer' }, theme: { type: 'string' } },
          required: ['page', 'theme'],
        },
      },
    },
    required: ['pages'],
  };

  try {
    const answer = await ai.askForJson(prompt, schema, { tier: 'basic', maxProviders: 3 });
    const themes = { ...fallback };
    for (const row of answer?.pages || []) {
      const theme = sanitiseTheme(row?.theme);
      // An invented name is DISCARDED and the derived answer stands, rather
      // than the page going undressed or wearing something nobody named.
      if (theme && fallback[row.page] !== undefined) themes[row.page] = theme;
    }
    return { themes, source: 'ai' };
  } catch (error) {
    return { themes: fallback, source: 'derived', why: error.message };
  }
}

/** Every page of one edition, each dressed for what it carries. */
async function applyToEdition(newspaperId, { themes = null, useAi = true } = {}) {
  const id = parseInt(newspaperId, 10);
  const pages = await pageRepository.findByNewspaper(id);
  // The desk's own choice wins outright. Otherwise ask - and `proposeThemes`
  // falls back to the derived answer on its own, so this never fails for want
  // of a provider.
  let chosen = themes;
  let source = 'desk';
  if (!chosen) {
    const proposal = useAi
      ? await proposeThemes(id)
      : { themes: null, source: 'derived' };
    chosen = proposal.themes || {};
    source = proposal.source;
  }
  const done = [];
  for (const page of pages) {
    // eslint-disable-next-line no-await-in-loop
    const result = await applyToPage(page.id, { theme: chosen[page.page_number] || chosen[String(page.page_number)] });
    done.push(result);
  }
  return {
    newspaperId: id,
    source,
    pages: done.length,
    saved: done.reduce((sum, one) => sum + (one.saved || 0), 0),
    dressed: done.reduce((sum, one) => sum + (one.dressed || 0), 0),
    results: done,
  };
}

module.exports = { proposeForPage, applyToPage, applyToEdition, proposeThemes };
