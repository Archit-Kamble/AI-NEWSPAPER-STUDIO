// Part 1: the editor's tab strip.
//
// Tabs preserve state in two senses, both required: the *active* tab survives
// selection changes and re-renders (it lives here, not in a re-rendered DOM),
// and each tab's own scroll position and transient UI state survive being
// switched away from - panels are rendered once and hidden, never destroyed.

// The story text is written in the Inspector, above - this dock is where the
// image, the fit and the AI composition happen, which is the second half of the
// production flow (write -> save -> compose -> save -> back to the page).
export const TABS = [
  { key: "images", label: "Images" },
  { key: "typography", label: "Typography" },
  { key: "layout", label: "Fit & Layout" },
  { key: "ai", label: "AI" },
  { key: "assets", label: "Assets" },
  { key: "history", label: "History" },
];

const STORAGE_KEY = "sahas.editor.activeTab";

let activeTab = readStoredTab();
const scrollPositions = new Map();

function readStoredTab() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return TABS.some((t) => t.key === stored) ? stored : "images";
  } catch {
    return "images";
  }
}

export function getActiveTab() {
  return activeTab;
}

export function tabStripMarkup() {
  return `
    <div class="ext-tabs" role="tablist">
      ${TABS.map(
        (tab) => `
        <button type="button" role="tab" class="ext-tab${tab.key === activeTab ? " active" : ""}"
                data-tab="${tab.key}" aria-selected="${tab.key === activeTab}">${tab.label}</button>`,
      ).join("")}
    </div>
  `;
}

export function tabPanelsMarkup(panelMarkupByKey) {
  return TABS.map(
    (tab) => `
      <section class="ext-tab-panel${tab.key === activeTab ? " active" : ""}" data-tab-panel="${tab.key}" role="tabpanel">
        ${panelMarkupByKey[tab.key] || ""}
      </section>`,
  ).join("");
}

export function bindTabs(onTabChange) {
  document.querySelectorAll(".ext-tab").forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.tab, onTabChange));
  });

  // Restore each panel's scroll position as it is revealed, and remember it as
  // it is hidden, so switching tabs never loses the reader's place.
  document.querySelectorAll(".ext-tab-panel").forEach((panel) => {
    panel.addEventListener("scroll", () => {
      scrollPositions.set(panel.dataset.tabPanel, panel.scrollTop);
    });
  });
  restoreScroll(activeTab);
}

export function setActiveTab(tabKey, onTabChange) {
  if (!TABS.some((t) => t.key === tabKey)) return;

  const previous = document.querySelector(".ext-tab-panel.active");
  if (previous) scrollPositions.set(previous.dataset.tabPanel, previous.scrollTop);

  activeTab = tabKey;
  try {
    localStorage.setItem(STORAGE_KEY, tabKey);
  } catch {
    // Storage being unavailable must not stop the tab from switching.
  }

  document.querySelectorAll(".ext-tab").forEach((button) => {
    const on = button.dataset.tab === tabKey;
    button.classList.toggle("active", on);
    button.setAttribute("aria-selected", String(on));
  });
  document.querySelectorAll(".ext-tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.tabPanel === tabKey);
  });

  restoreScroll(tabKey);
  onTabChange?.(tabKey);
}

function restoreScroll(tabKey) {
  const panel = document.querySelector(`.ext-tab-panel[data-tab-panel="${tabKey}"]`);
  if (panel) panel.scrollTop = scrollPositions.get(tabKey) || 0;
}
