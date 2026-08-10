const pageRepository = require('../repositories/page.repository');
const { geometryOf, snapPointsX } = require('../layout/geometry');

const G = geometryOf({});
const MIN_HEIGHT_PX = G.baselinePx * 4;

const nearest = (value, points) =>
  points.reduce((best, p) => (Math.abs(p - value) < Math.abs(best - value) ? p : best), points[0]);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Every block the editor draws or drags covers a whole number of columns and
// sits on the baseline, inside the matter box. Snapping on the server as well
// as in the browser means a page is always printable whatever sent the request.
function snapGeometry(input) {
  const top = G.marginYPx;
  const bottom = G.marginYPx + G.matterHeightPx;

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
  await pageRepository.createSection(id, snapGeometry(body));
  return pageRepository.findById(id);
}

async function deleteSection(pageId, sectionKey) {
  const id = parseInt(pageId, 10);
  const removed = await pageRepository.deleteSection(id, sectionKey);
  if (!removed) return null;
  return pageRepository.findById(id);
}

async function moveSection(pageId, sectionKey, body) {
  const id = parseInt(pageId, 10);
  const saved = await pageRepository.saveSectionGeometry(id, sectionKey, snapGeometry(body));
  if (!saved) return null;
  return pageRepository.findById(id);
}

async function saveSection(pageId, sectionKey, body) {
  const article = {
    newsItemId: body.newsItemId || body.sourceNewsId,
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
    columnCount: body.columnCount,
    marginPx: body.marginPx,
    lineHeight: body.lineHeight,
    letterSpacingPx: body.letterSpacingPx,
    paragraphSpacingPx: body.paragraphSpacingPx,
    listStyle: body.listStyle,
    dropCap: body.dropCap,
    borderStyle: body.borderStyle,
    borderWidthPx: body.borderWidthPx,
    borderColor: body.borderColor,
    headlineStyle: body.headlineStyle,
    accentColor: body.accentColor,
    // What structured card is placed in this block, and its payload. Never
    // `feature_key`, which is the layout's word for what the block is FOR and
    // is not the desk's to change.
    smartCardKey: body.smartCardKey || null,
    smartCardData: body.smartCardData || null,
  };

  await pageRepository.saveSection(parseInt(pageId, 10), sectionKey, article);
  return pageRepository.findById(parseInt(pageId, 10));
}

module.exports = { saveSection, createSection, deleteSection, moveSection, snapGeometry };
