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

// Below this, a photograph visibly breaks up on newsprint. 300 dpi is the
// target; 150 is the point at which a picture editor would reject it.
const MIN_EFFECTIVE_DPI = 150;
const IDEAL_EFFECTIVE_DPI = 300;
// Newsprint will not hold type smaller than this legibly.
const MIN_BODY_PT = 6.5;

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

async function checkPage(page, newspaper, totalPages) {
  const g = geometryOf(newspaper);
  const { buildFlowMap, flowImageFromRow } = await textFlow();
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
  const region = g.regions[Number(page.page_number) === 1 ? 'front' : 'inside'];

  const sections = page.sections || [];

  for (const section of sections) {
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
    if (section.body) {
      const map = buildFlowMap(section, {
        marginPx: Number(section.margin_px) || 12,
        lineHeight: Number(section.line_height) || 1.25,
        headline: section.headline || '',
        headlineFontPx: Number(section.headline_font_px),
        subheading: section.subheading || '',
        subheadingFontPx: Number(section.subheading_font_px),
        body: section.body,
        bodyFontPx: Number(section.body_font_px),
      }, (section.images || []).map(flowImageFromRow));

      if (section.body.length > map.bodyCharBudget) {
        findings.push({
          level: 'error', check: 'overset', ...at(section),
          message: `${section.body.length - map.bodyCharBudget} characters more than this block holds. Cut it, or carry it over.`,
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
};
const OVERFLOW_TYPES = { overset: 'TEXT_OVERFLOW' };

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
  MIN_EFFECTIVE_DPI, IDEAL_EFFECTIVE_DPI, MIN_BODY_PT,
};
