import { renderWorkspace, leaveWorkspace } from "./editor/workspace.js";
import { startNavigation, navigate, stopNavigation } from "./admin/navigation.js";
import { renderEditions } from "./admin/editions.js";
import { renderEpapers } from "./admin/epapers.js";
import { renderReporterManagement } from "./admin/staff.js";
import { renderGeneralSettings } from "./admin/settings.js";
import { escapeHtml } from "./editor/format.js";

const app = document.getElementById("app");

// WHAT THIS PERSON MAY DO IS THE SERVER'S ANSWER, NOT A COPY OF ITS RULES.
//
// This file used to carry `DESK_ROLES = ["admin", "editor", "chief_editor"]` -
// a second statement of a rule whose first statement is src/auth/roles.js, and
// a second catalogue is the failure this project has been bitten by twice. Both
// /api/auth/login and /api/auth/me now answer with `user.can`, so the browser
// has no rules in it at all: it hides a control it is told `false` for, and the
// server checks the same table again when the request arrives. Hiding is a
// courtesy to the desk; it is never the guard.
const can = (capability) => Boolean(currentUser?.can?.[capability]);

let currentUser = null;
let currentLanguage = "mr";
let editingDraftId = null;
let currentDraft = null;
let selectedReporterImages = [];

function toggleAppSidebar() {
  document.querySelector(".sidebar")?.classList.toggle("open");
  document.querySelector(".sidebar-app-backdrop")?.classList.toggle("open");
}

function closeAppSidebar() {
  document.querySelector(".sidebar")?.classList.remove("open");
  document.querySelector(".sidebar-app-backdrop")?.classList.remove("open");
}

function wireAppSidebarToggle() {
  document.getElementById("appSidebarToggle").addEventListener("click", toggleAppSidebar);
  document.getElementById("sidebarAppBackdrop").addEventListener("click", closeAppSidebar);
  // Escape closes it, the way it closes every other panel in this product
  // (the workspace's own panels already do). A drawer with a z-index 250
  // backdrop over the whole screen that only one particular click will shut is
  // the one panel a desk can get stuck behind.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAppSidebar();
  });
  document.querySelector(".sidebar").addEventListener("click", (event) => {
    if (event.target.classList.contains("sidebar-btn")) closeAppSidebar();
  });
}

async function init() {
  const res = await fetch("/api/auth/me");
  const data = await res.json();
  currentUser = data.user;
  // `role === "admin"` here would have sent an editor or a Sampadak to the
  // REPORTER dashboard on every page load and reload - the login path already
  // asked the right question, so the two disagreed about the same account.
  if (!currentUser) renderLogin();
  else if (can("makeUp")) renderAdminDashboard();
  else renderReporterDashboard();
}

function renderLogin() {
  app.innerHTML = `
    <div class="login-container">
      <div class="login-box">
        <h1>SAHAS</h1>
        <p>AI Newspaper Publishing System</p>
        <div class="form-group">
          <label>Username</label>
          <input id="email" placeholder="admin@esahas.com" />
        </div>
        <div class="form-group">
          <label>Password</label>
          <input id="password" type="password" />
        </div>
        <button class="btn-login" id="loginBtn">Login</button>
        <p class="version">Version 1.0</p>
      </div>
    </div>
  `;

  document.getElementById("loginBtn").addEventListener("click", async () => {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    // What somebody's job is is not a fact about their email address. This
    // used to read `email.includes("admin") ? "admin" : "reporter"` and send
    // that guess to the server, which compares it against the real role and
    // refuses when the two differ - so a chief editor at sunil@sahasvarta.com
    // was told "Invalid credentials" with the right password, and a reporter
    // whose address happened to contain "admin" could not sign in at all.
    // With two seeded accounts the guess happened to be right; it breaks the
    // morning the customer adds their first member of staff.
    //
    // The server already knows the role - it reads it off the user row. So it
    // is asked, and its answer is what decides the screen.
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();
    if (response.ok) {
      currentUser = data.user;
      if (can("makeUp")) renderAdminDashboard();
      else renderReporterDashboard();
    } else {
      alert(data.error);
    }
  });
}

async function renderReporterDashboard() {
  app.innerHTML = `
    <div class="main-layout">
      <div class="header">
        <div class="header-left">
          <button class="hamburger-btn" id="appSidebarToggle" title="Menu">&#9776;</button>
          SAHAS
        </div>
        <div class="header-center">Hi ${escapeHtml(currentUser.name)}</div>
        <div class="header-right"><button id="logoutBtn">Logout</button></div>
      </div>
      <div class="container">
        <div class="sidebar-app-backdrop" id="sidebarAppBackdrop"></div>
        <aside class="sidebar">
          <button class="sidebar-btn" id="createBtn">Create News</button>
          <button class="sidebar-btn" id="draftBtn">My Drafts</button>
          <button class="sidebar-btn" id="submittedBtn">Submitted</button>
          <button class="sidebar-btn" id="approvedBtn">Approved</button>
          <button class="sidebar-btn" id="rejectedBtn">Rejected</button>
          <button class="sidebar-btn" id="profileBtn">Profile</button>
          <button class="sidebar-btn logout" id="logoutBtn2">Logout</button>
        </aside>
        <main class="content" id="content"></main>
        <aside class="right-panel" id="rightPanel"></aside>
      </div>
    </div>
  `;

  wireAppSidebarToggle();

  const logout = () => {
    currentUser = null;
    stopNavigation();
    renderLogin();
  };
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("logoutBtn2").addEventListener("click", logout);

  // A reporter's screens are addressed exactly as the desk's are, so their
  // Back button behaves the same way. A filing queue is `#!/news/pending`;
  // the status is the id because that is what makes one queue a different
  // screen from another.
  const SCREENS = {
    // Editing a draft IS the create screen with a draft in it, so the draft
    // is the address's id. Without that the bar said `#!/news/draft` while an
    // edit form was on screen, and a reload came back to the wrong thing.
    create: { button: "createBtn", render: (view) => {
      editingDraftId = view.id ? Number(view.id) : null;
      return showReporterCreateNews();
    } },
    news: { button: null, render: (view) => {
      const queues = {
        draft: ["draftBtn", "My Drafts"],
        pending: ["submittedBtn", "Submitted"],
        approved: ["approvedBtn", "Approved"],
        rejected: ["rejectedBtn", "Rejected"],
      };
      const [, title] = queues[view.id] || queues.draft;
      return showReporterNewsList(queues[view.id] ? view.id : "draft", title);
    } },
    profile: { button: "profileBtn", render: showReporterProfile },
  };
  const QUEUE_BUTTONS = { draftBtn: "draft", submittedBtn: "pending", approvedBtn: "approved", rejectedBtn: "rejected" };

  document.getElementById("createBtn").addEventListener("click", () => navigate({ screen: "create" }));
  document.getElementById("profileBtn").addEventListener("click", () => navigate({ screen: "profile" }));
  for (const [button, status] of Object.entries(QUEUE_BUTTONS)) {
    document.getElementById(button).addEventListener("click", () => navigate({ screen: "news", id: status }));
  }

  await startNavigation(async (view, { stale } = {}) => {
    const screen = Object.prototype.hasOwnProperty.call(SCREENS, view.screen) ? view.screen : "create";
    if (stale?.()) return;
    document.querySelectorAll(".sidebar-btn").forEach((b) => b.classList.remove("active"));
    const lit = screen === "news"
      ? Object.keys(QUEUE_BUTTONS).find((b) => QUEUE_BUTTONS[b] === view.id) || "draftBtn"
      : SCREENS[screen].button;
    document.getElementById(lit)?.classList.add("active");
    await SCREENS[screen].render(view);
  }, {
    home: { screen: "create" },
    allow: (view) => Object.prototype.hasOwnProperty.call(SCREENS, view.screen),
  });
}

function showReporterProfile() {
  const content = document.getElementById("content");
  const rightPanel = document.getElementById("rightPanel");
  content.innerHTML = `
    <div class="form-section">
      <h2>PROFILE</h2>
      <div class="profile-info">
        <div class="info-row">
          <label>Name:</label>
          <strong>${escapeHtml(currentUser.name)}</strong>
        </div>
        <div class="info-row">
          <label>Email:</label>
          <strong>${escapeHtml(currentUser.email)}</strong>
        </div>
        <div class="info-row">
          <label>Role:</label>
          <strong>${escapeHtml(currentUser.role)}</strong>
        </div>
      </div>
    </div>
  `;
  rightPanel.innerHTML = "";
}

async function showReporterNewsList(status, title) {
  const content = document.getElementById("content");
  const rightPanel = document.getElementById("rightPanel");
  let news;
  try {
    news = await fetch(`/api/news?status=${status}&reporterId=${currentUser.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
  } catch (error) {
    console.error("News list load failed:", error);
    rightPanel.innerHTML = `<h3>${escapeHtml(title)}</h3>`;
    content.innerHTML = '<div class="form-section"><p>This list could not be loaded. Check the connection and try again.</p></div>';
    return;
  }

  rightPanel.innerHTML = `<h3>${escapeHtml(title)}</h3><p>Click on any news to edit</p>`;

  content.innerHTML = `
    <div class="form-section">
      <h2>${title}</h2>
      <div class="news-list" id="newsList"></div>
    </div>
  `;

  const list = document.getElementById("newsList");
  if (news.length === 0) {
    list.innerHTML = "<p>No news in this category</p>";
    return;
  }

  news.forEach((newsItem) => {
    const item = document.createElement("div");
    item.className = "news-item";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(newsItem.title)}</strong>
        <p>${escapeHtml(newsItem.subheading || newsItem.subtitle || "")}</p>

<small>
${escapeHtml(newsItem.category || "")} •
${escapeHtml(newsItem.location || "")} •
${new Date(newsItem.created_at || newsItem.createdAt).toLocaleDateString()}
</small>
      </div>
    `;
    item.style.cursor = "pointer";
    item.addEventListener("click", () => {
      if (status === "draft") navigate({ screen: "create", id: newsItem.id });
      else renderReporterNewsDetails(newsItem);
    });
    list.appendChild(item);
  });
}

// A screen this person cannot reach is not drawn as a disabled button - it is
// not there at all. That is the opposite of the rule this product follows for
// a DEVICE ("a device must be removable, and the way out lives beside the way
// in", where off is disabled rather than hidden), and deliberately so: a device
// is something the desk might want, while a screen they have no authority for
// is not a thing they can turn on. Showing it would only teach them to press it.
const sidebarButton = (id, label, capability, extra = "") =>
  (can(capability) ? `<button class="sidebar-btn ${extra}" id="${id}">${label}</button>` : "");

async function renderAdminDashboard() {
  app.innerHTML = `
    <div class="main-layout">
      <div class="header">
        <div class="header-left">
          <button class="hamburger-btn" id="appSidebarToggle" title="Menu">&#9776;</button>
          SAHAS
        </div>
        <div class="header-center">Hi ${escapeHtml(currentUser?.name || "")}${currentUser?.roleLabel ? ` <span class="role-pill role-${escapeHtml(currentUser.role)}">${escapeHtml(currentUser.roleLabel)}</span>` : ""}</div>
        <div class="header-right"><button id="logoutBtn">Logout</button></div>
      </div>
      <div class="container">
        <div class="sidebar-app-backdrop" id="sidebarAppBackdrop"></div>
        <aside class="sidebar">
          ${sidebarButton("newEditionBtn", "+ New Edition", "makeUp", "sidebar-btn--primary")}
          ${sidebarButton("pastBtn", "Past Newspapers", "makeUp")}
          ${sidebarButton("pastNewsBtn", "Past News", "reviewCopy")}
          ${sidebarButton("reportersBtn", "Staff", "manageStaff")}
          ${sidebarButton("settingsBtn", "Settings", "settings")}
          ${sidebarButton("epaperBtn", "E-paper", "publish")}
          <button class="sidebar-btn logout" id="logoutBtn2">Logout</button>
        </aside>
        <main class="content" id="content"></main>
        <aside class="right-panel" id="rightPanel"></aside>
      </div>
    </div>
  `;

  wireAppSidebarToggle();

  const logout = () => {
    currentUser = null;
    // The login page is not one of the desk's screens, so routing stops and
    // the address is cleared - otherwise signing out leaves `#!/edition/54470`
    // in the bar and Back walks a signed-out browser through screens it can no
    // longer load.
    stopNavigation();
    renderLogin();
  };
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("logoutBtn2").addEventListener("click", logout);

  // Every screen this desk can reach, by the name it is addressed by. The
  // sidebar button is named beside it so exactly one of them can be lit -
  // `active` used to be hard-coded onto "Past Newspapers" in the markup and
  // never moved, so the sidebar said the desk was on the first screen whatever
  // screen they were actually on.
  const SCREENS = {
    "past-newspapers": { button: "pastBtn", needs: "makeUp", render: () => showPastNewspapers() },
    "new-edition": { button: "newEditionBtn", needs: "makeUp", render: () => showPastNewspapers({ openCreator: true }) },
    "past-news": { button: "pastNewsBtn", needs: "reviewCopy", render: showPastNews },
    reporters: { button: "reportersBtn", needs: "manageStaff", render: showReporters },
    settings: { button: "settingsBtn", needs: "settings", render: showSettings },
    epaper: { button: "epaperBtn", needs: "publish", render: () => renderEpapers(
      document.getElementById("content"),
      { rightPanel: document.getElementById("rightPanel") },
    ) },
    // Handled before `render` is reached - an edition is a screen with an id
    // rather than a screen with a panel. It lights Past Newspapers because
    // that is the list it came out of.
    edition: { button: "pastBtn", needs: "makeUp", render: () => {} },
  };

  // An address is reachable only if the screen exists AND this person holds the
  // capability it needs. Without the second half, an editor typing
  // `#!/settings` painted the owner's settings screen - every field of which
  // then answered 403, so the desk was shown a form that could not be saved
  // and no sentence saying why. A screen nobody can use is not a screen.
  const reachable = (screen) =>
    Object.prototype.hasOwnProperty.call(SCREENS, screen) && can(SCREENS[screen].needs);

  for (const [screen, entry] of Object.entries(SCREENS)) {
    if (screen === "edition") continue;
    document.getElementById(entry.button)?.addEventListener("click", () => navigate({ screen }));
  }

  await startNavigation(paintDeskScreen, {
    home: { screen: "past-newspapers" },
    // An address this desk has no screen for - or no authority for - is not
    // followed: a typed or stale hash lands on the dashboard rather than on a
    // blank panel or a form that will refuse every save.
    allow: (view) => reachable(view.screen),
  });

  async function paintDeskScreen(view, { stale } = {}) {
    const screen = reachable(view.screen) ? view.screen : "past-newspapers";
    // Leaving an open edition flushes whatever the desk was in the middle of
    // typing. Autosave is on a timer, so between the last keystroke and the
    // next tick the only copy of a sentence is in the draft - and Back is now
    // one keypress away from here.
    if (document.querySelector(".workspace-shell")) await leaveWorkspace();
    if (stale?.()) return;

    document.querySelectorAll(".sidebar-btn").forEach((b) => b.classList.remove("active"));
    document.getElementById(SCREENS[screen].button)?.classList.add("active");

    if (screen === "edition") {
      const id = Number(view.id);
      if (!Number.isInteger(id) || id <= 0) {
        await navigate({ screen: "past-newspapers" }, { replace: true });
        return;
      }
      document.querySelector(".container")?.classList.add("container--workspace");
      closeAppSidebar();
      const rightPanel = document.getElementById("rightPanel");
      if (rightPanel) { rightPanel.innerHTML = ""; rightPanel.style.display = "none"; }
      await renderWorkspace(id);
      return;
    }

    document.querySelector(".container")?.classList.remove("container--workspace");
    const rightPanel = document.getElementById("rightPanel");
    if (rightPanel) rightPanel.style.display = "";
    await SCREENS[screen].render(view);
  }
}

async function showPastNewspapers({ openCreator = false } = {}) {
  const content = document.getElementById("content");
  const rightPanel = document.getElementById("rightPanel");

  let news;
  try {
    news = await fetch("/api/news").then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
  } catch (error) {
    console.error("Dashboard load failed:", error);
    rightPanel.innerHTML = "<p>The newsroom status could not be loaded. Check the connection and reload.</p>";
    content.innerHTML = "";
    return;
  }

  const pending = news.filter((n) => n.status === "pending").length;
  const approved = news.filter((n) => n.status === "approved").length;
  const rejected = news.filter((n) => n.status === "rejected").length;
  const draft = news.filter((n) => n.status === "draft").length;

  rightPanel.innerHTML = `
<h3>Newsroom Status</h3>

<div class="dashboard-grid">

<div class="dashboard-stat">
<div class="value">${draft}</div>
<div class="label">Draft</div>
</div>

<div class="dashboard-stat">
<div class="value">${pending}</div>
<div class="label">Pending</div>
</div>

<div class="dashboard-stat">
<div class="value">${approved}</div>
<div class="label">Approved</div>
</div>

<div class="dashboard-stat">
<div class="value">${rejected}</div>
<div class="label">Rejected</div>
</div>

</div>
`;

  // The editions panel lives in its own module (CLAUDE.md: do not grow admin.js).
  // It owns today's edition card, the page ladder preview and the recent list;
  // opening one is still the dashboard's job, which is what onOpen is for.
  await renderEditions(content, { onOpen: (id) => editNewspaper(id), openCreator, mayDelete: can("deleteEdition") });
}

async function showPastNews() {
  const content = document.getElementById("content");
  const rightPanel = document.getElementById("rightPanel");
  let news;
  try {
    news = await fetch("/api/news").then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
  } catch (error) {
    console.error("News review load failed:", error);
    rightPanel.innerHTML = "<h3>Reporter News</h3>";
    content.innerHTML = '<div class="form-section"><p>This list could not be loaded. Check the connection and try again.</p></div>';
    return;
  }
  rightPanel.innerHTML =
    "<h3>Reporter News</h3><p>Review every reporter submission and approve it for publication.</p>";

  // A REVIEW QUEUE OF 1966 FILINGS IS NOT A LIST, IT IS A WALL.
  //
  // This used to append every filing to the live document one card at a time -
  // measured on this newsroom's own database: 1972 cards, 17,780 DOM nodes,
  // 1030 ms before the screen settled, with no way to search it. And every
  // approval called showPastNews() again, so passing one story cost the whole
  // wall a second time.
  //
  // Three changes, and none of them changes what the desk can reach: the cards
  // are built into a fragment and attached ONCE, the queue is searchable and
  // filtered by status the way the Reporters screen already is, and a decision
  // updates its own card instead of rebuilding the screen.
  content.innerHTML = `
    <div class="form-section">
      <h2>REPORTER NEWS REVIEW</h2>
      <div class="news-review-controls">
        <input id="adminNewsSearch" type="search" placeholder="Search by title, reporter or category…">
        <select id="adminNewsStatus">
          <option value="">All statuses</option>
          ${[...new Set(news.map((n) => n.status).filter(Boolean))].sort()
            .map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}
        </select>
        <span class="muted" id="adminNewsCount"></span>
      </div>
      <div class="news-list" id="adminNewsList"></div>
    </div>`;
  const list = document.getElementById("adminNewsList");
  if (!news.length) {
    list.innerHTML = "<p>No reporter news yet.</p>";
    return;
  }

  const search = document.getElementById("adminNewsSearch");
  const statusPick = document.getElementById("adminNewsStatus");
  const countLabel = document.getElementById("adminNewsCount");
  // The whole queue is still reachable - this is how many are DRAWN before the
  // desk narrows it, the same bound the editions list uses.
  const PAGE = 60;
  let shown = PAGE;

  const haystack = (item) => `${item.title || ""} ${item.reporter_name || item.reporterName || ""} ${item.category || ""}`.toLowerCase();
  const matching = () => {
    const q = search.value.trim().toLowerCase();
    const st = statusPick.value;
    return news.filter((item) => (!q || haystack(item).includes(q)) && (!st || item.status === st));
  };

  const cardFor = (item) => {
    const card = document.createElement("div");
    card.className = "admin-news-card";
    card.dataset.newsId = item.id;
    card.innerHTML = `<div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.reporter_name || item.reporterName || "Reporter")} · ${escapeHtml(item.category || "Uncategorised")}</small><p>${escapeHtml(item.description || "No description")}</p></div><div class="status-actions"><span class="status-pill ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span><button class="btn-secondary approve">Approve</button><button class="btn-secondary reject">Reject</button></div>`;

    const decide = async (status, button) => {
      const buttons = card.querySelectorAll("button");
      buttons.forEach((b) => { b.disabled = true; });
      const wasLabel = button.textContent;
      button.textContent = "…";
      try {
        // The answer is READ. Unchecked, a rejected PATCH - an expired session,
        // a 500 - repainted the same list with the same status and said
        // nothing, so a desk had no way to tell a refusal from a success.
        const response = await fetch(`/api/news/${item.id}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `The desk could not record that (HTTP ${response.status}).`);
        // Only this card changed, so only this card is repainted - passing one
        // story used to rebuild all 1966.
        item.status = status;
        const pill = card.querySelector(".status-pill");
        pill.className = `status-pill ${status}`;
        pill.textContent = status;
        if (statusPick.value && statusPick.value !== status) paint();
      } catch (error) {
        alert(error.message || "That could not be saved. Try again.");
      } finally {
        buttons.forEach((b) => { b.disabled = false; });
        button.textContent = wasLabel;
      }
    };

    card.querySelector(".approve").addEventListener("click", (e) => decide("approved", e.currentTarget));
    card.querySelector(".reject").addEventListener("click", (e) => decide("rejected", e.currentTarget));
    return card;
  };

  function paint() {
    const matches = matching();
    // ONE attachment, not 1966. Building into a fragment keeps every append
    // out of the live document until the whole batch is ready.
    const fragment = document.createDocumentFragment();
    matches.slice(0, shown).forEach((item) => fragment.appendChild(cardFor(item)));
    list.replaceChildren(fragment);

    if (matches.length > shown) {
      const more = document.createElement("button");
      more.className = "btn-secondary";
      more.textContent = `Show ${Math.min(PAGE, matches.length - shown)} more of ${matches.length}`;
      more.addEventListener("click", () => { shown += PAGE; paint(); });
      list.appendChild(more);
    }
    countLabel.textContent = matches.length === news.length
      ? `${news.length} filings`
      : `${matches.length} of ${news.length} filings`;
    if (!matches.length) list.innerHTML = "<p class=\"muted\">No filing matches that.</p>";
  }

  const renarrow = () => { shown = PAGE; paint(); };
  search.addEventListener("input", renarrow);
  statusPick.addEventListener("change", renarrow);
  paint();
}

function showReporters() {
  renderReporterManagement(document.getElementById("content"), {
    rightPanel: document.getElementById("rightPanel"),
  });
}

function showSettings() {
  renderGeneralSettings(document.getElementById("content"), {
    rightPanel: document.getElementById("rightPanel"),
  });
}

async function showReporterCreateNews() {
  const content = document.getElementById("content");
  const rightPanel = document.getElementById("rightPanel");
  selectedReporterImages = [];
  let existingImageUrls = [];

  rightPanel.innerHTML = `
    <h3>${editingDraftId ? "Editing Draft" : "Tips"}</h3>
    ${
      editingDraftId
        ? "<p>All changes will be saved as draft</p>"
        : "<p>Save as draft and edit later or submit for approval</p>"
    }
  `;

  content.innerHTML = `
    <div class="form-section">
      <h2>${editingDraftId ? "EDIT NEWS" : "CREATE NEWS"}</h2>
      <div class="form-group">
        <label>Heading *</label>
        <input id="heading" placeholder="Main headline" />
      </div>
      <div class="form-group">
        <label>Subtitle</label>
        <input id="subtitle" placeholder="Supporting line" />
      </div>
      <div class="form-group">
        <label>Description / Context *</label>
        <textarea id="description" placeholder="Write the story..."></textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Category</label>
          <input id="category" placeholder="Politics, Local, Sports..." />
        </div>
        <div class="form-group">
          <label>Location</label>
          <input id="location" placeholder="City or place" />
        </div>
      </div>
      <div class="form-group">
        <label>Tags</label>
        <input id="tags" placeholder="comma, separated, tags" />
      </div>
      <div class="form-group">
        <label>Upload Images</label>
        <div class="upload-area" id="uploadArea">+ Select Images (up to 10)</div>
        <input type="file" id="imageInput" accept="image/*" multiple style="display: none;" />
        <small id="imageCount"></small>
        <div id="imagePreview"></div>
      </div>
      <button class="btn-submit" id="saveNewsBtn">${editingDraftId ? "Update Draft" : "Save as Draft"}</button>
      <button class="btn-secondary" id="submitBtn">${editingDraftId ? "Update & Submit" : "Submit for Approval"}</button>
    </div>
  `;

  const imagePreview = document.getElementById("imagePreview");
  const imageInput = document.getElementById("imageInput");
  const uploadArea = document.getElementById("uploadArea");

  function renderImagePreviewList() {
    imagePreview.innerHTML = "";
    [
      ...existingImageUrls,
      ...selectedReporterImages.map((file) => URL.createObjectURL(file)),
    ].forEach((url) => {
      const img = document.createElement("img");
      img.src = url;
      img.className = "draft-thumb";
      imagePreview.appendChild(img);
    });
    const newImageCount = selectedReporterImages.length;
    document.getElementById("imageCount").textContent = newImageCount
      ? `${newImageCount} new image${newImageCount === 1 ? "" : "s"} selected`
      : "";
  }

  uploadArea.addEventListener("click", () => imageInput.click());
  imageInput.addEventListener("change", () => {
    const selectedKeys = new Set(
      selectedReporterImages.map(
        (file) => `${file.name}-${file.size}-${file.lastModified}`,
      ),
    );
    Array.from(imageInput.files).forEach((file) => {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      if (!selectedKeys.has(key) && selectedReporterImages.length < 10) {
        selectedReporterImages.push(file);
        selectedKeys.add(key);
      }
    });
    // Clear the native input so the reporter can add more images in another selection.
    imageInput.value = "";
    renderImagePreviewList();
  });

  if (editingDraftId) {
    const draft = await fetch(`/api/news/${editingDraftId}`).then((r) =>
      r.json(),
    );
    if (draft) {
      document.getElementById("heading").value = draft.title || "";
      document.getElementById("subtitle").value =
        draft.subheading || draft.subtitle || "";
      document.getElementById("description").value = draft.description || "";
      document.getElementById("category").value = draft.category || "";
      document.getElementById("location").value = draft.location || "";
      document.getElementById("tags").value = draft.tags || "";
      existingImageUrls = draft.image_urls?.length
        ? draft.image_urls
        : draft.imageUrls?.length
          ? draft.imageUrls
          : draft.imageUrl
            ? [draft.imageUrl]
            : [];
      renderImagePreviewList();
    }
  }

  document
    .getElementById("saveNewsBtn")
    .addEventListener("click", () => saveNews("draft"));
  document
    .getElementById("submitBtn")
    .addEventListener("click", () => saveNews("pending"));
}

async function saveNews(status) {
  const saveButton = document.getElementById(
    status === "draft" ? "saveNewsBtn" : "submitBtn",
  );
  saveButton.disabled = true;
  const formData = new FormData();
  formData.append("title", document.getElementById("heading").value);
  formData.append("subheading", document.getElementById("subtitle").value);

  formData.append("description", document.getElementById("description").value);
  formData.append("category", document.getElementById("category").value);
  formData.append("location", document.getElementById("location").value);
  formData.append("tags", document.getElementById("tags").value);
  formData.append("reporterName", currentUser.name);
  formData.append("reporterId", currentUser.id);
  formData.append("language", currentLanguage);
  formData.append("status", status);

  selectedReporterImages.forEach((file) => {
    formData.append("images", file);
  });

  try {
    const response = editingDraftId
      ? await fetch(`/api/news/${editingDraftId}`, {
          method: "PATCH",
          body: formData,
        })
      : await fetch("/api/news", {
          method: "POST",
          body: formData,
        });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Unable to save news");
    }

    alert(status === "draft" ? "Saved as draft" : "Submitted for approval");
    editingDraftId = null;
    selectedReporterImages = [];
    await navigate({ screen: "news", id: status === "draft" ? "draft" : "pending" });
  } catch (error) {
    console.error("News save error:", error);
    alert(error.message || "Unable to save news. Please try again.");
  } finally {
    saveButton.disabled = false;
  }
}

function renderReporterNewsDetails(newsItem) {
  const rightPanel = document.getElementById("rightPanel");
  rightPanel.innerHTML = `
    <div class="form-section">
      <h2>${escapeHtml(newsItem.title)}</h2>
      <p><em>${escapeHtml(newsItem.subheading || newsItem.subtitle || "")}</em></p>
      <div class="info-row"><label>Category:</label><strong>${escapeHtml(newsItem.category || "-")}</strong></div>
      <div class="info-row"><label>Location:</label><strong>${escapeHtml(newsItem.location || "-")}</strong></div>
      <div class="info-row"><label>Tags:</label><strong>${escapeHtml(newsItem.tags || "-")}</strong></div>
      <div class="form-group">
        <label>Description</label>
        <p>${escapeHtml(newsItem.description || "-")}</p>
      </div>
      <div id="newsImages"></div>
    </div>
  `;

  const images = newsItem.image_urls?.length
    ? newsItem.image_urls
    : newsItem.imageUrls?.length
      ? newsItem.imageUrls
      : newsItem.imageUrl
        ? [newsItem.imageUrl]
        : [];

  const imagesDiv = document.getElementById("newsImages");
  images.forEach((src) => {
    const img = document.createElement("img");
    img.src = src;
    img.className = "draft-thumb";
    imagesDiv.appendChild(img);
  });
}

// Opening an edition is an ADDRESS, not a function call - which is what lets
// Back leave it again, and what lets a reload come back to it. The painting
// itself lives in paintDeskScreen, so there is one place that knows how the
// workspace is put on screen and taken off it.
async function editNewspaper(newspaperId) {
  await navigate({ screen: "edition", id: newspaperId });
}

init();
