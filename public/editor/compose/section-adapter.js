// One translation from a block into a composition, used by everything.
//
// A persisted `page_sections` row is snake_case and arrives with its numerics
// as strings (they are NUMERIC(5,1) columns); the editor's live view of the
// same block is camelCase and already coerced. Every consumer used to do this
// conversion itself, with its own defaults - which is how the canvas and the
// fit action ended up disagreeing about a block nobody had touched.
//
// This is the only place that decision is made, so there is exactly one
// answer to "what composition does this block have", whether it is asked by
// the page canvas, the Block Editor, the worklist, preflight or the AI brief.

import { composeBlock } from './compose.js';
import { plainText } from '../layout/rich-text.js';
// The dateline opens the body and therefore occupies the body's room, so it
// is composed as part of the flow. One definition, in the module that has
// always owned it - a second copy here is exactly the drift this codebase
// has been bitten by before.
import { datelineText } from '../layout/text-flow.js';
// A side-effect module shared with Scribus, so it installs onto globalThis
// rather than exporting - the canvas and the print path must use one caption
// geometry, and that predates this engine.
import '../layout/caption-geometry.js';

const { captionBox } = globalThis.SahasCaptionGeometry;

function pick(section, view, camel, snake, fallback) {
  for (const source of [view, section]) {
    if (!source) continue;
    if (source[camel] !== undefined && source[camel] !== null && source[camel] !== '') return source[camel];
    if (source[snake] !== undefined && source[snake] !== null && source[snake] !== '') return source[snake];
  }
  return fallback;
}

function positive(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * How many columns the copy is set in.
 *
 * A newspaper column is about 40mm; at 2px/mm that is 80px. A block three or
 * four grid columns wide carries one text column, a seven-column lead carries
 * three - a 620px line of 11px type is unreadable and no paper prints one.
 */
export function measureColumns(view, widthPx) {
  const explicit = Number(view?.columnCount ?? view?.column_count);
  if (Number.isFinite(explicit) && explicit > 1) return explicit;
  const usable = Math.max(0, widthPx - 2 * positive(view?.marginPx ?? view?.margin_px, 12));
  return Math.max(1, Math.min(4, Math.floor(usable / 150)));
}

/** A `section_images` row (or an already-converted one) as an obstacle. */
export function obstacleFromImage(row) {
  return {
    x: Number(row.x_px ?? row.x) || 0,
    y: Number(row.y_px ?? row.y) || 0,
    width: Number(row.width_px ?? row.width) || 0,
    height: Number(row.height_px ?? row.height) || 0,
    shape: row.shape || 'rect',
    rotation: Number(row.rotation) || 0,
    standOffPx: Number(row.stand_off_px ?? row.standOffPx) || 0,
    mask: row.mask || null,
  };
}

/**
 * Every obstacle a block's photographs put in the way of its copy.
 *
 * A caption is one of them. It is set in the picture's own measure under the
 * picture, so it occupies room the story cannot have - counting the
 * photograph but not its caption is how copy ends up printed underneath a
 * caption.
 */
export function obstaclesOf(section) {
  const out = [];
  for (const row of section?.images || []) {
    out.push(obstacleFromImage(row));
    const caption = captionBox(row);
    if (caption) {
      out.push({
        x: caption.x, y: caption.y, width: caption.width, height: caption.height,
        shape: 'rect', rotation: 0, standOffPx: caption.standOffPx || 0, mask: null,
      });
    }
  }
  return out;
}

/**
 * The composition of one block.
 *
 * `section` is the persisted row (for its geometry and its images); `view` is
 * what the desk currently has on screen, which may be an unsaved draft. The
 * draft wins, so the canvas shows what is being typed.
 */
export function composeSection(section = {}, view = {}) {
  const width = positive(section.width_px ?? section.width, 0);
  const height = positive(section.height_px ?? section.height, 0);
  const padding = positive(pick(section, view, 'marginPx', 'margin_px', 12), 12);
  const bodyFontPx = positive(pick(section, view, 'bodyFontPx', 'body_font_px', 16), 16);
  const prefix = datelineText(view);

  return composeBlock({
    width,
    height,
    padding,
    kicker: plainText(pick(section, view, 'kicker', 'kicker', '')),
    headline: plainText(pick(section, view, 'headline', 'headline', '')),
    subheading: plainText(pick(section, view, 'subheading', 'subheading', '')),
    // The dateline is part of the flow it opens.
    body: prefix + plainText(pick(section, view, 'body', 'body', '')),
    headlineFontPx: positive(pick(section, view, 'headlineFontPx', 'headline_font_px', 34), 34),
    subheadingFontPx: positive(pick(section, view, 'subheadingFontPx', 'subheading_font_px', 20), 20),
    bodyFontPx,
    lineHeight: Number(pick(section, view, 'lineHeight', 'line_height', 0)) || 0,
    fontFamily: pick(section, view, 'fontFamily', 'font_family', 'serif'),
    columnCount: measureColumns(view, width),
    headlineLocked: Boolean(pick(section, view, 'headlineLocked', 'headline_locked', false)),
    subheadingLocked: Boolean(pick(section, view, 'subheadingLocked', 'subheading_locked', false)),
    images: obstaclesOf(section),
  });
}
