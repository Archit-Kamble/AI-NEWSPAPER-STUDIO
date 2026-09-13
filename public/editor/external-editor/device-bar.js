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
import { TINTS, INKS, HEADLINE_STYLES } from "../layout/inks.js";
import { BLOCK_SHAPES } from "../layout/block-shapes.js";

const { BORDER_STYLES, BORDER_WIDTHS, BORDER_RADII, canRound, isRuled } = globalThis.SahasBorders;
const { TYPEFACES } = globalThis.SahasTypefaces;
const { INSET_PANEL_KINDS, INSET_PANEL_ORNAMENTS, defaultPanelFor } = globalThis.SahasInsetPanels;

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
  // THE RULE'S OWN THREE DECISIONS, beside the rule itself. Each was reachable
  // only by scrolling Properties in the settings rail, which is the fault this
  // whole file exists to fix, one catalogue at a time. All three read the same
  // shared tables the panel does, so the bar cannot grow a second vocabulary.
  //
  // Weight is NAMED, not stated in points - the desk asked for it that way -
  // while what is STORED is still the printer's unit, which is what the .sla,
  // the PDF and the IDML all read.
  "rule-width": () => BORDER_WIDTHS.map((w) => ({ value: String(w.px), label: w.label })),
  // A corner can only be rounded where a rule meets a rule, so a block that is
  // not boxed offers this button disabled rather than a menu that would draw
  // nothing - `canRound()` is the catalogue's own answer, not a second copy.
  corner: () => BORDER_RADII.map((r) => ({ value: String(r.px), label: r.label })),
  // Black carries no hex in the palette - choosing it CLEARS, which is the
  // difference between a choice and a state, and is exactly how the marks
  // toolbar's own ink picker and Properties already behave. The stored NULL is
  // the state `--block-ink`'s CSS fallback already paints, so an "Auto" entry
  // beside it would offer the same thing twice.
  "rule-ink": () => INKS.map((i) => ({ value: i.hex || "", label: i.label, swatch: i.hex })),
  // "HEADING BACKGROUND COLOUR", which is what the desk asked for: `reverse` is
  // white type out of a solid panel and the `band` treatments lay a screen
  // behind the headline, the deck, or both. It is one field, so it is one menu.
  "head-style": () => HEADLINE_STYLES.map((h) => ({ value: h.key, label: h.label })),
  // A rule ink (too light to hold type) is offered for rules and grounds only.
  "head-ink": () => INKS.filter((i) => !i.rule).map((i) => ({ value: i.hex || "", label: i.label, swatch: i.hex })),
  // ACCENT IS A DIFFERENT OBJECT and must not be merged into the one above: it
  // fills a reversed or screened band and colours the accent word, never the
  // headline's own running text. `accent_color` is NOT NULL with a real
  // default, so there is no unset state to clear back to - offering Black here
  // would send an empty value into the repository's own COALESCE and do
  // nothing, which is the other documented shape of a dead control.
  accent: () => INKS.filter((i) => i.hex).map((i) => ({ value: i.hex, label: i.label, swatch: i.hex })),
  shape: () => BLOCK_SHAPES.map((b) => ({ value: b.key, label: b.label })),
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
  // A device must be removable, and the way out lives beside the way in - so
  // the menu carries the removal, disabled rather than hidden when there is
  // nothing to remove.
  table: (view) => [
    { value: "open", label: hasTable(view) ? "Edit this table…" : "Add a table…" },
    { value: "remove", label: "Remove the table", danger: true, disabled: !hasTable(view) },
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
    ...INSET_PANEL_KINDS.filter((k) => k.key !== "chart" && k.key !== "table" && k.key !== "ornament")
      .map((k) => ({ value: `panel:${k.key}`, label: k.label })),
    { value: "overlay", label: "Picture across blocks" },
    // A PICTURE FROM A LINK. The desk has the URL - a wire photograph, an
    // agency link, something sent by email - and had no way to give it to a
    // block short of downloading it by hand and uploading it again. It ends in
    // the same placement an uploaded picture gets; only the way the bytes
    // arrive is different.
    { value: "picture-link", label: "Picture from a link…" },
    { value: "drop-panel", label: "Remove the last panel", danger: true, disabled: !panelCount(view) },
  ],
};

/** Is there a chart on this block at all - in the block itself, or in a panel? */
const hasTable = (view) => view?.smartCardKey === "table"
  || (Array.isArray(view?.insetPanels) && view.insetPanels.some((p) => p?.kind === "table"));
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
//
// AND THE TWO DISPLAY SIZES ARE A REQUEST UNTIL A DESK LOCKS THEM.
//
// compose.js FITS display type - it shrinks a headline that will not set in
// its band and grows one that leaves its measure short, which is most of what
// makes a page look composed. So a desk that typed 34 and saw 27 on the page
// had a control that appeared to do nothing: the report was "if we
// increase/decrease headline size it is not reflecting in editor".
//
// Both readings are right, so the control says which is in force. The read-out
// shows what the page IS SET IN, not what was asked for - an auto-fitted size
// in light type, a locked one in bold - and pressing a step locks it, because
// a desk reaching for the size is asking for that size. The letter beside it
// unlocks again and hands the decision back to the compositor.
const SIZE_FIELDS = Object.freeze([
  { field: "headlineFontPx", label: "Headline", short: "H", step: 1, min: 8, max: 140,
    lock: "headlineLocked", band: "headline" },
  { field: "subheadingFontPx", label: "Deck", short: "D", step: 1, min: 8, max: 90,
    lock: "subheadingLocked", band: "deck" },
  // The body is never auto-fitted - it is the measure everything else is
  // reserved against - so it has nothing to lock.
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
      <!-- The buttons live in a RAIL that scrolls; the menu below is a sibling
           of the rail, not a child of it, so it can open out of the bar. A
           menu inside the scroller is a menu nobody can see. -->
      <span class="device-bar-rail" id="edDeviceRail">
      <span class="dev-group">
        ${button("border", "▣", "Border", "How this block is ruled — none, a box, a rule above or below")}
        ${button("ground", "▤", "Tint", "A light ground behind the whole block, from the paper's own palette")}
        ${button("columns", "▥", "Columns", "How many columns the copy is set in — Auto works it out from the width")}
        ${button("shape", "◇", "Shape", "Cut a corner off the block — the compositor sets the copy clear of it")}
      </span>
      <!-- THE RULE'S OWN DECISIONS. Each of these was set only by scrolling
           Properties in the settings rail, and each is a decision a desk makes
           while looking at the block, not at a panel. Rule width and rule ink
           are disabled while the block carries no rule, and Corner while its
           rule has no two edges to meet - a control that cannot act is not
           offered, which is this file's own rule. -->
      <span class="dev-group">
        ${button("rule-width", "═", "Rule width", "How heavy the block's rule is — Small to Extra large, stored in the printer's points", { wide: true })}
        ${button("corner", "◜", "Corner", "Round the corners of a boxed block")}
        ${button("rule-ink", "▭", "Rule ink", "The colour of the block's rule, from the paper's own inks", { wide: true })}
      </span>
      <!-- HOW THE HEADLINE IS DRESSED. "Head band" is the desk's own request -
           a background behind the heading - and it is one field: reversed is
           white type out of a solid panel, the screens lay a light ground
           behind the headline, the deck or both. -->
      <span class="dev-group">
        ${button("head-style", "▬", "Head band", "A panel or a screen behind the headline — reversed, screened, ruled or a section tab", { wide: true })}
        ${button("head-ink", "A", "Head ink", "The headline's own colour — Black clears it back to the paper's default", { wide: true })}
        ${button("accent", "◆", "Accent", "The ink that fills a reversed or screened band, and colours the accent word")}
      </span>
      <!-- THE THREE TYPE SIZES. On the bar rather than in a panel, because a
           desk changing a headline is looking at the headline. -->
      <span class="dev-group dev-sizes">
        ${SIZE_FIELDS.map((f) => `<span class="dev-size" data-size-field="${f.field}">
          ${f.lock
            ? `<button type="button" class="dev-size-lock" data-size-lock="${f.lock}"
                 title="${escapeHtml(f.label)} size — press to hand the size back to the compositor, or to hold the one you chose">${f.short}</button>`
            : `<b title="${escapeHtml(f.label)} size">${f.short}</b>`}
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
        ${button("justify", "▤", "Justify", "Set the copy flush to BOTH edges of the column, closing each line as far as is decent")}
        ${button("justify-all", "▥", "Justify lines", "Force EVERY line but a paragraph's last to reach both edges — wider word gaps where it takes them", { wide: true })}
        ${button("dateline", "■", "Dateline", "Open the story with ■ location, reporter — or don't")}
      </span>
      <span class="dev-group">
        ${button("insert", "❏", "Insert", "A fact box, pull quote, cross-head, separator — or a picture laid across two blocks")}
        ${button("rule", "═", "Separator", "A decorative rule across the measure, between two parts of the story")}
        ${button("chart", "▮", "Chart", "Bars, a pie, a line, dots or plain figures")}
        ${button("table", "▦", "Table", "Rows and columns - a result, a rate, a fixture list")}
      </span>
      <span class="dev-group">
        ${button("caption", "❝", "Caption", "Write the line under the picture")}
        ${button("ai-picture", "✦", "AI picture", "Ask the AI for a picture — it proposes, you place it")}
      </span>
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
  // The RAIL is what scrolls now, so it is the rail's scroll position that
  // decides where a button actually is on screen.
  const rail = anchor.closest(".device-bar-rail");
  host.style.left = `${anchor.offsetLeft - (rail ? rail.scrollLeft : 0)}px`;
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
  return defaultPanelFor(kind, {
    width: Number(section?.width_px) || 200,
    height: Number(section?.height_px) || 200,
  }, Number(view?.bodyFontPx) || 6.4);
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
    const lockBtn = target.closest("[data-size-lock]");
    if (lockBtn) {
      const view = live?.getView?.() || {};
      const key = lockBtn.dataset.sizeLock;
      patch({ [key]: !view[key] });
      return;
    }

    const step = target.closest("[data-size-step]");
    if (step) {
      const field = step.closest("[data-size-field]")?.dataset.sizeField;
      const spec = SIZE_FIELDS.find((f) => f.field === field);
      if (!spec) return;
      const view = live?.getView?.() || {};
      // WHAT THE PAGE IS ACTUALLY SET IN is what a step moves from. Stepping
      // up from the stored 34 on a block the compositor is setting at 27 would
      // ask for 35 and change nothing a desk could see - twice.
      const from = spec.lock && !view[spec.lock] ? resolvedOf(spec) : null;
      const now = Number.isFinite(from) && from > 0 ? from : Number(view[field]);
      const base = Number.isFinite(now) && now > 0 ? now : spec.min;
      const next = step.dataset.sizeStep === "up" ? base + spec.step : base - spec.step;
      // The columns are NUMERIC(5,1) and arrive over the wire as strings; a
      // float that has drifted through a few halvings would store as 12.30000001
      // and read back as something a desk never chose.
      const clamped = Math.round(Math.min(spec.max, Math.max(spec.min, next)) * 10) / 10;
      if (clamped === base && (!spec.lock || view[spec.lock])) return;
      // A step is a decision, so it holds. The compositor still refuses a size
      // that genuinely cannot be set - it reports the block overset rather
      // than silently resizing - which is the honest answer to "I asked for
      // type this size and it does not fit".
      patch(spec.lock ? { [field]: clamped, [spec.lock]: true } : { [field]: clamped });
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
    if (device === "justify" || device === "justify-all") {
      // Two settings of one field, so each button turns the other off rather
      // than the two lighting at once and the block quietly obeying one.
      patch({ textAlign: view.textAlign === device ? "left" : device });
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
    case "rule-width": return view.borderWidthPx == null ? "" : String(view.borderWidthPx);
    case "corner": return String(Number(view.borderRadiusPx) || 0);
    case "rule-ink": return view.borderInk || "";
    case "head-style": return view.headlineStyle || "plain";
    case "head-ink": return view.headlineInk || "";
    case "accent": return view.accentColor || "";
    case "shape": return view.frameShape || "rectangle";
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
    case "rule-width": return patch({ borderWidthPx: Number(value) });
    case "corner": return patch({ borderRadiusPx: Number(value) });
    // An empty value is Black, which carries no hex and therefore CLEARS.
    case "rule-ink": return patch({ borderInk: value || null });
    case "head-style": return patch({ headlineStyle: value });
    case "head-ink": return patch({ headlineInk: value || null });
    case "accent": return patch({ accentColor: value });
    // `rectangle` is the absence of a cut, and the column's own empty state.
    case "shape": return patch({ frameShape: value === "rectangle" ? "" : value });
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
    // A TABLE asks the same two questions a chart does before it can draw
    // anything - how much room, and what is in it - so it opens its own dialog
    // rather than writing a guess into the block. See table-dialog.js.
    case "table": {
      if (value === "remove") {
        return patch({
          insetPanels: (Array.isArray(view.insetPanels) ? view.insetPanels : []).filter((p) => p?.kind !== "table"),
          ...(view.smartCardKey === "table" ? { smartCardKey: null, smartCardData: null } : {}),
        });
      }
      return handlers.onTable?.();
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
      if (value === "picture-link") return handlers.onPictureLink?.();
      if (value === "drop-panel") {
        const existing = Array.isArray(view.insetPanels) ? view.insetPanels : [];
        return patch({ insetPanels: existing.slice(0, -1) });
      }
      const kind = String(value).slice("panel:".length);
      const existing = Array.isArray(view.insetPanels) ? view.insetPanels : [];
      const added = panelFor(kind, section, view);
      patch({ insetPanels: [...existing, added] });
      // AND THE WAY TO WRITE IN IT, because otherwise this button adds a box
      // reading "इथे मजकूर लिहा" and stops. The panel's own fields have always
      // existed - Properties lists every panel on the block with a heading, its
      // lines, its marker, its ground and its rectangle - but Properties only
      // draws them while the WHOLE BLOCK is the selected object
      // (properties-panel.js's bodyMarkupFor), and Insert is pressed with the
      // story or the headline selected. So the desk got a panel they could see
      // and could not reach, which is the report "Insert button in ediotor is
      // use less as it add a block which we cannot edit". The way out lives
      // beside the way in.
      return handlers.onPanelAdded?.(added.id);
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
// What the compositor actually resolved for each display band on the block now
// showing. Held here so a stepper can move from the size on the PAGE rather
// than from the size in the row - see the step handler.
let resolved = {};
const resolvedOf = (spec) => (spec.band ? Number(resolved[spec.band]) : NaN);

export function refreshDeviceBar(view = {}, composition = null) {
  const bar = document.getElementById("edDeviceBar");
  if (!bar) return;
  resolved = {
    headline: composition?.bands?.headline?.resolvedPx,
    deck: composition?.bands?.deck?.resolvedPx,
  };
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
    table: hasTable(view),
    rule: hasOrnament(view),
    justify: view.textAlign === "justify",
    "justify-all": view.textAlign === "justify-all",
    // Lit means the dateline IS printed, which is the ordinary state - so this
    // is the one button on the bar that starts on.
    dateline: view.showDateline !== false,
    display: Boolean(view.displayFamily),
    shape: Boolean(view.frameShape),
    "rule-width": view.borderWidthPx != null,
    corner: Number(view.borderRadiusPx) > 0,
    "rule-ink": Boolean(view.borderInk),
    // Lit when the headline is dressed at all - plain is the ordinary state.
    "head-style": (view.headlineStyle || "plain") !== "plain",
    "head-ink": Boolean(view.headlineInk),
    // `accent` is deliberately NOT here: accent_color is NOT NULL with a real
    // default, so every block has one and a permanently lit button says
    // nothing. It is the warning-that-is-always-on fault, in miniature.
  };
  // A CONTROL THAT CANNOT ACT IS NOT OFFERED, and on a fixed row that means
  // disabled rather than removed - a button that came and went as the block
  // changed would move every button beside it under the desk's pointer, which
  // is the fault the bar's own scroll-don't-wrap rule exists to prevent. The
  // title says why, because a disabled control with no reason is a dead end.
  const border = view.borderStyle || "none";
  const off = {
    "rule-width": !isRuled(border) && "Rule this block first — a block with no rule has no width to set",
    "rule-ink": !isRuled(border) && "Rule this block first — a block with no rule has no colour to set",
    corner: !canRound(border) && "Box this block first — a corner needs a rule on both of its edges to round",
  };
  bar.querySelectorAll("[data-device]").forEach((element) => {
    const key = element.dataset.device;
    element.classList.toggle("is-on", Boolean(on[key]));
    const why = off[key];
    // The button's own title is kept, or a control that was disabled once
    // would carry the explanation for the rest of the session - refresh runs
    // many times between renders.
    if (element.dataset.baseTitle === undefined) element.dataset.baseTitle = element.title;
    element.disabled = Boolean(why);
    element.title = why || element.dataset.baseTitle;
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
    const locked = spec.lock ? Boolean(view[spec.lock]) : true;
    // The size the PAGE is set in. A desk looking at a headline wants the
    // number under it to be that headline's, not a request the compositor
    // overruled - that mismatch is the whole of "it is not reflecting".
    const shown = !locked && Number.isFinite(resolvedOf(spec)) && resolvedOf(spec) > 0
      ? resolvedOf(spec)
      : Number(view[spec.field]);
    out.textContent = Number.isFinite(shown) && shown > 0
      ? String(Math.round(shown * 10) / 10)
      : "—";
    // Bold means the desk's number is being honoured exactly; light means the
    // compositor is fitting the band and this is what it chose.
    out.classList.toggle("is-fitted", spec.lock ? !locked : false);
    const lockButton = bar.querySelector(`[data-size-lock="${spec.lock}"]`);
    if (lockButton) lockButton.classList.toggle("is-on", locked);
  }
}
