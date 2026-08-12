// Pure, bounded, single-page assignment rebalancing.
//
// B5A finds the best independent pair matching. This layer evaluates that
// mapping as a candidate page with analyzeLayout(), then applies only the best
// strictly improving swap, move, or replacement at each deterministic step.

const { planPageAssignments } = require('./page-assignment');
const { scoreStoryForFrame } = require('./story-frame-compatibility');
const { analyzeLayout } = require('./layout-quality');

const BALANCER_V1 = Object.freeze({
  compatibilityWeight: 0.45,
  layoutQualityWeight: 0.45,
  assignedWeight: 0.10,
  epsilon: 0.000001,
  maxIterations: (storyCount, frameCount) => Math.max(1, Math.min(100, storyCount * Math.max(1, frameCount))),
});

function idOf(value, index, prefix) {
  return value?.id ?? value?.section_id ?? value?.sectionKey ?? value?.section_key ?? `${prefix}-${index + 1}`;
}

function priorityOf(story) {
  const value = Number(story?.editorial_priority ?? story?.editorialPriority);
  return Number.isFinite(value) ? Math.min(5, Math.max(1, Math.round(value))) : 3;
}

function pairCache(stories, frames, context) {
  const scoreContext = { ...context, editorialFrames: context.editorialFrames || frames };
  return stories.map((story) => frames.map((frame) => scoreStoryForFrame(story, frame, scoreContext)));
}

function stateFromPlan(plan, stories, frames, pairs) {
  const frameIndex = new Map(frames.map((frame, index) => [String(idOf(frame, index, 'frame')), index]));
  const storyIndex = new Map(stories.map((story, index) => [String(idOf(story, index, 'story')), index]));
  const state = Array(stories.length).fill(null);
  for (const item of plan.assignments || []) {
    const story = storyIndex.get(String(item.storyId));
    const frame = frameIndex.get(String(item.frameId));
    if (story === undefined || frame === undefined || state[story] !== null || pairs[story][frame].hardReject) continue;
    if (!state.includes(frame)) state[story] = frame;
  }
  return state;
}

function planForState(state, stories, frames, pairs) {
  const used = new Set(state.filter((item) => item !== null));
  const assignments = [];
  const unassignedStories = [];
  state.forEach((frameIndex, storyIndex) => {
    if (frameIndex === null) {
      unassignedStories.push({ storyId: idOf(stories[storyIndex], storyIndex, 'story'), reason: 'UNASSIGNED_BY_LOCAL_SEARCH', priority: priorityOf(stories[storyIndex]) });
      return;
    }
    const pair = pairs[storyIndex][frameIndex];
    assignments.push({
      storyId: idOf(stories[storyIndex], storyIndex, 'story'), frameId: idOf(frames[frameIndex], frameIndex, 'frame'),
      score: pair.score, subscores: pair.subscores, reasons: pair.reasons,
    });
  });
  const scores = assignments.map((item) => item.score);
  const compatibilityTotal = scores.reduce((total, score) => total + score, 0);
  return {
    assignments,
    unassignedStories,
    emptyFrames: frames.flatMap((frame, index) => (!used.has(index) ? [{ frameId: idOf(frame, index, 'frame') }] : [])),
    score: scores.length ? Number((compatibilityTotal / scores.length).toFixed(4)) : 0,
    diagnostics: {
      compatibilityTotal,
      averageCompatibility: scores.length ? Number((compatibilityTotal / scores.length).toFixed(4)) : 0,
      minimumCompatibility: scores.length ? Math.min(...scores) : null,
      unassignedPriorityWeight: unassignedStories.reduce((total, item) => total + item.priority, 0),
      hardRejectedPairCount: pairs.flat().filter((item) => item.hardReject).length,
      assignmentCount: assignments.length,
    },
  };
}

function candidatePage(state, stories, frames, context) {
  const storyByFrame = new Map(state.flatMap((frameIndex, storyIndex) => frameIndex === null ? [] : [[frameIndex, stories[storyIndex]]]));
  return {
    page_number: context?.page?.page_number ?? context?.pageNumber ?? 2,
    sections: frames.map((frame, index) => {
      const story = storyByFrame.get(index);
      // Frame geometry always wins; assignment only transfers printable story
      // identity/content into a disposable analyzer input.
      return story ? {
        ...frame, ...story,
        x_px: frame.x_px, y_px: frame.y_px, width_px: frame.width_px, height_px: frame.height_px,
        section_key: idOf(frame, index, 'frame'),
      }
        : { ...frame, section_key: idOf(frame, index, 'frame'), headline: '', subheading: '', body: '', caption: '', kicker: '', image_url: '', images: [], smart_card_key: null, smart_card_data: null };
    }),
  };
}

function evaluate(state, stories, frames, pairs, context) {
  const plan = planForState(state, stories, frames, pairs);
  const layoutQuality = analyzeLayout(candidatePage(state, stories, frames, context), context.newspaper || {});
  const maximumPriority = Math.max(1, stories.length * 5);
  const unassignedPenalty = (100 * plan.diagnostics.unassignedPriorityWeight) / maximumPriority;
  const assignedComponent = 100 - unassignedPenalty;
  const objective = (BALANCER_V1.compatibilityWeight * plan.score)
    + (BALANCER_V1.layoutQualityWeight * layoutQuality.score)
    + (BALANCER_V1.assignedWeight * assignedComponent);
  return {
    plan, layoutQuality, unassignedPenalty: Number(unassignedPenalty.toFixed(4)), assignedComponent: Number(assignedComponent.toFixed(4)),
    objective: Number(objective.toFixed(6)),
  };
}

function rebalancePageAssignments(stories = [], frames = [], context = {}) {
  const pairs = pairCache(stories, frames, context);
  const initialPlan = context.initialPlan || planPageAssignments(stories, frames, context);
  let state = stateFromPlan(initialPlan, stories, frames, pairs);
  let current = evaluate(state, stories, frames, pairs, context);
  const initialEvaluation = current;
  const improvements = [];
  const limit = Number.isFinite(context.maxIterations) ? Math.max(0, Math.floor(context.maxIterations)) : BALANCER_V1.maxIterations(stories.length, frames.length);
  let terminationReason = state.some((item) => item !== null) ? 'LOCAL_OPTIMUM' : 'NO_ASSIGNMENTS';
  let iterations = 0;

  while (iterations < limit && terminationReason !== 'NO_ASSIGNMENTS') {
    const assigned = state.flatMap((frame, story) => frame === null ? [] : [{ story, frame }]);
    const used = new Set(assigned.map((item) => item.frame));
    const empty = frames.flatMap((_, frame) => !used.has(frame) ? [frame] : []);
    const unassigned = state.flatMap((frame, story) => frame === null ? [story] : []);
    const candidates = [];
    for (let a = 0; a < assigned.length; a += 1) for (let b = a + 1; b < assigned.length; b += 1) {
      const next = [...state]; next[assigned[a].story] = assigned[b].frame; next[assigned[b].story] = assigned[a].frame;
      candidates.push({ type: 'SWAP', next, stories: [assigned[a].story, assigned[b].story], frames: [assigned[a].frame, assigned[b].frame] });
    }
    for (const item of assigned) for (const target of empty) {
      const next = [...state]; next[item.story] = target;
      candidates.push({ type: 'MOVE', next, stories: [item.story], frames: [item.frame, target] });
    }
    for (const incoming of unassigned) for (const outgoing of assigned) {
      const next = [...state]; next[incoming] = outgoing.frame; next[outgoing.story] = null;
      candidates.push({ type: 'REPLACE', next, stories: [outgoing.story, incoming], frames: [outgoing.frame] });
    }

    let best = null;
    for (const candidate of candidates) {
      if (candidate.next.some((frame, story) => frame !== null && pairs[story][frame].hardReject)) continue;
      const evaluation = evaluate(candidate.next, stories, frames, pairs, context);
      if (evaluation.objective <= current.objective + BALANCER_V1.epsilon) continue;
      if (!best || evaluation.objective > best.evaluation.objective + BALANCER_V1.epsilon) best = { ...candidate, evaluation };
    }
    if (!best) break;
    improvements.push({
      type: best.type,
      affectedStories: best.stories.map((index) => idOf(stories[index], index, 'story')),
      affectedFrames: best.frames.map((index) => idOf(frames[index], index, 'frame')),
      beforeObjective: current.objective, afterObjective: best.evaluation.objective,
      delta: Number((best.evaluation.objective - current.objective).toFixed(6)),
      beforeQuality: current.layoutQuality.score, afterQuality: best.evaluation.layoutQuality.score,
      beforeCompatibility: current.plan.score, afterCompatibility: best.evaluation.plan.score,
    });
    state = best.next; current = best.evaluation; iterations += 1;
  }
  if (iterations >= limit && terminationReason !== 'NO_ASSIGNMENTS') terminationReason = 'ITERATION_LIMIT';
  return {
    initialPlan, finalPlan: current.plan,
    initialObjective: initialEvaluation.objective, finalObjective: current.objective,
    improvements, iterations, terminationReason,
    diagnostics: { compatibility: current.plan.diagnostics, layoutQuality: current.layoutQuality, unassignedPenalty: current.unassignedPenalty, assignedComponent: current.assignedComponent },
  };
}

module.exports = { rebalancePageAssignments, BALANCER_V1, candidatePage };
