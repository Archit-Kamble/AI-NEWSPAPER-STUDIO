// jump.service.js's carryOver(): the oldest move in newspaper production,
// end to end. `splitAt()` already had unit tests (production.test.js); this
// file is what was missing - carryOver() itself, the part that actually
// touches the database, had none.
//
// Project A's realistic test edition (scripts/build-test-edition.js) found a
// real gap while exercising it for the first time: `room` was sized against
// the SOURCE block's own capacity alone, so a story leaving a long tail could
// silently overset whatever empty block findLanding() happened to pick - a
// lead's continuation landed 560 characters over budget in a four-column
// block, on a real generated page, not a hand-built adversarial case. These
// tests hold both the ordinary path and the new guard.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn, removeEdition } = require('./helpers/desk');

async function withEdition(run) {
  const server = createApp().listen(0);
  const port = server.address().port;
  const desk = await signIn(port);
  let newspaper;
  try {
    newspaper = await desk.json('/api/newspapers', {
      method: 'POST',
      body: JSON.stringify({ name: 'jump.service test' }),
    });
    const page1 = await desk.json(`/api/newspapers/${newspaper.id}/pages`, {
      method: 'POST',
      body: JSON.stringify({ pageNumber: 1, templateKey: 'dense' }),
    });
    const page2 = await desk.json(`/api/newspapers/${newspaper.id}/pages`, {
      method: 'POST',
      body: JSON.stringify({ pageNumber: 2, templateKey: 'dense' }),
    });
    await run({ desk, newspaper, page1, page2 });
  } finally {
    await removeEdition(newspaper?.id);
    server.close();
  }
}

// Long enough to overset the source ('anchor', dense template) but not so
// long that the leftover also oversets an equally-sized landing block - a
// realistic single jump, not the "needs a third page" case the next test
// covers on purpose.
const LONG_BODY = 'हा एक लांब मजकूर आहे जो सलगपणे पुढे चालत राहतो. '.repeat(20);

test('a story too long for its block is carried onto the first empty block on a later page', async () => {
  await withEdition(async ({ desk, page1, page2 }) => {
    const sourceKey = page1.sections.find((s) => s.section_key === 'anchor').section_key;
    await desk.json(`/api/pages/${page1.id}/sections/${sourceKey}`, {
      method: 'PUT',
      body: JSON.stringify({ headline: 'लांब बातमी', body: LONG_BODY }),
    });

    const result = await desk.json(`/api/pages/${page1.id}/sections/${sourceKey}/carry-over`, {
      method: 'POST', body: JSON.stringify({}),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.to.pageNumber, 2);
    assert.ok(result.carryLine.includes('उर्वरित पान'));

    const updatedSource = (await desk.json(`/api/newspapers/${page1.newspaper_id || page1.newspaperId}/pages`))
      .find((p) => p.id === page1.id).sections.find((s) => s.section_key === sourceKey);
    assert.ok(updatedSource.body.includes('उर्वरित पान'), 'the first part carries the jump line');

    const targetPage = (await desk.json(`/api/newspapers/${page1.newspaper_id || page1.newspaperId}/pages`))
      .find((p) => p.id === result.to.pageId);
    const landed = targetPage.sections.find((s) => s.section_key === result.to.sectionKey);
    assert.ok(landed.body.includes('पान 1 वरून') || landed.body.includes('पान १ वरून'), 'the continuation carries the pick-up line');
    assert.equal(landed.headline, 'लांब बातमी', 'the continuation carries the story\'s own headline');
  });
});

test('a continuation that would overset the landing block is refused, not silently written oversized', async () => {
  await withEdition(async ({ desk, page1, page2 }) => {
    const sourceKey = 'anchor';
    // A source with a great deal LEFT OVER after its own budget - more than
    // any single narrow column-width block on the next page can hold.
    const hugeBody = LONG_BODY.repeat(6);
    await desk.json(`/api/pages/${page1.id}/sections/${sourceKey}`, {
      method: 'PUT',
      body: JSON.stringify({ headline: 'खूप मोठी बातमी', body: hugeBody }),
    });

    // Empty every block on page two except one narrow column, so findLanding()
    // has no choice but to offer the block too small to hold the tail.
    const narrow = page2.sections
      .filter((s) => s.section_key !== 'col-one-a')
      .map((s) => s.section_key);
    // col-one-a is already empty (a fresh dense page); nothing to do to it.
    void narrow;

    const result = await desk.json(`/api/pages/${page1.id}/sections/${sourceKey}/carry-over`, {
      method: 'POST',
      body: JSON.stringify({ toPageId: page2.id, toSectionKey: 'col-one-a' }),
    });

    assert.ok(result.error, 'an oversized continuation must be refused, not written');
    assert.match(result.error, /landing block|too small/);

    const stillSource = (await desk.json(`/api/newspapers/${page1.newspaper_id}/pages`))
      .find((p) => p.id === page1.id).sections.find((s) => s.section_key === sourceKey);
    assert.equal(stillSource.body, hugeBody, 'the source is untouched when the carry-over is refused');

    const stillTarget = (await desk.json(`/api/newspapers/${page1.newspaper_id}/pages`))
      .find((p) => p.id === page2.id).sections.find((s) => s.section_key === 'col-one-a');
    assert.equal(stillTarget.body, null, 'the target is untouched when the carry-over is refused');
  });
});

test('carrying over a block with no body is refused', async () => {
  await withEdition(async ({ desk, page1 }) => {
    const result = await desk.json(`/api/pages/${page1.id}/sections/anchor/carry-over`, {
      method: 'POST', body: JSON.stringify({}),
    });
    assert.ok(result.error);
  });
});

test('reunite() undoes a carry-over, restoring the body to one piece and emptying the continuation', async () => {
  await withEdition(async ({ desk, page1, page2 }) => {
    await desk.json(`/api/pages/${page1.id}/sections/anchor`, {
      method: 'PUT',
      body: JSON.stringify({ headline: 'लांब बातमी', body: LONG_BODY }),
    });
    const carried = await desk.json(`/api/pages/${page1.id}/sections/anchor/carry-over`, {
      method: 'POST', body: JSON.stringify({}),
    });
    assert.equal(carried.ok, true);

    const reunited = await desk.json(`/api/pages/${page1.id}/sections/anchor/reunite`, { method: 'POST' });
    assert.equal(reunited.ok, true);
    assert.equal(reunited.reunited, 1);

    const source = (await desk.json(`/api/newspapers/${page1.newspaper_id}/pages`))
      .find((p) => p.id === page1.id).sections.find((s) => s.section_key === 'anchor');
    assert.ok(!source.body.includes('उर्वरित पान'), 'the jump line is gone once reunited');

    const target = (await desk.json(`/api/newspapers/${page1.newspaper_id}/pages`))
      .find((p) => p.id === carried.to.pageId).sections.find((s) => s.section_key === carried.to.sectionKey);
    assert.equal(target.body, null, 'the continuation block is empty again');
    assert.equal(target.headline, null);
  });
});
