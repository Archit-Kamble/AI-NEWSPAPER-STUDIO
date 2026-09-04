// DRESSING THE WHOLE PAPER - it proposes before it writes, and what it
// promised is what it does.
//
// This is the biggest presentational write in the product: one press restyles
// every block of every page. The single-page control has proposed first since
// it was written; this did not - its question described the ACTION ("each page
// is given a look from the paper's own catalogue") and named nothing about the
// desk's own edition, which is how a desk learns to dismiss a question without
// reading it. The same fault this codebase fixed once for a scoped AI
// overwrite and once for deleting an edition.
//
// THE PREVIEW COSTS ONE AI CALL, NOT TWO. It hands back the themes it chose
// and the real run applies exactly those - asking again would bill the
// newsroom twice for one decision AND could answer differently, so the desk
// would approve one paper and be given another.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn, removeEdition } = require('./helpers/desk');

test.after(() => pool.end());

async function edition(t, date) {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);
  const started = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: date, pageCount: 4, fillFeatures: false }),
  });
  t.after(() => removeEdition(started.newspaper.id));
  return { desk, id: started.newspaper.id };
}

test('the preview writes nothing, and the apply does exactly what it promised', async (t) => {
  const { desk, id } = await edition(t, '2099-08-26');

  // useAi:false so this test spends no provider call and is deterministic -
  // the derived themes are the same answer every run.
  const look = await desk.json(`/api/newspapers/${id}/dress`, {
    method: 'POST', body: JSON.stringify({ preview: true, useAi: false }),
  });
  assert.ok(!look.error, `the preview failed: ${look.error}`);
  assert.strictEqual(look.preview, true);
  assert.ok(look.pages > 0, 'the preview reported no pages');
  assert.ok(look.changing > 0, 'a fresh edition should have something to dress');

  // IT WROTE NOTHING. Asking a second time must give the identical answer -
  // a preview that had changed the page would report less to do.
  const again = await desk.json(`/api/newspapers/${id}/dress`, {
    method: 'POST', body: JSON.stringify({ preview: true, useAi: false }),
  });
  assert.strictEqual(again.changing, look.changing, 'the preview changed the edition it was only looking at');

  // AND THE APPLY DELIVERS WHAT THE QUESTION PROMISED. `dressed` is the number
  // the desk is shown before pressing, so it is the number that must come back.
  const done = await desk.json(`/api/newspapers/${id}/dress`, {
    method: 'POST', body: JSON.stringify({ themes: look.themes }),
  });
  assert.ok(!done.error, `the apply failed: ${done.error}`);
  assert.strictEqual(done.dressed, look.dressed,
    'the paper was dressed differently from what the desk was shown');
  assert.strictEqual(done.pages, look.pages);
});

test('the themes the preview chose are the themes that get applied', async (t) => {
  const { desk, id } = await edition(t, '2099-08-27');
  const look = await desk.json(`/api/newspapers/${id}/dress`, {
    method: 'POST', body: JSON.stringify({ preview: true, useAi: false }),
  });
  const done = await desk.json(`/api/newspapers/${id}/dress`, {
    method: 'POST', body: JSON.stringify({ themes: look.themes }),
  });
  for (const one of done.results) {
    assert.strictEqual(one.theme, look.themes[one.pageNumber],
      `page ${one.pageNumber} was dressed as ${one.theme}, not the ${look.themes[one.pageNumber]} the desk approved`);
  }
  // Pressing it twice is safe: the second run finds nothing to change.
  const twice = await desk.json(`/api/newspapers/${id}/dress`, {
    method: 'POST', body: JSON.stringify({ preview: true, useAi: false }),
  });
  assert.strictEqual(twice.changing, 0, 'a paper already dressed as its own themes still reports work to do');
});

test('an edition with no pages is refused rather than reported as dressed', async () => {
  const pageStyleService = require('../src/services/pageStyle.service');
  const result = await pageStyleService.applyToEdition(999999999, { preview: true, useAi: false });
  assert.ok(result.error, 'an edition with no pages should be refused');
});
