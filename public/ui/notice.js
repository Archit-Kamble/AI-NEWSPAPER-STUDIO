/**
 * WHAT THE SOFTWARE SAYS, AND WHAT IT SAYS WHEN IT FAILS.
 *
 * `showNotice` moved here unchanged. It was already the good half of this
 * product's feedback: viewport-anchored, `role="status"`, `aria-live="polite"`,
 * with a dwell proportional to the sentence, because "Saved" is read in four
 * seconds and "There is no empty block on a later page to carry this into." is
 * not. It lived in `external-editor.js`, which the ADMIN screens have no
 * business importing from, so it lives here and that module re-exports it -
 * one implementation, every existing caller unchanged.
 *
 * `showFailure` is the half that did not exist. Measured by forcing a 500 on
 * the preflight route: the desk was shown the word `boom` - the server's own
 * error field, verbatim - with no Retry, no way to dismiss it and no way to
 * recall it, and it faded to nothing after about five seconds.
 *
 * So the one moment a desk most needs to read something carefully was the one
 * moment the product took it away on a timer. A failure therefore:
 *
 *   * STAYS until it is dismissed. No timer.
 *   * carries Retry when the caller can offer one, because "it failed" without
 *     "here is the way to try again" is half a sentence.
 *   * is `role="alert"`, not `role="status"` - a failure interrupts.
 *
 * It does NOT try to translate the server. `server.js`'s catch-all already
 * decides what a caller may see; this is about whether the desk can act on it.
 */

let notifyTimer = null;

function noticeHost() {
  let host = document.getElementById("deskNotice");
  if (!host) {
    host = document.createElement("div");
    host.id = "deskNotice";
    host.className = "desk-notice";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  return host;
}

/**
 * The answer to something the desk pressed, said next to their eye rather than
 * into the Block Editor's zero-width header strip 600px below the toolbar.
 */
export function showNotice(message) {
  const text = String(message ?? "");
  // The Block Editor's own header line, unchanged - it is that header's status
  // line and belongs there. Nothing depends on it being legible any more.
  const strip = document.getElementById("edNotice");
  if (strip) strip.textContent = text;

  const host = noticeHost();
  host.classList.remove("is-failure");
  host.textContent = text;
  host.classList.toggle("is-shown", Boolean(text));
  clearTimeout(notifyTimer);
  if (!text) return;
  const ms = Math.min(12000, 3500 + text.length * 45);
  notifyTimer = setTimeout(() => {
    if (host.textContent !== text) return;
    host.classList.remove("is-shown");
    if (strip && strip.textContent === text) strip.textContent = "";
  }, ms);
}

/**
 * A failure the desk can act on. `retry` is called when they press Retry; the
 * failure clears first, so a retry that fails again reads as a new failure
 * rather than as the old one never having gone.
 */
export function showFailure(message, { retry = null, retryLabel = "Retry" } = {}) {
  const text = String(message ?? "That did not work.");
  const strip = document.getElementById("edNotice");
  if (strip) strip.textContent = text;

  const host = noticeHost();
  clearTimeout(notifyTimer);
  host.textContent = "";
  host.classList.add("is-shown", "is-failure");
  // A failure interrupts; a status does not. The attribute has to change with
  // the state or a screen reader announces the wrong urgency.
  host.setAttribute("role", "alert");
  host.setAttribute("aria-live", "assertive");

  const line = document.createElement("span");
  line.className = "desk-notice-text";
  line.textContent = text;
  host.append(line);

  const clear = () => {
    host.classList.remove("is-shown", "is-failure");
    host.textContent = "";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    if (strip && strip.textContent === text) strip.textContent = "";
  };

  if (retry) {
    const again = document.createElement("button");
    again.type = "button";
    again.className = "desk-notice-btn";
    again.textContent = retryLabel;
    again.addEventListener("click", () => { clear(); retry(); });
    host.append(again);
  }
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "desk-notice-close";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.textContent = "×";
  dismiss.addEventListener("click", clear);
  host.append(dismiss);
}
