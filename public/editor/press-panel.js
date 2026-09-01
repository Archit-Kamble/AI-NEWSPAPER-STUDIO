// WHERE THE EDITION STANDS, AND PASSING A PAGE FOR PRESS.
//
// `signoff.service.js` has done this properly since it was written: three
// states a page moves through, a refusal to pass one while preflight still
// finds errors on it, and a row in `edition_history` naming who passed what
// and when - because on the day something goes wrong in print the first
// question is always "who passed it", and the answer has to exist.
//
// NOTHING IN THE BROWSER COULD REACH IT. `PATCH /pages/:id/state` appears
// nowhere under public/, and neither does `GET /newspapers/:id/status`, which
// returns the whole per-page picture this panel is made of. So every page in
// this database sits at its `making_up` default, and since pressReadiness
// blocks on PAGE_NOT_PASSED, **the entire press path was unreachable from the
// product**: the press package, the press-final e-paper and the CMYK press
// export are all gated on a readiness no control could ever produce. Measured
// on edition 54470 - four pages, all `making_up`, `readyForPress: false`,
// `waitingOn: [1,2,3,4]`.
//
// `PATCH /pages/:id/colour` is the same story one step along. `prints_colour`
// decides the page's FORME - the compositor greys the photographs on a mono
// page, and `separateToK()` sends its type, tints, rules and charts to one
// plate. It defaults to TRUE, so every page of every edition asks the press
// for four plates, and no control could say otherwise. For a district daily
// that is usually wrong on most of the paper.
//
// Both live here rather than on a toolbar row, and that is deliberate twice
// over. `.canvas-toolbar-row` is `flex-wrap: wrap`, so controls added to it
// become height when the window narrows - CLAUDE.md records a third row
// pushing a picture handle to y=1015, out of the viewport, where it stopped
// being draggable at all. And preflight is the check that GATES passing, so
// the finding and the action belong on one panel: the way out beside the way
// in, which is the rule this product keeps rediscovering.

import { escapeHtml, closeOnEscape, deskStamp, nameThePanel } from "./format.js";

const STATES = [
  { key: "making_up", label: "Being made up" },
  { key: "subbed", label: "Subbed" },
  { key: "passed", label: "Passed for press" },
];

const LABEL = Object.fromEntries(STATES.map((s) => [s.key, s.label]));

function whenPassed(page) {
  if (page.production_state !== "passed" || !page.state_changed_at) return "";
  const at = new Date(page.state_changed_at);
  if (Number.isNaN(at.getTime())) return "";
  const who = page.passed_by ? escapeHtml(String(page.passed_by)) : "the desk";
  return `<small class="press-passed">Passed by ${who}, ${deskStamp(at)}</small>`;
}

/**
 * WHAT STOPS THIS PAGE GOING TO PRESS - all of it, not the preflight errors.
 *
 * The first version of this row disabled "Passed for press" whenever the page
 * carried a preflight error, and that was a guess that is wrong in both
 * directions. Measured on edition 54470: page 2 shows ZERO preflight errors
 * and still cannot be passed - `pressReadiness.assessPage()` also refuses a
 * missing standing feature, an editorial destination with no story in it, and
 * generated copy nobody has reviewed. A control that says a page is ready when
 * the server will refuse it is worse than no control.
 *
 * The real answer is already in the payload: `/status` returns
 * `readiness.blockers`, each carrying the page it belongs to. So the row says
 * what the SERVER says, and nothing is inferred here.
 */
function blockersFor(status, pageNumber) {
  return (status?.readiness?.blockers || [])
    // A blocker with no page is the edition's, not this page's, and
    // PAGE_NOT_PASSED is the thing the desk is about to do - listing it as a
    // reason they cannot do it is a control arguing with itself.
    .filter((b) => Number(b.page) === Number(pageNumber) && b.code !== 'PAGE_NOT_PASSED');
}

function pageRow(page, formeOn, blockers) {
  const state = page.production_state || "making_up";
  const stopped = blockers.length;
  // One line per DISTINCT reason, with a count - four "editorial destination
  // has no story content" is one thing wrong four times, and reading it four
  // times over tells the desk nothing the number does not.
  const reasons = [...blockers.reduce((seen, b) => seen.set(b.message, (seen.get(b.message) || 0) + 1), new Map())]
    .map(([message, n]) => (n > 1 ? `${message} (×${n})` : message));
  return `
    <li class="press-page" data-page-id="${page.id}" data-page-number="${page.page_number}">
      <div class="press-page-head">
        <strong>Page ${page.page_number}</strong>
        <span class="press-state press-state-${state}">${escapeHtml(LABEL[state] || state)}</span>
        ${stopped ? `<span class="press-errors">${stopped} to clear</span>` : ""}
      </div>
      ${whenPassed(page)}
      ${stopped ? `<details class="press-blockers"><summary>What is stopping it</summary><ul>${
        reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")
      }</ul></details>` : ""}
      <div class="press-page-actions">
        <label class="press-state-pick">Stage
          <select data-page-state="${page.id}">
            ${STATES.map((s) => `<option value="${s.key}"${s.key === state ? " selected" : ""}>${s.label}</option>`).join("")}
          </select>
        </label>
        <button type="button" class="press-forme" data-page-colour="${page.id}"
                aria-pressed="${formeOn ? "true" : "false"}"
                title="${formeOn
                  ? "This page is on a colour forme. Press to print it black only."
                  : "This page prints black only. Press to put it on a colour forme."}">${formeOn ? "Colour" : "Mono"}</button>
      </div>
    </li>`;
}

function findingRows(report) {
  if (!report?.findings?.length) return '<li class="press-clean">Preflight found nothing to fix.</li>';
  const order = { error: 0, warning: 1, note: 2 };
  return [...report.findings]
    .sort((a, b) => order[a.level] - order[b.level] || a.pageNumber - b.pageNumber)
    .map((finding) => `
      <li class="preflight-row preflight-${finding.level}"
          data-page="${finding.pageNumber}" data-section="${escapeHtml(finding.sectionKey)}">
        <span class="preflight-where">p${finding.pageNumber} · ${escapeHtml(finding.sectionKey)}</span>
        <span class="preflight-what">${escapeHtml(finding.message)}</span>
      </li>`)
    .join("");
}

function headline(status) {
  if (status?.readyForPress) return "Ready for press";
  const waiting = Array.isArray(status?.waitingOn) ? status.waitingOn : [];
  if (waiting.length) {
    return `Waiting on page${waiting.length === 1 ? "" : "s"} ${waiting.join(", ")}`;
  }
  return "Not ready for press";
}

/**
 * Draws the panel, and keeps drawing it as the desk moves pages through.
 *
 * `report` is the preflight the desk just asked for; `pages` is the store's own
 * page list, which is where `prints_colour` comes from - `/status` does not
 * carry it. `onPagesChanged()` is called after a forme change so the canvas can
 * repaint, because greying a mono page's photographs is what the desk is
 * looking at when they press it.
 */
export async function renderPressPanel(newspaperId, { report, pages, onOpenFinding, onPagesChanged, onNotice }) {
  document.getElementById("preflightPanel")?.remove();

  const panel = document.createElement("aside");
  panel.id = "preflightPanel";
  panel.className = "preflight-panel press-panel";
  document.body.appendChild(panel);

  const formeOf = (pageId) => {
    const page = (pages || []).find((p) => Number(p.id) === Number(pageId));
    // The column is NOT NULL DEFAULT TRUE, so an absent value means colour -
    // never treat "I could not find the row" as "print it mono", which would
    // silently drop three plates off a page nobody asked to change.
    return page ? page.prints_colour !== false : true;
  };

  let status = null;

  const paint = () => {
    panel.innerHTML = `
      <header>
        <strong>Press — ${escapeHtml(headline(status))}</strong>
        <button type="button" id="preflightClose" aria-label="Close">×</button>
      </header>
      <ul class="press-pages">
        ${(status?.pages || []).map((page) => pageRow(page, formeOf(page.id), blockersFor(status, page.page_number))).join("")}
      </ul>
      <h4 class="press-findings-heading">Preflight</h4>
      <ul class="press-findings">${findingRows(report)}</ul>`;
    // Named after every paint: this panel rewrites its own header as pages are
    // passed, and an aria-labelledby pointing at a heading that has been
    // replaced names nothing.
    nameThePanel(panel);

    document.getElementById("preflightClose")
      .addEventListener("click", closeOnEscape(() => panel.remove()));

    panel.querySelectorAll(".preflight-row").forEach((row) => {
      row.addEventListener("click", () => onOpenFinding?.(Number(row.dataset.page), row.dataset.section));
    });

    panel.querySelectorAll("[data-page-state]").forEach((select) => {
      select.addEventListener("change", () => moveStage(select.dataset.pageState, select.value, select));
    });
    panel.querySelectorAll("[data-page-colour]").forEach((button) => {
      button.addEventListener("click", () => flipForme(button.dataset.pageColour, button));
    });
  };

  async function refreshStatus() {
    try {
      const response = await fetch(`/api/newspapers/${newspaperId}/status`);
      if (!response.ok) throw new Error(`status: HTTP ${response.status}`);
      status = await response.json();
    } catch (error) {
      console.error(error);
      status = null;
    }
  }

  async function moveStage(pageId, state, select) {
    select.disabled = true;
    try {
      const response = await fetch(`/api/pages/${pageId}/state`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        // The 409 carries the real blockers. Reporting "could not" without
        // them is the fault this codebase already fixed for the five
        // unchecked page re-reads: an action refused for a good reason, and
        // nothing on screen saying what the reason was.
        const reasons = [...new Set((result.findings || result.readiness?.blockers || []).map((b) => b.message))];
        throw new Error(reasons.length
          ? `${result.error || "That page cannot be passed yet."} ${reasons.join(" ")}`
          : result.error || `That page could not be moved on (HTTP ${response.status}).`);
      }
      await refreshStatus();
      paint();
      onNotice?.(`Page ${result.page?.page_number ?? ""} — ${LABEL[state] || state}.`.trim());
    } catch (error) {
      onNotice?.(error.message);
      await refreshStatus();
      paint();
    }
  }

  async function flipForme(pageId, button) {
    const wanted = button.getAttribute("aria-pressed") !== "true";
    button.disabled = true;
    try {
      const response = await fetch(`/api/pages/${pageId}/colour`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printsColour: wanted }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `The forme could not be changed (HTTP ${response.status}).`);
      // The canvas greys a mono page's photographs, so the page the desk is
      // looking at has to be repainted from the row that has just changed -
      // and this panel needs the fresh rows too, because the button's own
      // label is read off `prints_colour`. One call, returning them.
      const fresh = await onPagesChanged?.();
      if (Array.isArray(fresh)) pages = fresh;
      onNotice?.(`Page ${result.page_number ?? ""} prints ${wanted ? "in colour" : "black only"}.`.trim());
    } catch (error) {
      onNotice?.(error.message);
    } finally {
      button.disabled = false;
      paint();
    }
  }

  await refreshStatus();
  paint();
  return panel;
}
