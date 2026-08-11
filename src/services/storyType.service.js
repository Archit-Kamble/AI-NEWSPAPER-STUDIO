// Server-side bridge to the shared semantic catalog.  The catalog lives under
// public/editor because browser composition code also needs it; dynamic import
// lets CommonJS services consume that exact module instead of maintaining a
// second list of story types or priority rules.

let catalogPromise;

function catalog() {
  if (!catalogPromise) catalogPromise = import('../../public/editor/layout/story-types.js');
  return catalogPromise;
}

function supplied(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

/**
 * Canonicalise metadata accepted by request services.  Unknown explicit story
 * types are rejected; old/missing values use safe defaults. Numeric priorities
 * use the shared 1..5 clamp so imported or form values cannot escape the
 * agreed editorial scale.
 */
async function normalizeStoryMetadata(input = {}, fallback = {}) {
  const types = await catalog();
  const rawType = input.storyType ?? input.story_type;
  const rawPriority = input.editorialPriority ?? input.editorial_priority;

  if (supplied(rawType) && !types.isKnownStoryType(rawType)) {
    return { error: `Unknown story type: ${String(rawType).trim()}` };
  }
  if (supplied(rawPriority) && !Number.isFinite(Number(rawPriority))) {
    return { error: 'Editorial priority must be a number from 1 to 5' };
  }

  return {
    storyType: supplied(rawType)
      ? types.normalizeStoryType(rawType)
      : (fallback.storyType === undefined ? undefined : types.normalizeStoryType(fallback.storyType)),
    editorialPriority: supplied(rawPriority)
      ? types.normalizeEditorialPriority(rawPriority)
      : (fallback.editorialPriority === undefined
        ? undefined
        : types.normalizeEditorialPriority(fallback.editorialPriority, 3)),
  };
}

module.exports = { normalizeStoryMetadata };
