// ONE-CLICK BLOCK DESIGNS, built entirely from the publication primitives
// that already survive every output: canvas, e-paper, PDF, IDML and Scribus.
//
// A preset is deliberately NOT stored as a new magic style name. Applying one
// writes the same explicit border, ground and headline-treatment fields the
// desk can already set by hand. The result therefore remains editable after
// application, old editions need no migration, and an absent preset changes
// absolutely nothing.
//
// The catalogue never contains coordinates, dimensions, copy, images, type
// sizes, margins or column counts. Those belong to the sacred layout and the
// compositor. This is the paper's visual vocabulary, not another template
// system.

import { INKS, TINTS, screenOf } from './inks.js';
import './borders.js';

const { BORDER_KEYS, BORDER_WIDTHS, BORDER_RADII } = globalThis.SahasBorders;

const ink = (key) => INKS.find((entry) => entry.key === key)?.hex ?? null;
const tint = (key) => TINTS.find((entry) => entry.key === key)?.hex ?? null;
const rule = (label) => BORDER_WIDTHS.find((entry) => entry.label === label)?.px
  ?? BORDER_WIDTHS[1].px;
const radius = (label) => BORDER_RADII.find((entry) => entry.label === label)?.px ?? 0;

export const BLOCK_DESIGN_FIELDS = Object.freeze([
  'borderStyle', 'borderWidthPx', 'borderInk', 'borderRadiusPx',
  'backgroundColor', 'headlineStyle', 'headlineInk', 'accentColor',
  'frameShape',
]);

const CLEAN_SURFACE = Object.freeze({
  borderStyle: 'none',
  borderWidthPx: rule('Normal'),
  borderInk: null,
  borderRadiusPx: 0,
  backgroundColor: null,
  headlineStyle: 'plain',
  headlineInk: null,
  accentColor: ink('red'),
  frameShape: null,
});

const allNews = ['article', 'briefs', 'photo', 'feature'];
const article = ['article'];
const editorial = ['article', 'feature'];
const compact = ['briefs', 'article', 'feature'];

const preset = ({ key, category, label, marathi, description, kinds = allNews,
  minWidth = 0, minHeight = 0, insetRisk = false, surface = {} }) => Object.freeze({
  key, category, label, marathi, description,
  kinds: Object.freeze([...kinds]), minWidth, minHeight, insetRisk,
  surface: Object.freeze({ ...CLEAN_SURFACE, ...surface }),
});

// These are original SAHAS combinations derived from common newspaper
// grammar: open stories, edge rules, headline screens, restrained sidebars
// and stronger feature-page furniture. Publication names never enter the
// catalogue; editorial principles are reusable, branded expression is not.
export const BLOCK_DESIGN_PRESETS = Object.freeze([
  preset({
    key: 'clean-news', category: 'Core news', label: 'Clean news', marathi: 'स्वच्छ बातमी',
    description: 'Black on white with no enclosing rule. The headline and scale carry the hierarchy.',
  }),
  preset({
    key: 'hairline-finish', category: 'Core news', label: 'Hairline finish', marathi: 'तळरेषा',
    description: 'A quiet rule below separates the next story without turning this one into a card.',
    surface: { borderStyle: 'rule', borderWidthPx: rule('Small') },
  }),
  preset({
    key: 'section-opener', category: 'Core news', label: 'Section opener', marathi: 'विभाग आरंभ',
    description: 'A firm top rule gives the block a clear point of entry.',
    surface: { borderStyle: 'rule-above', borderWidthPx: rule('Normal') },
  }),
  preset({
    key: 'double-finish', category: 'Core news', label: 'Double finish', marathi: 'दुहेरी तळरेषा',
    description: 'A restrained double rule closes a package or the final item in a run.',
    surface: { borderStyle: 'rule-double', borderWidthPx: rule('Small') },
  }),
  preset({
    key: 'left-rail', category: 'Core news', label: 'Left rail', marathi: 'डावी रेषा',
    description: 'One vertical rule distinguishes a supporting column while keeping it open.',
    kinds: compact,
    surface: { borderStyle: 'rule-left', borderWidthPx: rule('Normal'), borderInk: ink('slate') },
  }),
  preset({
    key: 'right-rail', category: 'Core news', label: 'Right rail', marathi: 'उजवी रेषा',
    description: 'A right-edge rule for a narrow rail sitting to the left of a main story.',
    kinds: compact,
    surface: { borderStyle: 'rule-right', borderWidthPx: rule('Normal'), borderInk: ink('slate') },
  }),
  preset({
    key: 'open-panel', category: 'Core news', label: 'Open panel', marathi: 'खुली चौकट',
    description: 'Rules above and below create a distinct unit without boxing the sides.',
    kinds: compact,
    surface: { borderStyle: 'rule-both', borderWidthPx: rule('Small'), borderInk: ink('slate') },
  }),

  preset({
    key: 'lead-accent', category: 'News hierarchy', label: 'Lead accent', marathi: 'मुख्य ठळक',
    description: 'A strong red entry rule and one accent word; the rest remains sober.',
    kinds: article, minWidth: 180, minHeight: 130,
    surface: { borderStyle: 'rule-above', borderWidthPx: rule('Medium'), borderInk: ink('red'), headlineStyle: 'accent', accentColor: ink('red') },
  }),
  preset({
    key: 'lead-reversed', category: 'News hierarchy', label: 'Reversed lead', marathi: 'उलटा मुख्य मथळा',
    description: 'White headline out of one solid ink band for an exceptional lead.',
    kinds: article, minWidth: 210, minHeight: 150,
    surface: { borderStyle: 'rule-above', borderWidthPx: rule('Medium'), borderInk: ink('red'), headlineStyle: 'reverse', accentColor: ink('red') },
  }),
  preset({
    key: 'blue-head-screen', category: 'News hierarchy', label: 'Blue headline screen', marathi: 'निळी मथळा पट्टी',
    description: 'A light screen behind the headline, with a matching rule and headline ink.',
    minWidth: 150,
    surface: { borderStyle: 'rule-above', borderWidthPx: rule('Normal'), borderInk: ink('blue'), headlineStyle: 'band', headlineInk: ink('blue'), accentColor: ink('blue') },
  }),
  preset({
    key: 'navy-deck-screen', category: 'News hierarchy', label: 'Deck highlight', marathi: 'उपमथळा पट्टी',
    description: 'The explanatory deck receives the screen; the headline stays open.',
    kinds: article, minWidth: 165,
    surface: { borderStyle: 'rule-above', borderWidthPx: rule('Normal'), borderInk: ink('navy'), headlineStyle: 'band-deck', headlineInk: ink('navy'), accentColor: ink('navy') },
  }),
  preset({
    key: 'urgent-update', category: 'News hierarchy', label: 'Urgent update', marathi: 'तातडीचे अपडेट',
    description: 'A double red top rule and red headline signal urgency without flooding the block.',
    kinds: article, minWidth: 140,
    surface: { borderStyle: 'rule-above-double', borderWidthPx: rule('Medium'), borderInk: ink('red'), headlineStyle: 'accent', headlineInk: ink('red'), accentColor: ink('red') },
  }),

  preset({
    key: 'analysis-navy', category: 'Editorial', label: 'Analysis', marathi: 'विश्लेषण',
    description: 'A navy side rule and deck screen separate interpretation from straight reporting.',
    kinds: editorial, minWidth: 150, minHeight: 120,
    surface: { borderStyle: 'rule-left', borderWidthPx: rule('Medium'), borderInk: ink('navy'), headlineStyle: 'band-deck', headlineInk: ink('navy'), accentColor: ink('navy') },
  }),
  preset({
    key: 'opinion-cream', category: 'Editorial', label: 'Opinion', marathi: 'मत',
    description: 'Warm paper tint, maroon heading and a fine double top rule for signed opinion.',
    kinds: editorial, minWidth: 145, minHeight: 120,
    surface: { borderStyle: 'rule-above-double', borderWidthPx: rule('Small'), borderInk: ink('maroon'), backgroundColor: tint('cream'), headlineStyle: 'plain', headlineInk: ink('maroon'), accentColor: ink('maroon') },
  }),
  preset({
    key: 'editorial-formal', category: 'Editorial', label: 'Formal editorial', marathi: 'संपादकीय',
    description: 'Monochrome double rules above and below give an institutional voice.',
    kinds: editorial, minWidth: 150,
    surface: { borderStyle: 'rule-both-double', borderWidthPx: rule('Small') },
  }),
  preset({
    key: 'context-box', category: 'Editorial', label: 'Context box', marathi: 'पार्श्वभूमी',
    description: 'A neutral tint and slate box for facts, background or related information.',
    kinds: compact, minWidth: 120, minHeight: 90, insetRisk: true,
    surface: { borderStyle: 'box', borderWidthPx: rule('Small'), borderInk: ink('slate'), backgroundColor: tint('grey'), headlineInk: ink('slate') },
  }),
  preset({
    key: 'correction-note', category: 'Editorial', label: 'Correction', marathi: 'दुरुस्ती',
    description: 'A distinctive red side rule and pale ground for a sober correction or clarification.',
    kinds: compact, minWidth: 120,
    surface: { borderStyle: 'rule-left-double', borderWidthPx: rule('Normal'), borderInk: ink('red'), backgroundColor: tint('pink'), headlineInk: ink('red'), accentColor: ink('red') },
  }),
  preset({
    key: 'quote-open', category: 'Editorial', label: 'Open quotation', marathi: 'अवतरण',
    description: 'Fine rules above and below let a quotation breathe without enclosing it.',
    kinds: editorial, minWidth: 140, minHeight: 90,
    surface: { borderStyle: 'rule-both', borderWidthPx: rule('Small'), borderInk: ink('maroon'), headlineStyle: 'accent', accentColor: ink('maroon') },
  }),

  preset({
    key: 'feature-blue', category: 'Feature pages', label: 'Blue feature', marathi: 'निळे विशेष',
    description: 'A soft-corner blue panel for a feature page, not an ordinary news page.',
    kinds: editorial, minWidth: 150, minHeight: 120, insetRisk: true,
    surface: { borderStyle: 'box', borderWidthPx: rule('Normal'), borderInk: ink('blue'), borderRadiusPx: radius('Soft'), backgroundColor: tint('vivid-blue'), headlineStyle: 'band-deck', headlineInk: ink('navy'), accentColor: ink('blue') },
  }),
  preset({
    key: 'culture-plum', category: 'Feature pages', label: 'Culture', marathi: 'संस्कृती',
    description: 'Plum ink and a restrained screened headline for arts and culture coverage.',
    kinds: editorial, minWidth: 150, minHeight: 115, insetRisk: true,
    surface: { borderStyle: 'box', borderWidthPx: rule('Small'), borderInk: ink('plum'), borderRadiusPx: radius('Soft'), backgroundColor: tint('vivid-plum'), headlineStyle: 'band', headlineInk: ink('plum'), accentColor: ink('plum') },
  }),
  preset({
    key: 'sports-forest', category: 'Feature pages', label: 'Sport', marathi: 'क्रीडा',
    description: 'Forest ink, light green panel and strong headline screen for sports packages.',
    kinds: editorial, minWidth: 150, minHeight: 115, insetRisk: true,
    surface: { borderStyle: 'box', borderWidthPx: rule('Normal'), borderInk: ink('forest'), borderRadiusPx: radius('Soft'), backgroundColor: tint('vivid-forest'), headlineStyle: 'band', headlineInk: ink('forest'), accentColor: ink('forest') },
  }),
  preset({
    key: 'sunday-amber', category: 'Feature pages', label: 'Sunday feature', marathi: 'रविवार विशेष',
    description: 'Warm amber furniture for a magazine-like weekend block.',
    kinds: editorial, minWidth: 165, minHeight: 130, insetRisk: true,
    surface: { borderStyle: 'box-double', borderWidthPx: rule('Small'), borderInk: ink('amber'), borderRadiusPx: radius('Round'), backgroundColor: tint('vivid-amber'), headlineStyle: 'accent', headlineInk: ink('brown'), accentColor: ink('amber') },
  }),
  preset({
    key: 'profile-rose', category: 'Feature pages', label: 'Profile', marathi: 'व्यक्तिवेध',
    description: 'A rose side rule and light ground for profiles and human-interest writing.',
    kinds: editorial, minWidth: 145, minHeight: 120,
    surface: { borderStyle: 'rule-left', borderWidthPx: rule('Large'), borderInk: ink('rose'), backgroundColor: tint('rose'), headlineInk: ink('plum'), accentColor: ink('rose') },
  }),
  preset({
    key: 'tribute-mono', category: 'Feature pages', label: 'Tribute', marathi: 'श्रद्धांजली',
    description: 'A dignified monochrome frame for obituary or memorial coverage.',
    kinds: editorial, minWidth: 140, minHeight: 110, insetRisk: true,
    surface: { borderStyle: 'box-double', borderWidthPx: rule('Small'), backgroundColor: tint('grey') },
  }),

  preset({
    key: 'market-teal', category: 'Service & data', label: 'Market data', marathi: 'बाजार',
    description: 'Teal rules and a restrained heading screen for sourced financial data.',
    kinds: compact, minWidth: 130, minHeight: 90,
    surface: { borderStyle: 'rule-both', borderWidthPx: rule('Normal'), borderInk: ink('teal'), backgroundColor: tint('teal'), headlineStyle: 'band', headlineInk: ink('teal'), accentColor: ink('teal') },
  }),
  preset({
    key: 'civic-amber', category: 'Service & data', label: 'Civic notice', marathi: 'नागरी सूचना',
    description: 'Amber rule and light ground for closures, outages and public-service information.',
    kinds: compact, minWidth: 125, minHeight: 85, insetRisk: true,
    surface: { borderStyle: 'box', borderWidthPx: rule('Normal'), borderInk: ink('amber'), backgroundColor: tint('amber'), headlineStyle: 'band', headlineInk: ink('brown'), accentColor: ink('amber') },
  }),
  preset({
    key: 'district-briefs', category: 'Service & data', label: 'District briefs', marathi: 'जिल्हा वार्ता',
    description: 'A strong maroon top rule for a compact stack of town and taluka reports.',
    kinds: compact, minWidth: 120, minHeight: 110,
    surface: { borderStyle: 'rule-above-double', borderWidthPx: rule('Normal'), borderInk: ink('maroon'), headlineInk: ink('maroon'), accentColor: ink('maroon') },
  }),
]);

export const BLOCK_DESIGN_CATEGORIES = Object.freeze(
  [...new Set(BLOCK_DESIGN_PRESETS.map((entry) => entry.category))],
);

export function blockDesignPreset(key) {
  return BLOCK_DESIGN_PRESETS.find((entry) => entry.key === key) || null;
}

export function blockDesignPatch(key) {
  const found = blockDesignPreset(key);
  return found ? { ...found.surface } : null;
}

export function presetFitsBlock(entry, section = {}, view = {}) {
  if (!entry) return false;
  if (view.smartCardKey || section.smart_card_key) return false;
  const kind = String(view.blockType || section.block_type || 'article');
  if (kind === 'advert' || kind === 'advertisement' || !entry.kinds.includes(kind)) return false;
  return (Number(section.width_px) || 0) >= entry.minWidth
    && (Number(section.height_px) || 0) >= entry.minHeight;
}

export function availableBlockDesigns(section = {}, view = {}) {
  return BLOCK_DESIGN_PRESETS.filter((entry) => presetFitsBlock(entry, section, view));
}

export function matchingBlockDesign(view = {}) {
  return BLOCK_DESIGN_PRESETS.find((entry) => BLOCK_DESIGN_FIELDS.every((field) => {
    const expected = entry.surface[field] ?? null;
    const actual = view[field] ?? null;
    return typeof expected === 'number'
      ? Math.abs(Number(actual) - expected) < 0.02
      : actual === expected;
  })) || null;
}

export function recommendedBlockDesigns(section = {}, view = {}) {
  const type = String(view.storyType || section.story_type || '').toUpperCase();
  const priority = Number(view.editorialPriority ?? section.editorial_priority ?? 3);
  const kind = String(view.blockType || section.block_type || 'article');
  const keys = type === 'OPINION' ? ['opinion-cream', 'editorial-formal']
    : type === 'ANALYSIS' ? ['analysis-navy', 'navy-deck-screen']
      : type === 'QUOTE' ? ['quote-open', 'open-panel']
        : type === 'DATA' ? ['market-teal', 'context-box']
          : type === 'SIDEBAR' ? ['context-box', 'left-rail']
            : type === 'PHOTO_FEATURE' ? ['clean-news', 'section-opener']
              : type === 'BRIEF' || kind === 'briefs' ? ['district-briefs', 'hairline-finish']
                : priority >= 5 ? ['lead-accent', 'lead-reversed', 'clean-news']
                  : ['clean-news', 'hairline-finish', 'section-opener'];
  const available = new Set(availableBlockDesigns(section, view).map((entry) => entry.key));
  return keys.filter((key) => available.has(key));
}

/** Small inspector preview; it is illustration, never the printable block. */
export function blockDesignPreviewMarkup(entry) {
  if (!entry) return '';
  const s = entry.surface;
  const border = globalThis.SahasBorders.borderEdges(s.borderStyle);
  const isDouble = globalThis.SahasBorders.isDouble(s.borderStyle);
  const headlineGround = s.headlineStyle === 'reverse'
    ? s.accentColor
    : ['band', 'band-both'].includes(s.headlineStyle) ? screenOf(s.accentColor) : 'transparent';
  const deckGround = ['band-deck', 'band-both'].includes(s.headlineStyle)
    ? screenOf(s.accentColor) : 'transparent';
  const style = [
    `--preset-ground:${s.backgroundColor || '#ffffff'}`,
    `--preset-rule:${s.borderInk || '#111111'}`,
    `--preset-head:${s.headlineInk || '#111111'}`,
    `--preset-head-ground:${headlineGround}`,
    `--preset-deck-ground:${deckGround}`,
    `--preset-radius:${s.borderRadiusPx || 0}px`,
    `--preset-rule-width:${Math.max(1, Number(s.borderWidthPx) || 1)}px`,
  ].join(';');
  const classes = ['block-design-preview', isDouble ? 'is-double' : '',
    ...border.map((edge) => `has-${edge}`), s.headlineStyle === 'reverse' ? 'is-reverse' : '']
    .filter(Boolean).join(' ');
  return `<div class="${classes}" style="${style}" aria-hidden="true">
    <span class="block-design-preview-kicker"></span>
    <span class="block-design-preview-head"></span>
    <span class="block-design-preview-head short"></span>
    <span class="block-design-preview-deck"></span>
    <i></i><i></i><i></i><i class="short"></i>
  </div>`;
}

// Development-time catalogue assertions. Tests hold these too; keeping the
// failure close to the definition prevents a newly added preset from silently
// producing a value the server refuses.
for (const entry of BLOCK_DESIGN_PRESETS) {
  if (!BORDER_KEYS.includes(entry.surface.borderStyle)) throw new Error(`Unknown border in ${entry.key}`);
  if (!INKS.some((value) => (value.hex ?? null) === entry.surface.borderInk)) throw new Error(`Unknown rule ink in ${entry.key}`);
  if (!INKS.some((value) => (value.hex ?? null) === entry.surface.headlineInk)) throw new Error(`Unknown headline ink in ${entry.key}`);
  if (!INKS.some((value) => value.hex === entry.surface.accentColor)) throw new Error(`Unknown accent ink in ${entry.key}`);
  if (!TINTS.some((value) => (value.hex ?? null) === entry.surface.backgroundColor)) throw new Error(`Unknown ground in ${entry.key}`);
}
