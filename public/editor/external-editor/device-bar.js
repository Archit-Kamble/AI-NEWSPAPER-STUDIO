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
const { INSET_PANEL_KINDS, INSET_PANEL_MIN_PX, INSET_PANEL_ORNAMENTS } = globalThis.SahasInsetPanels;

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
// EVERY DEVICE THAT CAN BE ADDED CAN BE TAKEN OFF, and the way off is in the
// same menu as the way on. The desk's first report was exactly this - "every
// time we are able to add we should able to remove" - and it was true of four
// of them: a panel, a separator and a chart could each be put on a block and
// then only be got rid of by hunting for the right rail, or not at all.
//
// Border/Tint/Columns/Drop cap already had their off switch, because their
// "off" is a value in their own list (None, White, Auto, None). The four below
// have no such value - a panel is a thing that exists or does not - so each
// menu carries an explicit remove, and it is disabled rather than hidden when
// there is nothing to remove, so the desk can see that the way out exists.
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
  chart: (view) => [
    ...CHARTS.map((c) => ({ value: c.key, label: c.label })),
    { value: "remove", label: "Remove the chart", danger: true, disabled: !hasChart(view) },
  ],
  // The Separator was one fixed ornament and one press. A printed paper has a
  // small vocabulary of them and uses different ones for different jobs, so
  // this offers that vocabulary - and, since it is a menu now, the way to take
  // one off is in it, which is what the desk asked for.
  rule: (view) => [
    ...INSET_PANEL_ORNAMENTS.map((o) => ({ value: `orn:${o.key}`, label: `${o.mark || '\u2500\u2500'}   ${o.label}` })),
    { value: "orn:remove", label: "Remove the separator", danger: true, disabled: !hasOrnament(view) },
  ],
  insert: (view) => [
    // The chart kind is deliberately NOT offered here. It needs its data, its
    // room and its ink before it can draw anything, and that is three
    // questions - so it is the Chart button's dialog, and this menu would be a
    // second, worse way in that produced an empty rectangle.
    ...INSET_PANEL_KINDS.filter((k) => k.key !== "chart" && k.key !== "ornament")
      .map((k) => ({ value: `panel:${k.key}`, label: k.label })),
    { value: "overlay", label: "Picture across blocks" },
    { value: "drop-panel", label: "Remove the last panel", danger: true, disabled: !panelCount(view) },
  ],
};

/** Is there a chart on this block at all - in the block itself, or in a panel? */
const hasChart = (view) => view?.smartCardKey === "chart"
  || (Array.isArray(view?.insetPanels) && view.insetPanels.some((p) => p?.kind === "chart"));

const panelCount = (view) => (Array.isArray(view?.insetPanels) ? view.insetPanels.length : 0);

/** Is a separator set on this block? The one thing the Separator button toggles. */
const hasOrnament = (view) => Array.isArray(view?.insetPanels)
  && view.insetPanels.some((p) => p?.kind === "ornament");

// THE THREE TYPE SIZES, ON THE BAR.
//
// The desk's report: "we cannot able to edit headling and subheading font size
// in editor". The controls existed - Typography has a number input for each -
// and that was the whole problem: they were in a panel in the settings rail,
// which is precisely the findability fault this bar was built for, and the two
// display sizes are the commonest change a sub-editor makes to a block.
//
// A stepper rather than a number box, because a headline is chosen by looking
// at it. Half a point at a time on the body (the columns are NUMERIC(5,1) - a
// printer sets type in half points) and a whole point on display type, which
// is the granularity each is actually set in.
const SIZE_FIELDS = Object.freeze([
  { field: "headlineFontPx", label: "Headline", short: "H", step: 1, min: 8, max: 140 },
  { field: "subheadingFontPx", label: "Deck", short: "D", step: 1, min: 8, max: 90 },
  { field: "bodyFontPx", label: "Body", short: "B", step: 0.5, min: 6, max: 48 },
]);

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
      <!-- THE THREE TYPE SIZES. On the bar rather than in a panel, because a
           desk changing a headline is looking at the headline. -->
      <span class="dev-group dev-sizes">
        ${SIZE_FIELDS.map((f) => `<span class="dev-size" data-size-field="${f.field}">
          <b title="${escapeHtml(f.label)} size">${f.short}</b>
          <button type="button" class="dev-size-step" data-size-step="down" aria-label="${escapeHtml(f.label)} smaller">−</button>
          <output data-size-out="${f.field}">—</output>
          <button type="button" class="dev-size-step" data-size-step="up" aria-label="${escapeHtml(f.label)} bigger">+</button>
        </span>`).join("")}
      </span>
      <span class="dev-group">
        ${button("font", "Aa", "Body", "The face the story is set in", { wide: true })}
        ${button("display", "A", "Head", "The face the headline, kicker and deck are set in", { wide: true })}
        ${button("dropcap", "D", "Drop cap", "A large opening letter, two to four lines deep")}
        ${button("list-bullet", "▪", "Bullets", "Set the whole story as a bulleted list, markers hung in their own column")}
        ${button("list-number", "१", "Numbers", "Set the whole story as a numbered list, markers hung in their own column")}
        ${button("justify", "▤", "Justify", "Set the copy flush to BOTH edges of the column — the way a printed newspaper sets its body")}
        ${button("dateline", "■", "Dateline", "Open the story with ■ location, reporter — or don't")}
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

function showMenu(device, anchor, current, view) {
  const host = document.getElementById("edDeviceMenu");
  if (!host || !MENUS[device]) return;
  if (openMenu === device) return closeMenu();
  const items = MENUS[device](view);
  host.innerHTML = items.map((item) => `<button type="button" class="dev-menu-item${
    String(item.value) === String(current ?? "") ? " is-on" : ""}${item.danger ? " is-danger" : ""}"${
    item.disabled ? " disabled" : ""} data-device-choice="${escapeHtml(item.value)}">${
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

    // A SIZE STEPPER. Not a menu and not a toggle - it is pressed repeatedly,
    // so it must not close and reopen anything, and the read-out beside it has
    // to move on every press or the desk cannot tell it worked.
    const step = target.closest("[data-size-step]");
    if (step) {
      const field = step.closest("[data-size-field]")?.dataset.sizeField;
      const spec = SIZE_FIELDS.find((f) => f.field === field);
      if (!spec) return;
      const view = live?.getView?.() || {};
      const now = Number(view[field]);
      const base = Number.isFinite(now) && now > 0 ? now : spec.min;
      const next = step.dataset.sizeStep === "up" ? base + spec.step : base - spec.step;
      // The columns are NUMERIC(5,1) and arrive over the wire as strings; a
      // float that has drifted through a few halvings would store as 12.30000001
      // and read back as something a desk never chose.
      const clamped = Math.round(Math.min(spec.max, Math.max(spec.min, next)) * 10) / 10;
      if (clamped === base) return;
      patch({ [field]: clamped });
      return;
    }

    const pressed = target.closest("[data-device]");
    if (!pressed) { closeMenu(); return; }

    const view = live?.getView?.() || {};
    const device = pressed.dataset.device;

    if (MENUS[device]) {
      showMenu(device, pressed, currentOf(device, view), view);
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
    // THE COPY SET FLUSH TO BOTH EDGES - what the desk asked for by pointing at
    // a Lokmat block: "every word start with touching left side of news block
    // and line end is touching right side". That is justification, the
    // compositor has done it since it was written (compose.js's justifyLine),
    // and the only control for it was an Alignment segment in a panel in the
    // rail. It is the single most characteristic thing about printed body copy,
    // so it is a button.
    if (device === "justify") {
      patch({ textAlign: view.textAlign === "justify" ? "left" : "justify" });
      return;
    }
    if (device === "dateline") {
      patch({ showDateline: view.showDateline === false });
      return;
    }
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
    case "rule": {
      const set = (view.insetPanels || []).find((p) => p?.kind === "ornament");
      if (!set) return "";
      const mark = (set.lines || []).join(" ");
      return `orn:${INSET_PANEL_ORNAMENTS.find((o) => o.mark === mark)?.key || "plain"}`;
    }
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
    // A CHART IS NOT A ONE-PRESS DEVICE ANY MORE. Pressing a type used to write
    // a seed card - the same four districts, always, filling the whole block,
    // always red - which is why the report was that the button "showing only
    // same graph and pie charts which is useless". It was: it could only ever
    // produce its own example.
    //
    // So the type chosen here OPENS the dialog on that type, and the dialog
    // asks the two questions the seed answered by guessing: how much room, and
    // what is in it.
    case "chart": {
      if (value === "remove") {
        const panels = (Array.isArray(view.insetPanels) ? view.insetPanels : [])
          .filter((p) => p?.kind !== "chart");
        return patch({
          insetPanels: panels,
          ...(view.smartCardKey === "chart" ? { smartCardKey: null, smartCardData: null } : {}),
        });
      }
      return handlers.onChart?.(value);
    }
    // A SEPARATOR, of a chosen kind - or none. It only ever added before, so
    // pressing it twice put two on the block and nothing took either off.
    case "rule": {
      const without = (Array.isArray(view.insetPanels) ? view.insetPanels : [])
        .filter((p) => p?.kind !== "ornament");
      if (value === "orn:remove") return patch({ insetPanels: without });
      const mark = INSET_PANEL_ORNAMENTS.find((o) => o.key === String(value).slice("orn:".length))?.mark ?? "";
      // One separator to a block: choosing a different one REPLACES it rather
      // than laying a second across the same measure.
      return handlers.onInsertOrnament?.(mark, without);
    }
    case "insert": {
      if (value === "overlay") return handlers.onAddOverlay?.();
      if (value === "drop-panel") {
        const existing = Array.isArray(view.insetPanels) ? view.insetPanels : [];
        return patch({ insetPanels: existing.slice(0, -1) });
      }
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
    // Lit for a chart in a PANEL as well as one filling the block - a desk
    // looking at the bar is asking "is there a chart here", not "which of the
    // two places is it stored in".
    chart: hasChart(view),
    rule: hasOrnament(view),
    justify: view.textAlign === "justify",
    // Lit means the dateline IS printed, which is the ordinary state - so this
    // is the one button on the bar that starts on.
    dateline: view.showDateline !== false,
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

  // The three type sizes, as they actually are. A stepper with no read-out is
  // a control a desk presses hopefully; these say the number the block is set
  // in, and the columns are NUMERIC(5,1), so half points show as half points
  // and whole ones do not show a trailing zero.
  for (const spec of SIZE_FIELDS) {
    const out = bar.querySelector(`[data-size-out="${spec.field}"]`);
    if (!out) continue;
    const value = Number(view[spec.field]);
    out.textContent = Number.isFinite(value) && value > 0
      ? String(Math.round(value * 10) / 10)
      : "—";
  }
}
