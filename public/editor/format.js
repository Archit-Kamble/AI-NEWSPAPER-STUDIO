/*
 * ONE VOCABULARY FOR SAYING WHEN.
 *
 * Six of them were on screen at once, and two were in the workspace together,
 * one 500 px below the other:
 *
 *     2026-09-01              13 strings   edition rows, settings
 *     in 26785 days           12           edition rows
 *     १ सप्टेंबर २०२६           8           edition rows, the masthead line
 *     9/1/2026                 2           reporter cards
 *     9/1/2026, 3:16:43 AM     2           the Block Editor's Saved stamp
 *     08:20:06 AM              2           the history timeline
 *
 * Two things are wrong with the pair in the workspace beyond their disagreeing
 * with each other. M/D/YYYY is the wrong order for this newsroom - the audit
 * found it on the reporter's cards too, where the screen carries no English at
 * all. And SECOND precision on an action performed hundreds of times a day is
 * noise: what a desk reads a Saved stamp for is "is my work in", which is a
 * question about minutes.
 *
 * The desk chrome is English, so these are English forms; the Marathi date is
 * the masthead's and stays exactly as it is (marathiDate in admin/editions.js,
 * reporterDate for the reporter's own screens).
 */

const TIME = { hour: "2-digit", minute: "2-digit", hour12: false };
const DAY = { day: "numeric", month: "short" };

export function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

/**
 * A stamp on something that just happened. Today it is a time, because that is
 * the only part that carries information; any other day it is the day and the
 * time, because then the day does.
 */
export function deskStamp(value) {
  if (!value) return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "—";
  const now = new Date();
  const sameDay = at.getFullYear() === now.getFullYear()
    && at.getMonth() === now.getMonth()
    && at.getDate() === now.getDate();
  const time = new Intl.DateTimeFormat("en-GB", TIME).format(at);
  return sameDay ? time : `${new Intl.DateTimeFormat("en-GB", DAY).format(at)}, ${time}`;
}

const ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ESCAPE_MAP[char]);
}

// A panel appended to document.body (worklist, preflight, bulk-generate) is a
// dialog in everything but name, and a desk expects Escape to close one same
// as its own × button. The listener is document-level and outlives the panel
// unless removed, so the returned close() takes both down together - callers
// bind it to their own close button instead of calling onClose directly.
export function closeOnEscape(onClose) {
  const handler = (event) => {
    if (event.key === "Escape") close();
  };
  const close = () => {
    document.removeEventListener("keydown", handler);
    onClose();
  };
  document.addEventListener("keydown", handler);
  return close;
}

/**
 * A WORKSPACE PANEL IS A DIALOG IN EVERYTHING BUT NAME, SO IT SAYS SO.
 *
 * Driven at 1280x800 - opened each, pressed Escape, clicked the backdrop, and
 * checked where the focus went:
 *
 *                     focusables   role / aria-modal   Escape   focus back
 *   What's left            1         none / none         yes       yes
 *   Preflight              9         none / none         yes       yes
 *   Write empty blocks    63         none / none         yes       yes
 *
 * Escape and focus-restore are the hard half and were already right. What was
 * missing is the half that costs nothing: no `role`, no `aria-modal`, and on
 * What's left no title at all - so a screen reader was never told a dialog
 * opened, and announced an unnamed region.
 *
 * `aria-modal="false"` is the honest value and deliberate: these panels sit
 * OVER the workspace without taking it away - the desk can still reach the
 * page underneath, which is the whole point of a product where everything
 * happens inside one screen. Claiming modality would be a promise the panel
 * does not keep.
 *
 * Called AFTER the panel's markup is written, because it names the panel from
 * the heading the panel itself put there.
 */
export function nameThePanel(panel) {
  if (!panel) return;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  const title = panel.querySelector("header strong, header h2, header h3");
  if (!title) return;
  if (!title.id) title.id = `${panel.id || "panel"}Title`;
  panel.setAttribute("aria-labelledby", title.id);
}
