/**
 * WHAT THE PRODUCT SHOWS WHILE IT IS WORKING.
 *
 * Searched, before this file existed: no spinner, no skeleton, no `aria-busy`,
 * no `<progress>` anywhere in the product. Two `@keyframes` in six thousand
 * lines of CSS, neither of them a loading state.
 *
 * The measurement that made the case. Holding the pages API at 3s and pressing
 * Open on an edition, frame by frame from the click:
 *
 *     0.08s   editions list, no busy state, no notice, cursor `auto`
 *     1.70s   unchanged
 *     2.91s   unchanged
 *     3.81s   the workspace, complete, all 17 blocks at once
 *
 * The button is never disabled and the cursor never changes, so for three
 * seconds the application looks like it ignored the click - on the commonest
 * action in the product. A desk presses it again.
 *
 * Two things, and deliberately only two:
 *
 *   * `busyButton` - the control says it is working and cannot be pressed
 *     twice. Preflight, What's left and Fill features all reported
 *     `disabled: false` for the whole of their run.
 *   * `busyRegion` - the part of the screen that is about to be replaced says
 *     so, for work with no single button behind it.
 *
 * There is no global spinner and there should not be. This product's own
 * `showNotice` already says what STARTED ("Checking the edition…" at 12ms);
 * what was missing is anything saying it is STILL GOING, next to the thing
 * that will change.
 */

/**
 * Runs `work` with the button held busy, and always gives it back - including
 * when `work` throws, which is the case that otherwise leaves a desk with a
 * control that is disabled forever.
 *
 * The label is replaced rather than decorated so the button's own width does
 * not jump: "Preflight" becoming "Checking…" is one word for another.
 */
export async function busyButton(button, label, work) {
  if (!button) return work();
  const wasLabel = button.textContent;
  const wasWidth = button.getBoundingClientRect().width;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.classList.add("is-busy");
  // Holding the measured width stops a row of controls reflowing under the
  // pointer while one of them is working - the fault this codebase already
  // fixed once, for a device bar whose contents change as a desk works.
  if (wasWidth > 0) button.style.minWidth = `${Math.round(wasWidth)}px`;
  if (label) button.textContent = label;
  try {
    return await work();
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.classList.remove("is-busy");
    button.style.minWidth = "";
    if (label) button.textContent = wasLabel;
  }
}

/**
 * Marks a region as being rebuilt. Returns the function that releases it, so
 * the caller cannot forget which element it claimed.
 *
 * `aria-busy` is the whole of the accessibility contract here: a screen reader
 * is told not to announce a half-built region, and told again when it settles.
 */
export function busyRegion(host, { skeleton = true } = {}) {
  if (!host) return () => {};
  host.setAttribute("aria-busy", "true");
  if (skeleton) host.classList.add("is-loading");
  return () => {
    host.removeAttribute("aria-busy");
    host.classList.remove("is-loading");
  };
}

/**
 * The same, around one promise, for a caller that has nothing to release by
 * hand. Returns whatever the work returned.
 */
export async function whileBusy(host, work, options) {
  const release = busyRegion(host, options);
  try {
    return await work();
  } finally {
    release();
  }
}
