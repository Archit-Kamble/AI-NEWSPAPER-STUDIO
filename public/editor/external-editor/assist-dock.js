// THE DESK'S RIGHT-HAND COLUMN, AS A DOCK.
//
// It was a stack. AI, then Layout, then Smart cards, all three always drawn,
// one under the other - measured on a real front page at 1512x950, the column
// ran 1519px with the viewport 950 tall, and the panels a desk reaches for
// most were not in it at all: Properties, Typography, Story details and
// History live in the settings rail beside the page, capped to the page's own
// height, which measured a 462px window holding 2866px of panels.
//
// So the desk's report, and it is two reports with one cause:
//
//   "Images block functionalities should appear in editor after selecting the
//    image"
//   "All blocks like story details we should give button on editor and then
//    right side block should minimize and that selected block appear so he
//    will not scroll page"
//
// Both are the same sentence: THE PANEL A DESK HAS JUST ASKED FOR MUST COME TO
// THEM. Selecting a picture put its controls 1200px down the page; opening
// Story details meant finding a 462px window and scrolling inside it.
//
// One strip of buttons at the head of this column, one panel under it. The
// column stops being 1519px of everything and becomes the height of the one
// thing being used.
//
// NOTHING HERE IS A SECOND COPY OF A PANEL, and that is the whole design.
// A tab does not re-render its panel; it MOVES the panel's own element into
// this column and moves it back on the way out. Every listener a panel bound
// is bound to its own nodes and survives the move, so there is no re-binding,
// no second state, and no way for the docked copy and the real one to drift -
// which is the failure this project has been bitten by more than once.

// Where each panel lives when it is not docked here. `home` is the element it
// goes back into; `open` names the <details> inside it to open when the tab is
// pressed, so "Story" lands on Story details rather than on whatever the rail
// happened to have open.
const MOVED = {
  picture: { node: "edPictureControls" },
  block: { node: "workspaceToolsPanel", home: "workspaceTools", open: "properties" },
  type: { node: "workspaceToolsPanel", home: "workspaceTools", open: "typography" },
  story: { node: "workspaceToolsPanel", home: "workspaceTools", open: "story-details" },
  history: { node: "workspaceToolsPanel", home: "workspaceTools", open: "history" },
};

// WHERE A PANEL GOES BACK TO.
//
// The rail's host has a stable home (`#workspaceTools`), because it lives
// outside the Block Editor and survives every repaint. The picture controls do
// not: they are written INTO the story column by `pictureControlsMarkup()`, so
// their element is a new one after each render and their home is simply
// whichever parent that render gave them. Naming a fixed socket for them was
// tried and is wrong - "home" would then be a place they had never been, and
// the first tab switch would move them permanently out of the story column.
//
// So the parent is remembered the first moment this module sees the element
// undocked, and forgotten when a fresh element replaces it.
const homes = new WeakMap();

function homeOf(entry) {
  if (entry.home) return document.getElementById(entry.home);
  const el = document.getElementById(entry.node);
  return el ? homes.get(el) || null : null;
}

function rememberHome(entry) {
  if (entry.home) return;
  const el = document.getElementById(entry.node);
  const dock = document.getElementById("edAssistDock");
  if (!el || !el.parentElement) return;
  // Only while it is at home. A docked element's parent is the dock.
  if (dock && el.parentElement === dock.parentElement) return;
  homes.set(el, el.parentElement);
}

function sendHome(entry) {
  const el = document.getElementById(entry.node);
  const back = homeOf(entry);
  if (el && back && el.parentElement !== back) back.appendChild(el);
}

// The groups already in this column, by the `data-group` their section carries.
const OWN = { ai: "ai", layout: "space", cards: "card" };

const TABS = [
  { key: "ai", label: "AI", title: "Write, fill and optimise this block" },
  { key: "layout", label: "Layout", title: "How much room this block has left" },
  { key: "cards", label: "Cards", title: "The paper's standing daily features" },
  { key: "picture", label: "Picture", title: "The selected picture: crop, wrap, rotate, order", needsPicture: true },
  { key: "block", label: "Block", title: "Properties: border, ground, columns, drop cap", rail: true },
  { key: "type", label: "Type", title: "Typography: faces, sizes, alignment", rail: true },
  { key: "story", label: "Story", title: "Story details: reporter, location, category", rail: true },
  { key: "history", label: "History", title: "What has changed on this block", rail: true },
];

let active = "ai";
let bound = false;

export function activeAssistTab() {
  return active;
}

export function assistDockMarkup(hasPicture) {
  return `
    <div class="assist-dock" role="tablist" aria-label="Block editor panels" id="edAssistDock">
      ${TABS.map((tab) => {
        const off = tab.needsPicture && !hasPicture;
        return `<button type="button" role="tab" class="assist-tab${tab.rail ? " is-rail" : ""}"
                  data-assist-tab="${tab.key}"
                  aria-selected="${active === tab.key ? "true" : "false"}"
                  ${off ? "disabled" : ""}
                  title="${off ? "Select a picture on the block first" : tab.title}">${tab.label}</button>`;
      }).join("")}
    </div>
`;
}

/**
 * Puts every moved panel back where it belongs.
 *
 * MUST run before `renderExternalEditor` rewrites the dock's innerHTML.
 * `#workspaceToolsPanel` lives in the settings rail, which is OUTSIDE that
 * container - so while it is docked here it is inside the element about to be
 * wiped, and the wipe would destroy the rail's only panel host. The rail would
 * then be permanently empty, which is a far worse fault than the one this
 * module fixes.
 */
export function releaseDockedPanels() {
  Object.values(MOVED).forEach(sendHome);
}

function openOnly(name) {
  const panel = document.getElementById("workspaceToolsPanel");
  if (!panel || !name) return;
  const asides = [...panel.querySelectorAll(":scope > details.ext-aside")];
  asides.forEach((aside) => {
    const summary = aside.querySelector("summary")?.textContent?.trim().toLowerCase() || "";
    const slug = summary.replace(/\s+/g, "-");
    aside.open = slug === name;
  });
  // The rail's own default is Properties and Typography open. A tab that names
  // neither would otherwise leave the rail closed up when the desk goes back.
  if (!asides.some((a) => a.open)) asides.slice(0, 1).forEach((a) => { a.open = true; });
}

/** Shows the active tab's panel and hides the rest. Safe to call on every render. */
export function applyAssistTab() {
  const col = document.querySelector(".ext-assist-col");
  if (!col) return;

  const hasPicture = !document.querySelector('[data-assist-tab="picture"]')?.disabled;
  if (active === "picture" && !hasPicture) active = "ai";

  // The column's own three groups.
  Object.entries(OWN).forEach(([tab, groupKey]) => {
    const section = col.querySelector(`.ext-group[data-group="${groupKey}"]`);
    if (section) section.hidden = active !== tab;
  });

  // Anything moved in that is not this tab's goes home first, so two panels can
  // never be docked at once.
  Object.entries(MOVED).forEach(([tab, entry]) => {
    if (tab === active) return;
    sendHome(entry);
    rememberHome(entry);
  });

  const moved = MOVED[active];
  if (moved) {
    rememberHome(moved);
    const el = document.getElementById(moved.node);
    const dock = document.getElementById("edAssistDock");
    if (el && dock && el.parentElement !== dock.parentElement) {
      dock.insertAdjacentElement("afterend", el);
      el.classList.add("is-docked");
    }
  }
  // A panel that is home again is not a docked panel.
  Object.values(MOVED).forEach((entry) => {
    const el = document.getElementById(entry.node);
    if (el && el.parentElement !== document.getElementById("edAssistDock")?.parentElement) {
      el.classList.remove("is-docked");
    }
  });
  // Opened AFTER the move, so the <details> that is opened is the one now in
  // the dock rather than one about to be moved out from under the desk.
  if (moved?.open) openOnly(moved.open);

  col.querySelectorAll("[data-assist-tab]").forEach((button) => {
    button.setAttribute("aria-selected", button.dataset.assistTab === active ? "true" : "false");
  });

  // THE SETTINGS COLUMN CLOSES WHILE ITS PANEL IS OVER HERE.
  //
  // Moving the rail's one panel into this column left `#workspaceTools` as a
  // 340px band of nothing beside the sheet - measured, 97px of header inside a
  // 633px grid row - which is the desk's "block settings leaving a big gap
  // below, not using full page". Closing the column hands that width to the
  // page: the canvas host goes 1166px -> 1512px.
  //
  // The state is a class rather than a `:has()` selector because `:has()`
  // cannot be nested inside `:has()` - the rule needed two levels and Chrome
  // drops such a selector silently.
  const top = document.querySelector(".workspace-top");
  const rail = document.getElementById("workspaceTools");
  if (top && rail) {
    top.classList.toggle("tools-lent", !rail.querySelector(".workspace-tools-body"));
  }
}

export function showAssistTab(key) {
  if (!TABS.some((tab) => tab.key === key)) return;
  active = key;
  applyAssistTab();
  document.querySelector(`[data-assist-tab="${key}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/**
 * A PICTURE THE DESK HAS JUST SELECTED BRINGS ITS OWN CONTROLS.
 *
 * This is the desk's item 5. Called from wherever a picture becomes the
 * selected object - the pictures list, a click on the frame, a drag - so the
 * controls arrive beside the block rather than at the foot of the page.
 *
 * Deliberately NOT called when the picture is deselected: switching the desk
 * away from a panel they did not ask to leave is the viewport-throwing fault
 * this repository has already fixed twice.
 */
export function revealPicturePanel() {
  const tab = document.querySelector('[data-assist-tab="picture"]');
  if (!tab) return;
  tab.disabled = false;
  tab.title = "The selected picture: crop, wrap, rotate, order";
  showAssistTab("picture");
}

// Bound ONCE, at the document, and delegated - this column is rewritten on
// every repaint, so a listener bound to the strip itself is on a detached node
// from the next render. That is the `#edSpaceGroup` trap and the device bar's,
// and it is the reason a control draws perfectly and does nothing.
export function bindAssistDock() {
  if (bound) return;
  bound = true;
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-assist-tab]");
    if (!button || button.disabled) return;
    event.preventDefault();
    showAssistTab(button.dataset.assistTab);
  });
}
