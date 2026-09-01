/**
 * WHAT A LIST SAYS WHEN IT HAS NOTHING TO SHOW.
 *
 * Every list in this product could already say something - `No edition matches
 * that.`, `No stories match these filters.` - and every one of them said it in
 * `.muted` grey, in the body size, with no way out of the state it was
 * describing. So a desk who mistyped a search saw the list silently empty and
 * a sentence quieter than the sentence above it.
 *
 * Two things this adds, and they are the two a person actually needs:
 *
 *   * the sentence is READ AS a state rather than as a row - it sits in its
 *     own bordered field, centred, with the reason above the remedy;
 *   * where the desk did something to cause it (typed a search, chose a
 *     filter) it carries the way BACK. An empty list with no way out is a
 *     dead end a desk has to guess their way out of.
 *
 * It is markup rather than a component because every one of these lists paints
 * itself with `innerHTML`, and handing them a node would mean rewriting five
 * render paths to accept one.
 */

function escape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/**
 * `action` is `{ label, attr }` - `attr` being the data attribute the caller
 * already binds its own handlers with, so this introduces no second event
 * convention.
 */
export function emptyStateMarkup({ title, body = "", action = null } = {}) {
  return `<div class="empty-state">
    <p class="empty-state-title">${escape(title)}</p>
    ${body ? `<p class="empty-state-body">${escape(body)}</p>` : ""}
    ${action ? `<button type="button" class="empty-state-btn" ${action.attr}>${escape(action.label)}</button>` : ""}
  </div>`;
}
