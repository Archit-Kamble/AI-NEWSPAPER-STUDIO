import { renderWorkspace, leaveWorkspace } from "./editor/workspace.js";
import { startNavigation, navigate, stopNavigation } from "./admin/navigation.js";
import { renderEditions } from "./admin/editions.js";
import { renderEpapers } from "./admin/epapers.js";
import { renderReporterManagement } from "./admin/staff.js";
import { renderGeneralSettings } from "./admin/settings.js";
import { escapeHtml, deskStamp } from "./editor/format.js";
import { showNotice, showFailure } from "./ui/notice.js";
import { emptyStateMarkup } from "./ui/empty.js";
import { MR, devanagari, reporterDate } from "./admin/reporter-strings.js";
import { askPrompt, openDialog } from "./ui/dialog.js";
import { busyButton } from "./ui/busy.js";

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

/**
 * THE FIRST THING EVERY USER SEES, AND IT WAS THE LEAST SAHAS-LOOKING PAGE IN
 * THE PRODUCT.
 *
 * It carried a Latin "SAHAS" wordmark set in the browser's default face, the
 * words "AI Newspaper Publishing System", and "Version 1.0". The registered
 * nameplate - which the canvas sets, the press file embeds and the public
 * reader carries - appeared nowhere on it. Neither did the paper's own name.
 *
 * Four other things were wrong and are the kind a browser notices before a
 * person does:
 *
 *   * there was no <form>, so Enter did not sign anybody in. The only way in
 *     was to reach for the mouse.
 *   * "Username" labelled a field that holds an email address, and the input
 *     was type="text", so a phone offered the wrong keyboard for it.
 *   * no `autocomplete`, so no password manager could fill either field.
 *   * no way to see the password you typed - the commonest reason a correct
 *     password is reported as wrong.
 *
 * The nameplate is the artwork, never type: setting the paper's name in a
 * downloaded font would not be its masthead, it would be a lookalike. That is
 * identity.js's own rule and it holds here too.
 */
function renderLogin() {
  app.innerHTML = `
    <div class="login-container">
      <form class="login-box" id="loginForm" novalidate>
        <img class="login-nameplate" src="/assets/masthead/sahas-nameplate.png"
             alt="दैनिक साहस वार्ता" />
        <p class="login-standfirst">वृत्तपत्र निर्मिती कक्ष <span>· Newsroom</span></p>
        <div class="form-group">
          <label for="email">Email address</label>
          <input id="email" type="email" name="email" autocomplete="username"
                 inputmode="email" autocapitalize="off" spellcheck="false"
                 placeholder="you@esahas.com" required />
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <div class="password-field">
            <input id="password" type="password" name="password"
                   autocomplete="current-password" required />
            <button type="button" class="password-reveal" id="revealPassword"
                    aria-pressed="false" aria-label="Show the password">Show</button>
          </div>
        </div>
        <p class="login-error" id="loginError" role="alert" hidden></p>
        <button class="btn-login" id="loginBtn" type="submit">Sign in</button>
      </form>
    </div>
  `;

  const reveal = document.getElementById("revealPassword");
  reveal.addEventListener("click", () => {
    const field = document.getElementById("password");
    const shown = field.type === "text";
    field.type = shown ? "password" : "text";
    reveal.textContent = shown ? "Show" : "Hide";
    reveal.setAttribute("aria-pressed", String(!shown));
    reveal.setAttribute("aria-label", shown ? "Show the password" : "Hide the password");
    field.focus();
  });

  // The email field is where a person starts, so that is where the caret goes.
  document.getElementById("email").focus();

  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
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
    // A REFUSED SIGN-IN IS SAID WHERE THE SIGN-IN WAS ATTEMPTED.
    //
    // It used to arrive as a bottom-centre toast - the F.2 fault, at its
    // sharpest: this is the one screen in the product where the person cannot
    // yet do anything else, so an answer 700px from the button they pressed is
    // an answer they may not find at all.
    const slot = document.getElementById("loginError");
    const button = document.getElementById("loginBtn");
    slot.hidden = true;

    const outcome = await busyButton(button, "Signing in…", async () => {
      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        return { ok: response.ok, data: await response.json().catch(() => ({})) };
      } catch {
        // A dropped connection is not a wrong password, and telling somebody it
        // is sends them retyping something that was right.
        return { ok: false, data: { error: "The newsroom could not be reached. Check the connection." } };
      }
    });

    if (outcome.ok) {
      currentUser = outcome.data.user;
      if (can("makeUp")) renderAdminDashboard();
      else renderReporterDashboard();
      return;
    }
    slot.textContent = outcome.data.error || "That email address and password do not match.";
    slot.hidden = false;
    document.getElementById("password").focus();
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
        <div class="header-center" lang="mr">${MR.greeting}, ${escapeHtml(currentUser.name)} <span class="role-pill role-reporter">${escapeHtml(currentUser.roleLabel || MR.role)}</span></div>
        <div class="header-right"><button id="logoutBtn" lang="mr">${MR.logout}</button></div>
      </div>
      <div class="container">
        <div class="sidebar-app-backdrop" id="sidebarAppBackdrop"></div>
        <aside class="sidebar" lang="mr">
          <button class="sidebar-btn" id="createBtn">${MR.create}</button>
          <button class="sidebar-btn" id="draftBtn">${MR.drafts}</button>
          <button class="sidebar-btn" id="submittedBtn">${MR.submitted}</button>
          <button class="sidebar-btn" id="approvedBtn">${MR.approved}</button>
          <button class="sidebar-btn" id="rejectedBtn">${MR.rejected}</button>
          <button class="sidebar-btn" id="profileBtn">${MR.profile}</button>
          <button class="sidebar-btn logout" id="logoutBtn2">${MR.logout}</button>
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
      releaseUnsavedGuard();
      const queues = {
        draft: ["draftBtn", MR.drafts],
        pending: ["submittedBtn", MR.submitted],
        approved: ["approvedBtn", MR.approved],
        rejected: ["rejectedBtn", MR.rejected],
      };
      const [, title] = queues[view.id] || queues.draft;
      return showReporterNewsList(queues[view.id] ? view.id : "draft", title);
    } },
    profile: { button: "profileBtn", render: (view) => { releaseUnsavedGuard(); return showReporterProfile(view); } },
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
    <div class="form-section" lang="mr">
      <h2>${MR.profile}</h2>
      <div class="profile-info">
        <div class="info-row">
          <label>${MR.profileName}</label>
          <strong>${escapeHtml(currentUser.name)}</strong>
        </div>
        <div class="info-row">
          <label>${MR.profileEmail}</label>
          <strong>${escapeHtml(currentUser.email)}</strong>
        </div>
        <div class="info-row">
          <label>${MR.profileRole}</label>
          <!-- The LABEL, not the stored key. It printed "reporter" - the value
               in the database - on a screen written for the person that word
               describes, and in the one language they are certainly reading. -->
          <strong>${escapeHtml(MR.role)}</strong>
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

  rightPanel.innerHTML = `<h3 lang="mr">${escapeHtml(title)}</h3><p lang="mr">${MR.tapToEdit}</p>`;

  content.innerHTML = `
    <div class="form-section" lang="mr">
      <h2>${escapeHtml(title)}</h2>
      <div class="news-list" id="newsList"></div>
    </div>
  `;

  const list = document.getElementById("newsList");
  if (news.length === 0) {
    list.innerHTML = emptyStateMarkup({
      title: status === "draft" ? MR.emptyDrafts : MR.emptyQueue,
    });
    return;
  }

  news.forEach((newsItem) => {
    const item = document.createElement("div");
    item.className = "news-item";
    // A FILING'S CARD SAYS WHAT STATE IT IS IN.
    //
    // Measured before this: a card read the same line in Drafts, Submitted,
    // Approved and Rejected - the state was carried entirely by which sidebar
    // queue the reporter happened to be standing in. The desk's own queue
    // already did better; it shows a pill.
    //
    // A rejected filing also carries the note the desk wrote, which is R.1:
    // the note was stored, the API already returned it (news_items is read
    // with SELECT *), and this screen rendered it nowhere. So a journalist's
    // copy was refused and the product could not tell them why.
    const state = String(newsItem.status || status || "draft");
    const note = String(newsItem.review_note || newsItem.reviewNote || "").trim();
    item.innerHTML = `
      <div>
        <div class="news-item-head">
          <strong>${escapeHtml(newsItem.title)}</strong>
          <span class="status-pill ${escapeHtml(state)}">${escapeHtml(MR.status[state] || state)}</span>
        </div>
        <p>${escapeHtml(newsItem.subheading || newsItem.subtitle || "")}</p>
        <small>
          ${escapeHtml(newsItem.category || "")} ·
          ${escapeHtml(newsItem.location || "")} ·
          ${escapeHtml(reporterDate(newsItem.created_at || newsItem.createdAt))}
        </small>
        ${state === "rejected" ? `<div class="review-note">
          <span class="review-note-label">${MR.whyBack}</span>
          <p>${note ? escapeHtml(note) : MR.whyBackNone}</p>
        </div>` : ""}
      </div>
    `;
    item.style.cursor = "pointer";
    item.addEventListener("click", () => {
      // A story that came back is a story to correct, so it opens in the form
      // rather than in a read-only panel. Being told why and then having no
      // way to act on it is half a loop.
      if (status === "draft" || state === "rejected") navigate({ screen: "create", id: newsItem.id });
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

/**
 * A REPORTER'S FILING, WHOLE - the copy and the pictures they sent with it.
 *
 * The review queue showed a title, a byline and the description clamped to two
 * lines by CSS, and there was NO WAY ANYWHERE IN THE PRODUCT to read the rest
 * or to see one photograph. A desk was being asked to pass or send back a
 * story they could not read - which is not a review, it is a coin toss.
 *
 * Everything shown here already reached the browser: `/api/news` selects the
 * whole row, so the body, the pictures, the location, the tags and the note
 * somebody wrote when they last sent it back have all been sitting in the
 * response the queue was already fetching. This is a reader for them, not a
 * request.
 *
 * A dialog rather than a screen of its own: the queue is where the decision is
 * made, and a desk reading three filings in a row should come back to their
 * place in the list rather than to the top of it.
 */
function readFiling(item) {
  const shots = Array.isArray(item.image_urls) ? item.image_urls.filter(Boolean) : [];
  const body = document.createElement("div");
  body.className = "filing-detail";

  const meta = document.createElement("dl");
  meta.className = "filing-meta";
  const rows = [
    ["Reporter", item.reporter_name || item.reporterName || "—"],
    ["Category", item.category || "—"],
    ["Place", [item.location, item.city].filter(Boolean).join(", ") || "—"],
    ["Tags", item.tags || "—"],
    ["Status", item.status || "—"],
    ["Filed", item.created_at ? deskStamp(item.created_at) : "—"],
  ];
  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = String(value);
    meta.append(dt, dd);
  }
  body.append(meta);

  if (item.subheading) {
    const deck = document.createElement("p");
    deck.className = "filing-deck";
    deck.textContent = item.subheading;
    body.append(deck);
  }

  // The copy, paragraph by paragraph, as the reporter typed it. `textContent`
  // per paragraph - a filing is text a reporter wrote, never markup this
  // screen renders.
  const copy = document.createElement("div");
  copy.className = "filing-copy";
  const paragraphs = String(item.description || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (!paragraphs.length) {
    const none = document.createElement("p");
    none.className = "filing-empty";
    none.textContent = "This filing has no copy in it yet.";
    copy.append(none);
  }
  for (const text of paragraphs) {
    const p = document.createElement("p");
    p.textContent = text;
    copy.append(p);
  }
  body.append(copy);

  // THE PICTURES THE REPORTER SENT. Nothing in the product could show one, so
  // a desk passing a photo story was passing a photograph they had not seen.
  if (shots.length) {
    const gallery = document.createElement("div");
    gallery.className = "filing-shots";
    for (const url of shots) {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.title = "Open this picture at full size";
      const img = document.createElement("img");
      img.src = url;
      img.alt = `Picture filed with “${item.title || "this story"}”`;
      img.loading = "lazy";
      // A PICTURE THAT IS NO LONGER ON THE SERVER SAYS SO.
      // `image_urls` is a list of paths, and a path outlives the file: an
      // upload cleared out, an older filing, a fixture. A broken <img> renders
      // as its own alt text underlined inside a link, which reads as a fault
      // in this screen rather than as a fact about the filing.
      img.addEventListener("error", () => {
        const gone = document.createElement("span");
        gone.className = "filing-shot-gone";
        gone.textContent = "This picture is no longer on the server.";
        link.replaceWith(gone);
      });
      link.append(img);
      gallery.append(link);
    }
    body.append(gallery);
  }

  // The note somebody wrote the last time this was sent back. It is the one
  // thing on the row that says WHY, and it was stored and never shown here.
  if (item.review_note) {
    const note = document.createElement("p");
    note.className = "filing-note";
    note.textContent = `Sent back with: ${item.review_note}`;
    body.append(note);
  }

  return openDialog({
    title: item.title || "Filing",
    body,
    width: 760,
    actions: [{ label: "Close", value: "close", quiet: true }],
  });
}

async function showPastNews() {
  const content = document.getElementById("content");
  const rightPanel = document.getElementById("rightPanel");
  let news;
  try {
    news = await fetch("/api/news").then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
  } catch (error) {
    console.error("News review load failed:", error);
    rightPanel.innerHTML = "<h3>Past News</h3>";
    content.innerHTML = '<div class="form-section"><p>This list could not be loaded. Check the connection and try again.</p></div>';
    return;
  }
  // ONE SCREEN, ONE NAME.
  //
  // The sidebar called it Past News, the heading said REPORTER NEWS REVIEW,
  // the panel beside it said Reporter News and the address is #!/past-news -
  // four names for one screen, so a desk could not tell somebody which screen
  // to open. The sidebar's word wins, because that is the one a person is
  // reading when they decide to come here.
  rightPanel.innerHTML =
    "<h3>Past News</h3><p>Every story a reporter has filed. Pass it, or send it back with a reason.</p>";

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
      <h2>Past News</h2>
      <div class="news-review-controls">
        <input id="adminNewsSearch" type="search" placeholder="Search by title, reporter or category…">
        <!-- The queue opens on PENDING. What a desk comes to this screen for
             is the filings waiting on a decision; it used to open on All
             statuses with a header reading 1,327 filings, so the twelve that
             needed an answer were buried in thirteen hundred that did not.
             All statuses is still one press away. -->
        <select id="adminNewsStatus">
          <option value="">All statuses</option>
          ${[...new Set(news.map((n) => n.status).filter(Boolean))].sort()
            .map((v) => `<option value="${escapeHtml(v)}"${v === "pending" ? " selected" : ""}>${escapeHtml(v)}</option>`).join("")}
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
    const shots = Array.isArray(item.image_urls) ? item.image_urls.filter(Boolean) : [];
    card.innerHTML = `<div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.reporter_name || item.reporterName || "Reporter")} · ${escapeHtml(item.category || "Uncategorised")}${shots.length ? ` · ${shots.length} picture${shots.length === 1 ? "" : "s"}` : ""}</small><p>${escapeHtml(item.description || "No description")}</p><button type="button" class="btn-link read-full">Read the whole filing${shots.length ? " and its pictures" : ""}</button></div><div class="status-actions"><span class="status-pill ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span><button class="btn-secondary approve">Approve</button><button class="btn-secondary is-destructive reject">Send back</button></div>`;
    card.querySelector(".read-full").addEventListener("click", () => readFiling(item));

    const decide = async (status, button, reviewNote) => {
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
          body: JSON.stringify(reviewNote ? { status, reviewNote } : { status }),
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
        showFailure(error.message || "That could not be saved.", { retry: () => button.click() });
      } finally {
        buttons.forEach((b) => { b.disabled = false; });
        button.textContent = wasLabel;
      }
    };

    card.querySelector(".approve").addEventListener("click", (e) => decide("approved", e.currentTarget));

    // REJECTING ASKS FOR THE REASON, ON THE SCREEN WHERE REVIEWING HAPPENS.
    //
    // This is the other half of R.1, and the half that made it a hole rather
    // than an oversight. There were two review surfaces: the owner's Staff
    // profile page asked for a note, and THIS queue - the one carrying every
    // filing, where reviewing actually happens - had Approve and Reject and
    // never asked for a note at all. Pressing Reject fired no dialog of any
    // kind and the story went back with nothing attached to it.
    //
    // PATCH /api/news/:id/status has always accepted `reviewNote`. Nothing
    // here sent one.
    //
    // The two controls also looked identical - the same size, the same
    // neutral outline, stacked - so the one destructive act in the queue was
    // styled most like its opposite, fired immediately, and had no undo. It
    // is called Send back now, because that is what it does to a person, and
    // it asks.
    card.querySelector(".reject").addEventListener("click", async (e) => {
      const button = e.currentTarget;
      const note = await askPrompt({
        title: `Send “${item.title}” back to ${item.reporter_name || item.reporterName || "the reporter"}?`,
        body: "They see this note against the story on their own screen, and it is the only thing"
          + " telling them what to change. A story sent back with nothing said is one nobody can fix.",
        label: "What needs correcting",
        multiline: true,
        placeholder: "The council figure is from last year — check it against the minutes.",
        confirm: "Send it back",
        cancel: "Keep reviewing",
      });
      if (note === null) return;
      decide("rejected", button, note.trim());
    });
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
    if (!matches.length) {
      list.innerHTML = emptyStateMarkup({
        title: "No filing matches that.",
        body: "Search a reporter's name, a headline or a district — or change the status filter above.",
      });
    }
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
    <h3 lang="mr">${editingDraftId ? MR.editHeading : MR.tips}</h3>
    <p lang="mr">${editingDraftId ? MR.tipEditing : MR.tipDraft}</p>
  `;

  // The upload area was a bare <div> with tabIndex -1 and no role, so it could
  // not be reached from the keyboard at all. It is a button now, which is what
  // it always behaved as.
  content.innerHTML = `
    <div class="form-section reporter-form" lang="mr">
      <h2>${editingDraftId ? MR.editHeading : MR.createHeading}</h2>
      <div class="form-group">
        <label for="heading">${MR.fieldHeadline} <span class="req" aria-hidden="true">*</span></label>
        <input id="heading" placeholder="${MR.phHeadline}" aria-describedby="headingError" />
        <p class="field-error" id="headingError" hidden></p>
      </div>
      <div class="form-group">
        <label for="subtitle">${MR.fieldSubtitle}</label>
        <input id="subtitle" placeholder="${MR.phSubtitle}" />
      </div>
      <div class="form-group">
        <label for="description">${MR.fieldStory} <span class="req" aria-hidden="true">*</span></label>
        <textarea id="description" placeholder="${MR.phStory}" aria-describedby="descriptionError"></textarea>
        <p class="field-error" id="descriptionError" hidden></p>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="category">${MR.fieldCategory}</label>
          <input id="category" placeholder="${MR.phCategory}" />
        </div>
        <div class="form-group">
          <label for="location">${MR.fieldLocation}</label>
          <input id="location" placeholder="${MR.phLocation}" />
        </div>
      </div>
      <div class="form-group">
        <label for="tags">${MR.fieldTags}</label>
        <input id="tags" placeholder="${MR.phTags}" />
      </div>
      <div class="form-group">
        <label>${MR.fieldImages}</label>
        <button type="button" class="upload-area" id="uploadArea">${MR.pickImages}</button>
        <input type="file" id="imageInput" accept="image/*" multiple style="display: none;" />
        <small id="imageCount"></small>
        <p class="field-warning" id="imageReplaceWarning" hidden>${MR.imagesReplace}</p>
        <div id="imagePreview" class="image-preview"></div>
      </div>
      <div class="form-actions">
        <button class="btn-submit" id="saveNewsBtn">${editingDraftId ? MR.updateDraft : MR.saveDraft}</button>
        <button class="btn-secondary" id="submitBtn">${editingDraftId ? MR.updateSubmit : MR.submit}</button>
      </div>
    </div>
  `;

  const imagePreview = document.getElementById("imagePreview");
  const imageInput = document.getElementById("imageInput");
  const uploadArea = document.getElementById("uploadArea");

  // A PICTURE JUST CHOSEN CAN BE TAKEN BACK. ONE ALREADY FILED CANNOT, AND
  // THE FORM SAYS SO RATHER THAN OFFERING A CONTROL THAT WOULD NOT WORK.
  //
  // Measured before this: after attaching one there was no remove control of
  // any kind on the page. A reporter who picked the wrong photograph off a
  // phone camera roll could not undo it - the only way out was to abandon the
  // filing. Each newly chosen thumbnail now carries its own remove button,
  // named for a screen reader.
  //
  // A picture the story ALREADY carries is a different case and deliberately
  // has no button: news.service.js keeps `existing.image_urls` when no files
  // are sent and REPLACES the whole list when any are, so nothing this form
  // can send would remove one. Drawing a remove button there would be a
  // control that cannot act - the fault this codebase has already fixed twice.
  //
  // The replacement itself is the more useful thing to say, and nothing said
  // it: a reporter adding one photograph to a story that carries three loses
  // the other two, silently.
  function renderImagePreviewList() {
    imagePreview.innerHTML = "";
    const add = (url, onRemove) => {
      const figure = document.createElement("figure");
      figure.className = "image-chip";
      const img = document.createElement("img");
      img.src = url;
      img.className = "draft-thumb";
      img.alt = "";
      figure.append(img);
      if (onRemove) {
        const drop = document.createElement("button");
        drop.type = "button";
        drop.className = "image-chip-remove";
        drop.title = MR.removeImage;
        drop.setAttribute("aria-label", MR.removeImage);
        drop.textContent = "×";
        drop.addEventListener("click", () => { onRemove(); renderImagePreviewList(); });
        figure.append(drop);
      } else {
        figure.classList.add("is-filed");
      }
      imagePreview.appendChild(figure);
    };
    existingImageUrls.forEach((url) => add(url, null));
    selectedReporterImages.forEach((file, index) => {
      add(URL.createObjectURL(file), () => {
        selectedReporterImages = selectedReporterImages.filter((_, i) => i !== index);
      });
    });
    const chosen = selectedReporterImages.length;
    const note = document.getElementById("imageCount");
    note.textContent = chosen ? MR.imagesChosen(chosen) : "";
    // The one thing a reporter has to know before they press save.
    const warn = document.getElementById("imageReplaceWarning");
    if (warn) warn.hidden = !(chosen && existingImageUrls.length);
  }

  uploadArea.addEventListener("click", () => imageInput.click());
  imageInput.addEventListener("change", () => {
    const selectedKeys = new Set(
      selectedReporterImages.map(
        (file) => `${file.name}-${file.size}-${file.lastModified}`,
      ),
    );
    let refused = false;
    Array.from(imageInput.files).forEach((file) => {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      if (selectedKeys.has(key)) return;
      // Silently dropping the eleventh file leaves a reporter believing it was
      // attached. The limit is stated instead.
      if (selectedReporterImages.length + existingImageUrls.length >= 10) { refused = true; return; }
      selectedReporterImages.push(file);
      selectedKeys.add(key);
    });
    if (refused) showFailure(MR.imageLimit);
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

  // NOTHING WARNED ABOUT LEAVING UNSAVED WORK.
  //
  // `beforeunload` appeared nowhere under public/. The workspace at least has
  // autosave; this form has neither that nor a guard, so a closed tab took the
  // story with it. The listener is removed on a successful save, so a reporter
  // who has just filed is never asked.
  reporterFormDirty = false;
  ["heading", "subtitle", "description", "category", "location", "tags"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", () => { reporterFormDirty = true; });
  });
  armUnsavedGuard();
}

// The guard is module-level so saveNews() can stand it down, and so a second
// render of the form cannot leave two of them armed.
let reporterFormDirty = false;
function onBeforeUnload(event) {
  if (!reporterFormDirty) return undefined;
  event.preventDefault();
  // Browsers ignore the string and show their own sentence. Returning one is
  // still what arms the prompt in older engines.
  event.returnValue = MR.unsaved;
  return MR.unsaved;
}
function armUnsavedGuard() {
  window.removeEventListener("beforeunload", onBeforeUnload);
  window.addEventListener("beforeunload", onBeforeUnload);
}
function releaseUnsavedGuard() {
  reporterFormDirty = false;
  window.removeEventListener("beforeunload", onBeforeUnload);
}

/**
 * THE VALIDATION NAMES THE FIELD THE FORM ACTUALLY HAS.
 *
 * Submitting an empty filing used to produce a native alert reading "Title
 * required". The field is labelled मथळा. Measured alongside it: 0 inline
 * errors, and `document.activeElement` stayed on BODY - so the reporter was
 * told something was wrong, told the wrong name for it, and left to find it.
 *
 * The message goes UNDER THE FIELD IT IS ABOUT, the field is marked invalid
 * for a screen reader, and the caret is put in the first one that is empty.
 */
function fieldProblem(id, message) {
  const field = document.getElementById(id);
  const slot = document.getElementById(`${id}Error`);
  if (slot) {
    slot.textContent = message || "";
    slot.hidden = !message;
  }
  if (field) {
    field.classList.toggle("is-invalid", Boolean(message));
    field.setAttribute("aria-invalid", message ? "true" : "false");
  }
  return field;
}

function checkReporterForm() {
  const problems = [
    ["heading", document.getElementById("heading").value.trim() ? "" : MR.needHeadline],
    ["description", document.getElementById("description").value.trim() ? "" : MR.needStory],
  ];
  problems.forEach(([id, message]) => fieldProblem(id, message));
  const first = problems.find(([, message]) => message);
  if (!first) return true;
  fieldProblem(first[0], first[1])?.focus();
  return false;
}

async function saveNews(status) {
  const saveButton = document.getElementById(
    status === "draft" ? "saveNewsBtn" : "submitBtn",
  );
  // A draft is a story still being written, so it is allowed to be incomplete.
  // Sending it to the desk is a different act and is checked.
  if (status !== "draft" && !checkReporterForm()) return;
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

    releaseUnsavedGuard();
    showNotice(status === "draft" ? MR.savedDraft : MR.savedSubmitted);
    editingDraftId = null;
    selectedReporterImages = [];
    await navigate({ screen: "news", id: status === "draft" ? "draft" : "pending" });
  } catch (error) {
    console.error("News save error:", error);
    showFailure(error.message || MR.saveFailed, { retry: () => saveButton.click() });
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
