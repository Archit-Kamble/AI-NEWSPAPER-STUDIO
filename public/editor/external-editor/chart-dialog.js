// THE CHART DIALOG - choose the chart, choose its room, then give it its data.
//
// The desk's report, and it is three complaints in one sentence: "chart, graph,
// lines after choose should first ask us to take space in news block after that
// it should ask for input that we provide by manually or by API calls.
// Currently it's showing only same graph and pie charts which is useless also
// we should able to add different color to graph".
//
// All three were true, and they had one cause. Pressing Chart wrote a SEED card
// straight into the block: the same four districts, the same numbers, the whole
// block, always red. There was no step at which a desk said what the chart was
// about, how big it should be, or what colour to print it. A control that can
// only produce the example it ships with is a demo, not a tool.
//
// So the order is the order the desk asked for:
//
//   1. WHICH CHART   bars, a pie, a line, dots or plain figures
//   2. HOW MUCH ROOM the whole block, or a panel of a chosen size inside it
//                    with the copy running round it
//   3. WHAT IS IN IT the readings, typed or pasted, plus the ink it prints in
//
// Step 2 is the one that did not exist at all, and it is the one that makes a
// chart usable in a newspaper: a story with a chart beside it is the ordinary
// case, and "the chart takes the entire block" is the rare one.
//
// NOTHING HERE INVENTS GEOMETRY OR COLOUR. The chart is solved by
// smart-cards/layout.js exactly as it always was, and the inks offered are the
// paper's own four (layout/inks.js) - a chart prints from a plate, so a colour
// a desk mixed in a browser is a colour no press can lay down. This dialog
// collects a payload and hands it to the same `onPatch` every other control
// ends in.
import { escapeHtml } from "../format.js";
import { CHART_INKS } from "../smart-cards/layout.js";
import "../layout/inset-panels.js";

const { INSET_PANEL_MIN_PX } = globalThis.SahasInsetPanels;

const TYPES = Object.freeze([
  { key: "bar", label: "Bars", note: "A row per reading, ranked. The clearest chart on newsprint." },
  { key: "pie", label: "Pie", note: "Shares of one whole, with a legend beside the wheel." },
  { key: "line", label: "Line", note: "A trend across categories, every reading marked and numbered." },
  { key: "dots", label: "Dots", note: "The same plot without the line - readings that are not a series." },
  { key: "stat", label: "Figures", note: "Big numbers over their captions. No plot at all." },
]);

// The room a chart takes. "Whole block" is what a Smart Card has always been;
// the three panel sizes are fractions of the block, which is how a desk thinks
// about a chart beside copy - not in pixels.
const ROOM = Object.freeze([
  { key: "block", label: "The whole block", note: "The chart is the block. The story's copy is replaced by it." },
  { key: "half", label: "Half the block", share: 0.5, note: "A panel down one side, copy running round it." },
  { key: "third", label: "A third", share: 0.34, note: "A smaller panel, most of the block still copy." },
  { key: "quarter", label: "A quarter", share: 0.25, note: "A corner panel." },
]);

let host = null;
let state = null;

const rowsFrom = (items) => (Array.isArray(items) && items.length
  ? items.map((item) => ({ label: String(item.label ?? ""), value: String(item.value ?? "") }))
  : [{ label: "", value: "" }]);

/**
 * The panel a chosen share becomes, in the block's own pixels.
 *
 * A share of the block's AREA, laid out as a column down the right-hand side -
 * which is where a printed paper puts a chart that copy runs round, because a
 * reader's eye returns to the left margin on every line and a panel there
 * interrupts every one of them.
 */
function panelBox(share, section) {
  const blockW = Math.max(INSET_PANEL_MIN_PX, Number(section?.width_px) || 200);
  const blockH = Math.max(INSET_PANEL_MIN_PX, Number(section?.height_px) || 200);
  // Width first: a chart needs measure more than it needs depth, so the share
  // is spent on width up to two-thirds of the block and the rest on height.
  const width = Math.max(INSET_PANEL_MIN_PX, Math.round(blockW * Math.min(0.66, Math.sqrt(share))));
  const height = Math.max(INSET_PANEL_MIN_PX, Math.round((blockH * share) / (width / blockW)));
  return {
    width: Math.min(width, blockW - 2),
    height: Math.min(height, Math.round(blockH * 0.8)),
    x: Math.max(0, blockW - Math.min(width, blockW - 2) - 2),
    y: Math.round(blockH * 0.3),
  };
}

function markup() {
  const { type, ink, room, rows, subtitle, unit, source, existing } = state;
  return `
    <div class="chart-dialog-scrim" data-chart-close></div>
    <div class="chart-dialog" role="dialog" aria-modal="true" aria-label="Add a chart">
      <header class="chart-dialog-head">
        <h3>Chart</h3>
        <button type="button" class="chart-dialog-x" data-chart-close aria-label="Close">×</button>
      </header>

      <section class="chart-step">
        <h4><b>1</b> Which chart</h4>
        <div class="chart-choices">
          ${TYPES.map((t) => `<button type="button" class="chart-choice${t.key === type ? " is-on" : ""}"
            data-chart-type="${t.key}"><strong>${escapeHtml(t.label)}</strong><span>${escapeHtml(t.note)}</span></button>`).join("")}
        </div>
      </section>

      <section class="chart-step">
        <h4><b>2</b> How much room it takes</h4>
        <div class="chart-choices">
          ${ROOM.map((r) => `<button type="button" class="chart-choice${r.key === room ? " is-on" : ""}"
            data-chart-room="${r.key}"><strong>${escapeHtml(r.label)}</strong><span>${escapeHtml(r.note)}</span></button>`).join("")}
        </div>
      </section>

      <section class="chart-step">
        <h4><b>3</b> What is in it</h4>
        <div class="chart-rows" id="chartRows">
          ${rows.map((row, i) => `
            <div class="chart-row" data-row="${i}">
              <input type="text" class="chart-row-label" value="${escapeHtml(row.label)}" placeholder="नाव" aria-label="Label" />
              <input type="text" inputmode="decimal" class="chart-row-value" value="${escapeHtml(row.value)}" placeholder="०" aria-label="Value" />
              <button type="button" class="chart-row-x" data-chart-drop="${i}" title="Take this reading out">−</button>
            </div>`).join("")}
        </div>
        <div class="chart-row-tools">
          <button type="button" class="layout-btn" data-chart-add>+ Reading</button>
          <button type="button" class="layout-btn" data-chart-paste>Paste a list…</button>
        </div>
        <div class="chart-fields">
          <label>Standfirst <input type="text" id="chartSubtitle" value="${escapeHtml(subtitle)}" placeholder="जिल्हानिहाय आकडेवारी" /></label>
          <label>Unit <input type="text" id="chartUnit" value="${escapeHtml(unit)}" placeholder="टक्के" /></label>
          <label>Source <input type="text" id="chartSource" value="${escapeHtml(source)}" placeholder="स्रोत : साहस वार्ता" /></label>
        </div>
        <div class="chart-inks">
          <span>Printed in</span>
          ${CHART_INKS.map((entry) => `<button type="button" class="chart-ink${
            (entry.key === "black" ? "#111111" : entry.hex) === ink ? " is-on" : ""}"
            data-chart-ink="${escapeHtml(entry.key === "black" ? "#111111" : entry.hex)}"
            title="${escapeHtml(entry.label)}"><i style="background:${escapeHtml(entry.hex)}"></i>${escapeHtml(entry.label)}</button>`).join("")}
        </div>
        <p class="muted chart-note">A chart is printed from one plate, in tints of one ink - which is what keeps five
          slices apart on newsprint. Black uses no colour plate at all, so it is the one to choose for a mono page.</p>
      </section>

      <footer class="chart-dialog-foot">
        ${existing ? `<button type="button" class="layout-btn danger" data-chart-remove>Remove this chart</button>` : ""}
        <span class="chart-dialog-spacer"></span>
        <button type="button" class="layout-btn" data-chart-close>Cancel</button>
        <button type="button" class="layout-btn primary" data-chart-apply>${existing ? "Update" : "Place"} the chart</button>
      </footer>
    </div>`;
}

function paint() {
  if (!host || !state) return;
  host.innerHTML = markup();
}

/** What the desk has typed, read off the form rather than tracked per keystroke. */
function harvest() {
  if (!host) return;
  const rows = [...host.querySelectorAll(".chart-row")].map((element) => ({
    label: element.querySelector(".chart-row-label")?.value ?? "",
    value: element.querySelector(".chart-row-value")?.value ?? "",
  }));
  if (rows.length) state.rows = rows;
  state.subtitle = host.querySelector("#chartSubtitle")?.value ?? state.subtitle;
  state.unit = host.querySelector("#chartUnit")?.value ?? state.unit;
  state.source = host.querySelector("#chartSource")?.value ?? state.source;
}

/** The card payload, or null when there is not one usable reading in it. */
function payload() {
  const items = state.rows
    .map((row) => ({ label: String(row.label).trim(), value: Number(String(row.value).replace(/[^\d.-]/g, "")) }))
    .filter((row) => row.label && Number.isFinite(row.value));
  if (!items.length) return null;
  return {
    chartType: state.type,
    subtitle: state.subtitle.trim(),
    unit: state.unit.trim(),
    source: state.source.trim(),
    ink: state.ink,
    items,
  };
}

export function closeChartDialog() {
  if (host) host.innerHTML = "";
  state = null;
}

/**
 * Open the dialog for the block now showing.
 *
 * `existing` is read from whichever of the two places this block's chart may
 * live - a whole-block Smart Card, or a chart panel - so re-opening it edits
 * the chart that is there rather than starting a second one beside it.
 */
export function openChartDialog({ view, section, onPatch, chartType }) {
  host = document.getElementById("chartDialogHost");
  if (!host) return;

  const panels = Array.isArray(view?.insetPanels) ? view.insetPanels : [];
  const panelIndex = panels.findIndex((panel) => panel?.kind === "chart");
  const blockCard = view?.smartCardKey === "chart" ? view.smartCardData : null;
  const existingCard = blockCard || (panelIndex >= 0 ? panels[panelIndex].card : null);

  state = {
    type: chartType || existingCard?.chartType || "bar",
    ink: existingCard?.ink || "#c8102e",
    room: blockCard ? "block" : panelIndex >= 0 ? "half" : "block",
    rows: rowsFrom(existingCard?.items),
    subtitle: existingCard?.subtitle || "",
    unit: existingCard?.unit || "",
    source: existingCard?.source || "",
    existing: Boolean(existingCard),
    panelIndex,
    hadBlockCard: Boolean(blockCard),
    section, view, onPatch,
  };
  paint();
}

/**
 * Write the chart into the block.
 *
 * The two rooms are two different stores and a chart may only be in one of
 * them, so moving a chart from the block into a panel has to CLEAR the block's
 * card - otherwise the page draws the card over the top of the story that is
 * now running round the panel. Found by doing exactly that.
 */
function apply() {
  harvest();
  const card = payload();
  const { onPatch, section, view } = state;
  if (!card) {
    window.alert("A chart needs at least one reading with a name and a number.");
    return;
  }
  const panels = (Array.isArray(view?.insetPanels) ? view.insetPanels : []).filter((p) => p?.kind !== "chart");

  if (state.room === "block") {
    onPatch({ smartCardKey: "chart", smartCardData: card, insetPanels: panels }, "chart-dialog");
  } else {
    const share = ROOM.find((r) => r.key === state.room)?.share || 0.5;
    const box = panelBox(share, section);
    const kept = state.panelIndex >= 0 ? (view.insetPanels || [])[state.panelIndex] : null;
    panels.push({
      id: kept?.id || `panel-${Date.now().toString(36)}`,
      kind: "chart",
      // A panel a desk has already sized and dragged keeps where it is: the
      // room control is how a chart is FIRST given its space, not a thing that
      // silently undoes the placement afterwards.
      x: kept?.x ?? box.x, y: kept?.y ?? box.y,
      width: kept?.width ?? box.width, height: kept?.height ?? box.height,
      card,
    });
    onPatch({
      insetPanels: panels,
      // Only when this block's card WAS the chart. A block holding a sudoku
      // and gaining a chart panel keeps its sudoku.
      ...(state.hadBlockCard ? { smartCardKey: null, smartCardData: null } : {}),
    }, "chart-dialog");
  }
  closeChartDialog();
}

function remove() {
  const { onPatch, view } = state;
  const panels = (Array.isArray(view?.insetPanels) ? view.insetPanels : []).filter((p) => p?.kind !== "chart");
  onPatch({
    insetPanels: panels,
    ...(state.hadBlockCard ? { smartCardKey: null, smartCardData: null } : {}),
  }, "chart-dialog");
  closeChartDialog();
}

// Bound to the DOCUMENT once, for the same reason the device bar is: this
// dialog is re-rendered on every choice, so a listener on its own element is
// on a detached node from the next repaint.
let bound = false;

export function bindChartDialog() {
  if (bound) return;
  bound = true;

  document.addEventListener("click", (event) => {
    if (!state) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest("[data-chart-close]")) { closeChartDialog(); return; }
    if (target.closest("[data-chart-apply]")) { apply(); return; }
    if (target.closest("[data-chart-remove]")) { remove(); return; }

    const type = target.closest("[data-chart-type]");
    if (type) { harvest(); state.type = type.dataset.chartType; paint(); return; }

    const room = target.closest("[data-chart-room]");
    if (room) { harvest(); state.room = room.dataset.chartRoom; paint(); return; }

    const ink = target.closest("[data-chart-ink]");
    if (ink) { harvest(); state.ink = ink.dataset.chartInk; paint(); return; }

    if (target.closest("[data-chart-add]")) {
      harvest(); state.rows.push({ label: "", value: "" }); paint();
      host.querySelector(".chart-row:last-child .chart-row-label")?.focus();
      return;
    }
    const drop = target.closest("[data-chart-drop]");
    if (drop) {
      harvest();
      state.rows.splice(Number(drop.dataset.chartDrop), 1);
      if (!state.rows.length) state.rows = [{ label: "", value: "" }];
      paint();
      return;
    }
    if (target.closest("[data-chart-paste]")) {
      // "Input we provide by manually OR by API calls" - a desk with figures
      // already in hand (an agency table, a spreadsheet column, the output of
      // something else) should not retype them one box at a time. One reading
      // to the line, name and number separated by a comma, a tab or a dash,
      // which is what every source this desk actually pastes from produces.
      const text = window.prompt("One reading to a line — name, then the number.\n\nसातारा, 842\nकोल्हापूर, 1290");
      if (text == null) return;
      const parsed = text.split(/\n+/).map((line) => {
        const match = /^(.*?)[\s,;\t|–—-]+(-?[\d.,]+)\s*$/.exec(line.trim());
        return match ? { label: match[1].trim(), value: match[2].replace(/,/g, "") } : null;
      }).filter(Boolean);
      if (!parsed.length) { window.alert("Nothing in that looked like a name and a number."); return; }
      harvest();
      state.rows = parsed;
      paint();
      return;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (state && event.key === "Escape") closeChartDialog();
  });
}

export function chartDialogHostMarkup() {
  return `<div class="chart-dialog-host" id="chartDialogHost"></div>`;
}
