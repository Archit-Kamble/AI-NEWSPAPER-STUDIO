// "Fill remaining area with AI" — the first of the AI buttons that is real.
//
// It was a stub: it printed the request it WOULD send into a preview box and
// did nothing. The rule it has to obey is the one in VISION.md - AI assists, it
// never owns - so this returns a proposal and writes nothing, and the copy the
// desk already has is carried on rather than replaced.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn } = require('./helpers/desk');

const storyWriter = require('../src/services/storyWriter.service');
const ai = require('../src/services/ai');

const EXISTING = 'मुंबई : राज्य सरकारने आज शेतकऱ्यांसाठी नवी योजना जाहीर केली आहे. '
  + 'या योजनेचा तपशील लवकरच जाहीर होणार आहे.';

async function withBlock(t, name) {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);

  const newspaper = await desk.json('/api/newspapers', { method: 'POST', body: JSON.stringify({ name }) });
  t.after(() => pool.query('DELETE FROM newspapers WHERE id = $1', [newspaper.id]));

  const page = await desk.json(`/api/newspapers/${newspaper.id}/pages`, {
    method: 'POST',
    body: JSON.stringify({ pageNumber: 1, templateKey: 'front' }),
  });
  return { desk, page };
}

/** A stub provider, so these run without a key and spend nothing. */
function withProvider(t, askForJson) {
  const real = ai.PROVIDERS.sarvam;
  const env = { provider: process.env.AI_PROVIDER, fallback: process.env.AI_FALLBACK_PROVIDER };
  ai.PROVIDERS.sarvam = {
    key: 'sarvam', name: 'Stub', supportsTiers: true, isConfigured: () => true, configHint: '',
    maxOutputTokens: (n) => n || 16384,
    askForJson,
  };
  process.env.AI_PROVIDER = 'sarvam';
  process.env.AI_FALLBACK_PROVIDER = '';
  t.after(() => {
    ai.PROVIDERS.sarvam = real;
    process.env.AI_PROVIDER = env.provider;
    process.env.AI_FALLBACK_PROVIDER = env.fallback;
  });
}

// -------------------------------------------------------------- K. the brief ---

test('the brief carries the block, its measure, and what is already written', async () => {
  let seen = null;
  const section = { width_px: 300, height_px: 400 };
  seen = storyWriter.fillBriefFor({
    view: { headline: 'शेतकऱ्यांसाठी योजना', subheading: 'मंत्रिमंडळाचा निर्णय', body: EXISTING },
    notes: 'जिल्हानिहाय आकडेवारी टाळा',
    room: { budget: 900, used: 120, remaining: 780, cols: 40 },
    language: 'Marathi',
    section,
  });

  assert.match(seen, /शेतकऱ्यांसाठी योजना/, 'the headline');
  assert.match(seen, /मंत्रिमंडळाचा निर्णय/, 'the subheading');
  assert.ok(seen.includes(EXISTING), 'the copy so far, in full');
  assert.match(seen, /900/, 'the budget');
  assert.match(seen, /120/, 'what is used');
  assert.match(seen, /जिल्हानिहाय आकडेवारी टाळा/, "the desk's own notes");
  assert.match(seen, /300 × 400 px/, 'the block');
  assert.match(seen, /40 characters across/, 'its measure');

  // The two rules that matter most.
  assert.match(seen, /without changing a word of what is already there/i);
  assert.match(seen, /Do NOT invent facts/i);
  assert.match(seen, /filling space is exactly when a model starts making/i,
    'and it says WHY, at the moment the risk is highest');
});

// ------------------------------------------------------- the proposal itself ---

test('it returns a proposal and writes nothing to the database', async (t) => {
  const { desk, page } = await withBlock(t, 'ZZ fill remaining');
  await desk(`/api/pages/${page.id}/sections/lead`, {
    method: 'PUT',
    body: JSON.stringify({ headline: 'शेतकऱ्यांसाठी योजना', body: EXISTING, status: 'editing' }),
  });

  const carriedOn = `${EXISTING} योजनेसाठी निधीची तरतूद करण्यात आली असून अंमलबजावणी पुढील महिन्यात सुरू होईल.`;
  withProvider(t, async () => ({ data: { body: carriedOn } }));

  const result = await desk.json(`/api/pages/${page.id}/sections/lead/fill`, {
    method: 'POST',
    body: JSON.stringify({ tier: 'basic' }),
  });

  assert.ok(result.proposal.body.startsWith(EXISTING), 'the copy that was there is still there, first and unchanged');
  assert.ok(result.proposal.body.length > EXISTING.length, 'and it has been carried on');
  assert.equal(result.proposal.headline, undefined, 'the headline the desk wrote is not touched');
  assert.ok(result.fit.charsBefore < result.fit.charsUsed, 'the fit says what it added');
  assert.ok(result.fit.bodyCharBudget > 0);

  // Nothing was saved. A proposal the desk has not accepted must not reach the
  // page - this is the whole difference between assisting and owning.
  const [reloaded] = await desk.json(`/api/newspapers/${page.newspaper_id}/pages`);
  const lead = reloaded.sections.find((s) => s.section_key === 'lead');
  assert.equal(lead.body, EXISTING, 'the block still holds exactly what the desk wrote');
  assert.equal(lead.ai_generated, false, 'and is not marked AI-written until the desk accepts');
});

test('a reporter\'s copy is carried on, never replaced', async (t) => {
  const { desk, page } = await withBlock(t, 'ZZ fill keeps reporter copy');

  const reporterStory = 'पुणे : जिल्ह्यात आज पावसाने हजेरी लावली.';
  await desk(`/api/pages/${page.id}/sections/lead`, {
    method: 'PUT',
    body: JSON.stringify({ headline: 'पावसाची हजेरी', body: reporterStory, status: 'story_linked' }),
  });

  let briefed = '';
  withProvider(t, async (prompt) => {
    briefed = prompt;
    return { data: { body: `${reporterStory} शेतकऱ्यांना दिलासा मिळाला आहे.` } };
  });

  const result = await desk.json(`/api/pages/${page.id}/sections/lead/fill`, {
    method: 'POST',
    body: JSON.stringify({ tier: 'basic' }),
  });

  assert.ok(briefed.includes(reporterStory), "the reporter's copy is given to the model as fixed text");
  assert.ok(result.proposal.body.startsWith(reporterStory), 'and comes back at the front, word for word');
});

// This used to assert a 400 telling the desk to "cut it, set it tighter, or
// carry it over" - so the one button whose whole job is making a block the
// right length refused in exactly the case a desk most needs it, and its
// advice was to go and do it by hand. Overset copy is now cut back to the
// last whole sentence that fits, by composing it (copyFit.service.js), which
// is why the model still must not be called: cutting is arithmetic, not
// authorship, and spending a paid call on it was always waste.
test('an over-full block is CUT back to fit, deterministically and without a model call', async (t) => {
  const { desk, page } = await withBlock(t, 'ZZ fill already full');

  // Far more copy than a block holds - real sentences, so there are sentence
  // boundaries to cut at, which is what a sub-editor's own "cut from the
  // bottom" does.
  const sentence = 'पंतप्रधान नरेंद्र मोदी यांनी लाल किल्ल्यावर ध्वजारोहण केले. ';
  await desk(`/api/pages/${page.id}/sections/lead`, {
    method: 'PUT',
    body: JSON.stringify({ headline: 'मथळा', body: sentence.repeat(60) }),
  });

  withProvider(t, async () => { throw new Error('the model must not be called to cut copy'); });

  const response = await desk(`/api/pages/${page.id}/sections/lead/fill`, {
    method: 'POST',
    body: JSON.stringify({ tier: 'basic' }),
  });
  assert.equal(response.status, 200, 'the block is repaired, not refused');
  const result = await response.json();
  assert.ok(result.proposal?.body, 'a shorter body comes back');
  assert.ok(result.proposal.body.length < sentence.repeat(60).length, 'and it is genuinely shorter');
  assert.equal(result.fit.overflowing, false, 'and it actually fits now');
  assert.equal(result.fit.trimmed, true);
  assert.equal(result.trimmedOnly, true, 'no provider was asked');
});

test('a block holding a Smart Card is not filled with prose', async (t) => {
  const { desk, page } = await withBlock(t, 'ZZ fill smart card block');
  const sudoku = require('../src/features/sudoku');
  const built = await sudoku.build('2031-04-11');

  await desk(`/api/pages/${page.id}/sections/lead`, {
    method: 'PUT',
    body: JSON.stringify({ headline: built.title, smartCardKey: 'sudoku', smartCardData: built.card }),
  });

  withProvider(t, async () => { throw new Error('the model must not be called for a card block'); });

  const response = await desk(`/api/pages/${page.id}/sections/lead/fill`, {
    method: 'POST',
    body: JSON.stringify({ tier: 'basic' }),
  });
  assert.equal(response.status, 400);
  const result = await response.json();
  assert.match(result.error, /Smart Card/i);
});

test('an exhausted output budget reaches the desk as advice, not as a variable name', async (t) => {
  const { desk, page } = await withBlock(t, 'ZZ fill budget exhausted');
  await desk(`/api/pages/${page.id}/sections/lead`, {
    method: 'PUT',
    body: JSON.stringify({ headline: 'शीर्षक', body: EXISTING }),
  });

  withProvider(t, async () => ({ error: 'spent it all reasoning', outputExhausted: true, budget: 4096 }));

  const response = await desk(`/api/pages/${page.id}/sections/lead/fill`, {
    method: 'POST',
    body: JSON.stringify({ tier: 'ultra' }),
  });
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.match(result.error, /could not complete this request within the current output limit/i);
  assert.ok(!/SARVAM_MAX_OUTPUT_TOKENS/.test(result.error));
});
