// Editor and canvas must never disagree about what a block says.
//
// The architecture is already right: one draft in the store, a DRAFT event, and
// a targeted repaint of the one block that changed. What was missing was the
// other half - PAGE_SYNC, the event a SAVE raises, refreshed the page
// navigator, the minimap, the layout picker and the saved-at time, and did not
// refresh the blocks themselves.
//
// That hid itself well. After an ordinary save the canvas looked right, because
// the last keystroke had already painted it. It was only wrong when the fresher
// rows carried something the canvas had never been told: Make it fit changing
// type sizes, Carry over moving copy onto a second block, Fill features writing
// a dozen blocks at once.
//
// These tests cover the two halves that can be checked without a browser: the
// precedence rule the canvas paints by (draft over row, for the selected block
// only), and the round trip through the API. The repaint itself is checked by
// driving the real workspace - see the regression net.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn } = require('./helpers/desk');

async function withPage(t, name) {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);

  const newspaper = await desk.json('/api/newspapers', {
    method: 'POST',
    body: JSON.stringify({ name, publicationDate: '2099-01-01' }),
  });
  t.after(() => pool.query('DELETE FROM newspapers WHERE id = $1', [newspaper.id]));

  const page = await desk.json(`/api/newspapers/${newspaper.id}/pages`, {
    method: 'POST',
    body: JSON.stringify({ pageNumber: 1, templateKey: 'front' }),
  });
  return { desk, newspaper, page };
}

const HEADLINE = 'शेतकऱ्यांसाठी नवी योजना जाहीर';
const BODY = 'मुंबई : राज्य सरकारने आज शेतकऱ्यांसाठी नवी योजना जाहीर केली.';

// ------------------------------------------------ A. what the canvas paints ---

test('the canvas paints the draft for the selected block and the row for the rest', async () => {
  const store = await import('../public/editor/store.js');
  const { draftFromSection, viewOfSection } = await import('../public/editor/section-model.js');

  const rows = [
    { section_key: 'lead', headline: 'saved headline', body: 'saved body', width_px: 300, height_px: 200 },
    { section_key: 'second', headline: 'other block', body: 'other body', width_px: 300, height_px: 200 },
  ];
  const page = { id: 1, page_number: 1, sections: rows };

  store.setEdition({ newspaper: { id: 1 }, pages: [page], reporterNews: [] });
  store.setSelectedSection('lead', draftFromSection(rows[0]));

  const seen = [];
  store.subscribe(store.TOPICS.DRAFT, (detail) => seen.push(detail));

  store.updateDraft({ headline: HEADLINE }, 'story-editor');
  store.updateDraft({ body: BODY }, 'block-frame');

  assert.equal(seen.length, 2, 'each edit raises exactly one DRAFT event');
  assert.deepEqual(seen[0].changed, ['headline']);
  assert.equal(seen[1].source, 'block-frame', 'the source rides along so a view can ignore its own echo');

  // The selected block paints from the draft...
  const lead = viewOfSection(rows[0], store.getDraft(), 'lead');
  assert.equal(lead.headline, HEADLINE);
  assert.equal(lead.body, BODY);

  // ...and every other block paints from its own row, never from the draft.
  const second = viewOfSection(rows[1], store.getDraft(), 'lead');
  assert.equal(second.headline, 'other block');

  // The row itself is untouched until a save returns. This is what lets a
  // repaint on PAGE_SYNC be safe: the draft is layered over the row, so an
  // autosave landing mid-sentence cannot take the last few characters back off
  // the page.
  assert.equal(rows[0].headline, 'saved headline');
  assert.equal(store.isDirty(), true);
});

test('a save raises PAGE_SYNC, and the merged view still reads the same', async () => {
  const store = await import('../public/editor/store.js');
  const { draftFromSection, viewOfSection } = await import('../public/editor/section-model.js');

  const before = { section_key: 'lead', headline: 'saved headline', body: 'saved body', width_px: 300, height_px: 200 };
  const page = { id: 2, page_number: 1, sections: [before] };

  store.setEdition({ newspaper: { id: 2 }, pages: [page], reporterNews: [] });
  store.setSelectedSection('lead', draftFromSection(before));
  store.updateDraft({ headline: HEADLINE, body: BODY }, 'story-editor');

  let syncs = 0;
  let structural = 0;
  store.subscribe(store.TOPICS.PAGE_SYNC, () => { syncs += 1; });
  store.subscribe(store.TOPICS.PAGE, () => { structural += 1; });

  // What the save endpoint returns: the same layout with fresher rows.
  const after = { ...before, headline: HEADLINE, body: BODY };
  store.replacePage({ id: 2, page_number: 1, sections: [after] });

  assert.equal(syncs, 1, 'a save is a sync');
  assert.equal(structural, 0, 'and never a structural change - that would rebuild the workspace');

  const view = viewOfSection(store.getCurrentPage().sections[0], store.getDraft(), 'lead');
  assert.equal(view.headline, HEADLINE, 'the block still reads what was typed');
  assert.equal(view.body, BODY);
});

// ------------------------------------------------------- B. the round trip ---

test('what is typed is what persists, and what reloads, and what a re-select shows', async (t) => {
  const { desk, page } = await withPage(t, 'ZZ editor canvas sync');

  const saved = await desk.json(`/api/pages/${page.id}/sections/lead`, {
    method: 'PUT',
    body: JSON.stringify({
      headline: HEADLINE,
      subheading: 'राज्य मंत्रिमंडळाचा निर्णय',
      body: BODY,
      bodyFontPx: 11.5,
      textAlign: 'justify',
      status: 'needs_review',
    }),
  });

  // The save returns the whole page, which is what the store swaps in.
  const fromSave = saved.sections.find((s) => s.section_key === 'lead');
  assert.equal(fromSave.headline, HEADLINE);
  assert.equal(fromSave.body, BODY);

  // A reload reads the same thing. Font sizes are NUMERIC(5,1) and arrive as
  // strings, so they are compared as numbers - the editor coerces the same way.
  const [reloaded] = await desk.json(`/api/newspapers/${page.newspaper_id}/pages`);
  const lead = reloaded.sections.find((s) => s.section_key === 'lead');
  assert.equal(lead.headline, HEADLINE);
  assert.equal(lead.subheading, 'राज्य मंत्रिमंडळाचा निर्णय');
  assert.equal(lead.body, BODY);
  assert.equal(Number(lead.body_font_px), 11.5);
  assert.equal(lead.text_align, 'justify');

  // Switching to another block and back is a re-read of the same row: the
  // draft is rebuilt from it, so nothing may have changed on the way.
  const { draftFromSection, payloadFromDraft } = await import('../public/editor/section-model.js');
  const draft = draftFromSection(lead);
  assert.equal(draft.headline, HEADLINE);
  assert.equal(draft.body, BODY);
  assert.equal(draft.bodyFontPx, 11.5);

  // And saving that untouched draft back changes nothing. A field the draft
  // drops on the way through would be silently wiped by the next save of any
  // block - which is the whole reason the three shapes live in one file.
  const again = await desk.json(`/api/pages/${page.id}/sections/lead`, {
    method: 'PUT',
    body: JSON.stringify(payloadFromDraft(draft)),
  });
  const round = again.sections.find((s) => s.section_key === 'lead');
  assert.equal(round.headline, HEADLINE);
  assert.equal(round.subheading, 'राज्य मंत्रिमंडळाचा निर्णय');
  assert.equal(round.body, BODY);
  assert.equal(Number(round.body_font_px), 11.5);
  assert.equal(round.text_align, 'justify');
  assert.equal(round.status, 'needs_review');
});

test('a Smart Card in the draft survives a switch away and back', async (t) => {
  const { desk, page } = await withPage(t, 'ZZ card survives reselect');
  const sudoku = require('../src/features/sudoku');
  const built = await sudoku.build('2031-04-11');

  const { draftFromSection, payloadFromDraft } = await import('../public/editor/section-model.js');

  await desk(`/api/pages/${page.id}/sections/lead`, {
    method: 'PUT',
    body: JSON.stringify({ headline: built.title, smartCardKey: 'sudoku', smartCardData: built.card }),
  });

  const [reloaded] = await desk.json(`/api/newspapers/${page.newspaper_id}/pages`);
  const lead = reloaded.sections.find((s) => s.section_key === 'lead');

  // Selecting the block builds a draft from the row - the card has to come with
  // it, or switching blocks would quietly drop the puzzle on the next save.
  const draft = draftFromSection(lead);
  assert.equal(draft.smartCardKey, 'sudoku');
  assert.deepEqual(draft.smartCardData.grid, built.card.grid);

  const payload = payloadFromDraft(draft);
  assert.equal(payload.smartCardKey, 'sudoku');
  assert.deepEqual(payload.smartCardData.grid, built.card.grid);

  const again = await desk.json(`/api/pages/${page.id}/sections/lead`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  const round = again.sections.find((s) => s.section_key === 'lead');
  assert.deepEqual(round.smart_card_data.grid, built.card.grid, 'square for square, after a full round trip');
});

test('linking a reporter story takes the Smart Card back off the block', async () => {
  const { draftFromStory } = await import('../public/editor/section-model.js');
  const draft = { status: 'empty', smartCardKey: 'sudoku', smartCardData: { grid: [] } };
  const next = draftFromStory(draft, { id: 7, title: 'बातमी', description: 'मजकूर' });

  assert.equal(next.smartCardKey, null, 'a story and a sudoku cannot both print in one block');
  assert.equal(next.smartCardData, null);
  assert.equal(next.headline, 'बातमी');
});
