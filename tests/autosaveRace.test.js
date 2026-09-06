const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

let runId = 0;
const load = (name) => import(`${pathToFileURL(path.join(__dirname, '../public/editor', name))}?race=${++runId}`);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

async function workspace() {
  const store = await load('store.js');
  const history = await load('history/history.js');
  const { draftFromSection, payloadFromDraft } = await load('section-model.js');
  const section = { section_key: 'lead', revision: 1, body: 'Original', width_px: 268, height_px: 248 };
  const page = { id: 1, sections: [section, { ...section, section_key: 'second-lead' }] };
  store.setEdition({ newspaper: { id: 1 }, pages: [page], reporterNews: [] });
  const draft = draftFromSection(section);
  store.setSelectedSection('lead', draft);
  history.reset(draft);
  const entries = new Map();
  const journal = {
    remember(value, { unlessNewerThan } = {}) {
      const snapshot = typeof value === 'function' ? value() : value;
      if (unlessNewerThan !== undefined && entries.has(snapshot?.sectionKey)) return;
      if (snapshot) entries.set(snapshot.sectionKey, JSON.parse(JSON.stringify(snapshot.draft)));
    },
    forget(pageId, key) { entries.delete(key); },
  };
  const response = deferred();
  let scheduled = 0;
  const context = {
    store, history, payloadFromDraft, journal,
    autosave: { schedule() { scheduled++; } },
    fetch: () => response.promise,
  };
  // Exercise the actual workspace save callbacks without loading the DOM and
  // its editor dependencies. The store, draft translation and history are real.
  const source = fs.readFileSync(path.join(__dirname, '../public/editor/workspace.js'), 'utf8');
  const callbacks = source.slice(source.indexOf('function captureDraft()'), source.indexOf('async function saveNow()'));
  const api = vm.runInNewContext(`${callbacks}\n({ captureDraft, persistDraft, onAutosaveState })`, context);
  const selectionFunctions = ['selectSection', 'selectPage'].map((name) => {
    const start = source.indexOf(`async function ${name}(`);
    assert.ok(start >= 0, `${name} must wait for the save before replacing the draft`);
    return source.slice(start, source.indexOf('\n}', start) + 2);
  }).join('\n');
  const noop = () => {};
  const selection = vm.runInNewContext(`${selectionFunctions}\n({ selectSection, selectPage })`, {
    ...context, captureDraft: api.captureDraft, draftFromSection, selectionRequest: 0,
    autosave: { flush: () => response.promise },
    selectPart: noop, refreshSelection: noop, renderMiniMap: noop,
    renderSidePanels: noop, loadSectionImages: noop, syncRemoveBlockButton: noop,
    syncReuniteButton: noop, refreshToolbarSelection: noop,
  });
  const unload = source.slice(source.indexOf('function onWorkspaceBeforeUnload('), source.indexOf('function armUnsavedGuard()'));
  const onUnload = (outstanding) => vm.runInNewContext(`${callbacks}\n${unload}\nonWorkspaceBeforeUnload`, {
    ...context, autosave: { isOutstanding: () => true, outstandingSnapshot: () => outstanding },
  })({ preventDefault() {} });
  const edit = (body) => {
    store.updateDraft({ body });
    history.record(store.getDraft(), { coalesce: false });
    journal.remember(api.captureDraft());
  };
  return {
    ...api, ...selection, store, history, entries, edit, onUnload,
    scheduled: () => scheduled,
    finish: () => response.resolve({ ok: true, status: 200, json: async () => ({ ...page, sections: [{ ...section, revision: 2 }] }) }),
  };
}

test('an old save response cannot acknowledge newer typing in the same block', async () => {
  const w = await workspace();
  w.edit('First version');
  const snapshot = w.captureDraft();
  const saving = w.persistDraft(snapshot);
  w.edit('First version plus the new sentence');
  w.finish();
  await saving;
  w.onAutosaveState('saved', undefined, snapshot);
  assert.equal(w.store.isDirty(), true, 'the new sentence has not reached the server');
  assert.equal(w.history.timeline().at(-1).saved, false, 'do not stamp the new undo entry saved');
  assert.equal(w.entries.get('lead')?.body, 'First version plus the new sentence', 'keep the latest recovery copy');
  assert.ok(w.scheduled() > 0, 'the newer draft must still get a save');
});

test('changing blocks keeps the old draft selected until its save finishes', async () => {
  const w = await workspace();
  w.edit('Unsaved old block');
  const changing = w.selectSection('second-lead');
  assert.equal(w.store.getState().selectedSectionKey, 'lead');
  assert.equal(w.entries.get('lead').body, 'Unsaved old block');
  w.finish();
  await changing;
  assert.equal(w.store.getState().selectedSectionKey, 'second-lead');
});

test('changing pages keeps the old page selected until its save finishes', async () => {
  const w = await workspace();
  w.edit('Unsaved old page');
  const changing = w.selectPage(2);
  assert.equal(w.store.getState().currentPageId, 1);
  w.finish();
  await changing;
  assert.equal(w.store.getState().currentPageId, 2);
});

test('the last block click wins while an earlier selection is waiting for a save', async () => {
  const w = await workspace();
  w.edit('Saving');
  const earlier = w.selectSection('second-lead');
  await w.selectSection('lead');
  w.finish();
  assert.equal(await earlier, false);
  assert.equal(w.store.getState().selectedSectionKey, 'lead');
});

test('snapshot recovery copy does not change when a draft array is edited', async () => {
  const w = await workspace();
  w.store.updateDraft({ tags: ['first'] });
  const snapshot = w.captureDraft();
  w.store.getDraft().tags.push('second');
  assert.deepEqual(Array.from(snapshot.draft.tags), ['first']);
});

test('leaving journals the latest typing, not only the older in-flight request', async () => {
  const w = await workspace();
  w.edit('In flight');
  const snapshot = w.captureDraft();
  w.edit('Latest typing');
  w.onUnload(snapshot);
  assert.equal(w.entries.get('lead').body, 'Latest typing');
  w.store.setSelectedSection('second-lead', { ...w.store.getDraft(), body: 'Block B' });
  w.edit('Unsaved B');
  w.onUnload(snapshot);
  assert.equal(w.entries.get('lead').body, 'Latest typing', 'do not overwrite a newer recovery copy of the previous block');
  assert.equal(w.entries.get('second-lead').body, 'Unsaved B');
});

test('retry sends the failed snapshot, then a fresh flush captures the latest draft', async () => {
  const autosave = await load('autosave/autosave.js');
  let body = 'failed snapshot';
  const sent = [];
  autosave.configure({
    capture: () => ({ body }),
    save: async (snapshot) => {
      sent.push(snapshot.body);
      return sent.length !== 1;
    },
  });
  try {
    await autosave.flush();
    assert.equal(autosave.isOutstanding(), true);
    body = 'latest draft';
    await autosave.flush();
    await autosave.flush();
    assert.deepEqual(sent, ['failed snapshot', 'failed snapshot', 'latest draft']);
    assert.equal(autosave.isOutstanding(), false);
  } finally {
    autosave.cancel();
    autosave.discardOutstanding();
  }
});

test('a late receipt only clears journal entries older than its snapshot', () => {
  const entries = new Map();
  const storage = {
    setItem: (key, value) => entries.set(key, value),
    getItem: (key) => entries.get(key) ?? null,
    removeItem: (key) => entries.delete(key),
  };
  let now = 1000;
  const source = fs.readFileSync(path.join(__dirname, '../public/editor/autosave/draft-journal.js'), 'utf8');
  const journal = vm.runInNewContext(`${source.replace(/export function /g, 'function ')}\n({ remember, forget })`, {
    window: { localStorage: storage }, Date: { now: () => now },
  });
  const snapshot = { pageId: 1, sectionKey: 'lead', draft: { body: 'latest' } };
  journal.remember(snapshot, { force: true });
  journal.remember({ ...snapshot, draft: { body: 'older in-flight copy' } }, { force: true, unlessNewerThan: 999 });
  assert.equal(JSON.parse(entries.values().next().value).draft.body, 'latest');
  journal.forget(1, 'lead', { through: 999 });
  assert.equal(entries.size, 1, 'newer typing is kept');
  journal.forget(1, 'lead', { through: 1000 });
  assert.equal(entries.size, 1, 'a shared timestamp is kept conservatively');
  journal.forget(1, 'lead', { through: 1001 });
  assert.equal(entries.size, 0, 'an older recovery entry is retired');
  now = 2000;
  journal.remember(snapshot, { force: true });
  journal.forget(1, 'lead');
  assert.equal(entries.size, 0, 'an exact acknowledgment or explicit discard still clears it');
});

test('a response for a different block cannot clear the selected block dirty flag', async () => {
  const w = await workspace();
  w.edit('Block A');
  const snapshot = w.captureDraft();
  const saving = w.persistDraft(snapshot);
  w.store.setSelectedSection('second-lead', { ...w.store.getDraft(), body: 'Block B' });
  w.edit('Unsaved block B');
  w.finish();
  await saving;
  w.onAutosaveState('saved', undefined, snapshot);
  assert.equal(w.store.isDirty(), true);
  assert.equal(w.entries.get('second-lead')?.body, 'Unsaved block B');
});

test('an unchanged acknowledged draft is saved and its journal entry is cleared', async () => {
  const w = await workspace();
  w.edit('Ready');
  const snapshot = w.captureDraft();
  const saving = w.persistDraft(snapshot);
  w.finish();
  await saving;
  w.onAutosaveState('saved', undefined, snapshot);
  assert.equal(w.store.isDirty(), false);
  assert.equal(w.history.timeline().at(-1).saved, true);
  assert.equal(w.entries.has('lead'), false);
  assert.equal(w.scheduled(), 0);
});

test('flush waits for an in-flight save and sends the latest draft before returning', async () => {
  const autosave = await load('autosave/autosave.js');
  const gate = deferred();
  let body = 'first';
  const sent = [];
  autosave.configure({
    capture: () => ({ body }),
    save: async (snapshot) => {
      sent.push(snapshot.body);
      if (sent.length === 1) await gate.promise;
      return true;
    },
  });
  const first = autosave.flush();
  body = 'latest';
  let returned = false;
  const second = autosave.flush().then(() => { returned = true; });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(returned, false, 'navigation must wait while its current block is saving');
    gate.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(sent, ['first', 'latest']);
    assert.equal(autosave.isOutstanding(), false);
  } finally {
    gate.resolve();
    await Promise.all([first, second]);
    autosave.cancel();
    autosave.discardOutstanding();
  }
});

// A SAVE THAT NEVER ANSWERS MAY NOT FREEZE THE DESK.
//
// Selecting a block and turning a page both await flush(), so an unbounded
// wait turns one unanswered request into an editor that ignores clicks - no
// error, nothing on screen, because the save has not failed yet, it simply
// has not come back. The wait is therefore bounded: the save carries on, the
// draft is already in the recovery journal, and the late-answer guard above
// stops that response speaking for whatever the desk has open by then.
//
// Driven on fake timers so the test does not actually wait five seconds.
test('flush gives up waiting on a request that never answers, and the save lives on', async () => {
  const autosave = await load('autosave/autosave.js');
  const never = new Promise(() => {});
  let settled = false;
  let calls = 0;
  autosave.configure({
    capture: () => ({ body: 'held' }),
    save: async () => { calls += 1; await never; return true; },
  });
  const realSetTimeout = globalThis.setTimeout;
  const pending = [];
  globalThis.setTimeout = (fn, ms) => { pending.push({ fn, ms }); return pending.length; };
  try {
    const flushed = autosave.flush().then(() => { settled = true; });
    await new Promise((resolve) => realSetTimeout(resolve, 0));
    assert.equal(calls, 1, 'the save was actually sent');
    assert.equal(settled, false, 'and flush is still waiting for it');

    // Fire the bound the way the clock would.
    const bound = pending.find((t) => t.ms === 5000);
    assert.ok(bound, 'flush arms a bounded wait rather than waiting forever');
    bound.fn();
    await flushed;
    assert.equal(settled, true, 'the gesture is released while the request is still open');
    assert.equal(calls, 1, 'and the unanswered save was not sent a second time');
  } finally {
    globalThis.setTimeout = realSetTimeout;
    autosave.cancel();
    autosave.discardOutstanding();
  }
});
