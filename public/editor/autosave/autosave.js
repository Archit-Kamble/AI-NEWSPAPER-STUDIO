// Phase 7: debounced autosave with a retry on failure.
//
// The workspace owns the actual PUT (it is the only module that talks to the
// section API); this module owns *when* that happens and how failure is
// reported, so the timing policy lives in one place instead of being sprinkled
// through input handlers.
//
// A RETRY SAVED WHATEVER WAS OPEN WHEN IT FIRED, NOT WHAT FAILED.
//
// `run()` used to call a zero-argument `saveFn()` that reached into the store
// for the current page, the current block and the current draft. That is
// correct for the first attempt and wrong for every retry, because a retry
// happens 1.5 or 4 seconds later and the desk has moved on. Reproduced
// deterministically: block A's save fails, the desk selects block B, and the
// retry writes block B - so A's copy is silently dropped and B is written
// twice, once with A's own revision expectations.
//
// The fix is that a save is OF something. `capture()` takes an immutable
// snapshot - which page, which block, and the payload as it stood - at the
// moment the attempt begins, and every retry of that attempt re-sends THAT
// snapshot. Nothing here asks the store what is current; it cannot, because it
// is not given a way to.
//
// The same shape closes the other half: a late answer must not mark a NEWER
// draft as saved. The snapshot travels back out to the workspace's save
// function, which compares it against what is selected now before it touches
// the history or the dirty flag.

const DEBOUNCE_MS = 1000;
const RETRY_DELAYS_MS = [1500, 4000];

let timer = null;
let inFlight = false;
let running = null;
let pendingWhileInFlight = false;
let retryIndex = 0;
let saveFn = null;
let captureFn = null;
let onState = null;
// The snapshot an in-progress attempt is retrying. Null between attempts, so a
// fresh attempt always captures fresh.
let attempt = null;

export function configure({ save, capture, onStateChange }) {
  saveFn = save;
  captureFn = capture;
  onState = onStateChange;
}

// Whether anything is still on its way to the database - a save in flight, a
// retry waiting, or a debounce that has not fired. The unload guard asks this;
// it is the honest answer to "is there work that has not reached the server".
export function isOutstanding() {
  return Boolean(inFlight || attempt || timer);
}

// The snapshot a failed attempt is still holding, so a caller that wants to
// journal or report unsaved work can see WHAT is unsaved rather than only
// that something is.
export function outstandingSnapshot() {
  return attempt;
}

export function schedule() {
  if (!saveFn) return;
  clearTimeout(timer);
  timer = setTimeout(run, DEBOUNCE_MS);
}

export function cancel() {
  clearTimeout(timer);
  timer = null;
}

// Give up on the snapshot a failed attempt is holding. Used when the thing it
// describes no longer exists - the block was deleted, or the edition closed -
// so `isOutstanding()` cannot go on reporting work that can never land.
export function discardOutstanding() {
  attempt = null;
  retryIndex = 0;
}

// Save immediately - used by the explicit Save buttons and when leaving a
// section, where waiting out the debounce would lose the edit.
export async function flush() {
  cancel();
  // A navigation awaits flush to keep the selected draft alive. Returning
  // while another request is running would let it switch blocks before the
  // final keystrokes are captured. Drain that request, then save the latest.
  if (inFlight) {
    await bounded(running);
    cancel();
  }
  await bounded(run());
}

// BUT THE WAIT IS BOUNDED, BECAUSE A CLICK MAY NOT HANG ON A REQUEST.
//
// Selecting a block and turning a page both await flush() now, so an
// unbounded wait makes an unanswered save freeze the gesture: the desk clicks
// a block and nothing happens, with no error, because there is nothing to
// report yet. A FAILED save settles immediately - the catch below swallows it
// and schedules the retry - so this only ever bounds a request that has not
// answered at all.
//
// Giving up the wait costs nothing that matters: the caller has already
// written the draft to the recovery journal, the snapshot the save is holding
// is immutable, and the late-answer guard refuses to let that response speak
// for whatever the desk has open by the time it lands. So the save carries on
// in the background and the desk carries on working.
const FLUSH_WAIT_MS = 5000;
function bounded(promise) {
  if (!promise || typeof promise.then !== "function") return Promise.resolve();
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, FLUSH_WAIT_MS))]);
}

function run() {
  // AN EXPIRED TIMEOUT IS NOT OUTSTANDING WORK.
  //
  // `schedule()` stores the debounce's id in `timer` and nothing ever cleared
  // it once that timeout FIRED - so from the first autosave onwards `timer`
  // held a dead id for the life of the workspace, and `isOutstanding()` was
  // permanently true. Two things read it: the unload guard, which would have
  // asked EVERY desk to confirm leaving EVERY time they navigated; and the
  // draft journal's forced write, which then left a recovery entry for a
  // block that was safely saved, offered back on the next open as a modal
  // over the canvas.
  //
  // Cleared here rather than in schedule(): if run() is executing then the
  // debounce has fired - even when a previous request is still running - so
  // at this instant nothing is scheduled. The retry branch sets it again,
  // which is a real pending save.
  timer = null;
  if (!saveFn) return;
  if (inFlight) {
    pendingWhileInFlight = true;
    return running;
  }
  running = saveAttempt();
  return running;
}

async function saveAttempt() {

  // A retry re-sends the snapshot that failed. Only a FRESH attempt asks what
  // there is to save, and it asks exactly once.
  if (!attempt) attempt = captureFn ? captureFn() : null;
  // Nothing selected, or nothing to write. Not a failure - there is simply no
  // save to make - so the indicator is left alone rather than saying "saved"
  // about a save that never happened.
  if (!attempt) {
    clearTimeout(timer);
    timer = null;
    return;
  }

  const sending = attempt;
  inFlight = true;
  onState?.("saving");
  try {
    const ok = await saveFn(sending);
    if (!ok) throw new Error("Save rejected");
    retryIndex = 0;
    attempt = null;
    onState?.("saved", undefined, sending);
  } catch (error) {
    if (retryIndex < RETRY_DELAYS_MS.length) {
      const delay = RETRY_DELAYS_MS[retryIndex];
      retryIndex += 1;
      onState?.("error", `Save failed, retrying in ${Math.round(delay / 1000)}s`);
      clearTimeout(timer);
      // `attempt` is deliberately KEPT, so the retry below re-sends this exact
      // block rather than whatever the desk has open by then.
      timer = setTimeout(run, delay);
    } else {
      retryIndex = 0;
      // The attempt is kept here too. The copy is still only in the browser,
      // and the desk is about to be told so; dropping the snapshot would throw
      // away the one record of what did not reach the database.
      onState?.("error", "Save failed. Use Save to try again.");
    }
  } finally {
    inFlight = false;
    if (pendingWhileInFlight) {
      pendingWhileInFlight = false;
      schedule();
    }
  }
}
