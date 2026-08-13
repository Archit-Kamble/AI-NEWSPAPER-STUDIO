// Async pair precomputation layered over B4 semantic compatibility and B6B
// canonical current-copy fit. Matching itself remains the B5A Hungarian solver.

const { scoreStoryForFrame } = require('./story-frame-compatibility');
const { measureStoryFrameFit } = require('./story-frame-fit');
const { planPageAssignments, planPageAssignmentsFromEvaluations } = require('./page-assignment');

const FLOW_AWARE_V1 = Object.freeze({ semanticWeight: 0.70, fitWeight: 0.30, unresolvedImageFitWeight: 0.15 });
const idOf = (value, index, prefix) => value?.id ?? value?.section_id ?? value?.sectionKey ?? value?.section_key ?? `${prefix}-${index + 1}`;

async function buildFlowAwarePairEvaluations(stories = [], frames = [], context = {}) {
  const scoreContext = { ...context, editorialFrames: context.editorialFrames || frames };
  let hardRejectedPairs = 0, measuredFitPairs = 0, skippedFitPairs = 0;
  const evaluations = await Promise.all(stories.map(async (story, storyIndex) => Promise.all(frames.map(async (frame, frameIndex) => {
    const compatibility = scoreStoryForFrame(story, frame, scoreContext);
    const ids = { storyId: idOf(story, storyIndex, 'story'), frameId: idOf(frame, frameIndex, 'frame') };
    if (compatibility.hardReject) {
      hardRejectedPairs += 1; skippedFitPairs += 1;
      return { ...ids, compatibility, fit: null, planningScore: compatibility.score, hardReject: true, fitContributionApplied: 0, fitConfidence: 'NOT_MEASURED', reasons: compatibility.reasons };
    }
    measuredFitPairs += 1;
    const fit = await measureStoryFrameFit(story, frame, context);
    const sourceScaleHardRejected = context.externalComposition && fit.sourceScaleStatus === 'SOURCE_SCALE_SEVERELY_THIN';
    const fitWeight = !fit.applicable ? 0 : (fit.imagePlacementUnresolved ? FLOW_AWARE_V1.unresolvedImageFitWeight : FLOW_AWARE_V1.fitWeight);
    const planningScore = (compatibility.score * (1 - fitWeight)) + ((fit.fitScore ?? compatibility.score) * fitWeight);
    return { ...ids, compatibility, fit, planningScore: Number(planningScore.toFixed(4)), hardReject: sourceScaleHardRejected, fitContributionApplied: fitWeight, fitConfidence: !fit.applicable ? 'NOT_APPLICABLE' : (fit.imagePlacementUnresolved ? 'REDUCED_UNRESOLVED_IMAGE' : 'FULL'), reasons: [...compatibility.reasons, ...(sourceScaleHardRejected ? ['SOURCE_SCALE_SEVERELY_THIN'] : [])] };
  }))));
  return { evaluations, diagnostics: { totalPairs: stories.length * frames.length, hardRejectedPairs, measuredFitPairs, skippedFitPairs } };
}

function selectedFitDiagnostics(plan) {
  const selected = plan.assignments || [];
  const applicable = selected.filter((item) => item.fit?.applicable);
  const classes = applicable.reduce((out, item) => { out[item.fit.fitClass] = (out[item.fit.fitClass] || 0) + 1; return out; }, {});
  return {
    selectedCompatibilityAverage: selected.length ? selected.reduce((sum, item) => sum + item.compatibilityScore, 0) / selected.length : 0,
    selectedFitAverage: applicable.length ? applicable.reduce((sum, item) => sum + item.fit.fitScore, 0) / applicable.length : null,
    selectedFitClasses: classes, fitApplicableCount: applicable.length, fitInapplicableCount: selected.length - applicable.length,
    unresolvedImageFitCount: applicable.filter((item) => item.fit.imagePlacementUnresolved).length,
  };
}

async function planFlowAwarePageAssignments(stories = [], frames = [], context = {}) {
  const semanticOnlyPlan = planPageAssignments(stories, frames, context);
  const matrix = await buildFlowAwarePairEvaluations(stories, frames, context);
  const plan = planPageAssignmentsFromEvaluations(stories, frames, matrix.evaluations, context);
  const oldFrames = new Map(semanticOnlyPlan.assignments.map((item) => [String(item.storyId), item.frameId]));
  const changes = plan.assignments.flatMap((item) => oldFrames.get(String(item.storyId)) !== item.frameId ? [{ storyId: item.storyId, oldFrameId: oldFrames.get(String(item.storyId)) || null, newFrameId: item.frameId, compatibilityScore: item.compatibilityScore, fitScore: item.fit?.fitScore ?? null, planningScore: item.score }] : []);
  return {
    ...plan,
    semanticOnlyPlanScore: semanticOnlyPlan.score, flowAwarePlanScore: plan.score,
    diagnostics: { ...plan.diagnostics, ...matrix.diagnostics, ...selectedFitDiagnostics(plan), assignmentChanges: changes },
    pairEvaluations: matrix.evaluations,
  };
}

module.exports = { buildFlowAwarePairEvaluations, planFlowAwarePageAssignments, FLOW_AWARE_V1 };
