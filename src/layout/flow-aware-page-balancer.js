// Async B6D local repair over one precomputed B6C pair matrix. Text flow is
// measured before search; candidate trials only look up pair scores and run
// synchronous geometry/hierarchy analysis.

const { buildFlowAwarePairEvaluations } = require('./flow-aware-page-planner');
const { planPageAssignmentsFromEvaluations } = require('./page-assignment');
const { analyzeLayout } = require('./layout-quality');
const { candidatePage } = require('./page-balancer');

const FLOW_BALANCER_V1 = Object.freeze({ pairQualityWeight: 0.60, layoutQualityWeight: 0.30, assignedWeight: 0.10, epsilon: 0.000001, maxIterations: (stories, frames) => Math.max(1, Math.min(100, stories * Math.max(1, frames))) });
const idOf = (value, index, prefix) => value?.id ?? value?.section_id ?? value?.sectionKey ?? value?.section_key ?? `${prefix}-${index + 1}`;
const priorityOf = (story) => Math.min(5, Math.max(1, Math.round(Number(story?.editorial_priority ?? story?.editorialPriority) || 3)));

function stateFromPlan(plan, stories, frames, pairs) {
  const storiesById = new Map(stories.map((item, index) => [String(idOf(item, index, 'story')), index]));
  const framesById = new Map(frames.map((item, index) => [String(idOf(item, index, 'frame')), index]));
  const state = Array(stories.length).fill(null);
  for (const item of plan.assignments || []) {
    const story = storiesById.get(String(item.storyId)); const frame = framesById.get(String(item.frameId));
    if (story !== undefined && frame !== undefined && state[story] === null && !state.includes(frame) && !pairs[story][frame].hardReject) state[story] = frame;
  }
  return state;
}
function planForState(state, stories, frames, pairs) {
  const used = new Set(state.filter((item) => item !== null)); const assignments = [], unassignedStories = [];
  state.forEach((frame, story) => {
    if (frame === null) unassignedStories.push({ storyId: idOf(stories[story], story, 'story'), reason: 'UNASSIGNED_BY_LOCAL_SEARCH', priority: priorityOf(stories[story]) });
    else { const pair = pairs[story][frame]; assignments.push({ storyId: idOf(stories[story], story, 'story'), frameId: idOf(frames[frame], frame, 'frame'), score: pair.planningScore, compatibilityScore: pair.compatibility.score, fit: pair.fit, fitConfidence: pair.fitConfidence, fitContributionApplied: pair.fitContributionApplied, reasons: pair.reasons }); }
  });
  const scores = assignments.map((item) => item.score); const total = scores.reduce((sum, score) => sum + score, 0);
  return { assignments, unassignedStories, emptyFrames: frames.flatMap((frame, index) => !used.has(index) ? [{ frameId: idOf(frame, index, 'frame') }] : []), score: scores.length ? Number((total / scores.length).toFixed(4)) : 0, diagnostics: { compatibilityTotal: total, averageCompatibility: scores.length ? total / scores.length : 0, unassignedPriorityWeight: unassignedStories.reduce((sum, item) => sum + item.priority, 0), assignmentCount: assignments.length } };
}
function evaluate(state, stories, frames, pairs, context) {
  const plan = planForState(state, stories, frames, pairs); const layoutQuality = analyzeLayout(candidatePage(state, stories, frames, context), context.newspaper || {});
  const coverage = 100 - ((100 * plan.diagnostics.unassignedPriorityWeight) / Math.max(1, stories.length * 5));
  return { plan, layoutQuality, coverage: Number(coverage.toFixed(4)), objective: Number(((FLOW_BALANCER_V1.pairQualityWeight * plan.score) + (FLOW_BALANCER_V1.layoutQualityWeight * layoutQuality.score) + (FLOW_BALANCER_V1.assignedWeight * coverage)).toFixed(6)) };
}
function fitEvidence(state, next, stories, pairs) {
  return next.flatMap((frame, story) => state[story] === frame || frame === null || state[story] === null ? [] : [{ storyId: idOf(stories[story], story, 'story'), oldFitClass: pairs[story][state[story]].fit?.fitClass ?? null, newFitClass: pairs[story][frame].fit?.fitClass ?? null, oldFitScore: pairs[story][state[story]].fit?.fitScore ?? null, newFitScore: pairs[story][frame].fit?.fitScore ?? null }]);
}
async function rebalanceFlowAwarePageAssignments(stories = [], frames = [], context = {}) {
  const matrix = context.pairMatrix || await buildFlowAwarePairEvaluations(stories, frames, context);
  const pairs = matrix.evaluations; const initialPlan = context.initialPlan || planPageAssignmentsFromEvaluations(stories, frames, pairs, context);
  let state = stateFromPlan(initialPlan, stories, frames, pairs), current = evaluate(state, stories, frames, pairs, context), initial = current, iterations = 0;
  const improvements = []; const limit = Number.isFinite(context.maxIterations) ? Math.max(0, Math.floor(context.maxIterations)) : FLOW_BALANCER_V1.maxIterations(stories.length, frames.length);
  let terminationReason = state.some((item) => item !== null) ? 'LOCAL_OPTIMUM' : 'NO_ASSIGNMENTS';
  while (iterations < limit && terminationReason !== 'NO_ASSIGNMENTS') {
    const assigned = state.flatMap((frame, story) => frame === null ? [] : [{ story, frame }]); const used = new Set(assigned.map((item) => item.frame));
    const empty = frames.flatMap((_, index) => !used.has(index) ? [index] : []), unassigned = state.flatMap((frame, story) => frame === null ? [story] : []), candidates = [];
    for (let a = 0; a < assigned.length; a += 1) for (let b = a + 1; b < assigned.length; b += 1) { const next = [...state]; next[assigned[a].story] = assigned[b].frame; next[assigned[b].story] = assigned[a].frame; candidates.push({ type: 'SWAP', next, stories: [assigned[a].story, assigned[b].story], frames: [assigned[a].frame, assigned[b].frame] }); }
    for (const item of assigned) for (const target of empty) { const next = [...state]; next[item.story] = target; candidates.push({ type: 'MOVE', next, stories: [item.story], frames: [item.frame, target] }); }
    for (const incoming of unassigned) for (const outgoing of assigned) { const next = [...state]; next[incoming] = outgoing.frame; next[outgoing.story] = null; candidates.push({ type: 'REPLACE', next, stories: [outgoing.story, incoming], frames: [outgoing.frame] }); }
    let best = null;
    for (const candidate of candidates) {
      if (candidate.next.some((frame, story) => frame !== null && pairs[story][frame].hardReject)) continue;
      const evaluation = evaluate(candidate.next, stories, frames, pairs, context);
      if (evaluation.objective > current.objective + FLOW_BALANCER_V1.epsilon && (!best || evaluation.objective > best.evaluation.objective + FLOW_BALANCER_V1.epsilon)) best = { ...candidate, evaluation };
    }
    if (!best) break;
    improvements.push({ type: best.type, affectedStories: best.stories.map((i) => idOf(stories[i], i, 'story')), affectedFrames: best.frames.map((i) => idOf(frames[i], i, 'frame')), beforeObjective: current.objective, afterObjective: best.evaluation.objective, delta: Number((best.evaluation.objective - current.objective).toFixed(6)), pairQualityBefore: current.plan.score, pairQualityAfter: best.evaluation.plan.score, layoutQualityBefore: current.layoutQuality.score, layoutQualityAfter: best.evaluation.layoutQuality.score, coverageBefore: current.coverage, coverageAfter: best.evaluation.coverage, fitEvidence: fitEvidence(state, best.next, stories, pairs) });
    state = best.next; current = best.evaluation; iterations += 1;
  }
  if (iterations >= limit && terminationReason !== 'NO_ASSIGNMENTS') terminationReason = 'ITERATION_LIMIT';
  const selected = current.plan.assignments, applicable = selected.filter((item) => item.fit?.applicable);
  return { initialPlan, finalPlan: current.plan, initialObjective: initial.objective, finalObjective: current.objective, improvements, iterations, terminationReason, diagnostics: { ...matrix.diagnostics, selectedFitApplicable: applicable.length, selectedFitInapplicable: selected.length - applicable.length, selectedUnresolvedImageFits: applicable.filter((item) => item.fit.imagePlacementUnresolved).length, selectedFitClassCounts: applicable.reduce((out, item) => { out[item.fit.fitClass] = (out[item.fit.fitClass] || 0) + 1; return out; }, {}), averageSelectedSemanticCompatibility: selected.length ? selected.reduce((sum, item) => sum + item.compatibilityScore, 0) / selected.length : 0, averageSelectedFitScore: applicable.length ? applicable.reduce((sum, item) => sum + item.fit.fitScore, 0) / applicable.length : null, averageSelectedPlanningScore: current.plan.score, initialLayoutQuality: initial.layoutQuality.score, finalLayoutQuality: current.layoutQuality.score, acceptedRepairCount: improvements.length } };
}
module.exports = { rebalanceFlowAwarePageAssignments, FLOW_BALANCER_V1 };
