/**
 * A BLOCK'S COPY LIVED IN ONE PLACE, AND THAT PLACE WAS A TAB.
 *
 * The workspace's draft is a JavaScript object. Autosave debounces one second,
 * retries twice, and then gives up with a sentence in the corner - and at no
 * point between the keystroke and the server acknowledging it does the copy
 * exist anywhere a crash, a closed tab or a lost connection cannot take it.
 * There was no `beforeunload`, no journal and no local copy anywhere in the
 * workspace; only the reporter's own form had an unload guard.
 *
 * This is the journal. It is deliberately small and deliberately dumb:
 *
 *   * It is written on a THROTTLE, not on every keystroke. The typing path in
 *     this product already runs the compositor; adding a synchronous
 *     localStorage write per character to it would be paying for this in the
 *     one place a desk would feel it. Two seconds bounds what a crash can take
 *     to about a sentence, at one small write per two seconds of typing.
 *   * Every write is wrapped. A full quota, a private window, a browser set to
 *     block site data - all of them throw on `setItem`, and not one of them is
 *     a reason for a keystroke to fail. A journal that cannot be written is a
 *     journal that is not there, which is exactly where this started.
 *   * It is BOUNDED. Oldest entries are dropped past MAX_ENTRIES, and anything
 *     older than MAX_AGE_MS is dropped on sight, so a desk that never comes
 *     back to a block cannot fill the origin's storage with it.
 *
 * WHAT IT NEVER DOES IS RESTORE BY ITSELF. An entry is the browser's copy of
 * something the server may since have been told by someone else - and this
 * codebase's own rule is that software does not silently overwrite a decision
 * a person made. So `pendingFor()` reports, the workspace offers, and a person
 * presses it. Restoring puts the words into the draft, where Ctrl+Z still
 * reaches them; it never writes to the database on its own.
 *
 * localStorage rather than IndexedDB on purpose: `beforeunload` cannot await
 * anything, so the one moment this most needs to write is the one moment an
 * asynchronous store is no use.
 */

// WHEN THIS PAGE LOADED.
//
// An entry written during THIS session is not orphaned work - it is the block
// the desk has open, which autosave is still trying to save and whose failure
// they are already being told about in the corner. Offering to "restore" it
// would be the software interrupting a desk to hand them back what they are
// currently typing.
//
// The journal is the net under a CRASH: a tab that closed, a browser that
// died, a machine that lost power. What distinguishes that is precisely that
// the entry predates the page now asking. So the offer is scoped to entries
// older than this page load, and everything written since is left to autosave,
// where it belongs.
const SESSION_START = Date.now();

const PREFIX = 'sahas.draft.';
const MAX_ENTRIES = 40;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const THROTTLE_MS = 2000;

let lastWriteAt = 0;

function keyFor(pageId, sectionKey) {
  return `${PREFIX}${pageId}.${sectionKey}`;
}

/** Every key this module owns, newest first, with expired ones already gone. */
function entries() {
  const found = [];
  let store;
  try {
    store = window.localStorage;
    if (!store) return [];
  } catch {
    return [];
  }
  const stale = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
    try {
      const entry = JSON.parse(store.getItem(key));
      if (!entry || typeof entry.at !== 'number') { stale.push(key); continue; }
      if (Date.now() - entry.at > MAX_AGE_MS) { stale.push(key); continue; }
      found.push({ key, ...entry });
    } catch {
      // Unparseable is indistinguishable from absent, and keeping it would
      // make this list wrong for ever.
      stale.push(key);
    }
  }
  for (const key of stale) { try { store.removeItem(key); } catch { /* nothing to do */ } }
  found.sort((a, b) => b.at - a.at);
  // Past the cap the OLDEST go, because the newest is the one somebody is
  // most likely still to want.
  for (const extra of found.slice(MAX_ENTRIES)) {
    try { store.removeItem(extra.key); } catch { /* nothing to do */ }
  }
  return found.slice(0, MAX_ENTRIES);
}

/**
 * Write the snapshot down. `force` skips the throttle and is what the unload
 * guard uses - that moment is the whole reason this exists, and it happens
 * once.
 */
// `snapshot` may be a FUNCTION, and on the typing path it must be.
//
// The throttle is what keeps this cheap, and a caller that builds the snapshot
// before calling was paying for it on every keystroke and then having it
// thrown away - captureDraft() runs payloadFromDraft AND a deep clone, on the
// one path where the compositor is already running per character. Passing a
// thunk means the throttle is checked first and the work is only done on the
// write that actually happens.
export function remember(snapshot, { force = false, unlessNewerThan = Infinity } = {}) {
  const now = Date.now();
  if (!force && now - lastWriteAt < THROTTLE_MS) return;
  if (typeof snapshot === 'function') snapshot = snapshot();
  if (!snapshot || !snapshot.pageId || !snapshot.sectionKey || !snapshot.draft) return;
  lastWriteAt = now;
  try {
    const existing = window.localStorage.getItem(keyFor(snapshot.pageId, snapshot.sectionKey));
    if (existing && Number.isFinite(unlessNewerThan)) {
      try {
        if (JSON.parse(existing)?.at >= unlessNewerThan) return;
      } catch { /* replace an unreadable recovery entry */ }
    }
    window.localStorage.setItem(
      keyFor(snapshot.pageId, snapshot.sectionKey),
      JSON.stringify({
        pageId: snapshot.pageId,
        sectionKey: snapshot.sectionKey,
        draft: snapshot.draft,
        at: now,
      }),
    );
  } catch {
    // A quota that is full, a private window, site data blocked. Typing does
    // not fail because the journal could not be kept.
  }
}

/** The server has it. The browser's copy is no longer worth anything. */
export function forget(pageId, sectionKey, { through = Infinity } = {}) {
  try {
    const key = keyFor(pageId, sectionKey);
    const entry = JSON.parse(window.localStorage.getItem(key));
    // A late receipt cannot erase a newer recovery copy. Equality is kept
    // too: a keystroke can share the capture's millisecond timestamp.
    if (entry && entry.at >= through) return;
    window.localStorage.removeItem(key);
  } catch { /* nothing to do */ }
}

/**
 * Entries for the pages of the edition being opened. Scoped to the edition so
 * a desk is never asked about a block belonging to a paper they are not
 * looking at.
 */
export function pendingFor(pageIds) {
  const wanted = new Set((pageIds || []).map(Number));
  return entries().filter((entry) => wanted.has(Number(entry.pageId))
    && entry.at < SESSION_START);
}

/** Used by the offer, to say what is in an entry without restoring it. */
export function describe(entry) {
  const words = String(entry?.draft?.body || '').trim();
  const headline = String(entry?.draft?.headline || '').trim();
  if (headline) return headline;
  if (words) return `${words.slice(0, 60)}${words.length > 60 ? '…' : ''}`;
  return entry?.sectionKey || 'a block';
}
