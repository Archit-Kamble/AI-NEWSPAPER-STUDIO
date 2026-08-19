// Writing the empty blocks of a page, one block at a time.
//
// The tempting shape is one enormous request: hand the model the whole page and
// ask for twelve stories. That is wrong three times over. The output budget is
// per request, so twelve stories in one answer is the exact call that spends
// its whole budget reasoning and returns nothing; one block failing loses all
// twelve; and each block has its OWN measured hole, so a single answer cannot
// be written to fit any of them.
//
// So: one request per block, against the endpoint a single block already uses,
// with two or three in the air at once. Two reasons for the limit rather than
// none - a provider has a requests-per-minute ceiling (Sarvam Starter is 60),
// and a desk watching twelve blocks fill at once cannot tell which one it is
// waiting for.
//
// Nothing is saved. Every block comes back as a proposal, exactly as a single
// block does, and the desk accepts them one at a time - VISION.md: AI assists,
// it never owns.

/** How many requests are allowed in the air at once. */
export const CONCURRENCY = 2;

/**
 * The brief for a block nobody has written a headline for: today's news, for
 * the ground this paper covers.
 *
 * Deliberately in Marathi and deliberately naming the day. Both matter:
 * information/intent.js classifies a seed as `current_news` from words like
 * "आज" and "ताज्या", and information/routing.js picks which feeds to ask from
 * the place named in it. A seed that says neither would be classified
 * `evergreen`, retrieval would never run, and the model would be writing a
 * news story out of its own memory - the one thing that layer exists to stop.
 */
export function newsSeed(section, place = '') {
  const ground = [section?.location, section?.category, place]
    .map((part) => String(part || '').trim())
    .find(Boolean) || 'महाराष्ट्र';
  return `${ground} आजच्या ताज्या बातम्या`;
}

/**
 * The blocks on a page that can be written, and the seed each would be written
 * from.
 *
 * The rule is narrow on purpose. A block is a candidate only when the desk has
 * said what it is about and has not written it yet - which in a newsroom means
 * a headline with no copy under it, the state a page is in after the news list
 * is laid down in the afternoon.
 *
 * Everything else is left alone:
 *   * copy already written, by anybody, is never overwritten
 *   * a linked reporter story belongs to the reporter
 *   * a Smart Card block is not prose
 *   * an advert slot was sold, and a photo block wants a photograph
 *
 * A block with NO headline used to be skipped too, on the reasoning that a
 * model asked to fill 800 characters from nothing invents all of them. That
 * reasoning was right when it was written and is not any more: a seed naming a
 * place and today is classified `current_news` by information/intent.js, and
 * `write()` fetches and verifies real sources BEFORE spending an AI call and
 * returns a refusal in Marathi if it cannot. So an empty block is written from
 * today's real news or it is not written at all - the model is never the source
 * of a current event, which is the whole invariant that layer exists to hold.
 */
export function candidatesOn(page, { place = '' } = {}) {
  const blocks = page?.sections || [];
  const out = { ready: [], skipped: [] };

  for (const section of blocks) {
    const skip = (why) => out.skipped.push({ sectionKey: section.section_key, why });
    const headline = String(section.headline || "").trim();
    const body = String(section.body || "").trim();

    if (section.block_type === "advert") { skip("advert space"); continue; }
    if (section.block_type === "photo") { skip("wants a photograph"); continue; }
    if (section.feature_key || section.smart_card_key) { skip("a standing feature"); continue; }
    if (section.news_item_id) { skip("a reporter's story"); continue; }
    if (body) { skip("already written"); continue; }

    out.ready.push({
      sectionKey: section.section_key,
      // The headline IS the brief when there is one. When there is not, the
      // brief is today's news for the ground this paper covers - the block's
      // own location or category if the layout gave it one, else the paper's
      // place of publication. Written in Marathi because that is the language
      // the feeds are read in and the language intent.js's own "this is a
      // current event" words are in (आज, ताज्या, बातम्या).
      seed: headline || newsSeed(section, place),
      notes: String(section.ai_notes || "").trim(),
      language: section.language || "Marathi",
      // So the desk can be told which blocks were written from the wire rather
      // than from a headline somebody wrote.
      fromToday: !headline,
    });
  }

  return out;
}

/**
 * Runs the batch, at most `concurrency` at a time.
 *
 * `request` does one block and is injected, so this can be tested without a
 * network and so there is one place a block is written - the same endpoint the
 * single-block button uses.
 *
 * `onProgress` is called before and after every block, which is what lets the
 * desk read "Generating 3 of 12" rather than watching a spinner.
 */
export async function runBulk({ blocks, request, onProgress, concurrency = CONCURRENCY, signal } = {}) {
  const queue = [...(blocks || [])];
  const total = queue.length;
  const results = [];
  let started = 0;
  let finished = 0;

  const report = (phase, block, extra = {}) =>
    onProgress?.({ phase, total, started, finished, sectionKey: block?.sectionKey, ...extra });

  async function worker() {
    while (queue.length) {
      if (signal?.aborted) return;
      const block = queue.shift();
      started += 1;
      report("start", block);

      let outcome;
      try {
        const result = await request(block);
        outcome = result?.error
          ? { sectionKey: block.sectionKey, error: result.error }
          : { sectionKey: block.sectionKey, proposal: result.proposal, fit: result.fit, provider: result.provider };
      } catch (error) {
        // One block failing must never take the batch down. A provider having a
        // bad minute should cost the desk that block, not the page.
        outcome = { sectionKey: block.sectionKey, error: error.message || "The AI did not answer." };
      }

      finished += 1;
      results.push(outcome);
      report("done", block, { ok: !outcome.error });
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, total || 1)) }, () => worker()),
  );

  // Back into page order: the workers finish out of order, and a desk reads a
  // page from the top.
  const order = new Map((blocks || []).map((block, index) => [block.sectionKey, index]));
  results.sort((a, b) => (order.get(a.sectionKey) ?? 0) - (order.get(b.sectionKey) ?? 0));

  return {
    results,
    written: results.filter((r) => !r.error).length,
    failed: results.filter((r) => r.error).length,
  };
}
