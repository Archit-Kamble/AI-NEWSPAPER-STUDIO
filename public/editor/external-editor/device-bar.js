// THE DEVICE BAR - every device this paper can set, on one row, on the editor.
//
// The desk's report, and it is the fault this whole file exists to fix:
// "I have not seen buttons or things you modified - make sure to add every
// functionality a button which is small and on editor like bold, italic,
// underline."
//
// It was true. Every device built in the last two passes was reachable, and
// every one of them was reachable only by scrolling a narrow settings rail or
// opening a tab: Border, Ground, Columns, Drop cap and the inset panels lived
// in Properties; the font families and the list style in Typography; the chart
// in Smart cards; the caption in Pictures. A control a desk cannot FIND is a
// control that does not exist - that is the same finding as "a control that
// cannot act is not offered", one step earlier.
//
// So this is one row, beside the bold/italic/underline the desk already knows,
// and it is deliberately NOT a second implementation of any of them. Every
// button ends in the same `onPatch(patch, source)` the panels themselves call,
// which is `patchDraft` in workspace.js - one store, one draft, one save. A
// button here and the control in the rail are two views of one decision, and
// pressing either moves the other.
//
// Everything it offers comes from the shared catalogues - borders.js, inks.js,
// typefaces.js, inset-panels.js, smart-cards - so this row can never drift
// into a second vocabulary. That is the failure this codebase has been bitten
// by twice and it would have been very easy to repeat here.
import "../layout/borders.js";
import "../layout/inset-panels.js";
import "../layout/typefaces.js";
import { TINTS } from "../layout/inks.js";

const { BORDER_STYLES } = globalThis.SahasBorders;
const { TYPEFACES } = globalThis.SahasTypefaces;
const { INSET_PANEL_KINDS, INSET_PANEL_MIN_PX } = globalThis.SahasInsetPanels;

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// A face this paper actually has, split by what it is FOR. `displayFamily` is
// a second field on purpose (see CLAUDE.md) - composing a headline in the
// family the BODY was reserved room in reserves room for the wrong glyphs.
const TEXT_FACES = TYPEFACES.filter((f) => f.role === "text");
const DISPLAY_FACES = TYPEFACES.filter((f) => f.role === "display");

const CHARTS = Object.freeze([
  { key: "bar", label: "Bars" },
  { key: "pie", label: "Pie" },
  { key: "line", label: "Line" },
  { key: "dots", label: "Dots" },
  { key: "stat", label: "Figures" },
]);

// A device that has one obvious "on" state is a TOGGLE; one with a handful of
// named settings opens a small menu. Nothing here cycles blindly through a
// list - a desk pressing a button twice should not have to remember where in a
// sequence it left off, which is what made the old number-input columns
// control unusable.
const MENUS = {
  border: () => BORDER_STYLES.map((s) => ({ value: s.key, label: s.label })),
  ground: () => [{ value: "", label: "White (paper)" },
    ...TINTS.filter((t) => t.hex).map((t) => ({ value: t.hex, label: t.label, swatch: t.hex }))],
  columns: () => [{ value: "", label: "Auto" }, { value: "1", label: "1 column" },
    { value: "2", label: "2 columns" }, { value: "3", label: "3 columns" }, { value: "4", label: "4 columns" }],
  font: () => TEXT_FACES.map((f) => ({ value: f.key, label: f.label })),
  display: () => [{ value: "", label: "The paper's sans" },
    ...DISPLAY_FACES.map((f) => ({ value: f.key, label: f.label })),
    ...TEXT_FACES.map((f) => ({ value: f.key, label: f.label }))],
  dropcap: () => [{ value: "0", label: "None" }, { value: "2", label: "2 lines" },
    { value: "3", label: "3 lines" }, { value: "4", label: "4 lines" }],
  chart: () => CHARTS.map((c) => ({ value: c.key, label: c.label })),
  insert: () => [
    ...INSET_PANEL_KINDS.map((k) => ({ value: `panel:${k.key}`, label: k.label })),
    { value: "overlay", label: "Picture across blocks" },
  ],
};

/**
 * One small button: a mark, and the word for it.
 *
 * ICON-ONLY WAS TRIED AND IS WRONG HERE. Bold/italic/underline can be icons
 * because every desk already knows them; ▣ ▤ ▥ for border/ground/columns are
 * three squares a person has to learn, and the whole reason this bar exists is
 * that a desk could not find these devices. A tooltip is not something anybody
 * reads while working - this codebase has already been bitten by exactly that
 * (`#edStorySize` retargeting silently). So the word is on the button.
 */
const button = (id, icon, label, title, { wide = false } = {}) => `<button type="button" class="dev-btn${wide ? " is-wide" : ""}"
  data-device="${id}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"
  ><b>${icon}</b><span>${escapeHtml(label)}</span></button>`;

export function deviceBarMarkup() {
  return `
    <div class="device-bar" id="edDeviceBar" role="toolbar" aria-label="Newspaper devices">
      <span class="dev-group">
        ${button("border", "▣", "Border", "How this block is ruled — none, a box, a rule above or below")}
        ${button("ground", "▤", "Tint", "A light ground behind the whole block, from the paper's own palette")}
        ${button("columns", "▥", "Columns", "How many columns the copy is set in — Auto works it out from the width")}
      </span>
      <span class="dev-group">
        ${button("font", "Aa", "Body", "The face the story is set in", { wide: true })}
        ${button("display", "A", "Head", "The face the headline, kicker and deck are set in", { wide: true })}
        ${button("dropcap", "D", "Drop cap", "A large opening letter, two to four lines deep")}
        ${button("list-bullet", "▪", "Bullets", "Set the whole story as a bulleted list, markers hung in their own column")}
        ${button("list-number", "१", "Numbers", "Set the whole story as a numbered list, markers hung in their own column")}
      </span>
      <span class="dev-group">
        ${button("insert", "❏", "Insert", "A fact box, pull quote, cross-head, separator — or a picture laid across two blocks")}
        ${button("rule", "═", "Separator", "A decorative rule across the measure, between two parts of the story")}
        ${button("chart", "▮", "Chart", "Bars, a pie, a line, dots or plain figures")}
      </span>
      <span class="dev-group">
        ${button("caption", "❝", "Caption", "Write the line under the picture")}
        ${button("ai-picture", "✦", "AI picture", "Ask the AI for a picture — it proposes, you place it")}
      </span>
      <span class="dev-menu" id="edDeviceMenu" hidden></span>
    </div>`;
}

// ------------------------------------------------------------------ menus ---

let openMenu = null;

function closeMenu() {
  const host = document.getElementById("edDeviceMenu");
  if (host) { host.hidden = true; host.innerHTML = ""; }
  openMenu = null;
}

function showMenu(device, anchor, current) {
  const host = document.getElementById("edDeviceMenu");
  if (!host || !MENUS[device]) return;
  if (openMenu === device) return closeMenu();
  const items = MENUS[device]();
  host.innerHTML = items.map((item) => `<button type="button" class="dev-menu-item${
    String(item.value) === String(current ?? "") ? " is-on" : ""}" data-device-choice="${escapeHtml(item.value)}">${
    item.swatch ? `<i style="background:${escapeHtml(item.swatch)}"></i>` : ""}${escapeHtml(item.label)}</button>`).join("");
  host.hidden = false;
  // Positioned against the BAR, not the page: the bar is re-rendered on every
  // block change and an absolutely-positioned menu measured off the document
  // would be left behind by the next repaint.
  const bar = anchor.closest(".device-bar");
  host.style.left = `${anchor.offsetLeft - (bar ? bar.scrollLeft : 0)}px`;
  openMenu = device;
}

// ----------------------------------------------------------------- actions ---

/**
 * A new panel, at a sensible size for its kind.
 *
 * The same defaults Properties' own "+" buttons use, and deliberately the same
 * code path afterwards: the whole panel list is patched, because a panel has
 * no server-side id to address.
 */
function panelFor(kind, section, view) {
  const blockW = Number(section?.width_px) || 200;
  const blockH = Number(section?.height_px) || 200;
  const crosshead = kind === "crosshead";
  const w = crosshead ? Math.max(INSET_PANEL_MIN_PX, blockW - 4)
    : Math.max(INSET_PANEL_MIN_PX, Math.round(blockW * 0.45));
  const h = crosshead ? Math.max(INSET_PANEL_MIN_PX, Math.round((Number(view?.bodyFontPx) || 6.4) * 1.45 * 2))
    : Math.max(INSET_PANEL_MIN_PX, Math.round(blockH * 0.3));
  return {
    id: `panel-${Date.now().toString(36)}`,
    kind,
    x: crosshead ? 2 : Math.max(0, blockW - w - 2),
    y: Math.round(blockH * 0.45),
    width: w, height: h,
    title: kind === "quote" ? "" : crosshead ? "पुढील टप्पा" : "ठळक मुद्दे",
    lines: crosshead ? [] : [kind === "quote" ? "इथे अवतरण लिहा" : "इथे मजकूर लिहा"],
  };
}

/** A starting chart, so the button produces something a desk can SEE and edit. */
const SEED_CHART = {
  chartType: "bar",
  subtitle: "जिल्हानिहाय आकडेवारी",
  unit: "",
  source: "स्रोत : साहस वार्ता",
  items: [
    { label: "सातारा", value: 842 },
    { label: "कोल्हापूर", value: 1290 },
    { label: "सांगली", value: 603 },
    { label: "पुणे", value: 770 },
  ],
};

// ------------------------------------------------------------------- bind ---

/**
 * Bound to the DOCUMENT, never to the bar.
 *
 * The bar is rewritten whenever the block changes, so a listener attached to
 * the element itself is on a detached node from the next repaint - the
 * `#edSpaceGroup` trap, which this codebase has now hit twice and which
 * presents as a control that draws perfectly and does nothing.
 */
let bound = false;
let live = null;

export function bindDeviceBar(handlers) {
  // The handlers are refreshed on every render; the LISTENER is added once.
  //
  // `renderExternalEditor()` runs on every repaint, so binding here bound a
  // new document-level listener each time - and because pressing a button that
  // is already open TOGGLES its menu, an even number of listeners opened and
  // closed it in the same click and the menu never appeared. It looked exactly
  // like a dead button, which is the fault this whole bar exists to fix, so it
  // would have shipped as one. Found by pressing Border in a real browser and
  // reading `#edDeviceMenu` afterwards: present, empty, hidden.
  live = handlers;
  if (bound) return;
  bound = true;

  const patch = (updates) => live?.onPatch?.(updates, "device-bar");

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const choice = target.closest("[data-device-choice]");
    if (choice) {
      applyChoice(openMenu, choice.dataset.deviceChoice, live, patch);
      closeMenu();
      return;
    }

    const pressed = target.closest("[data-device]");
    if (!pressed) { closeMenu(); return; }

    const view = live?.getView?.() || {};
    const device = pressed.dataset.device;

    if (MENUS[device]) {
      showMenu(device, pressed, currentOf(device, view));
      return;
    }
    closeMenu();

    // The two list buttons are TOGGLES against the block's own list style -
    // and they are not Quill's ordered/bullet buttons beside them. Quill's own
    // list marks the ONE document it owns; `list_style` sets how the whole
    // story is poured, with the marker hung in its own column. Two different
    // objects, so two different controls, each labelled for what it acts on.
    if (device === "list-bullet" || device === "list-number") {
      const want = device === "list-bullet" ? "bullet" : "number";
      patch({ listStyle: view.listStyle === want ? "none" : want });
      return;
    }
    if (device === "rule") { live?.onInsertOrnament?.(); return; }
    if (device === "caption") { live?.onFocusCaption?.(); return; }
    if (device === "ai-picture") { live?.onProposePicture?.(); return; }
  });

  // A menu is dismissed by Escape as well as by a press elsewhere - it is a
  // popover, and every popover this product has closes both ways.
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });
}

function currentOf(device, view) {
  switch (device) {
    case "border": return view.borderStyle || "none";
    case "ground": return view.backgroundColor || "";
    case "columns": return view.columnCount == null ? "" : String(view.columnCount);
    case "font": return view.fontFamily || "serif";
    case "display": return view.displayFamily || "";
    case "dropcap": return String(Number(view.dropCapLines) || 0);
    case "chart": return view.smartCardKey === "chart" ? (view.smartCardData?.chartType || "bar") : "";
    default: return "";
  }
}

function applyChoice(device, value, handlers, patch) {
  const view = handlers.getView?.() || {};
  const section = handlers.getSection?.() || {};
  switch (device) {
    case "border": return patch({ borderStyle: value });
    case "ground": return patch({ backgroundColor: value || null });
    case "columns": return patch({ columnCount: value === "" ? null : Number(value) });
    case "font": return patch({ fontFamily: value });
    case "display": return patch({ displayFamily: value });
    case "dropcap": return patch({ dropCapLines: Number(value) });
    case "chart": {
      const data = view.smartCardKey === "chart" && view.smartCardData
        ? { ...view.smartCardData, chartType: value }
        : { ...SEED_CHART, chartType: value };
      return patch({ smartCardKey: "chart", smartCardData: data });
    }
    case "insert": {
      if (value === "overlay") return handlers.onAddOverlay?.();
      const kind = String(value).slice("panel:".length);
      const existing = Array.isArray(view.insetPanels) ? view.insetPanels : [];
      return patch({ insetPanels: [...existing, panelFor(kind, section, view)] });
    }
    default:
  }
}

/**
 * Which devices are ON for the block now showing.
 *
 * Read from the live view, so the bar and the rail cannot disagree - pressing
 * either moves both, because both are drawn from the one draft.
 */
export function refreshDeviceBar(view = {}) {
  const bar = document.getElementById("edDeviceBar");
  if (!bar) return;
  const on = {
    border: (view.borderStyle || "none") !== "none",
    ground: Boolean(view.backgroundColor),
    columns: view.columnCount != null,
    dropcap: Number(view.dropCapLines) > 0,
    "list-bullet": view.listStyle === "bullet",
    "list-number": view.listStyle === "number",
    chart: view.smartCardKey === "chart",
    display: Boolean(view.displayFamily),
  };
  bar.querySelectorAll("[data-device]").forEach((element) => {
    element.classList.toggle("is-on", Boolean(on[element.dataset.device]));
  });
  // The two face buttons say WHICH face, because "Aa" alone cannot: a desk
  // choosing between four Marathi text faces needs to see the one in force.
  const label = (id, text) => {
    const node = bar.querySelector(`[data-device="${id}"] span`);
    if (node) node.textContent = text;
  };
  const faceOf = (key, fallback) => TYPEFACES.find((f) => f.key === key)?.short || fallback;
  label("font", faceOf(view.fontFamily, "Serif"));
  label("display", view.displayFamily ? faceOf(view.displayFamily, "Sans") : "Sans");
}
