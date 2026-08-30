// N things at a time, and never all of them at once.
//
// Two consumers: the open-web searches in retrieval.js, and the writer calls
// in writer.js. Both want the same shape and neither wants a dependency.
//
// The limit is not decoration. A burst is worse than a queue here for a
// measured reason: ai/conditions.js classifies `rateLimit` as "no retry, go
// straight to the understudy", so eight simultaneous writer calls do not fail
// loudly - they quietly push the rest of the paper onto a fallback provider
// whose plan then truncates a full-page lead. A slow answer is recoverable; a
// silently downgraded one reaches the plate.

/**
 * @param {Array} list
 * @param {number} limit  how many may be in the air at once
 * @param {(item, index) => Promise} fn
 * @param {{onProgress: ({started, finished, total, item}) => void, signal}} hooks
 * @returns {Promise<Array>} results in the ORDER OF THE INPUT, not of completion
 */
async function mapLimit(list, limit, fn, { onProgress, signal } = {}) {
  const items = [...(list || [])];
  const total = items.length;
  const results = new Array(total);
  let next = 0;
  let started = 0;
  let finished = 0;

  async function worker() {
    for (;;) {
      if (signal?.aborted) return;
      const index = next;
      next += 1;
      if (index >= total) return;

      started += 1;
      onProgress?.({ phase: 'start', started, finished, total, item: items[index], index });
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        // One item failing must never take the batch down. A provider having
        // a bad minute should cost the desk that block, not the page.
        results[index] = { error: error?.message || String(error) };
      }
      finished += 1;
      onProgress?.({ phase: 'done', started, finished, total, item: items[index], index });
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, total || 1)) }, () => worker()),
  );
  return results;
}

module.exports = { mapLimit };
