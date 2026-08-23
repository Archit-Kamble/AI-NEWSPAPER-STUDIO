const pageRepository = require('../repositories/page.repository');
const newspaperRepository = require('../repositories/newspaper.repository');
const { normalizeStoryMetadata } = require('./storyType.service');
const { geometryOf, snapPointsX } = require('../layout/geometry');
const { quote } = require('../layout/rateCard');
const reviewInvalidation = require('./reviewInvalidation.service');

const PRINTABLE_FIELDS = ['news_item_id','kicker','headline','subheading','body','caption','image_url','smart_card_key','smart_card_data'];
const comparable = (value) => JSON.stringify(value ?? null);

const G = geometryOf({});
const MIN_HEIGHT_PX = G.baselinePx * 4;

let palettePromise;
function presentationPalette() {
  if (!palettePromise) palettePromise = import('../../public/editor/layout/inks.js');
  return palettePromise;
}

const supplied = (value) => value !== undefined && value !== null && String(value).trim() !== '';

const nearest = (value, points) =>
  points.reduce((best, p) => (Math.abs(p - value) < Math.abs(best - value) ? p : best), points[0]);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Every block the editor draws or drags covers a whole number of columns and
// sits on the baseline, inside the CONTENT region - never the raw matter box.
// Snapping on the server as well as in the browser means a page is always
// printable whatever sent the request.
//
// This used to clamp against the matter box alone (marginYPx to
// marginYPx+matterHeightPx), which is the whole printable area including the
// header and footer furniture's own bands - so a block dragged to the very
// top or foot of the page could legally land on top of the nameplate/folio or
// the page-foot/imprint strip, exactly the collision geometry.js's region
// model exists to rule out (Project A, Bug #7/#8/#9). Clamping to
// G.regions[kind].content instead makes that collision impossible to create
// in the first place, not just something validatePageLayout() reports after
// the fact.
function snapGeometry(input, pageNumber) {
  const kind = Number(pageNumber) === 1 ? 'front' : (Number(pageNumber) === 2 ? 'insideImprint' : 'inside');
  const { top, bottom } = G.regions[kind].content;

  // Left edge onto a column start, right edge onto a column end - never the
  // other way round, or a block would begin inside a gutter.
  const x = nearest(Math.round(Number(input.x) || 0), G.snapLeftPx);
  const wanted = x + Math.round(Number(input.width) || G.columnPx);
  const rightCandidates = G.snapRightPx.filter((p) => p > x);
  const x2 = nearest(wanted, rightCandidates.length ? rightCandidates : [G.snapRightPx[G.snapRightPx.length - 1]]);

  const snapY = (v) => Math.round(v / G.baselinePx) * G.baselinePx;
  const y = clamp(snapY(Number(input.y) || 0), top, bottom - MIN_HEIGHT_PX);
  const height = clamp(snapY(Number(input.height) || MIN_HEIGHT_PX), MIN_HEIGHT_PX, bottom - y);

  return { x, y, width: x2 - x, height };
}

async function createSection(pageId, body) {
  const id = parseInt(pageId, 10);
  const page = await pageRepository.findById(id);
  if (!page) return null;
  await pageRepository.createSection(id, snapGeometry(body, page.page_number));
  await reviewInvalidation.invalidatePage(id);
  return pageRepository.findById(id);
}

// Removing the sold corner of page one is allowed, and the REFUSAL that used
// to sit here is retired.
//
// It was put in for a real fault: the corner block was deleted and the
// nameplate stretched the paper's own title across the space where it had
// been. But that fault was in the nameplate, not in the deletion - it took
// its own left edge from whether the block happened to exist rather than from
// the page's region model - and it was fixed there. Refusing the deletion as
// well left a page that could never say "this edition does not sell the
// corner", which is an ordinary thing for a paper to say and the thing the
// desk asked for: no corner, and the nameplate set across the whole measure
// (masthead.js).
//
// The classification itself stays in templates.js (isStructuralTemplateFrame)
// and still earns its keep: `POST /api/pages/:id/repair-structural-frames`
// puts the corner back for a desk who removed it and wants it again, and that
// repair reads the same one function.
async function deleteSection(pageId, sectionKey) {
  const id = parseInt(pageId, 10);
  const removed = await pageRepository.deleteSection(id, sectionKey);
  if (!removed) return null;
  await reviewInvalidation.invalidatePage(id);
  return pageRepository.findById(id);
}

async function moveSection(pageId, sectionKey, body) {
  const id = parseInt(pageId, 10);
  const page = await pageRepository.findById(id);
  if (!page) return null;
  const saved = await pageRepository.saveSectionGeometry(id, sectionKey, snapGeometry(body, page.page_number));
  if (!saved) return null;
  await reviewInvalidation.invalidatePage(id);
  return pageRepository.findById(id);
}

async function saveSection(pageId, sectionKey, body) {
  const id = parseInt(pageId, 10);
  const beforePage = await pageRepository.findById(id);
  const before = beforePage?.sections?.find((section) => section.section_key === sectionKey);
  const semantic = await normalizeStoryMetadata(body);
  if (semantic.error) return semantic;
  const palette = await presentationPalette();
  const backgroundColor = supplied(body.backgroundColor)
    ? palette.sanitiseTint(body.backgroundColor)
    : null;
  const accentColor = supplied(body.accentColor)
    ? palette.sanitiseInk(body.accentColor)
    : null;
  if (supplied(body.backgroundColor) && backgroundColor === null) {
    return { error: 'The block ground must be one of the newspaper palette tints.' };
  }
  if (supplied(body.accentColor) && accentColor === null) {
    return { error: 'The headline accent must be one of the newspaper palette inks.' };
  }
  if (supplied(body.borderStyle) && !['none', 'box'].includes(body.borderStyle)) {
    return { error: 'The border style must be none or box.' };
  }
  if (supplied(body.headlineStyle) && !['plain', 'accent', 'reverse'].includes(body.headlineStyle)) {
    return { error: 'The headline treatment must be plain, accent or reverse.' };
  }
  if (supplied(body.marginPx)
      && (!Number.isFinite(Number(body.marginPx)) || Number(body.marginPx) < 1 || Number(body.marginPx) > 60)) {
    return { error: 'The block margin must be between 1 and 60 pixels.' };
  }
  const article = {
    newsItemId: body.newsItemId || body.sourceNewsId,
    storyType: semantic.storyType,
    editorialPriority: semantic.editorialPriority,
    headline: body.headline || body.title,
    headlineFontPx: body.headlineFontPx,
    kicker: body.kicker,
    subheading: body.subheading || body.subtitle,
    subheadingFontPx: body.subheadingFontPx,
    body: body.body || body.description,
    bodyFontPx: body.bodyFontPx,
    category: body.category,
    location: body.location,
    tags: body.tags,
    reporterName: body.reporterName,
    aiNotes: body.aiNotes,
    caption: body.caption,
    language: body.language,
    status: body.status,
    aiGenerated: body.aiGenerated,
    imageUrl: body.imageUrl,
    imageRotation: body.imageRotation,
    imageZoom: body.imageZoom,
    imageFit: body.imageFit,
    imageFlipH: body.imageFlipH,
    imageFlipV: body.imageFlipV,
    fontFamily: body.fontFamily,
    fontWeight: body.fontWeight,
    fontItalic: body.fontItalic,
    fontUnderline: body.fontUnderline,
    textAlign: body.textAlign,
    headlineAlign: body.headlineAlign,
    subheadingAlign: body.subheadingAlign,
    columnCount: body.columnCount,
    marginPx: body.marginPx,
    lineHeight: body.lineHeight,
    letterSpacingPx: body.letterSpacingPx,
    paragraphSpacingPx: body.paragraphSpacingPx,
    listStyle: body.listStyle,
    dropCapLines: body.dropCapLines,
    borderStyle: body.borderStyle,
    borderWidthPx: body.borderWidthPx,
    borderColor: body.borderColor,
    backgroundColor,
    headlineStyle: body.headlineStyle,
    accentColor,
    // What structured card is placed in this block, and its payload. Never
    // `feature_key`, which is the layout's word for what the block is FOR and
    // is not the desk's to change.
    smartCardKey: body.smartCardKey || null,
    smartCardData: body.smartCardData || null,
  };

  const proposed = {
    news_item_id: article.newsItemId || null, kicker: article.kicker || null,
    headline: article.headline || null, subheading: article.subheading || null,
    body: article.body || null, caption: article.caption || null,
    image_url: article.imageUrl || null, smart_card_key: article.smartCardKey || null,
    smart_card_data: article.smartCardData || null,
  };
  const changed = before && PRINTABLE_FIELDS.some((field) => comparable(before[field]) !== comparable(proposed[field]));
  if (changed && ['ready', 'published'].includes(before.status)) article.status = before.ai_generated || article.aiGenerated ? 'needs_review' : 'editing';

  await pageRepository.saveSection(id, sectionKey, article);
  if (changed) await reviewInvalidation.invalidatePage(id);
  return pageRepository.findById(id);
}

// What a block of space is worth, by column-centimetre and position. Position
// is most of the price, so this needs the section, its page number and colour
// forme, and how many pages the edition has.
async function rateFor(pageId, sectionKey) {
  const section = await pageRepository.findSectionForRate(parseInt(pageId, 10), sectionKey);
  if (!section) return null;

  const pages = await pageRepository.findByNewspaper(section.newspaper_id);
  const newspaper = await newspaperRepository.findById(section.newspaper_id);

  return quote(section, section, { totalPages: pages.length, newspaper });
}

module.exports = { saveSection, createSection, deleteSection, moveSection, snapGeometry, rateFor };
