// Async enrichment of the cheap geometry analyzer with the editor's canonical
// text-flow grid. `analyzeLayout()` remains synchronous and useful on every
// canvas interaction; this module is the composition-quality diagnostic seam.

const { analyzeLayout } = require('./layout-quality');

const UTILIZATION_V1 = Object.freeze({
  severelyUnderfilledBodyRatio: 0.22,
  underfilledDominantFrameRatio: 0.35,
  dominantFrameAreaRatio: 0.18,
  lowEffectivePageRatio: 0.55,
  // Geometry remains valuable, but a full physical frame with very little
  // actual composition can no longer score like a full newspaper page.
  geometryWeight: 0.45,
  utilizationWeight: 0.55,
});

const BODY_TYPES = new Set(['STANDARD', 'SECONDARY', 'LEAD', 'ANALYSIS', 'OPINION']);
const IMAGE_TYPES = new Set(['PHOTO_FEATURE']);
const EXCLUDED_TYPES = new Set(['SMART_CARD', 'ADVERTISEMENT', 'QUOTE', 'DATA', 'SIDEBAR']);
const round = (value, digits = 4) => Number(Number(value || 0).toFixed(digits));
const typeOf = (section) => {
  // Legacy fixture rows can predate semantic persistence. Physical advert and
  // named standing-feature metadata are nevertheless trustworthy evidence
  // that the generic body-flow diagnostic is inapplicable.
  if (String(section?.block_type ?? section?.blockType ?? '').toLowerCase() === 'advert') return 'ADVERTISEMENT';
  if (section?.feature_key ?? section?.featureKey) return 'SMART_CARD';
  return String(section?.story_type ?? section?.storyType ?? 'STANDARD').trim().toUpperCase() || 'STANDARD';
};
const priorityOf = (section) => {
  const value = Number(section?.editorial_priority ?? section?.editorialPriority);
  return Number.isFinite(value) ? Math.min(5, Math.max(1, Math.round(value))) : 3;
};

async function textFlow() { return import('../../public/editor/layout/text-flow.js'); }

function flowView(section) {
  return {
    headline: section?.headline || '', subheading: section?.subheading || '', body: section?.body || '',
    marginPx: Number(section?.margin_px) || 12, columnCount: Number(section?.column_count) || 1,
    lineHeight: Number(section?.line_height) || 1.45,
    headlineFontPx: Number(section?.headline_font_px) || 24,
    subheadingFontPx: Number(section?.subheading_font_px) || 14,
    bodyFontPx: Number(section?.body_font_px) || 10,
  };
}

function cells(map, kind) { return map.grid.reduce((total, row) => total + row.filter((cell) => cell === kind).length, 0); }

function finding(code, severity, message, evidence, sectionKey = undefined) {
  return sectionKey === undefined ? { code, severity, message, evidence } : { code, severity, message, evidence, sectionKey };
}

async function analyzeComposedLayout(page, newspaper = {}) {
  const geometry = analyzeLayout(page, newspaper);
  const { buildFlowMap, flowImageFromRow, CELL } = await textFlow();
  const geometryByKey = new Map((geometry.sections || []).map((section) => [String(section.sectionKey), section]));
  const sections = [];
  let effectiveUsedArea = 0;
  let effectiveAvailableArea = 0;
  for (const section of page?.sections || []) {
    const key = String(section.section_key ?? section.id ?? '');
    const frame = geometryByKey.get(key);
    if (!frame) continue;
    const storyType = typeOf(section);
    const eligible = BODY_TYPES.has(storyType) || IMAGE_TYPES.has(storyType) || storyType === 'BRIEF';
    if (!eligible || EXCLUDED_TYPES.has(storyType)) {
      sections.push({ sectionKey: section.section_key, storyType, editorialPriority: priorityOf(section), measured: false, reason: 'STRUCTURED_OR_SPECIAL_RENDERER' });
      continue;
    }
    const map = buildFlowMap(section, flowView(section), (section.images || []).map(flowImageFromRow));
    const headlineCells = cells(map, CELL.HEADLINE);
    const subheadingCells = cells(map, CELL.SUBHEADING);
    const imageCells = map.imageCells;
    const availableCells = map.cols * map.rows;
    const rawBodyFillRatio = map.bodyCharBudget ? map.usedChars / map.bodyCharBudget : (map.usedChars ? Infinity : 0);
    const normalizedBodyFillRatio = Math.min(1, rawBodyFillRatio);
    const usedCells = headlineCells + subheadingCells + imageCells + Math.min(map.usedChars, map.bodyCharBudget);
    const effectiveContentRatio = availableCells ? Math.min(1, usedCells / availableCells) : 0;
    const diagnostic = {
      sectionKey: section.section_key, storyType, editorialPriority: priorityOf(section), measured: true,
      frameAreaRatio: frame.frameAreaRatio, frameSizeRank: frame.frameSizeRank,
      bodyCharBudget: map.bodyCharBudget, bodyCharsUsed: map.usedChars,
      bodyFillRatio: round(rawBodyFillRatio), normalizedBodyFillRatio: round(normalizedBodyFillRatio),
      headlineRows: map.headlineRows, subheadingRows: map.subheadingRows,
      imageCells, imageRatio: round(availableCells ? imageCells / availableCells : 0),
      effectiveUsedCells: usedCells, effectiveAvailableCells: availableCells, effectiveContentRatio: round(effectiveContentRatio),
    };
    sections.push(diagnostic);
    // Compact briefs and photo features are represented, but only ordinary
    // prose types are held to body-fill findings below.
    effectiveUsedArea += effectiveContentRatio * frame.frameArea;
    effectiveAvailableArea += frame.frameArea;
  }
  const effectiveUtilizationRatio = effectiveAvailableArea ? effectiveUsedArea / effectiveAvailableArea : 0;
  const utilizationScore = Math.max(0, Math.min(100, 100 * effectiveUtilizationRatio));
  const findings = [...geometry.findings];
  for (const section of sections) {
    if (!section.measured || !BODY_TYPES.has(section.storyType)) continue;
    const evidence = {
      sectionKey: section.sectionKey, storyType: section.storyType, editorialPriority: section.editorialPriority,
      frameAreaRatio: section.frameAreaRatio, bodyCharBudget: section.bodyCharBudget, bodyCharsUsed: section.bodyCharsUsed,
      bodyFillRatio: section.bodyFillRatio, effectiveContentRatio: section.effectiveContentRatio,
    };
    if (section.bodyCharBudget > 0 && section.bodyFillRatio < UTILIZATION_V1.severelyUnderfilledBodyRatio) {
      findings.push(finding('SEVERELY_UNDERFILLED_SECTION', 'high', 'This story uses very little of its canonical body capacity.', evidence, section.sectionKey));
    }
    if (section.frameAreaRatio >= UTILIZATION_V1.dominantFrameAreaRatio
      && section.effectiveContentRatio < UTILIZATION_V1.underfilledDominantFrameRatio) {
      findings.push(finding('UNDERFILLED_DOMINANT_FRAME', 'high', 'A prominent editorial frame has poor effective content utilization.', evidence, section.sectionKey));
    }
    if (section.bodyFillRatio > 1) findings.push(finding('OVERFILLED_SECTION', 'medium', 'Raw body use exceeds the canonical capacity.', evidence, section.sectionKey));
  }
  if (effectiveAvailableArea > 0 && effectiveUtilizationRatio < UTILIZATION_V1.lowEffectivePageRatio) {
    findings.push(finding('LOW_EFFECTIVE_PAGE_UTILIZATION', 'high', 'Filled frames contain too little effective composition content.', {
      effectiveUsedArea: round(effectiveUsedArea), effectiveAvailableArea: round(effectiveAvailableArea), effectiveUtilizationRatio: round(effectiveUtilizationRatio),
    }));
  }
  const score = round((geometry.score * UTILIZATION_V1.geometryWeight) + (utilizationScore * UTILIZATION_V1.utilizationWeight));
  return {
    ...geometry,
    score,
    geometryScore: geometry.score,
    subscores: { ...geometry.subscores, utilization: round(utilizationScore) },
    metrics: { ...geometry.metrics, effectiveUsedArea: round(effectiveUsedArea), effectiveAvailableArea: round(effectiveAvailableArea), effectiveUtilizationRatio: round(effectiveUtilizationRatio) },
    sections,
    findings,
  };
}

module.exports = { analyzeComposedLayout, UTILIZATION_V1, flowView };
