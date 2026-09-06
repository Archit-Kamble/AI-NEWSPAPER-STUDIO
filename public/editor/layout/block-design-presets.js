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

import { INKS, TINTS, headlineTreatment, screenOf } from './inks.js';
import { clipPathFor, shapedRectPoints } from './block-shapes.js';
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
  minWidth = 0, minHeight = 0, insetRisk = false, companionPanels = [], surface = {} }) => Object.freeze({
  key, category, label, marathi, description,
  kinds: Object.freeze([...kinds]), minWidth, minHeight, insetRisk,
  companionPanels: Object.freeze([...companionPanels]),
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
    key: 'corner-brief', category: 'Core news', label: 'Corner brief', marathi: 'कोपरा वार्ता',
    description: 'A top-left corner rule and a short headline rule give a compact brief a clear entry point.',
    kinds: compact, minWidth: 115, minHeight: 75,
    surface: { borderStyle: 'corner-top-left', borderWidthPx: rule('Normal'), borderInk: ink('slate'), headlineStyle: 'headline-rule-short', accentColor: ink('slate') },
  }),
  preset({
    key: 'open-right-note', category: 'Core news', label: 'Open-right note', marathi: 'उजवीकडे खुली नोंद',
    description: 'A three-sided frame opens toward the related story beside it, ideal for context or follow-up copy.',
    kinds: compact, minWidth: 120, minHeight: 85,
    surface: { borderStyle: 'frame-open-right', borderWidthPx: rule('Small'), borderInk: ink('slate'), backgroundColor: tint('grey'), headlineStyle: 'headline-rule-short', headlineInk: ink('slate'), accentColor: ink('slate') },
  }),
  preset({
    key: 'ledger-close', category: 'Core news', label: 'Ledger close', marathi: 'त्रिरेषा समाप्ती',
    description: 'Three hairlines close a major run of related stories with more ceremony than an ordinary separator.',
    kinds: compact, minWidth: 130, minHeight: 90,
    surface: { borderStyle: 'rule-triple', borderWidthPx: rule('Small'), borderInk: ink('slate'), headlineStyle: 'headline-rule-short', accentColor: ink('slate') },
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
    key: 'breaking-open-frame', category: 'News hierarchy', label: 'Breaking frame', marathi: 'ठळक खुली चौकट',
    description: 'A red frame open at the foot and a heavy headline rule create urgency without a solid banner.',
    kinds: article, minWidth: 175, minHeight: 120,
    surface: { borderStyle: 'frame-open-bottom', borderWidthPx: rule('Medium'), borderInk: ink('red'), headlineStyle: 'headline-rule-heavy', headlineInk: ink('red'), accentColor: ink('red') },
  }),
  preset({
    key: 'lead-centred-rule', category: 'News hierarchy', label: 'Centred lead', marathi: 'मध्यरेषा मुख्य बातमी',
    description: 'A centred accent rule gives a broad, formal lead a composed front-page finish.',
    kinds: article, minWidth: 205, minHeight: 135,
    surface: { borderStyle: 'rule-above-double', borderWidthPx: rule('Small'), borderInk: ink('navy'), headlineStyle: 'headline-rule-center', headlineInk: ink('navy'), accentColor: ink('red') },
  }),
  preset({
    key: 'premium-splash', category: 'News hierarchy', label: 'Premium splash', marathi: 'त्रिरेषा मुख्य बातमी',
    description: 'A triple red entry rule and a compact accent finish reserve the strongest hierarchy for the day’s defining story.',
    kinds: article, minWidth: 220, minHeight: 150,
    surface: { borderStyle: 'rule-above-triple', borderWidthPx: rule('Small'), borderInk: ink('red'), headlineStyle: 'accent-rule', headlineInk: ink('red'), accentColor: ink('red') },
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
    key: 'ruled-splash', category: 'International newsroom', label: 'Ruled splash', marathi: 'रेषांकित मुख्य बातमी',
    description: 'A filled headline measure with one accent word and a precise rule beneath it.',
    kinds: article, minWidth: 190, minHeight: 130,
    surface: { borderStyle: 'rule-above', borderWidthPx: rule('Medium'), borderInk: ink('red'), headlineStyle: 'accent-rule', accentColor: ink('red') },
  }),
  preset({
    key: 'open-headline-rule', category: 'International newsroom', label: 'Open headline rule', marathi: 'खुली मथळा रेषा',
    description: 'An open story with a rule tied to the headline instead of the outer block.',
    kinds: article, minWidth: 145, minHeight: 100,
    surface: { headlineStyle: 'headline-rule', accentColor: ink('slate') },
  }),
  preset({
    key: 'section-tab-red', category: 'International newsroom', label: 'Section tab', marathi: 'विभाग पट्टी',
    description: 'A compact screened tab behind the kicker creates a clear, repeatable section entry.',
    kinds: editorial, minWidth: 135, minHeight: 95,
    surface: { borderStyle: 'rule', borderWidthPx: rule('Small'), headlineStyle: 'kicker-tab', headlineInk: ink('red'), accentColor: ink('red') },
  }),
  preset({
    key: 'city-desk-tab', category: 'International newsroom', label: 'City desk package', marathi: 'शहर वार्ता पट्टी',
    description: 'A maroon section tab and closing display rule hold a local-news package together.',
    kinds: compact, minWidth: 135, minHeight: 105,
    surface: { borderStyle: 'rule-both', borderWidthPx: rule('Small'), borderInk: ink('maroon'), headlineStyle: 'kicker-tab-rule', headlineInk: ink('maroon'), accentColor: ink('maroon') },
  }),
  preset({
    key: 'stepped-commentary', category: 'International newsroom', label: 'Stepped commentary', marathi: 'पायरीदार भाष्य',
    description: 'Light bands follow each composed headline line, with a sober navy editorial rail.',
    kinds: editorial, minWidth: 145, minHeight: 120,
    surface: { borderStyle: 'rule-left', borderWidthPx: rule('Medium'), borderInk: ink('navy'), headlineStyle: 'stepped-lines', headlineInk: ink('navy'), accentColor: ink('blue') },
  }),
  preset({
    key: 'interview-display-rule', category: 'International newsroom', label: 'Interview', marathi: 'मुलाखत',
    description: 'Open side edges and a rule after the complete display make room for Q&A copy.',
    kinds: editorial, minWidth: 150, minHeight: 120,
    surface: { borderStyle: 'rule-both', borderWidthPx: rule('Small'), borderInk: ink('maroon'), headlineStyle: 'display-rule', headlineInk: ink('maroon'), accentColor: ink('maroon') },
  }),
  preset({
    key: 'world-desk', category: 'International newsroom', label: 'World desk', marathi: 'जागतिक वार्ता',
    description: 'A navy double entry rule and blue accent rule give foreign coverage a distinct desk identity.',
    kinds: article, minWidth: 150, minHeight: 105,
    surface: { borderStyle: 'rule-above-double', borderWidthPx: rule('Small'), borderInk: ink('navy'), headlineStyle: 'accent-rule', headlineInk: ink('navy'), accentColor: ink('blue') },
  }),
  preset({
    key: 'data-headline-rule', category: 'International newsroom', label: 'Data brief', marathi: 'आकडेवारी बातमी',
    description: 'A teal fact-paper ground, side rail and headline rule frame a sourced data story.',
    kinds: compact, minWidth: 135, minHeight: 95,
    surface: { borderStyle: 'rule-left', borderWidthPx: rule('Medium'), borderInk: ink('teal'), backgroundColor: tint('teal'), headlineStyle: 'headline-rule', headlineInk: ink('teal'), accentColor: ink('teal') },
  }),
  preset({
    key: 'photo-display-rule', category: 'International newsroom', label: 'Photo dispatch', marathi: 'छायाचित्र वृत्तांत',
    description: 'A quiet rule after the display anchors a photograph-led dispatch without boxing it.',
    kinds: ['photo', 'article'], minWidth: 165, minHeight: 115,
    surface: { borderStyle: 'rule', borderWidthPx: rule('Small'), borderInk: ink('slate'), headlineStyle: 'display-rule', accentColor: ink('slate') },
  }),
  preset({
    key: 'weekend-stepped', category: 'International newsroom', label: 'Weekend essay', marathi: 'साप्ताहिक लेख',
    description: 'Warm paper and stepped amber headline bands give a feature-page essay a measured magazine voice.',
    kinds: editorial, minWidth: 165, minHeight: 130,
    surface: { backgroundColor: tint('cream'), headlineStyle: 'stepped-lines', headlineInk: ink('brown'), accentColor: ink('amber') },
  }),
  preset({
    key: 'section-rail-blue', category: 'International newsroom', label: 'Section rail', marathi: 'विभाग रेषा',
    description: 'A blue section tab continues into a fine rail, creating a repeatable desk signature across a page.',
    kinds: editorial, minWidth: 145, minHeight: 95,
    surface: { borderStyle: 'rule', borderWidthPx: rule('Small'), borderInk: ink('blue'), headlineStyle: 'kicker-rail', headlineInk: ink('navy'), accentColor: ink('blue') },
  }),
  preset({
    key: 'double-display-package', category: 'International newsroom', label: 'Double display close', marathi: 'दुहेरी मथळा समाप्ती',
    description: 'Two fine rules close the complete display for a formal package or special report.',
    kinds: editorial, minWidth: 160, minHeight: 115,
    surface: { borderStyle: 'frame-open-top', borderWidthPx: rule('Small'), borderInk: ink('maroon'), headlineStyle: 'display-rule-double', headlineInk: ink('maroon'), accentColor: ink('maroon') },
  }),

  // ACCOUNTABILITY IS A JOB, NOT A COLOUR. These treatments distinguish the
  // forms a serious newsroom uses to show how it knows: investigation,
  // verification, public record, direct comparison and an explanatory guide.
  // `companionPanels` is advice in the inspector only. Applying a surface
  // never manufactures evidence, inserts copy or moves a rectangle.
  preset({
    key: 'investigation-file', category: 'Accountability', label: 'Investigation file', marathi: 'शोधवृत्त',
    description: 'A doubled red evidence rail and a ruled headline give an investigation authority without turning the story into an alarm banner.',
    kinds: editorial, minWidth: 165, minHeight: 120,
    companionPanels: ['document', 'timeline'],
    surface: { borderStyle: 'rule-left-double', borderWidthPx: rule('Normal'), borderInk: ink('red'), headlineStyle: 'accent-rule', accentColor: ink('red') },
  }),
  preset({
    key: 'verified-report', category: 'Accountability', label: 'Verified report', marathi: 'तथ्य पडताळणी',
    description: 'A teal entry rule and compact desk tab mark a checked claim; the pale ground keeps evidence distinct from commentary.',
    kinds: compact, minWidth: 140, minHeight: 105,
    companionPanels: ['comparison', 'document'],
    surface: { borderStyle: 'rule-above-double', borderWidthPx: rule('Small'), borderInk: ink('teal'), backgroundColor: tint('teal'), headlineStyle: 'kicker-tab-rule', headlineInk: ink('teal'), accentColor: ink('teal') },
  }),
  preset({
    key: 'public-record', category: 'Accountability', label: 'Public record', marathi: 'सार्वजनिक नोंद',
    description: 'Slate double rules and a quiet paper-grey ground set an order, audit, judgment or official record apart from ordinary narration.',
    kinds: compact, minWidth: 135, minHeight: 100,
    companionPanels: ['document'],
    surface: { borderStyle: 'rule-both-double', borderWidthPx: rule('Small'), borderInk: ink('slate'), backgroundColor: tint('grey'), headlineStyle: 'headline-rule', headlineInk: ink('slate'), accentColor: ink('slate') },
  }),
  preset({
    key: 'policy-before-now', category: 'Accountability', label: 'Before and now', marathi: 'आधी आणि आता',
    description: 'An open blue comparison rail makes a policy or outcome change easy to scan while leaving the reporting visually primary.',
    kinds: compact, minWidth: 145, minHeight: 105,
    companionPanels: ['comparison'],
    surface: { borderStyle: 'rule-both', borderWidthPx: rule('Normal'), borderInk: ink('blue'), backgroundColor: tint('blue'), headlineStyle: 'display-rule', headlineInk: ink('navy'), accentColor: ink('blue') },
  }),
  preset({
    key: 'reader-guide', category: 'Accountability', label: 'Reader guide', marathi: 'वाचक मार्गदर्शक',
    description: 'A warm left rail and section tab identify practical explanation without making public-service reporting look promotional.',
    kinds: editorial, minWidth: 145, minHeight: 110,
    companionPanels: ['explainer', 'related'],
    surface: { borderStyle: 'rule-left', borderWidthPx: rule('Medium'), borderInk: ink('amber'), backgroundColor: tint('cream'), headlineStyle: 'kicker-tab-rule', headlineInk: ink('brown'), accentColor: ink('amber') },
  }),
  preset({
    key: 'results-desk', category: 'Accountability', label: 'Results desk', marathi: 'निकाल कक्ष',
    description: 'A maroon double close and precise headline rule hold election, examination or official tally reporting together.',
    kinds: compact, minWidth: 145, minHeight: 100,
    companionPanels: ['key-number', 'comparison'],
    surface: { borderStyle: 'rule-both-double', borderWidthPx: rule('Normal'), borderInk: ink('maroon'), backgroundColor: tint('maroon'), headlineStyle: 'headline-rule', headlineInk: ink('maroon'), accentColor: ink('maroon') },
  }),
  preset({
    key: 'legal-docket', category: 'Accountability', label: 'Legal docket', marathi: 'कायदेशीर नोंद',
    description: 'A sober open-top frame and double display rule distinguish a court, tender or government record.',
    kinds: compact, minWidth: 145, minHeight: 105,
    companionPanels: ['document', 'timeline'],
    surface: { borderStyle: 'frame-open-top', borderWidthPx: rule('Normal'), borderInk: ink('slate'), backgroundColor: tint('grey'), headlineStyle: 'display-rule-double', headlineInk: ink('slate'), accentColor: ink('slate') },
  }),
  preset({
    key: 'verdict-corner', category: 'Accountability', label: 'Verdict corner', marathi: 'निर्णय कोपरा',
    description: 'A firm upper-right corner and heavy maroon headline rule suit a decisive official outcome.',
    kinds: compact, minWidth: 130, minHeight: 90,
    companionPanels: ['key-number', 'document'],
    surface: { borderStyle: 'corner-top-right', borderWidthPx: rule('Medium'), borderInk: ink('maroon'), backgroundColor: tint('maroon'), headlineStyle: 'headline-rule-heavy', headlineInk: ink('maroon'), accentColor: ink('maroon') },
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
    key: 'profile-bevel', category: 'Feature pages', label: 'Bevelled profile', marathi: 'तिरपा व्यक्तिवेध',
    description: 'A top bevel, rose rule and restrained paper tint create a distinctive profile without changing its layout.',
    kinds: editorial, minWidth: 155, minHeight: 125, insetRisk: true,
    surface: { borderStyle: 'box', borderWidthPx: rule('Normal'), borderInk: ink('rose'), backgroundColor: tint('rose'), headlineStyle: 'headline-rule-short', headlineInk: ink('plum'), accentColor: ink('rose'), frameShape: 'bevel-top' },
  }),
  preset({
    key: 'culture-chevron', category: 'Feature pages', label: 'Culture chevron', marathi: 'संस्कृती तिरपी चौकट',
    description: 'Opposite cut corners and a plum headline screen give arts coverage a controlled visual cadence.',
    kinds: editorial, minWidth: 155, minHeight: 120, insetRisk: true,
    surface: { borderStyle: 'box', borderWidthPx: rule('Small'), borderInk: ink('plum'), backgroundColor: tint('vivid-plum'), headlineStyle: 'band-deck', headlineInk: ink('plum'), accentColor: ink('plum'), frameShape: 'chevron-alt' },
  }),
  preset({
    key: 'weekend-octagon', category: 'Feature pages', label: 'Weekend octagon', marathi: 'अष्टकोनी रविवार',
    description: 'A softly screened octagonal frame makes a long-read fact or standfirst feel deliberately special.',
    kinds: editorial, minWidth: 165, minHeight: 135, insetRisk: true,
    surface: { borderStyle: 'box-double', borderWidthPx: rule('Small'), borderInk: ink('amber'), backgroundColor: tint('cream'), headlineStyle: 'headline-rule-center', headlineInk: ink('brown'), accentColor: ink('amber'), frameShape: 'octagon' },
  }),
  preset({
    key: 'heritage-frame', category: 'Feature pages', label: 'Heritage frame', marathi: 'त्रिरेषा विशेष',
    description: 'A formal triple maroon frame gives an anniversary, archive or commemorative package a print-led identity.',
    kinds: editorial, minWidth: 165, minHeight: 130, insetRisk: true,
    surface: { borderStyle: 'box-triple', borderWidthPx: rule('Small'), borderInk: ink('maroon'), backgroundColor: tint('cream'), headlineStyle: 'headline-rule-center', headlineInk: ink('maroon'), accentColor: ink('maroon') },
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
  preset({
    key: 'tender-notice', category: 'Service & data', label: 'Tender notice', marathi: 'निविदा सूचना',
    description: 'A formal three-sided slate frame and double display rule suit public tenders and statutory notices.',
    kinds: compact, minWidth: 140, minHeight: 105,
    surface: { borderStyle: 'frame-open-bottom', borderWidthPx: rule('Normal'), borderInk: ink('slate'), backgroundColor: tint('grey'), headlineStyle: 'display-rule-double', headlineInk: ink('slate'), accentColor: ink('slate') },
  }),
  preset({
    key: 'market-tape', category: 'Service & data', label: 'Market tape', marathi: 'बाजार पट्टा',
    description: 'A teal section rail and open-bottom frame organise market figures and the previous session’s context.',
    kinds: compact, minWidth: 145, minHeight: 95,
    surface: { borderStyle: 'frame-open-bottom', borderWidthPx: rule('Small'), borderInk: ink('teal'), backgroundColor: tint('teal'), headlineStyle: 'kicker-rail', headlineInk: ink('teal'), accentColor: ink('teal') },
  }),
  preset({
    key: 'scoreline', category: 'Service & data', label: 'Scoreline', marathi: 'क्रीडा निकाल',
    description: 'A forest corner rule and compact headline finish keep scores fast to scan and unmistakably editorial.',
    kinds: compact, minWidth: 120, minHeight: 80,
    surface: { borderStyle: 'corner-bottom-right', borderWidthPx: rule('Medium'), borderInk: ink('forest'), backgroundColor: tint('forest'), headlineStyle: 'headline-rule-short', headlineInk: ink('forest'), accentColor: ink('forest') },
  }),
  preset({
    key: 'weather-window', category: 'Service & data', label: 'Weather window', marathi: 'हवामान चौकट',
    description: 'An open-left blue frame and centred rule create a calm service panel for local weather.',
    kinds: compact, minWidth: 125, minHeight: 85,
    surface: { borderStyle: 'frame-open-left', borderWidthPx: rule('Small'), borderInk: ink('blue'), backgroundColor: tint('blue'), headlineStyle: 'headline-rule-center', headlineInk: ink('navy'), accentColor: ink('blue') },
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
  const keys = type === 'OPINION' ? ['opinion-cream', 'stepped-commentary', 'editorial-formal']
    : type === 'ANALYSIS' ? ['stepped-commentary', 'analysis-navy', 'navy-deck-screen']
      : type === 'QUOTE' ? ['quote-open', 'open-panel']
        : type === 'DATA' ? ['data-headline-rule', 'market-teal', 'results-desk', 'context-box']
          : type === 'SIDEBAR' ? ['reader-guide', 'context-box', 'left-rail']
            : type === 'PHOTO_FEATURE' ? ['photo-display-rule', 'clean-news', 'section-opener']
              : type === 'BRIEF' || kind === 'briefs' ? ['city-desk-tab', 'district-briefs', 'hairline-finish']
                : priority >= 5 ? ['ruled-splash', 'lead-accent', 'lead-reversed', 'clean-news']
                  : ['clean-news', 'hairline-finish', 'section-opener'];
  const available = new Set(availableBlockDesigns(section, view).map((entry) => entry.key));
  return keys.filter((key) => available.has(key));
}

/** Small inspector preview; it is illustration, never the printable block. */
export function blockDesignPreviewMarkup(entry) {
  if (!entry) return '';
  const s = entry.surface;
  const treatment = headlineTreatment(s.headlineStyle);
  const border = globalThis.SahasBorders.borderEdges(s.borderStyle);
  const lineCount = globalThis.SahasBorders.borderLineCount(s.borderStyle);
  const isDouble = lineCount === 2;
  const headlineGround = s.headlineStyle === 'reverse'
    ? s.accentColor
    : ['band', 'band-both'].includes(s.headlineStyle) ? screenOf(s.accentColor) : 'transparent';
  const deckGround = ['band-deck', 'band-both'].includes(s.headlineStyle)
    ? screenOf(s.accentColor) : 'transparent';
  const style = [
    `--preset-ground:${s.backgroundColor || '#ffffff'}`,
    `--preset-rule:${s.borderInk || '#111111'}`,
    `--preset-accent:${s.accentColor || '#c8102e'}`,
    `--preset-accent-screen:${screenOf(s.accentColor || '#c8102e')}`,
    `--preset-head:${s.headlineInk || '#111111'}`,
    `--preset-head-ground:${headlineGround}`,
    `--preset-deck-ground:${deckGround}`,
    `--preset-radius:${s.borderRadiusPx || 0}px`,
    `--preset-rule-width:${Math.max(1, Number(s.borderWidthPx) || 1)}px`,
    s.frameShape ? `clip-path:${clipPathFor(s.frameShape, 112, 88)}` : '',
  ].join(';');
  const needsBorderOverlay = Boolean(s.frameShape) || lineCount > 2;
  const classes = ['block-design-preview', isDouble ? 'is-double' : '', lineCount > 2 ? 'is-triple' : '',
    ...(needsBorderOverlay ? ['is-shaped'] : border.map((edge) => `has-${edge}`)),
    s.headlineStyle === 'reverse' ? 'is-reverse' : '',
    treatment.ruleAfter ? `has-${treatment.ruleAfter}-rule` : '',
    treatment.kickerTab ? 'has-kicker-tab' : '', treatment.steppedLines ? 'has-stepped-lines' : '',
    treatment.kickerRail ? 'has-kicker-rail' : '',
    Number(treatment.ruleShare) < 1 ? 'has-short-rule' : '',
    treatment.ruleAlign === 'centre' ? 'has-centred-rule' : '',
    Number(treatment.ruleHeight) > 1 ? 'has-heavy-rule' : '',
    Number(treatment.ruleCount) > 1 ? 'has-double-rule' : '',
    treatment.accentWord ? 'has-accent-word' : '']
    .filter(Boolean).join(' ');
  const shapeBorder = (() => {
    if (!needsBorderOverlay || !border.length) return '';
    const weight = Math.max(1, Number(s.borderWidthPx) || 1);
    const offsets = globalThis.SahasBorders.borderOffsetsPx(s.borderStyle, weight);
    const polygons = offsets.map((offset) => {
      const width = 112 - offset * 2 - weight;
      const height = 88 - offset * 2 - weight;
      if (width <= 0 || height <= 0) return '';
      if (s.frameShape) {
        const points = shapedRectPoints(s.frameShape, width, height)
          .map(([x, y]) => `${(x + offset + weight / 2).toFixed(2)},${(y + offset + weight / 2).toFixed(2)}`)
          .join(' ');
        return `<polygon points="${points}" fill="none" stroke="${s.borderInk || '#111111'}" stroke-width="${weight}" />`;
      }
      const lines = {
        top: [offset, offset + weight / 2, 112 - offset, offset + weight / 2],
        right: [112 - offset - weight / 2, offset, 112 - offset - weight / 2, 88 - offset],
        bottom: [offset, 88 - offset - weight / 2, 112 - offset, 88 - offset - weight / 2],
        left: [offset + weight / 2, offset, offset + weight / 2, 88 - offset],
      };
      return border.map((edge) => {
        const [x1, y1, x2, y2] = lines[edge];
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${s.borderInk || '#111111'}" stroke-width="${weight}" />`;
      }).join('');
    }).join('');
    return `<svg class="block-design-preview-shape" viewBox="0 0 112 88" aria-hidden="true">${polygons}</svg>`;
  })();
  return `<div class="${classes}" style="${style}" aria-hidden="true">
    ${shapeBorder}
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
