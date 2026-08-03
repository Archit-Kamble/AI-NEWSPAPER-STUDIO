// Phase 7: debounced autosave with a retry on failure.
//
// The workspace owns the actual PUT (it is the only module that talks to the
// section API); this module owns *when* that happens and how failure is
// reported, so the timing policy lives in one place instead of being sprinkled
// through input handlers.

const DEBOUNCE_MS = 1000;
const RETRY_DELAYS_MS = [1500, 4000];

let timer = null;
let inFlight = false;
let pendingWhileInFlight = false;
let retryIndex = 0;
let saveFn = null;
let onState = null;

export function configure({ save, onStateChange }) {
  saveFn = save;
  onState = onStateChange;
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

// Save immediately - used by the explicit Save buttons and when leaving a
// section, where waiting out the debounce would lose the edit.
export async function flush() {
  cancel();
  await run();
}

async function run() {
  if (!saveFn) return;
  if (inFlight) {
    pendingWhileInFlight = true;
    return;
  }

  inFlight = true;
  onState?.("saving");
  try {
    const ok = await saveFn();
    if (!ok) throw new Error("Save rejected");
    retryIndex = 0;
    onState?.("saved");
  } catch (error) {
    if (retryIndex < RETRY_DELAYS_MS.length) {
      const delay = RETRY_DELAYS_MS[retryIndex];
      retryIndex += 1;
      onState?.("error", `Save failed, retrying in ${Math.round(delay / 1000)}s`);
      clearTimeout(timer);
      timer = setTimeout(run, delay);
    } else {
      retryIndex = 0;
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
