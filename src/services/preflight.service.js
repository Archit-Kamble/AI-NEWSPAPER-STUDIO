// Preflight: everything that must be true before a page goes to the plate.
//
// Every print shop runs this check, and it exists because the mistakes it
// catches are the expensive ones - they are not found on screen, they are found
// on fifty thousand copies. The workspace already holds every number needed to
// make the checks, so there is no reason for the desk to be the last line of
// defence.
//
// The one that matters most is RESOLUTION. A photograph that looks perfect on a
// 660-pixel canvas can be a 400-pixel web image being blown up to 130 mm, which
// at the press's 300 dpi is 78 dpi of real detail: on paper it is a mush of
// squares. Nothing on screen shows this. The arithmetic does.
//
// Findings are graded, and the grade means something:
//   error    do not print this. It will be visibly wrong.
//   warning  a person should look at it and decide.
//   note     worth knowing, not worth stopping for.

const path = require('path');
const pool = require('../config/db');
const { geometryOf, pxToMm } = require('../layout/geometry');
const { getTemplate } = require('../layout/templates');
const { resolveFramePurpose } = require('../layout/frame-purpose');
const { panelsOf } = require('../../public/editor/layout/inset-panels.js');

// Below this, a photograph visibly breaks up on newsprint. 300 dpi is the
// target; 150 is the point at which a picture editor would reject it.
const MIN_EFFECTIVE_DPI = 150;
const IDEAL_EFFECTIVE_DPI = 300;
// Newsprint will not hold type smaller than this legibly.
const MIN_BODY_PT = 6.5;

// Evidence furniture has to say where the evidence came from. This is a
// WARNING rather than a blocker because the source may already be explicit in
// the surrounding report, but the desk must see the omission before the page
// reaches plate. It never invents or inserts a source.
const SOURCE_LABEL = /^(?:स्रोत|संदर्भ|आधार|source)\s*[:：\-]/i;
const labelledSource = (value) => SOURCE_LABEL.test(String(value || '').trim());

function evidenceSourceFindings(section = {}) {
  const findings = [];
  for (const panel of panelsOf(section)) {
    if (['document', 'key-number'].includes(panel.kind)
      && !panel.lines.some(labelledSource)) {
      findings.push({
        level: 'warning', check: 'unsourced-evidence-panel',
        message: `${panel.kind === 'document' ? 'Document excerpt' : 'Key number'} has no labelled source. Add “स्रोत : …” before press.`,
      });
    }
    if (['chart', 'table'].includes(panel.kind) && !String(panel.card?.source || '').trim()) {
      findings.push({
        level: 'warning', check: 'unsourced-data-panel',
        message: `${panel.kind === 'chart' ? 'Chart' : 'Table'} inset has no source. Add the provider and reference date before press.`,
      });
    }
  }
  const cardKey = String(section.smart_card_key || '').toLowerCase();
  if (['chart', 'table'].includes(cardKey) && !String(section.smart_card_data?.source || '').trim()) {
    findings.push({
      level: 'warning', check: 'unsourced-data-card',
      message: `${cardKey === 'chart' ? 'Chart' : 'Table'} block has no source. Add the provider and reference date before press.`,
    });
  }
  return findings;
}

let JimpModule = null;
async function getJimp() {
  if (!JimpModule) ({ Jimp: JimpModule } = await import('jimp'));
  return JimpModule;
}

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const pxToPt = (px) => (Number(px) / 2) * 72 / 25.4;

// What resolution a picture will actually print at: its own pixels spread over
// the millimetres it has been scaled to on the page.
async function effectiveDpi(image) {
  try {
    const Jimp = await getJimp();
    const file = path.join(PUBLIC_DIR, String(image.url).replace(/^\/+/, ''));
    const loaded = await Jimp.read(file);
    const widthMm = pxToMm(image.width_px);
    const heightMm = pxToMm(image.height_px);
    if (widthMm <= 0 || heightMm <= 0) return null;
    return {
      dpiX: Math.round(loaded.bitmap.width / (widthMm / 25.4)),
      dpiY: Math.round(loaded.bitmap.height / (heightMm / 25.4)),
      sourceWidth: loaded.bitmap.width,
      sourceHeight: loaded.bitmap.height,
      widthMm: Number(widthMm.toFixed(1)),
    };
  } catch {
    return { missing: true };
  }
}

// Two blocks may touch but must not overlap: on the page one would print on top
// of the other.
function overlaps(a, b) {
  return (
    a.x_px < b.x_px + b.width_px &&
    b.x_px < a.x_px + a.width_px &&
    a.y_px < b.y_px + b.height_px &&
    b.y_px < a.y_px + a.height_px
  );
}

let flowModule = null;
async function textFlow() {
  if (!flowModule) flowModule = await import('../../public/editor/layout/text-flow.js');
  return flowModule;
}

// A Smart Card too small for its own block used to just clip (or, before
// that, silently render at whichever of three disagreeing hardcoded sizes
// its container happened to apply) - never a signal a press-readiness check
// could see. smartCardFitState() answers the same question smartCardMarkup()
// already does while drawing, without drawing anything.
let smartCardModule = null;
async function smartCards() {
  if (!smartCardModule) smartCardModule = await import('../../public/editor/smart-cards/smart-cards.js');
  return smartCardModule;
}
let smartCardLayoutModule = null;
async function smartCardLayout() {
  if (!smartCardLayoutModule) smartCardLayoutModule = await import('../../public/editor/smart-cards/layout.js');
  return smartCardLayoutModule;
}

// The exact composition engine, for the one check that has to agree with
// fit.service.js exactly: whether a block's REAL copy actually fits. Both
// used to ask text-flow.js's approximate character grid, each with its own
// call - close enough to agree in the ordinary case, but "fit says this
// fits" and "preflight still fails it" is exactly the two-numbers-disagree
// bug this engine exists to remove, and a sign-off is the worst place to
// find it. The rest of this file's checks (band-vs-image collisions, caption
// placement) stay on the existing box-based geometry below; only the overset
// question moves, because it is the one both services must answer alike.
let composeModule = null;
async function compose() {
  if (!composeModule) composeModule = await import('../../public/editor/compose/section-adapter.js');
  return composeModule;
}
let richTextModule = null;
async function richText() {
  if (!richTextModule) richTextModule = await import('../../public/editor/layout/rich-text.js');
  return richTextModule;
}
let metricsModule = null;
let shaperModule = null;
async function ensureComposeReady() {
  if (!metricsModule) metricsModule = await import('../../public/editor/compose/font-metrics.js');
  if (!shaperModule) shaperModule = await import('../../public/editor/compose/shaper.js');
  await Promise.all([metricsModule.ensureFontsLoaded(), shaperModule.ensureShaperReady()]);
  // Preflight is the last check before the plate. An overset verdict reached
  // from approximate widths because the shaper silently failed to load is
  // not a conservative check, it is a wrong one - loud failure, not a quiet
  // downgrade.
  shaperModule.requireShaperReady();
}

async function checkPage(page, newspaper, totalPages) {
  const g = geometryOf(newspaper);
  const { flowViewFromSection, buildFlowMap, flowImageFromRow, bandBox, captionBox, CELL } = await textFlow();
  await ensureComposeReady();
  const adapter = await compose();
  const findings = [];
  const at = (section) => ({ pageNumber: page.page_number, sectionKey: section.section_key });

  const matter = {
    left: g.marginXPx,
    top: g.marginYPx,
    right: g.marginXPx + g.matterWidthPx,
    bottom: g.marginYPx + g.matterHeightPx,
  };
  // The region a story is actually allowed to occupy - inside the matter box,
  // AND clear of the header/footer furniture (Project A's region model,
  // geometry.js's regionsFor). page-region furniture (masthead-advert aside,
  // which is deliberately IN the header band beside the nameplate) is not a
  // section a desk places, so this only ever fires for a custom block dragged
  // somewhere the snap-to-content clamp (pageSection.service.js) should
  // already have prevented - defence in depth, not the primary guard.
  const region = Number(page.page_number) === 1 ? g.regions.front
    : (Number(page.page_number) === 2 ? g.regions.insideImprint : g.regions.inside);

  const sections = page.sections || [];
  const templateByKey = new Map(getTemplate(page.template_key).sections.map((item) => [item.key, item]));

  for (const section of sections) {
    const ownership = resolveFramePurpose(section, templateByKey.get(section.section_key));
    for (const code of ownership.errors) findings.push({
      level: 'error', check: code.toLowerCase().replace(/_/g, '-'), ...at(section),
      message: code === 'IMAGE_COMPANION_ORPHAN'
        ? 'This image companion has no canonical story-package owner.'
        : 'This physical frame has no unambiguous publication-content ownership policy.',
    });
    // --- inside the matter box -------------------------------------------
    if (
      section.x_px < matter.left - 1 || section.y_px < matter.top - 1 ||
      section.x_px + section.width_px > matter.right + 1 ||
      section.y_px + section.height_px > matter.bottom + 1
    ) {
      findings.push({
        level: 'error', check: 'outside-matter', ...at(section),
        message: 'This block runs outside the matter box and will be trimmed off.',
      });
    }

    // --- on top of the nameplate/folio or the footer furniture ------------
    // The masthead's own sold corner (`masthead-advert`) lives in the header
    // band by design (templates.js) and is exempt; every other block must
    // stay inside the content region.
    if (section.section_key !== 'masthead-advert' && section.y_px < region.header.bottom - 1) {
      findings.push({
        level: 'error', check: 'header-collision', ...at(section),
        message: 'This block overlaps the nameplate/folio band.',
      });
    }
    if (section.y_px + section.height_px > region.footer.top + 1) {
      findings.push({
        level: 'error', check: 'footer-collision', ...at(section),
        message: 'This block overlaps the footer band and will print under the page-foot/imprint furniture.',
      });
    }

    // --- nonsense geometry --------------------------------------------------
    if (section.width_px <= 0 || section.height_px <= 0) {
      findings.push({
        level: 'error', check: 'negative-dimensions', ...at(section),
        message: `This block has a ${section.width_px}×${section.height_px}px size - nothing can be drawn in it.`,
      });
    }

    // --- copy that does not fit -------------------------------------------
    // The exact engine, not the character grid: the same composeSection()
    // fit.service.js measures a fix against, so a block fit just approved can
    // never fail this check the way an approximate-grid-vs-approximate-grid
    // comparison could.
    if (section.body) {
      const composed = adapter.composeSection(section, {});
      if (adapter.bodyOverset(composed)) {
        findings.push({
          level: 'error', check: 'overset', ...at(section),
          message: `${adapter.bodyOversetChars(composed)} characters more than this block holds. Cut it, or carry it over.`,
        });
      }
    }

    // --- italic copy going to press ------------------------------------------
    // Bold, underline and a selected size all reach the press file as real,
    // documented Scribus CharStyle attributes (a genuinely separate bold font
    // file; FEATURES="underline"; FONTSIZE is just a number) - confirmed
    // against the actual Scribus 1.6.1 binary's own CharStyle flag names, not
    // assumed. Italic is different in kind, not just unverified: no Devanagari
    // face in this publication - or upstream in Noto Serif/Sans Devanagari at
    // all - ships a true italic style, so `FEATURES="italic"` in the press
    // file is a synthetic oblique (the same slant Scribus's own Italic toggle
    // would apply to any font lacking one), and a slanted conjunct can read
    // worse than an unslanted one. This is a real, desk-visible caution, not
    // a dropped feature - see scribus.service.js's own note on this.
    if (section.body) {
      const { textWithMarks } = await richText();
      const { marks } = textWithMarks(section.body);
      const hasItalic = marks.some((m) => m.tag === 'i');
      if (hasItalic) {
        findings.push({
          level: 'warning', check: 'synthetic-italic-print', ...at(section),
          message: 'This story has italic copy. No Devanagari face this publication ships has a true italic style, so the press file slants the upright letterforms instead - check that it stays legible before it goes to plate.',
        });
      }
    }

    // --- a Smart Card too small for its own block --------------------------
    // The same geometry solve smartCardMarkup() draws from (layout.js),
    // asked without drawing anything - a card that would print at a legible
    // FLOOR size rather than its block's true measure is a real press
    // problem (SMART_CARD_OVERSET), not a cosmetic one, so it is an error
    // for a printable page exactly like text overset is above.
    //
    // The frame is read off the SAME exact composition the page canvas draws
    // a card's kicker/headline/deck from (composeSection() with an empty
    // body and no images - a Smart Card is never prose) - not a second,
    // approximate buildFlowMap() row count that could disagree with it. A
    // headline that auto-fit smaller changes its real line count; the old
    // estimate never tracked that, so preflight could be checking a
    // different frame than the one the page actually drew.
    if (section.smart_card_key && section.smart_card_data) {
      const { smartCardFitState } = await smartCards();
      const { smartCardFrameFromComposition } = await smartCardLayout();
      const view = flowViewFromSection(section);
      const emptyCardDisplay = { headline: '', subheading: '', body: '' };
      const composition = adapter.composeSection(
        { ...section, images: [], ...emptyCardDisplay },
        { ...view, ...emptyCardDisplay },
      );
      const frame = smartCardFrameFromComposition(composition);
      if (smartCardFitState(section.smart_card_key, section.smart_card_data, frame) === 'OVERSET') {
        findings.push({
          level: 'error', check: 'smart-card-overset', ...at(section),
          message: 'This Smart Card does not fit its block at a legible size. Widen or heighten the block, or reduce what the card holds.',
        });
      }
    }

    // --- evidence and data provenance ------------------------------------
    // These warnings inspect the same stored panel/card structures every
    // renderer consumes. They do not infer a citation from prose, because a
    // printed evidence module should carry its own visible source label.
    for (const finding of evidenceSourceFindings(section)) {
      findings.push({ ...finding, ...at(section) });
    }

    // --- photograph/caption against printable copy ------------------------
    // The canonical flow map is also what the renderer uses. If a title band
    // cannot retain half its measure, the placement is an error—not a valid
    // squeezed headline. Caption bounds come from the same shared helper.
    if ((section.images || []).length) {
      const view = flowViewFromSection(section);
      const map = buildFlowMap(section, view, section.images.map(flowImageFromRow));
      const padding = Number(view.marginPx) || 12;
      const measure = map.cols * map.cellWidth;
      for (const [kind, present] of [[CELL.KICKER, view.kicker], [CELL.HEADLINE, view.headline], [CELL.SUBHEADING, view.subheading]]) {
        if (!present) continue;
        const box = bandBox(map, kind, padding, measure, padding);
        if (!box.safe) findings.push({
          level: 'error', check: 'image-text-collision', ...at(section),
          message: 'A photograph consumes the kicker/headline/deck band. Move or remove it before press.',
        });
      }
      const protectedBottom = padding + (map.kickerRows + map.headlineRows + map.subheadingRows) * map.cellHeight;
      for (const image of section.images) {
        const box = captionBox(image);
        if (!box) continue;
        if (box.x < 0 || box.y < 0 || box.x + box.width > Number(section.width_px) || box.y + box.height > Number(section.height_px)) findings.push({
          level: 'error', check: 'caption-outside-section', ...at(section),
          message: 'A photograph caption runs outside its owning block.',
        });
        if (box.y < protectedBottom) findings.push({
          level: 'error', check: 'caption-text-collision', ...at(section),
          message: 'A photograph caption intersects the kicker/headline/deck area.',
        });
      }
    }

    // --- type too small to read on newsprint ------------------------------
    const bodyPt = pxToPt(section.body_font_px);
    if (section.body && bodyPt < MIN_BODY_PT) {
      findings.push({
        level: 'warning', check: 'type-too-small', ...at(section),
        message: `Body type is ${bodyPt.toFixed(1)}pt. Newsprint will not hold anything under ${MIN_BODY_PT}pt.`,
      });
    }

    // --- an empty block on a page about to print --------------------------
    const empty = !section.headline && !section.body && !section.image_url && !(section.images || []).length;
    if (empty && section.block_type !== 'advert') {
      findings.push({
        level: 'warning', check: 'empty-block', ...at(section),
        message: 'This block is empty and will print as a white hole.',
      });
    }

    // --- two pictures on the same block printing on top of each other -----
    // Graded, not flatly an error: a cutout's real occupancy is its alpha
    // mask, narrower than the rectangle stored in x_px/y_px/width_px/height_px
    // (Project A audit - a bounding-box check is the wrong tool for a cutout,
    // confirmed by direct visual inspection, not assumed). Two overlapping
    // RECTANGLES are unambiguous; anything involving a cutout is flagged for a
    // person to look at rather than failed outright.
    const images = section.images || [];
    for (let i = 0; i < images.length; i += 1) {
      for (let j = i + 1; j < images.length; j += 1) {
        if (!overlaps(images[i], images[j])) continue;
        const bothRect = (images[i].shape || 'rect') === 'rect' && (images[j].shape || 'rect') === 'rect';
        findings.push({
          level: bothRect ? 'error' : 'warning', check: 'image-collision', ...at(section),
          message: bothRect
            ? 'Two pictures on this block overlap and will print on top of each other.'
            : 'Two pictures on this block have overlapping frames - check whether the cutout actually collides.',
        });
      }
    }

    // --- pictures ----------------------------------------------------------
    for (const image of section.images || []) {
      const resolution = await effectiveDpi(image);
      if (!resolution) continue;
      if (resolution.missing) {
        findings.push({
          level: 'error', check: 'missing-picture', ...at(section),
          message: `The picture file ${image.url} could not be read. It will print as a blank frame.`,
        });
        continue;
      }
      const worst = Math.min(resolution.dpiX, resolution.dpiY);
      if (worst < MIN_EFFECTIVE_DPI) {
        findings.push({
          level: 'error', check: 'low-resolution', ...at(section),
          message:
            `This photograph is ${resolution.sourceWidth}×${resolution.sourceHeight} used at ` +
            `${resolution.widthMm}mm — ${worst} dpi on the page. It needs ${IDEAL_EFFECTIVE_DPI}; ` +
            `under ${MIN_EFFECTIVE_DPI} it prints as squares.`,
        });
      } else if (worst < IDEAL_EFFECTIVE_DPI) {
        findings.push({
          level: 'warning', check: 'soft-resolution', ...at(section),
          message: `${worst} dpi on the page. Acceptable, but ${IDEAL_EFFECTIVE_DPI} is the target.`,
        });
      }

      if (!image.caption) {
        findings.push({
          level: 'note', check: 'no-caption', ...at(section),
          message: 'This photograph has no caption.',
        });
      }
    }

    // --- colour on a page that prints black only ---------------------------
    if (page.prints_colour === false && (section.images || []).length) {
      findings.push({
        level: 'warning', check: 'colour-on-mono-page', ...at(section),
        message: 'This page prints black only — the photograph will come out grey.',
      });
    }
  }

  // --- blocks printing on top of one another -------------------------------
  for (let i = 0; i < sections.length; i += 1) {
    for (let j = i + 1; j < sections.length; j += 1) {
      if (overlaps(sections[i], sections[j])) {
        findings.push({
          level: 'error', check: 'overlapping-blocks',
          pageNumber: page.page_number,
          sectionKey: `${sections[i].section_key} / ${sections[j].section_key}`,
          message: 'These two blocks overlap and will print on top of each other.',
        });
      }
    }
  }

  // --- a story that says it continues, but does not ------------------------
  for (const section of sections) {
    if (/उर्वरित पान/.test(section.body || '')) {
      const { rows } = await pool.query(
        'SELECT id FROM page_sections WHERE continued_from_section_id = $1',
        [section.id],
      );
      if (!rows.length) {
        findings.push({
          level: 'error', check: 'broken-jump', ...at(section),
          message: 'This story promises a continuation that does not exist. The reader will turn the page to nothing.',
        });
      }
    }
  }

  return findings;
}

/**
 * Preflights a whole edition.
 *
 * `passed` is the only thing the sign-off cares about: no errors. Warnings are
 * for a person to weigh, which is why they do not block.
 */
async function checkEdition(newspaperId) {
  const { rows: papers } = await pool.query('SELECT * FROM newspapers WHERE id = $1', [newspaperId]);
  const paper = papers[0];
  if (!paper) return null;

  const districtEditions = require('./districtEdition.service');
  const pages = await districtEditions.pagesOf(newspaperId);

  const findings = [];
  for (const page of pages) {
    findings.push(...(await checkPage(page, paper, pages.length)));
  }

  const counts = findings.reduce(
    (totals, finding) => ({ ...totals, [finding.level]: (totals[finding.level] || 0) + 1 }),
    { error: 0, warning: 0, note: 0 },
  );

  return {
    editionId: paper.id,
    date: String(paper.publication_date).slice(0, 10),
    pages: pages.length,
    counts,
    passed: counts.error === 0,
    findings,
  };
}

// The named geometry-error vocabulary Project A's composition engine speaks
// in - the same checks `checkPage()` already runs (this file has done most of
// this work since preflight existed; a second, parallel "collision engine"
// would be exactly the duplicate system CLAUDE.md warns against), reshaped
// into named types a caller can branch on without parsing an English sentence.
const COLLISION_TYPES = {
  'outside-matter': 'OUTSIDE_PAGE',
  'header-collision': 'OVERLAPPING_HEADER',
  'footer-collision': 'OVERLAPPING_FOOTER',
  'negative-dimensions': 'NEGATIVE_SPACE',
  'overlapping-blocks': 'STORY_COLLISION',
  'image-collision': 'IMAGE_COLLISION',
  'image-text-collision': 'IMAGE_TEXT_COLLISION',
  'caption-text-collision': 'CAPTION_TEXT_COLLISION',
  'caption-outside-section': 'CAPTION_OUTSIDE_SECTION',
  'frame-purpose-unknown': 'FRAME_PURPOSE_UNKNOWN',
  'frame-purpose-ambiguous': 'FRAME_PURPOSE_AMBIGUOUS',
  'image-companion-orphan': 'IMAGE_COMPANION_ORPHAN',
  'required-frame-policy-missing': 'REQUIRED_FRAME_POLICY_MISSING',
};
const OVERFLOW_TYPES = { overset: 'TEXT_OVERFLOW', 'smart-card-overset': 'SMART_CARD_OVERSET' };

/**
 * The general collision layer for one page, in the shape a layout engine (or
 * an AI composer's own repair loop) wants: named error types, not prose.
 *
 * This is not a second implementation - it runs `checkPage()`, the exact
 * function preflight has used since it existed, and reshapes the same
 * findings. A geometry bug fixed here is fixed for the desk's preflight
 * report and for this at the same time, because there is only the one check.
 */
async function validatePageLayout(page, newspaper) {
  const findings = await checkPage(page, newspaper, 1);

  const collisions = [];
  const overflow = [];
  const warnings = [];

  for (const finding of findings) {
    if (COLLISION_TYPES[finding.check]) {
      collisions.push({ type: COLLISION_TYPES[finding.check], ...finding });
    } else if (OVERFLOW_TYPES[finding.check]) {
      overflow.push({ type: OVERFLOW_TYPES[finding.check], ...finding });
    } else {
      warnings.push(finding);
    }
  }

  return {
    valid: collisions.every((c) => c.level !== 'error') && overflow.every((c) => c.level !== 'error'),
    collisions,
    overflow,
    warnings,
  };
}

module.exports = {
  checkEdition, checkPage, validatePageLayout, effectiveDpi,
  evidenceSourceFindings,
  MIN_EFFECTIVE_DPI, IDEAL_EFFECTIVE_DPI, MIN_BODY_PT,
};
