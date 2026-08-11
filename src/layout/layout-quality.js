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
  // Semantic hierarchy only reports clear assignment failures. These values
  // are grouped here (rather than buried in conditionals) so later editor
  // calibration can revise them from reviewed pages.
  dominanceRatio: 0.6,
  lowerPriorityDominanceRatio: 1.75,
  oversizedBriefRatio: 0.75,
  minPhotoImageFrameRatio: 0.2,
  hierarchyScoreCap: 50,
  hierarchyScoreImpact: 0.2,
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

// Semantic values arrive already canonical from the persisted story-type
// foundation. This is deliberately not another story-type catalog: the
// analyzer only reads the stored identity and treats unknown legacy values as
// ordinary editorial content rather than assigning a special treatment.
function sectionStoryType(section) {
  return String(section?.story_type ?? section?.storyType ?? 'STANDARD').trim().toUpperCase() || 'STANDARD';
}

function sectionPriority(section) {
  const value = Number(section?.editorial_priority ?? section?.editorialPriority);
  return Number.isFinite(value) ? Math.min(5, Math.max(1, Math.round(value))) : 3;
}

function hasStructuredCard(section) {
  const key = section?.smart_card_key ?? section?.smartCardKey;
  const data = section?.smart_card_data ?? section?.smartCardData;
  return Boolean(key && data && typeof data === 'object');
}

function imageRect(sectionFrame, image) {
  const x = Number(image?.x_px ?? image?.x);
  const y = Number(image?.y_px ?? image?.y);
  const width = Number(image?.width_px ?? image?.width);
  const height = Number(image?.height_px ?? image?.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  // section_images stores coordinates inside its owning section, as does the
  // shared text-flow map. Convert once to page coordinates before clipping.
  return clipRect(rect(sectionFrame.left + x, sectionFrame.top + y, sectionFrame.left + x + width, sectionFrame.top + y + height), sectionFrame);
}

function sectionDiagnostic(item, contentRect) {
  const { section, rect: frame } = item;
  const images = Array.isArray(section.images) ? section.images : [];
  const placedImages = images.map((image) => imageRect(frame, image)).filter(Boolean);
  const imageArea = unionArea(placedImages);
  const hasLegacyImage = Boolean(String(section.image_url ?? section.imageUrl ?? '').trim());
  const storyType = sectionStoryType(section);
  const isEditorial = storyType !== 'ADVERTISEMENT' && storyType !== 'SMART_CARD';
  return {
    sectionKey: section.section_key,
    storyType,
    editorialPriority: sectionPriority(section),
    editorialFrame: isEditorial,
    frameArea: round(areaOf(frame)),
    frameAreaRatio: round(ratio(areaOf(frame), areaOf(contentRect))),
    widthRatio: round(ratio(frame.width, contentRect.width)),
    heightRatio: round(ratio(frame.height, contentRect.height)),
    frameSizeRank: null,
    contentSignals: {
      hasHeadline: Boolean(String(section.headline ?? '').trim()),
      hasBody: Boolean(String(section.body ?? '').trim()),
      hasPlacedImage: placedImages.length > 0,
      hasLegacyImage,
      hasImage: placedImages.length > 0 || hasLegacyImage,
      imageCount: images.length,
      imageArea: round(imageArea),
      imageFrameRatio: round(ratio(imageArea, areaOf(frame))),
      hasStructuredSmartCard: hasStructuredCard(section),
    },
    findings: [],
  };
}

function addSectionFinding(diagnostic, code, severityLevel, message, evidence, pageFindings) {
  const item = finding(code, severityLevel, message, evidence);
  diagnostic.findings.push(item);
  pageFindings.push({ ...item, sectionKey: diagnostic.sectionKey });
}

function hierarchyDiagnostics(diagnostics, pageFindings) {
  const editorial = diagnostics
    .filter((item) => item.editorialFrame)
    .sort((a, b) => b.frameArea - a.frameArea || String(a.sectionKey).localeCompare(String(b.sectionKey)));
  editorial.forEach((item, index) => { item.frameSizeRank = index + 1; });
  const largestArea = editorial[0]?.frameArea || 0;
  const lowerThirdStart = Math.ceil(editorial.length * (2 / 3));
  const topThirdEnd = Math.max(1, Math.ceil(editorial.length / 3));

  for (const item of diagnostics) {
    const evidence = {
      storyType: item.storyType, priority: item.editorialPriority,
      frameArea: item.frameArea, frameAreaRatio: item.frameAreaRatio,
      frameSizeRank: item.frameSizeRank,
    };
    if (item.editorialFrame && editorial.length >= 3) {
      const weakHighPriority = item.editorialPriority >= 4
        && item.frameSizeRank > lowerThirdStart
        && item.frameArea <= largestArea * QUALITY_V1.dominanceRatio;
      const oversizedLowPriority = item.editorialPriority <= 1
        && item.frameSizeRank <= topThirdEnd
        && item.frameArea >= largestArea * QUALITY_V1.oversizedBriefRatio;
      const dominatedByLowerPriority = item.editorialPriority >= 4 && editorial.some((other) =>
        other.editorialPriority <= item.editorialPriority - 2
        && other.frameArea >= item.frameArea * QUALITY_V1.lowerPriorityDominanceRatio,
      );
      if (weakHighPriority || oversizedLowPriority || dominatedByLowerPriority) {
        addSectionFinding(item, 'PRIORITY_FRAME_MISMATCH', 'high',
          'This story’s editorial priority and assigned frame prominence are clearly misaligned.', {
            ...evidence, largestEditorialFrameArea: largestArea,
            weakHighPriority, oversizedLowPriority, dominatedByLowerPriority,
          }, pageFindings);
      }
    }

    if (item.storyType === 'BRIEF' && editorial.length >= 3
      && item.frameSizeRank <= topThirdEnd && item.frameArea >= largestArea * QUALITY_V1.oversizedBriefRatio) {
      addSectionFinding(item, 'BRIEF_OVERSIZED_FRAME', 'medium',
        'A compact brief occupies one of the page’s dominant editorial frames.', {
          ...evidence, largestEditorialFrameArea: largestArea,
        }, pageFindings);
    }
    if (item.storyType === 'PHOTO_FEATURE') {
      if (!item.contentSignals.hasImage) {
        addSectionFinding(item, 'PHOTO_FEATURE_WITHOUT_IMAGE', 'high',
          'A photo feature has no placed or legacy image.', evidence, pageFindings);
      } else if (item.contentSignals.hasPlacedImage
        && item.contentSignals.imageFrameRatio < QUALITY_V1.minPhotoImageFrameRatio) {
        addSectionFinding(item, 'PHOTO_FEATURE_IMAGE_TOO_SMALL', 'medium',
          'Placed image area is too small for an image-led photo feature.', {
            ...evidence, imageArea: item.contentSignals.imageArea,
            imageFrameRatio: item.contentSignals.imageFrameRatio,
            minimumImageFrameRatio: QUALITY_V1.minPhotoImageFrameRatio,
          }, pageFindings);
      }
    }
    if (item.storyType === 'SMART_CARD' && !item.contentSignals.hasStructuredSmartCard) {
      addSectionFinding(item, 'SMART_CARD_MISSING_DATA', 'high',
        'A Smart Card section lacks the structured key-and-data payload its renderer requires.', evidence, pageFindings);
    }
  }

  const leads = editorial.filter((item) => item.storyType === 'LEAD');
  if (leads.length > 1) {
    pageFindings.push(finding('MULTIPLE_COMPETING_LEADS', 'medium',
      'More than one editorial section is assigned the LEAD story type.', {
        leadSectionKeys: leads.map((item) => item.sectionKey), leadCount: leads.length,
      }));
  }
  if (leads.length === 1 && largestArea > 0 && leads[0].frameArea < largestArea * QUALITY_V1.dominanceRatio) {
    const lead = leads[0];
    const item = finding('LEAD_NOT_DOMINANT', 'high',
      'The LEAD is substantially smaller than another editorial frame.', {
        sectionKey: lead.sectionKey, leadFrameArea: lead.frameArea,
        leadFrameSizeRank: lead.frameSizeRank, largestEditorialFrameArea: largestArea,
        dominanceRatio: round(ratio(lead.frameArea, largestArea)),
      });
    lead.findings.push(item);
    pageFindings.push(item);
  }

  const hierarchyFindingCount = pageFindings.filter((item) => [
    'PRIORITY_FRAME_MISMATCH', 'LEAD_NOT_DOMINANT', 'MULTIPLE_COMPETING_LEADS',
    'BRIEF_OVERSIZED_FRAME', 'PHOTO_FEATURE_WITHOUT_IMAGE', 'PHOTO_FEATURE_IMAGE_TOO_SMALL',
    'SMART_CARD_MISSING_DATA',
  ].includes(item.code)).length;
  const hierarchyPenalty = Math.min(QUALITY_V1.hierarchyScoreCap, hierarchyFindingCount * 12);
  return { hierarchy: round(100 - hierarchyPenalty), hierarchyFindingCount };
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
  const contentFrames = frames.filter((item) => hasPrintableContent(item.section));
  const occupied = contentFrames.map((item) => item.rect);
  const emptyFrames = frames.filter((item) => !hasPrintableContent(item.section));
  const sections = contentFrames.map((item) => sectionDiagnostic(item, contentRect));
  const semanticFindings = [];
  const hierarchy = hierarchyDiagnostics(sections, semanticFindings);

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
    hierarchy: hierarchy.hierarchy,
  };
  // Preserve B2’s geometry score when no semantic issue exists. Hierarchy is
  // an intentionally bounded overlay (at most ten points) until real editor
  // review supplies evidence for a calibrated combined score.
  const geometryScore = (subscores.density + subscores.whitespace + subscores.balance) / 3;
  const score = round(Math.max(0, geometryScore - ((100 - subscores.hierarchy) * QUALITY_V1.hierarchyScoreImpact)));

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
  findings.push(...semanticFindings);

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
      hierarchyFindingCount: hierarchy.hierarchyFindingCount,
    },
    sections,
    findings,
  };
}

module.exports = { analyzeLayout, QUALITY_V1, hasPrintableContent, unionArea };
