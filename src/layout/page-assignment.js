// Pure single-page story/frame assignment planning.
//
// The planner uses the Hungarian algorithm (O(n³)) for an exact maximum-weight
// one-to-one matching. It never changes a page: callers receive only a
// candidate mapping they may inspect or later apply. Equal weights are broken
// deterministically by original frame order, then original story order.

const { scoreStoryForFrame } = require('./story-frame-compatibility');

const ASSIGNMENT_V1 = Object.freeze({
  impossibleWeight: -1000000000,
  // Dummies mean “leave this story unassigned.” Low-priority stories have a
  // slightly less costly dummy, while a normal compatible frame always wins.
  unassignedWeightForPriority: (priority) => 15 - (Math.min(5, Math.max(1, priority)) * 2),
});

function idOf(value, index, prefix) {
  return value?.id ?? value?.section_id ?? value?.sectionKey ?? value?.section_key ?? `${prefix}-${index + 1}`;
}

function priorityOf(story) {
  const value = Number(story?.editorial_priority ?? story?.editorialPriority);
  return Number.isFinite(value) ? Math.min(5, Math.max(1, Math.round(value))) : 3;
}

// Hungarian minimum-cost assignment, adapted from the standard potential
// formulation. This expects rows <= columns; planner columns include one dummy
// for every story, so that invariant always holds.
function hungarianMin(cost) {
  const n = cost.length;
  const m = cost[0]?.length || 0;
  const u = Array(n + 1).fill(0);
  const v = Array(m + 1).fill(0);
  const p = Array(m + 1).fill(0);
  const way = Array(m + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(m + 1).fill(Infinity);
    const used = Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j += 1) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j += 1) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const assignment = Array(n).fill(-1);
  for (let j = 1; j <= m; j += 1) if (p[j]) assignment[p[j] - 1] = j - 1;
  return assignment;
}

function planPageAssignments(stories = [], frames = [], context = {}) {
  const editorialFrames = context.editorialFrames || frames;
  const scoreContext = { ...context, editorialFrames };
  const pairings = stories.map((story) => frames.map((frame) => scoreStoryForFrame(story, frame, scoreContext)));
  const hardRejectedPairCount = pairings.flat().filter((item) => item.hardReject).length;
  const columns = frames.length + stories.length;
  const weights = stories.map((story, storyIndex) => Array.from({ length: columns }, (_, columnIndex) => {
    if (columnIndex < frames.length) {
      const result = pairings[storyIndex][columnIndex];
      if (result.hardReject) return ASSIGNMENT_V1.impossibleWeight;
      // Frame index is a tiny deterministic tie-break only; canonical score
      // remains untouched in the public assignment result.
      return (result.score * 1000) + (frames.length - columnIndex) / 1000;
    }
    return ASSIGNMENT_V1.unassignedWeightForPriority(priorityOf(story)) * 1000;
  }));
  const maxWeight = Math.max(0, ...weights.flat());
  const assignmentColumns = stories.length ? hungarianMin(weights.map((row) => row.map((weight) => maxWeight - weight))) : [];

  const assignments = [];
  const unassignedStories = [];
  const usedFrames = new Set();
  assignmentColumns.forEach((column, storyIndex) => {
    const story = stories[storyIndex];
    if (column >= 0 && column < frames.length && !pairings[storyIndex][column].hardReject) {
      const frame = frames[column];
      const compatible = pairings[storyIndex][column];
      usedFrames.add(column);
      assignments.push({
        storyId: idOf(story, storyIndex, 'story'), frameId: idOf(frame, column, 'frame'),
        score: compatible.score, subscores: compatible.subscores, reasons: compatible.reasons,
      });
    } else {
      const validPairs = pairings[storyIndex].filter((item) => !item.hardReject);
      unassignedStories.push({
        storyId: idOf(story, storyIndex, 'story'),
        reason: validPairs.length ? 'UNASSIGNED_BY_GLOBAL_MATCH' : 'NO_COMPATIBLE_FRAME',
        priority: priorityOf(story),
      });
    }
  });

  const scores = assignments.map((item) => item.score);
  const totalCompatibility = scores.reduce((sum, item) => sum + item, 0);
  return {
    assignments,
    unassignedStories,
    emptyFrames: frames.flatMap((frame, index) => (!usedFrames.has(index)
      ? [{ frameId: idOf(frame, index, 'frame') }]
      : [])),
    score: scores.length ? Number((totalCompatibility / scores.length).toFixed(4)) : 0,
    diagnostics: {
      compatibilityTotal: totalCompatibility,
      averageCompatibility: scores.length ? Number((totalCompatibility / scores.length).toFixed(4)) : 0,
      minimumCompatibility: scores.length ? Math.min(...scores) : null,
      unassignedPriorityWeight: unassignedStories.reduce((sum, item) => sum + item.priority, 0),
      hardRejectedPairCount,
      assignmentCount: assignments.length,
    },
  };
}

module.exports = { planPageAssignments, ASSIGNMENT_V1, hungarianMin };
