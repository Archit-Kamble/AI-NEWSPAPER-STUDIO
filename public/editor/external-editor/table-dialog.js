// A PLAIN TABLE - rows and columns of the desk's own figures.
//
// The commonest piece of furniture in a district daily after the story itself:
// a result, a rate, a fixture list, a ward-by-ward count. This product could
// set nine kinds of structured box and not one of them was a table, so a desk's
// only option was to type it as prose and let the compositor break it wherever
// the measure ran out.
//
// SAME SHAPE AS THE CHART DIALOG, deliberately. A table asks the same two
// questions before it can draw anything - how much room does it take, and what
// is in it - and everything it produces is a Smart Card payload handed to the
// same `onPatch` every other control ends in. Nothing here invents geometry:
// layoutSmartCard() measures the columns and fits every cell.
import { escapeHtml } from "../format.js";
import { askPrompt, askMessage } from "../../ui/dialog.js";
import { CHART_INKS, layoutSmartCard } from "../smart-cards/layout.js";
import "../layout/inset-panels.js";
import "../layout/typefaces.js";

const { INSET_PANEL_MIN_PX } = globalThis.SahasInsetPanels;
const { TYPEFACES } = globalThis.SahasTypefaces;

// The same four the chart offers, and the same argument: a table's rules and
// its head are ink, and a colour mixed in a browser is one no press can lay
// down.
const ROOM = Object.freeze([
  { key: "block", label: "The whole block", note: "The table is the block. The story's copy is replaced by it." },
  { key: "half", label: "Half the block", share: 0.5, note: "A panel down one side, copy running round it." },
  { key: "third", label: "A third", share: 0.34, note: "A smaller panel, most of the block still copy." },
  { key: "quarter", label: "A quarter", share: 0.25, note: "A corner panel." },
]);

let host = null;
let state = null;

const emptyGrid = () => ({ columns: ["", ""], rows: [["", ""], ["", ""]] });

/**
 * The panel a chosen share becomes - the same rule the chart's uses, including
 * the part that matters most: the share is a CEILING, and the table is cut to
 * the height its own rows need. A panel that reserves room it does not use is a
 * hole in the page, and the copy is what pays for it.
 */
function panelBox(share, section, card) {
  const blockW = Math.max(INSET_PANEL_MIN_PX, Number(section?.width_px) || 200);
  const blockH = Math.max(INSET_PANEL_MIN_PX, Number(section?.height_px) || 200);
  const width = Math.min(Math.max(INSET_PANEL_MIN_PX,
    Math.round(blockW * Math.min(0.66, Math.sqrt(share)))), blockW - 2);
  const ceiling = Math.min(
    Math.max(INSET_PANEL_MIN_PX, Math.round((blockH * share) / (width / blockW))),
    Math.round(blockH * 0.8),
  );
  let height = ceiling;
  try {
    const solved = layoutSmartCard("table", card, { width, height: ceiling });
    const content = Number(solved?.geometry?.contentHeight) || 0;
    if (content) {
      const box = Number(solved?.contentBox?.height) || ceiling;
      height = Math.min(ceiling, Math.ceil(content + Math.max(0, ceiling - box) + (solved?.subtitle?.height || 0)));
    }
  } catch (error) {
    // A table this dialog cannot solve is not a reason to refuse the
    // placement; the share it asked for is a perfectly good answer.
  }
  return {
    width,
    height: Math.max(INSET_PANEL_MIN_PX, height),
    x: Math.max(0, blockW - width - 2),
    y: Math.round(blockH * 0.3),
  };
}

function markup() {
  const { room, columns, rows, source, ink, family, existing } = state;
  const headCells = columns.map((text, c) => `<input type="text" class="table-head-cell" data-col="${c}"
    value="${escapeHtml(text)}" placeholder="शीर्षक" aria-label="Column ${c + 1} heading">`).join("");
  const bodyRows = rows.map((row, r) => `
    <div class="table-row" data-row="${r}">
      ${row.map((text, c) => `<input type="text" class="table-cell" data-row="${r}" data-col="${c}"
        value="${escapeHtml(text)}" aria-label="Row ${r + 1} column ${c + 1}">`).join("")}
      <button type="button" class="chart-row-x" data-table-drop-row="${r}" title="Take this row out">−</button>
    </div>`).join("");

  return `
    <div class="chart-dialog-scrim" data-table-close></div>
    <div class="chart-dialog" role="dialog" aria-modal="true" aria-label="Add a table">
      <header class="chart-dialog-head">
        <h3>Table</h3>
        <button type="button" class="chart-dialog-x" data-table-close aria-label="Close">×</button>
      </header>

      <section class="chart-step">
        <h4><b>1</b> How much room it takes</h4>
        <div class="chart-choices">
          ${ROOM.map((r) => `<button type="button" class="chart-choice${r.key === room ? " is-on" : ""}"
            data-table-room="${r.key}"><strong>${escapeHtml(r.label)}</strong><span>${escapeHtml(r.note)}</span></button>`).join("")}
        </div>
      </section>

      <section class="chart-step">
        <h4><b>2</b> What is in it</h4>
        <div class="table-grid" style="--table-cols:${columns.length}">
          <div class="table-row is-head">${headCells}<span class="table-row-spacer"></span></div>
          ${bodyRows}
        </div>
        <div class="chart-row-tools">
          <button type="button" class="layout-btn" data-table-add-row>+ Row</button>
          <button type="button" class="layout-btn" data-table-add-col>+ Column</button>
          <button type="button" class="layout-btn" data-table-drop-col
            ${columns.length <= 1 ? "disabled" : ""}>− Column</button>
          <button type="button" class="layout-btn" data-table-paste>Paste a table…</button>
        </div>
        <div class="chart-fields">
          <label>Source <input type="text" id="tableSource" value="${escapeHtml(source)}" placeholder="स्रोत : साहस वार्ता"></label>
        </div>
        <div class="chart-inks">
          <span>Set in</span>
          ${[{ key: "", label: "The paper's own", short: "Default" }, ...TYPEFACES.filter((f) => f.role === "text")]
            .map((f) => `<button type="button" class="chart-face${(family || "") === f.key ? " is-on" : ""}"
              data-table-face="${escapeHtml(f.key)}">${escapeHtml(f.short || f.label)}</button>`).join("")}
        </div>
        <div class="chart-inks">
          <span>Head rule in</span>
          ${CHART_INKS.map((entry) => {
            const value = entry.key === "black" ? "#111111" : entry.hex;
            return `<button type="button" class="chart-ink${value === ink ? " is-on" : ""}"
              data-table-ink="${escapeHtml(value)}" title="${escapeHtml(entry.label)}"
              ><i style="background:${escapeHtml(entry.hex || "#111111")}"></i>${escapeHtml(entry.label)}</button>`;
          }).join("")}
        </div>
        <p class="muted chart-note">A heading row is optional - leave it empty and the table sets without one.
          Columns are measured from what is in them and scaled to the block, so the widths are the content's.</p>
      </section>

      <footer class="chart-dialog-foot">
        ${existing ? '<button type="button" class="layout-btn danger" data-table-remove>Remove this table</button>' : ""}
        <span class="chart-dialog-spacer"></span>
        <button type="button" class="layout-btn" data-table-close>Cancel</button>
        <button type="button" class="layout-btn primary" data-table-apply>${existing ? "Update" : "Place"} the table</button>
      </footer>
    </div>`;
}

function paint() {
  if (host && state) host.innerHTML = markup();
}

/** What the desk has typed, read off the form rather than tracked per keystroke. */
function harvest() {
  if (!host || !state) return;
  const heads = [...host.querySelectorAll(".table-head-cell")];
  if (heads.length) state.columns = heads.map((input) => input.value);
  const rows = [...host.querySelectorAll(".table-row:not(.is-head)")];
  if (rows.length) {
    state.rows = rows.map((row) => [...row.querySelectorAll(".table-cell")].map((input) => input.value));
  }
  state.source = host.querySelector("#tableSource")?.value ?? state.source;
}

/** The card payload, or null when there is not one usable cell in it. */
function payload() {
  const columns = state.columns.map((text) => String(text).trim());
  const rows = state.rows
    .map((row) => row.map((text) => String(text).trim()))
    .filter((row) => row.some((cell) => cell !== ""));
  if (!rows.length && !columns.some((c) => c !== "")) return null;
  return {
    columns,
    rows,
    source: state.source.trim(),
    ink: state.ink,
    ...(state.family ? { family: state.family } : {}),
  };
}

export function closeTableDialog() {
  if (host) host.innerHTML = "";
  state = null;
}

export function openTableDialog({ view, section, onPatch }) {
  host = document.getElementById("chartDialogHost");
  if (!host) return;

  const panels = Array.isArray(view?.insetPanels) ? view.insetPanels : [];
  const panelIndex = panels.findIndex((panel) => panel?.kind === "table");
  const blockCard = view?.smartCardKey === "table" ? view.smartCardData : null;
  const existing = blockCard || (panelIndex >= 0 ? panels[panelIndex].card : null);
  const grid = existing ? { columns: existing.columns || [], rows: existing.rows || [] } : emptyGrid();

  state = {
    room: blockCard ? "block" : panelIndex >= 0 ? "half" : "block",
    columns: grid.columns.length ? grid.columns.map((c) => String(c ?? "")) : ["", ""],
    rows: grid.rows.length ? grid.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "")) : [])) : emptyGrid().rows,
    source: existing?.source || "",
    ink: existing?.ink || "#111111",
    family: existing?.family || "",
    existing: Boolean(existing),
    panelIndex,
    hadBlockCard: Boolean(blockCard),
    section, view, onPatch,
  };
  paint();
}

function apply() {
  harvest();
  const card = payload();
  const { onPatch, section, view } = state;
  if (!card) {
    // Not awaited: see chart-dialog.js - the guard returns either way.
    askMessage({ title: "The table is empty", body: "A table needs at least one row with something in it." });
    return;
  }
  const panels = (Array.isArray(view?.insetPanels) ? view.insetPanels : []).filter((p) => p?.kind !== "table");

  if (state.room === "block") {
    onPatch({ smartCardKey: "table", smartCardData: card, insetPanels: panels }, "table-dialog");
  } else {
    const share = ROOM.find((r) => r.key === state.room)?.share || 0.5;
    const box = panelBox(share, section, card);
    const kept = state.panelIndex >= 0 ? (view.insetPanels || [])[state.panelIndex] : null;
    panels.push({
      id: kept?.id || `panel-${Date.now().toString(36)}`,
      kind: "table",
      // A panel a desk has already sized and dragged keeps where it is: the
      // room control is how a table is FIRST given its space, not a thing that
      // silently undoes the placement afterwards.
      x: kept?.x ?? box.x, y: kept?.y ?? box.y,
      width: kept?.width ?? box.width, height: kept?.height ?? box.height,
      card,
    });
    onPatch({
      insetPanels: panels,
      ...(state.hadBlockCard ? { smartCardKey: null, smartCardData: null } : {}),
    }, "table-dialog");
  }
  closeTableDialog();
}

function remove() {
  const { onPatch, view } = state;
  onPatch({
    insetPanels: (Array.isArray(view?.insetPanels) ? view.insetPanels : []).filter((p) => p?.kind !== "table"),
    ...(view?.smartCardKey === "table" ? { smartCardKey: null, smartCardData: null } : {}),
  }, "table-dialog");
  closeTableDialog();
}

/**
 * Bound ONCE at the document, like every other control in this folder: the
 * dialog is rewritten on every paint, so an element-bound listener is on a
 * detached node from the next one.
 */
let bound = false;
export function bindTableDialog() {
  if (bound) return;
  bound = true;

  document.addEventListener("click", async (event) => {
    if (!state) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest("[data-table-close]")) { closeTableDialog(); return; }
    if (target.closest("[data-table-apply]")) { apply(); return; }
    if (target.closest("[data-table-remove]")) { remove(); return; }

    const room = target.closest("[data-table-room]");
    if (room) { harvest(); state.room = room.dataset.tableRoom; paint(); return; }

    const face = target.closest("[data-table-face]");
    if (face) { harvest(); state.family = face.dataset.tableFace; paint(); return; }

    const ink = target.closest("[data-table-ink]");
    if (ink) { harvest(); state.ink = ink.dataset.tableInk; paint(); return; }

    if (target.closest("[data-table-add-row]")) {
      harvest();
      state.rows.push(state.columns.map(() => ""));
      paint();
      host.querySelector(".table-row:last-of-type .table-cell")?.focus();
      return;
    }
    if (target.closest("[data-table-add-col]")) {
      harvest();
      state.columns.push("");
      state.rows = state.rows.map((row) => [...row, ""]);
      paint();
      return;
    }
    const dropCol = target.closest("[data-table-drop-col]");
    if (dropCol && !dropCol.disabled) {
      harvest();
      if (state.columns.length > 1) {
        state.columns.pop();
        state.rows = state.rows.map((row) => row.slice(0, state.columns.length));
      }
      paint();
      return;
    }
    const dropRow = target.closest("[data-table-drop-row]");
    if (dropRow) {
      harvest();
      state.rows.splice(Number(dropRow.dataset.tableDropRow), 1);
      if (!state.rows.length) state.rows = [state.columns.map(() => "")];
      paint();
      return;
    }
    if (target.closest("[data-table-paste]")) {
      // A desk with a table already in hand - an agency return, a spreadsheet
      // block - should not retype it cell by cell. One row to the line, cells
      // separated by a tab or a comma, which is what both of those produce.
      // The same one-line box asked to take a table - see chart-dialog.js.
      const text = await askPrompt({
        title: "Paste the table",
        body: "One row to the line. The first line is the heading row.",
        label: "Rows",
        multiline: true,
        rows: 9,
        placeholder: "जिल्हा\tपाऊस\tटक्के\nसातारा\t842\t96",
        help: "Separate the cells with a tab or a comma.",
        confirm: "Use this table",
      });
      if (!text) return;
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (!lines.length) return;
      const split = (line) => line.split(/\t|,/).map((cell) => cell.trim());
      const parsed = lines.map(split);
      const width = Math.max(...parsed.map((row) => row.length), 1);
      state.columns = Array.from({ length: width }, (_, i) => parsed[0][i] || "");
      state.rows = parsed.slice(1).map((row) => Array.from({ length: width }, (_, i) => row[i] || ""));
      if (!state.rows.length) state.rows = [Array.from({ length: width }, () => "")];
      paint();
    }
  });
}
