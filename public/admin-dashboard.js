const app = document.getElementById("app");
let currentUser = null;
let newspapers = [];
let news = [];
let selectedNewspaper = null;
let selectedTemplate = null;

async function init() {
  const res = await fetch("/api/auth/me");
  const data = await res.json();
  if (!data.user) {
    renderLogin();
    return;
  }
  currentUser = data.user;
  if (currentUser.role === "admin") {
    renderAdminDashboard();
  } else {
    renderReporterDashboard();
  }
}

async function loadNewspapers() {
  const res = await fetch("/api/newspapers");
  newspapers = await res.json();
}

async function loadNews() {
  const res = await fetch("/api/news");
  const rows = await res.json();

  news = rows.map((item) => ({
    ...item,

    // Backward compatibility
    subtitle: item.subtitle ?? item.subheading ?? "",
    reporterName: item.reporterName ?? item.reporter_name ?? "",
    imageUrls: item.image_urls ?? [],
    reporterId: item.reporterId ?? item.created_by ?? null,
    createdAt: item.createdAt ?? item.created_at,
  }));
}

function renderLogin() {
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <h1>AI Newspaper Studio</h1>
      </aside>
      <main class="main">
        <div class="card">
          <h2>Welcome</h2>
          <p>Professional newsroom publishing workflow with AI assistance.</p>
          <div class="grid two">
            <div>
              <label>Role</label>
              <select id="role">
                <option value="admin">Admin</option>
                <option value="reporter">Reporter</option>
              </select>
            </div>
            <div>
              <label>Email</label>
              <input id="email" placeholder="name@newsroom.com" />
            </div>
          </div>
          <label>Password</label>
          <input id="password" type="password" placeholder="Enter password" />
          <button class="primary-btn" id="loginBtn">Sign in</button>
        </div>
      </main>
    </div>
  `;

  document.getElementById("loginBtn").addEventListener("click", async () => {
    const role = document.getElementById("role").value;
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, role }),
    });

    const data = await response.json();
    if (!response.ok) {
      alert(data.error || "Login failed");
      return;
    }

    currentUser = data.user;
    if (role === "admin") {
      renderAdminDashboard();
    } else {
      renderReporterDashboard();
    }
  });
}

async function renderAdminDashboard() {
  await loadNewspapers();
  await loadNews();

  app.innerHTML = `
    <div class="shell admin-layout">
      <aside class="sidebar">
        <h1>Admin Workspace</h1>
        <button class="sidebar-btn" id="viewPastBtn">Past Newspapers</button>
        <button class="sidebar-btn" id="viewNewsBtn">Past News</button>
        <button class="sidebar-btn" id="viewAdsBtn">Past Ads</button>
        <button class="sidebar-btn" id="viewReportersBtn">Reporters</button>
        <button class="sidebar-btn" id="viewEPaperBtn">E-Paper</button>
        <button class="sidebar-btn logout-btn" id="logoutBtn">Logout</button>
      </aside>

      <main class="main admin-main">
        <div id="adminContent"></div>
      </main>

      <aside class="right-panel">
        <div id="rightContent"></div>
      </aside>
    </div>
  `;

  document.getElementById("logoutBtn").addEventListener("click", () => {
    currentUser = null;
    renderLogin();
  });

  showCreateNewspaperView();
}

function showCreateNewspaperView() {
  const content = document.getElementById("adminContent");
  const rightContent = document.getElementById("rightContent");

  content.innerHTML = `
    <div class="card">
      <h2>Create Newspaper</h2>
      <div class="grid two">
        <div>
          <label>Newspaper Name</label>
          <input id="newspaperName" placeholder="Morning Chronicle" />
        </div>
        <div>
          <label>Publication Date</label>
          <input id="pubDate" type="date" />
        </div>
      </div>
      <button class="primary-btn" id="selectTemplateBtn">Select Template</button>
      <div id="newspaperList"></div>
    </div>
  `;

  document.getElementById("selectTemplateBtn").addEventListener("click", () => {
    const name = document.getElementById("newspaperName").value;
    const date = document.getElementById("pubDate").value;
    if (!name) {
      alert("Enter a newspaper name");
      return;
    }
    showTemplateSelection(name, date);
  });

  renderNewspaperList();
}

function showTemplateSelection(name, date) {
  const rightContent = document.getElementById("rightContent");
  const templates = [
    { id: 1, name: "Classic 8-Page", pages: 8 },
    { id: 2, name: "Modern Metro", pages: 6 },
    { id: 3, name: "Editorial Focus", pages: 4 },
  ];

  rightContent.innerHTML = `
    <div class="card">
      <h3>Select Template</h3>
      <div id="templateList"></div>
      <button class="primary-btn" id="createWithTemplateBtn" style="margin-top: 12px;">Create Newspaper</button>
    </div>
  `;

  const templateList = document.getElementById("templateList");
  templates.forEach((tpl) => {
    const item = document.createElement("div");
    item.className =
      "template-item" + (selectedTemplate?.id === tpl.id ? " selected" : "");
    item.innerHTML = `<div>${tpl.name}</div><small>${tpl.pages} pages</small>`;
    item.addEventListener("click", () => {
      document
        .querySelectorAll(".template-item")
        .forEach((el) => el.classList.remove("selected"));
      item.classList.add("selected");
      selectedTemplate = tpl;
    });
    templateList.appendChild(item);
  });

  document
    .getElementById("createWithTemplateBtn")
    .addEventListener("click", async () => {
      if (!selectedTemplate) {
        alert("Select a template");
        return;
      }
      const res = await fetch("/api/newspapers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          template: selectedTemplate.name,
          date,
          pages: selectedTemplate.pages,
        }),
      });
      const newspaper = await res.json();
      selectedNewspaper = newspaper;
      showNewsAssignmentView();
    });
}

function showNewsAssignmentView() {
  const content = document.getElementById("adminContent");
  const rightContent = document.getElementById("rightContent");

  content.innerHTML = `
    <div class="card">
      <h2>Assign News to "${selectedNewspaper.name}"</h2>
      <button class="secondary-btn" id="createNewBtn">+ Create New News</button>
      <button class="secondary-btn" id="addFromReporterBtn">+ Add From Reporter</button>
      <div id="newsSlots"></div>
    </div>
  `;

  rightContent.innerHTML = `
    <div class="card">
      <h3>Preview</h3>
      <div id="preview"></div>
    </div>
  `;

  document.getElementById("createNewBtn").addEventListener("click", () => {
    showNewsForm();
  });

  document
    .getElementById("addFromReporterBtn")
    .addEventListener("click", () => {
      showReporterNewsList();
    });

  renderNewsSlots();
}

function showNewsForm() {
  const content = document.getElementById("adminContent");

  content.innerHTML = `
    <div class="card">
      <h2>Create News Article</h2>
      <div class="grid two">
        <div>
          <label>Heading</label>
          <input id="newsHeading" placeholder="Headline" />
        </div>
        <div>
          <label>Category</label>
          <input id="newsCategory" placeholder="Politics" />
        </div>
      </div>
      <label>Sub Heading</label>
      <input id="newsSubheading" placeholder="Supporting line" />
      <label>Description</label>
      <textarea id="newsDescription" placeholder="Write the article body"></textarea>
      <div class="grid two">
        <div>
          <label>Location</label>
          <input id="newsLocation" placeholder="City" />
        </div>
        <div>
          <label>Tags</label>
          <input id="newsTags" placeholder="news, economy" />
        </div>
      </div>
      <label>Additional AI Instructions</label>
      <textarea id="aiInstructions" placeholder="Use emotional tone, Keep below 150 words, etc."></textarea>
      <button class="primary-btn" id="saveNewsBtn">Save & Edit in Layout Desk</button>
      <button class="secondary-btn" id="backBtn">Back</button>
    </div>
  `;

  document.getElementById("saveNewsBtn").addEventListener("click", async () => {
    const payload = {
      title: document.getElementById("newsHeading").value,
      subheading: document.getElementById("newsSubheading").value,
      description: document.getElementById("newsDescription").value,
      category: document.getElementById("newsCategory").value,
      location: document.getElementById("newsLocation").value,
      tags: document.getElementById("newsTags").value,
      newspaperId: selectedNewspaper.id,
      status: "draft",
    };

    const res = await fetch("/api/news", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const newsItem = await res.json();
      openExternalEditor(newsItem);
    }
  });

  document
    .getElementById("backBtn")
    .addEventListener("click", showNewsAssignmentView);
}

function openExternalEditor(newsItem) {
  // This would open the external editor (iframe or new window)
  alert(`Opening Layout Desk for: ${newsItem.title}`);
  // In production, open the external editor URL and pass the news item ID
}

function showReporterNewsList() {
  if (status === "draft") {
    item.addEventListener("click", () => {
      editingDraftId = newsItem.id;
      showReporterCreateNews();
    });
  } else {
    item.addEventListener("click", () => {
      renderReporterNewsDetails(newsItem);
    });
  }
  const content = document.getElementById("adminContent");
  const approvedNews = news.filter(
    (n) => n.status === "approved" && !n.newspaperId,
  );

  content.innerHTML = `
    <div class="card">
      <h2>Approved Reporter News</h2>
      <div id="reporterNewsList"></div>
      <button class="secondary-btn" id="backFromReporterBtn">Back</button>
    </div>
  `;

  const list = document.getElementById("reporterNewsList");
  approvedNews.forEach((n) => {
    const item = document.createElement("div");
    item.className = "news-item";
    item.innerHTML = `
      <div>
        <strong>${n.title}</strong>
        <small>${n.reporterName || n.reporter_name || "Unknown"} • ${n.category}</small>
      </div>
      <button class="small-btn" data-id="${n.id}">Add</button>
    `;
    item.querySelector("button").addEventListener("click", async () => {
      await fetch(`/api/news/${n.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newspaperId: selectedNewspaper.id }),
      });
      showNewsAssignmentView();
    });
    list.appendChild(item);
  });

  document
    .getElementById("backFromReporterBtn")
    .addEventListener("click", showNewsAssignmentView);
}

function renderNewsSlots() {
  // Placeholder for news slot rendering with visual preview
}

function renderNewspaperList() {
  const list = document.getElementById("newspaperList");
  list.innerHTML =
    '<div class="list">' +
    newspapers
      .map(
        (n) => `
    <div class="item">${n.name} • ${n.template}</div>
  `,
      )
      .join("") +
    "</div>";
}

async function renderReporterDashboard() {
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <h1>Reporter Workspace</h1>
        <button class="sidebar-btn" id="createNewsBtn">Create News</button>
        <button class="sidebar-btn" id="myDraftsBtn">My Drafts</button>
        <button class="sidebar-btn logout-btn" id="logoutBtn">Logout</button>
      </aside>
      <main class="main">
        <div id="reporterContent"></div>
      </main>
    </div>
  `;

  document.getElementById("logoutBtn").addEventListener("click", () => {
    currentUser = null;
    renderLogin();
  });

  showReporterNewsForm();
}

function showReporterNewsForm() {
  const content = document.getElementById("reporterContent");

  content.innerHTML = `
    <div class="card">
      <h2>Create News</h2>
      <div class="grid two">
        <div>
          <label>Heading</label>
          <input id="rHeading" placeholder="Breaking news headline" />
        </div>
        <div>
          <label>Category</label>
          <input id="rCategory" placeholder="Local" />
        </div>
      </div>
      <label>Sub Heading</label>
      <input id="rSubheading" placeholder="Brief supporting line" />
      <label>Description</label>
      <textarea id="rDescription" placeholder="Write the article body"></textarea>
      <label>Location</label>
      <input id="rLocation" placeholder="City or region" />
      <label>Tags</label>
      <input id="rTags" placeholder="news, economy, update" />
      <button class="primary-btn" id="rSaveBtn">Save</button>
    </div>
  `;

  document.getElementById("rSaveBtn").addEventListener("click", async () => {
    const payload = {
      title: document.getElementById("rHeading").value,
      subheading: document.getElementById("rSubheading").value,
      description: document.getElementById("rDescription").value,
      category: document.getElementById("rCategory").value,
      location: document.getElementById("rLocation").value,
      tags: document.getElementById("rTags").value,
      reporterName: currentUser.name,
      status: "pending",
    };

    const res = await fetch("/api/news", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      alert("News saved and sent for approval");
      showReporterNewsForm();
    }
  });
}

init();
