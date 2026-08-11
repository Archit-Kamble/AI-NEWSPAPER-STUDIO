// Deterministic page-composition diagnostics.
//
// This module deliberately answers a different question from preflight:
// preflight/validatePageLayout() decides whether a page is legal to print;
// analyzeLayout() measures whether its legal content region is being used well.
// It is pure, synchronous and rectangle-based so it can be run repeatedly
// during composition without a browser, database query or image decode.

const { geometryOf } = require('./geometry');

// V1 has only three equally weighted, explainable dimensions. Equal weighting
// is intentional: there is not yet an editor-approved page corpus from which
// to calibrate editorial weights. These thresholds are diagnostic prompts, not
// print-gating rules.
const QUALITY_V1 = Object.freeze({
  targetOccupancyRatio: 0.78,
  lowOccupancyRatio: 0.55,
  largeEmptyRegionRatio: 0.25,
  notableEmptyRegionRatio: 0.12,
  largeEmptyFrameRatio: 0.18,
  notableEmptyFrameRatio: 0.08,
  highImbalance: 0.4,
  notableImbalance: 0.25,
});

const EPSILON = 1e-9;
const round = (value, digits = 4) => Number(Number(value || 0).toFixed(digits));
const ratio = (part, whole) => (whole > 0 ? part / whole : 0);
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function rect(left, top, right, bottom) {
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function sectionRect(section) {
  const left = Number(section?.x_px);
  const top = Number(section?.y_px);
  const width = Number(section?.width_px);
  const height = Number(section?.height_px);
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return rect(left, top, left + width, top + height);
}

function clipRect(source, bounds) {
  if (!source) return null;
  const clipped = rect(
    Math.max(source.left, bounds.left),
    Math.max(source.top, bounds.top),
    Math.min(source.right, bounds.right),
    Math.min(source.bottom, bounds.bottom),
  );
  return clipped.width > EPSILON && clipped.height > EPSILON ? clipped : null;
}

function areaOf(source) {
  return source ? source.width * source.height : 0;
}

function mergeIntervals(intervals) {
  const merged = [];
  for (const interval of [...intervals].sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (interval.end <= interval.start + EPSILON) continue;
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end + EPSILON) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ start: interval.start, end: interval.end });
  }
  return merged;
}

/** Exact union area via coordinate bands, never a sum of overlapping frames. */
function unionArea(rectangles) {
  const valid = rectangles.filter(Boolean);
  const xs = [...new Set(valid.flatMap((item) => [item.left, item.right]))].sort((a, b) => a - b);
  let total = 0;
  for (let index = 0; index < xs.length - 1; index += 1) {
    const left = xs[index];
    const right = xs[index + 1];
    if (right <= left + EPSILON) continue;
    const spans = valid
      .filter((item) => item.left < right - EPSILON && item.right > left + EPSILON)
      .map((item) => ({ start: item.top, end: item.bottom }));
    for (const span of mergeIntervals(spans)) total += (right - left) * (span.end - span.start);
  }
  return total;
}

// This matches the lifecycle's material-content fields (headline/body/legacy
// image/placed image) and adds the two printable structured forms it does not
// inspect: Smart Card payload and ad copy. Metadata and a bare reporter link
// remain intentionally empty until printable content is actually present.
function hasPrintableContent(section) {
  const textFields = ['headline', 'subheading', 'body', 'caption', 'kicker'];
  if (textFields.some((field) => String(section?.[field] ?? '').trim())) return true;
  if (String(section?.image_url ?? section?.imageUrl ?? '').trim()) return true;
  if (Array.isArray(section?.images) && section.images.length > 0) return true;
  if (section?.smart_card_key || section?.smartCardKey || section?.smart_card_data || section?.smartCardData) return true;
  return false;
}

function largestEmptyRectangle(bounds, occupied) {
  const xs = [...new Set([bounds.left, bounds.right, ...occupied.flatMap((item) => [item.left, item.right])])]
    .sort((a, b) => a - b);
  let largest = null;

  // A maximum empty axis-aligned rectangle has left/right edges on a content
  // boundary. For each such horizontal span, merge every occupied vertical
  // interval that intersects it and test the remaining gaps. This is exact for
  // the rectangle model and cheap for a newspaper page's small block count.
  for (let start = 0; start < xs.length - 1; start += 1) {
    for (let end = start + 1; end < xs.length; end += 1) {
      const left = xs[start];
      const right = xs[end];
      const blocked = occupied
        .filter((item) => item.left < right - EPSILON && item.right > left + EPSILON)
        .map((item) => ({ start: item.top, end: item.bottom }));
      const intervals = mergeIntervals(blocked);
      let cursor = bounds.top;
      for (const interval of [...intervals, { start: bounds.bottom, end: bounds.bottom }]) {
        if (interval.start > cursor + EPSILON) {
          const candidate = rect(left, cursor, right, interval.start);
          if (!largest || areaOf(candidate) > areaOf(largest) + EPSILON) largest = candidate;
        }
        cursor = Math.max(cursor, interval.end);
      }
    }
  }

  return largest;
}

function severity(value, high, notable) {
  if (value >= high) return 'high';
  if (value >= notable) return 'medium';
  return 'low';
}

function finding(code, severityLevel, message, evidence) {
  return { code, severity: severityLevel, message, evidence };
}

function analyzeLayout(page, newspaper = {}) {
  const geometry = geometryOf(newspaper);
  const kind = Number(page?.page_number) === 1 ? 'front' : 'inside';
  const content = geometry.regions[kind].content;
  const contentRect = rect(geometry.marginXPx, content.top, geometry.marginXPx + geometry.matterWidthPx, content.bottom);
  const contentArea = areaOf(contentRect);

  const frames = (page?.sections || [])
    .map((section) => ({ section, rect: clipRect(sectionRect(section), contentRect) }))
    .filter((item) => item.rect);
  const occupied = frames.filter((item) => hasPrintableContent(item.section)).map((item) => item.rect);
  const emptyFrames = frames.filter((item) => !hasPrintableContent(item.section));

  const occupiedArea = unionArea(occupied);
  const emptyFrameArea = unionArea(emptyFrames.map((item) => item.rect));
  const largestEmpty = largestEmptyRectangle(contentRect, occupied);
  const largestEmptyArea = areaOf(largestEmpty);

  const middleX = (contentRect.left + contentRect.right) / 2;
  const middleY = (contentRect.top + contentRect.bottom) / 2;
  const leftWeight = unionArea(occupied.map((item) => clipRect(item, rect(contentRect.left, contentRect.top, middleX, contentRect.bottom))));
  const rightWeight = unionArea(occupied.map((item) => clipRect(item, rect(middleX, contentRect.top, contentRect.right, contentRect.bottom))));
  const topWeight = unionArea(occupied.map((item) => clipRect(item, rect(contentRect.left, contentRect.top, contentRect.right, middleY))));
  const bottomWeight = unionArea(occupied.map((item) => clipRect(item, rect(contentRect.left, middleY, contentRect.right, contentRect.bottom))));
  const horizontalImbalance = ratio(Math.abs(leftWeight - rightWeight), leftWeight + rightWeight);
  const verticalImbalance = ratio(Math.abs(topWeight - bottomWeight), topWeight + bottomWeight);

  const occupancyRatio = ratio(occupiedArea, contentArea);
  const emptyFrameRatio = ratio(emptyFrameArea, contentArea);
  const largestEmptyRect = largestEmpty && {
    x: round(largestEmpty.left), y: round(largestEmpty.top), width: round(largestEmpty.width), height: round(largestEmpty.height),
    area: round(largestEmptyArea), areaRatio: round(ratio(largestEmptyArea, contentArea)),
  };

  const subscores = {
    density: round(100 * clamp(occupancyRatio / QUALITY_V1.targetOccupancyRatio)),
    whitespace: round(100 * (1 - Math.max(emptyFrameRatio, largestEmptyRect?.areaRatio || 0))),
    balance: round(100 * (1 - ((horizontalImbalance + verticalImbalance) / 2))),
  };
  const score = round((subscores.density + subscores.whitespace + subscores.balance) / 3);

  const findings = [];
  if (occupancyRatio < QUALITY_V1.lowOccupancyRatio) {
    findings.push(finding('LOW_PAGE_OCCUPANCY', 'high', 'The content region has little occupied editorial area.', {
      occupancyRatio: round(occupancyRatio), targetOccupancyRatio: QUALITY_V1.targetOccupancyRatio,
      occupiedArea: round(occupiedArea), contentArea: round(contentArea),
    }));
  }
  if (largestEmptyRect && largestEmptyRect.areaRatio >= QUALITY_V1.notableEmptyRegionRatio) {
    findings.push(finding('LARGE_EMPTY_REGION', severity(
      largestEmptyRect.areaRatio, QUALITY_V1.largeEmptyRegionRatio, QUALITY_V1.notableEmptyRegionRatio,
    ), 'A large unoccupied rectangle remains in the printable content region.', largestEmptyRect));
  }
  if (emptyFrameRatio >= QUALITY_V1.notableEmptyFrameRatio) {
    findings.push(finding('LARGE_EMPTY_FRAME', severity(
      emptyFrameRatio, QUALITY_V1.largeEmptyFrameRatio, QUALITY_V1.notableEmptyFrameRatio,
    ), 'Existing page frames account for a notable amount of unused printable area.', {
      emptySectionCount: emptyFrames.length, emptyFrameArea: round(emptyFrameArea), emptyFrameRatio: round(emptyFrameRatio),
    }));
  }
  if (horizontalImbalance >= QUALITY_V1.notableImbalance) {
    findings.push(finding('HORIZONTAL_IMBALANCE', severity(
      horizontalImbalance, QUALITY_V1.highImbalance, QUALITY_V1.notableImbalance,
    ), 'Occupied visual area is uneven between the left and right halves.', {
      leftWeight: round(leftWeight), rightWeight: round(rightWeight), horizontalImbalance: round(horizontalImbalance),
    }));
  }
  if (verticalImbalance >= QUALITY_V1.notableImbalance) {
    findings.push(finding('VERTICAL_IMBALANCE', severity(
      verticalImbalance, QUALITY_V1.highImbalance, QUALITY_V1.notableImbalance,
    ), 'Occupied visual area is uneven between the top and bottom halves.', {
      topWeight: round(topWeight), bottomWeight: round(bottomWeight), verticalImbalance: round(verticalImbalance),
    }));
  }

  return {
    score,
    subscores,
    metrics: {
      contentArea: round(contentArea), occupiedArea: round(occupiedArea), occupancyRatio: round(occupancyRatio),
      emptyFrameArea: round(emptyFrameArea), emptyFrameRatio: round(emptyFrameRatio),
      largestEmptyRect,
      leftWeight: round(leftWeight), rightWeight: round(rightWeight), horizontalImbalance: round(horizontalImbalance),
      topWeight: round(topWeight), bottomWeight: round(bottomWeight), verticalImbalance: round(verticalImbalance),
      filledSectionCount: occupied.length, emptySectionCount: emptyFrames.length,
    },
    findings,
  };
}

module.exports = { analyzeLayout, QUALITY_V1, hasPrintableContent, unionArea };
