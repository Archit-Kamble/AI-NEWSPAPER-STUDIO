const app = document.getElementById("app");
let currentUser = null;
let currentNewspaper = null;
let currentPage = null;
let currentLanguage = "mr";
let editingDraftId = null;
let currentDraft = null;
let selectedReporterImages = [];

const newspaperTemplates = {
  front: {
    name: "Front page", description: "Lead story with four supporting news blocks.",
    grid: '"lead lead side" "lead lead side" "bottom1 bottom2 bottom2"',
    slots: ["lead", "side", "bottom1", "bottom2"]
  },
  local: {
    name: "Local news", description: "Six balanced local-news sections.",
    grid: '"top top top" "left centre right" "left lower lower"',
    slots: ["top", "left", "centre", "right", "lower"]
  },
  feature: {
    name: "Feature page", description: "Large feature story with supporting briefs.",
    grid: '"feature feature brief1" "feature feature brief2" "footer footer footer"',
    slots: ["feature", "brief1", "brief2", "footer"]
  },
  opinion: {
    name: "Opinion", description: "Editorial and three opinion columns.",
    grid: '"editorial editorial editorial" "opinion1 opinion2 opinion3"',
    slots: ["editorial", "opinion1", "opinion2", "opinion3"]
  },
  gallery: {
    name: "Photo story", description: "Image-led sections with captions and a lead.",
    grid: '"hero hero photo1" "hero hero photo2" "caption caption caption"',
    slots: ["hero", "photo1", "photo2", "caption"]
  },
  custom: {
    name: "Custom starter", description: "Six equal sections to customise later in Scribus.",
    grid: '"one two three" "four five six"',
    slots: ["one", "two", "three", "four", "five", "six"]
  }
};

async function init() {
  const res = await fetch("/api/auth/me");
  const data = await res.json();
  currentUser = data.user;
  if (!currentUser) renderLogin();
  else if (currentUser.role === "admin") renderAdminDashboard();
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
    const role = email.includes("admin") ? "admin" : "reporter";

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, role }),
    });

    const data = await response.json();
    if (response.ok) {
      currentUser = data.user;
      if (role === "admin") renderAdminDashboard();
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
        <div class="header-left">SAHAS</div>
        <div class="header-center">Hi ${currentUser.name}</div>
        <div class="header-right"><button id="logoutBtn">Logout</button></div>
      </div>
      <div class="container">
        <aside class="sidebar">
          <button class="sidebar-btn active" id="createBtn">Create News</button>
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

  const logout = () => {
    currentUser = null;
    renderLogin();
  };
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("logoutBtn2").addEventListener("click", logout);

  document.getElementById("createBtn").addEventListener("click", () => {
    editingDraftId = null;
    showReporterCreateNews();
  });
  document
    .getElementById("draftBtn")
    .addEventListener("click", () =>
      showReporterNewsList("draft", "My Drafts"),
    );
  document
    .getElementById("submittedBtn")
    .addEventListener("click", () =>
      showReporterNewsList("pending", "Submitted"),
    );
  document
    .getElementById("approvedBtn")
    .addEventListener("click", () =>
      showReporterNewsList("approved", "Approved"),
    );
  document
    .getElementById("rejectedBtn")
    .addEventListener("click", () =>
      showReporterNewsList("rejected", "Rejected"),
    );
  document
    .getElementById("profileBtn")
    .addEventListener("click", showReporterProfile);

  showReporterCreateNews();
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
          <strong>${currentUser.name}</strong>
        </div>
        <div class="info-row">
          <label>Email:</label>
          <strong>${currentUser.email}</strong>
        </div>
        <div class="info-row">
          <label>Role:</label>
          <strong>${currentUser.role}</strong>
        </div>
      </div>
    </div>
  `;
  rightPanel.innerHTML = "";
}

async function showReporterNewsList(status, title) {
  const content = document.getElementById("content");
  const rightPanel = document.getElementById("rightPanel");
  const news = await fetch(
    `/api/news?status=${status}&reporterId=${currentUser.id}`,
  ).then((r) => r.json());

  rightPanel.innerHTML = `<h3>${title}</h3><p>Click on any news to edit</p>`;

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
        <strong>${newsItem.title}</strong>
        <p>${newsItem.subtitle}</p>
        <small>${newsItem.category} • ${newsItem.location} • ${new Date(newsItem.createdAt).toLocaleDateString()}</small>
      </div>
    `;
    item.style.cursor = "pointer";
    item.addEventListener("click", () => {
      if (status === "draft") {
        editingDraftId = newsItem.id;
        showReporterCreateNews();
      } else {
        renderReporterNewsDetails(newsItem);
      }
    });
    list.appendChild(item);
  });
}

async function renderAdminDashboard() {
  app.innerHTML = `
    <div class="main-layout">
      <div class="header">
        <div class="header-left">SAHAS</div>
        <div class="header-center">Hi Admin</div>
        <div class="header-right"><button id="logoutBtn">Logout</button></div>
      </div>
      <div class="container">
        <aside class="sidebar">
          <button class="sidebar-btn active" id="pastBtn">Past Newspapers</button>
          <button class="sidebar-btn" id="pastNewsBtn">Past News</button>
          <button class="sidebar-btn" id="reportersBtn">Reporters</button>
          <button class="sidebar-btn" id="settingsBtn">Settings</button>
          <button class="sidebar-btn logout" id="logoutBtn2">Logout</button>
        </aside>
        <main class="content" id="content"></main>
        <aside class="right-panel" id="rightPanel"></aside>
      </div>
    </div>
  `;

  const logout = () => {
    currentUser = null;
    renderLogin();
  };
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("logoutBtn2").addEventListener("click", logout);
  document
    .getElementById("pastBtn")
    .addEventListener("click", showPastNewspapers);
  document
    .getElementById("pastNewsBtn")
    .addEventListener("click", showPastNews);
  document
    .getElementById("reportersBtn")
    .addEventListener("click", showReporters);
  document
    .getElementById("settingsBtn")
    .addEventListener("click", showSettings);

  showPastNewspapers();
}

async function showPastNewspapers() {
  const content = document.getElementById("content");
  const rightPanel = document.getElementById("rightPanel");
  const newspapers = await fetch("/api/newspapers").then((r) => r.json());

  rightPanel.innerHTML = `<h3>Newspapers</h3><p>Click to edit or create new</p>`;

  content.innerHTML = `
    <div class="form-section">
      <h2>PAST NEWSPAPERS</h2>
      <button class="btn-submit" style="margin-bottom: 20px;" id="newBtn">+ Create New Newspaper</button>
      <div class="news-list" id="newspaperList"></div>
    </div>
  `;

  document
    .getElementById("newBtn")
    .addEventListener("click", createNewNewspaper);

  const list = document.getElementById("newspaperList");
  newspapers.forEach((np) => {
    const item = document.createElement("div");
    item.className = "newspaper-item";
    item.innerHTML = `
      <div>
        <strong>${np.name}</strong>
        <small>${np.date} • ${np.pageCount} pages • ${np.status}</small>
      </div>
      <button class="btn-secondary">Edit</button>
    `;
    item
      .querySelector("button")
      .addEventListener("click", () => editNewspaper(np.id));
    list.appendChild(item);
  });
}

async function showPastNews() {
  const content = document.getElementById("content");
  const rightPanel = document.getElementById("rightPanel");
  const news = await fetch("/api/news").then((r) => r.json());
  rightPanel.innerHTML = "<h3>Reporter News</h3><p>Review every reporter submission and approve it for publication.</p>";
  content.innerHTML = '<div class="form-section"><h2>REPORTER NEWS REVIEW</h2><div class="news-list" id="adminNewsList"></div></div>';
  const list = document.getElementById("adminNewsList");
  if (!news.length) {
    list.innerHTML = "<p>No reporter news yet.</p>";
    return;
  }
  news.forEach((item) => {
    const card = document.createElement("div");
    card.className = "admin-news-card";
    card.innerHTML = `<div><strong>${item.title}</strong><small>${item.reporterName || "Reporter"} · ${item.category || "Uncategorised"}</small><p>${item.description || "No description"}</p></div><div class="status-actions"><span class="status-pill ${item.status}">${item.status}</span><button class="btn-secondary approve">Approve</button><button class="btn-secondary reject">Reject</button></div>`;
    card.querySelector(".approve").addEventListener("click", async () => {
      await fetch(`/api/news/${item.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "approved" }) });
      showPastNews();
    });
    card.querySelector(".reject").addEventListener("click", async () => {
      await fetch(`/api/news/${item.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "rejected" }) });
      showPastNews();
    });
    list.appendChild(card);
  });
}

function showReporters() {
  document.getElementById("rightPanel").innerHTML = "<h3>Reporters</h3>";
  document.getElementById("content").innerHTML =
    '<div class="form-section"><h2>Reporters</h2><p>Feature coming soon</p></div>';
}

function showSettings() {
  document.getElementById("rightPanel").innerHTML = "<h3>Settings</h3>";
  document.getElementById("content").innerHTML =
    '<div class="form-section"><h2>Settings</h2><p>Feature coming soon</p></div>';
}

async function createNewNewspaper() {
  const content = document.getElementById("content");
  const rightPanel = document.getElementById("rightPanel");

  rightPanel.innerHTML = `<h3>Create Steps</h3><p>1. Select pages<br>2. Choose template per page<br>3. Add news to sections</p>`;

  content.innerHTML = `
    <div class="form-section">
      <h2>CREATE NEW NEWSPAPER</h2>
      <div class="print-specification">
        <strong>Print setup</strong>
        <span>Page: 330 × 530 mm · Matter area: 310 × 510 mm · CMYK</span>
      </div>
      <div class="form-group">
        <label>Select Page Count</label>
        <input type="number" id="pageCount" value="4" min="1" max="16" />
      </div>
      <button class="btn-submit" id="nextBtn">Next: Select Templates</button>
      <button class="btn-secondary" id="backBtn">Back</button>
    </div>
  `;

  document
    .getElementById("backBtn")
    .addEventListener("click", showPastNewspapers);
  document.getElementById("nextBtn").addEventListener("click", async () => {
    const pageCount = parseInt(document.getElementById("pageCount").value);
    const res = await fetch("/api/newspapers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageCount, template: "none", pageSize: { width: 330, height: 530, unit: "mm" }, liveArea: { width: 310, height: 510, unit: "mm" } }),
    });
    currentNewspaper = await res.json();
    currentPage = null;

    for (let i = 1; i <= pageCount; i++) {
      await fetch(`/api/newspapers/${currentNewspaper.id}/pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageNumber: i }),
      });
    }

    selectPageTemplates();
  });
}

async function selectPageTemplates() {
  const content = document.getElementById("content");
  const rightPanel = document.getElementById("rightPanel");
  const pages = await fetch(
    `/api/newspapers/${currentNewspaper.id}/pages`,
  ).then((r) => r.json());

  if (!currentPage || !pages.some((page) => page.id === currentPage.id)) currentPage = pages[0];

  rightPanel.innerHTML = `
    <h3>Page ${currentPage.pageNumber}</h3>
    <div class="page-list" id="pageList"></div>
  `;

  const pageList = document.getElementById("pageList");
  pages.forEach((page) => {
    const btn = document.createElement("button");
    btn.className = "page-btn" + (currentPage.id === page.id ? " active" : "");
    btn.textContent = `Page ${page.pageNumber}`;
    btn.addEventListener("click", () => {
      currentPage = page;
      selectPageTemplates();
    });
    pageList.appendChild(btn);
  });

  content.innerHTML = `
    <div class="form-section">
      <h2>SELECT TEMPLATE FOR PAGE ${currentPage.pageNumber}</h2>
      <p class="muted">These blank blocks are the real news sections. You will fill them after every page has a template.</p>
      <div class="page-template-grid" id="templates"></div>
      <button class="btn-submit" id="confirmBtn">Save Template & Continue</button>
      <button class="btn-secondary" id="backBtn">Back</button>
    </div>
  `;

  const templatesDiv = document.getElementById("templates");
  Object.entries(newspaperTemplates).forEach(([key, tpl]) => {
    const btn = document.createElement("div");
    btn.className = "page-template" + (currentPage.template?.name === tpl.name ? " active" : "");
    btn.innerHTML = `<strong>${tpl.name}</strong><small>${tpl.description}</small><div class="template-thumb real-page-grid" style="grid-template-areas: ${tpl.grid.replaceAll('"', '&quot;')}">${tpl.slots.map((slot) => `<span style="grid-area:${slot}"></span>`).join("")}</div>`;

    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".page-template")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentPage.template = { key, ...tpl };
    });

    templatesDiv.appendChild(btn);
  });

  document.getElementById("backBtn").addEventListener("click", () => {
    currentNewspaper = null;
    showPastNewspapers();
  });

  document.getElementById("confirmBtn").addEventListener("click", async () => {
    const selected = document.querySelector(".page-template.active");
    if (!selected) {
      alert("Select a template");
      return;
    }
    const savedResponse = await fetch(`/api/pages/${currentPage.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: currentPage.template }),
    });
    currentPage = await savedResponse.json();

    const nextPage = pages.find(
      (p) => p.pageNumber === currentPage.pageNumber + 1,
    );
    if (nextPage) {
      currentPage = nextPage;
      selectPageTemplates();
    } else {
      editNewspaper(currentNewspaper.id);
    }
  });
}

async function editNewspaper(newspaperId) {
  currentNewspaper = await fetch(`/api/newspapers/${newspaperId}`).then((r) =>
    r.json(),
  );
  const pages = await fetch(`/api/newspapers/${newspaperId}/pages`).then((r) =>
    r.json(),
  );
  const reporterNews = await fetch("/api/news").then((r) => r.json());

  if (!currentPage || !pages.some((page) => page.id === currentPage.id)) currentPage = pages[0];

  const content = document.getElementById("content");
  const rightPanel = document.getElementById("rightPanel");

  rightPanel.innerHTML = `
    <h3>Pages</h3>
    <div class="page-list" id="pageList"></div>
    <h3 style="margin-top: 20px;">Reporter News</h3>
    <p class="muted">Click a page section, then choose a story to auto-fill it.</p>
    <div class="news-list" id="newsList"></div>
  `;

  const pageList = document.getElementById("pageList");
  pages.forEach((page) => {
    const btn = document.createElement("button");
    btn.className = "page-btn" + (currentPage.id === page.id ? " active" : "");
    btn.textContent = `Page ${page.pageNumber}`;
    btn.addEventListener("click", () => {
      currentPage = page;
      editNewspaper(newspaperId);
    });
    pageList.appendChild(btn);
  });

  const newsList = document.getElementById("newsList");
  reporterNews.forEach((newsItem) => {
    const item = document.createElement("div");
    item.className = "news-item-small";
    item.innerHTML = `<div><strong>${newsItem.title}</strong><small>${newsItem.category || "Uncategorised"} · ${newsItem.status}</small></div>`;
    item.addEventListener("click", () => alert("Select a highlighted page section first, then choose this story from its editor."));
    newsList.appendChild(item);
  });

  content.innerHTML = `
    <div class="form-section">
      <div class="editor-heading"><div><h2>EDIT PAGE ${currentPage.pageNumber}</h2><p>${currentNewspaper.pageSize?.width || 330} × ${currentNewspaper.pageSize?.height || 530} mm · CMYK · matter area ${currentNewspaper.liveArea?.width || 310} × ${currentNewspaper.liveArea?.height || 510} mm</p></div><button class="btn-secondary" id="filesBtn">Scribus / final files</button></div>
      <h3>Template: ${currentPage.template?.name || "Choose a template first"}</h3>
      <div class="newspaper-page" id="preview"></div>
      <div class="section-editor" id="sectionEditor"><p>Click any blank or filled section to write news or auto-fill it from a reporter.</p></div>
    </div>
  `;

  const preview = document.getElementById("preview");
  const template = currentPage.template?.slots ? currentPage.template : newspaperTemplates.custom;
  preview.style.gridTemplateAreas = template.grid;
  const sectionArticles = Object.fromEntries((currentPage.articles || []).filter((article) => article.sectionId).map((article) => [article.sectionId, article]));
  template.slots.forEach((slot, index) => {
    const article = sectionArticles[slot];
    const section = document.createElement("button");
    section.className = "newspaper-section" + (article ? " filled" : "");
    section.style.gridArea = slot;
    section.innerHTML = article ? `<span class="section-label">Section ${index + 1}</span><strong>${article.title || "Untitled story"}</strong><small>${article.category || "News"}</small>` : `<span class="section-label">Section ${index + 1}</span><strong>Blank news section</strong><small>Click to add a story</small>`;
    section.addEventListener("click", () => showSectionEditor(newspaperId, slot, article, reporterNews));
    preview.appendChild(section);
  });
  document.getElementById("filesBtn").addEventListener("click", () => showPublicationFiles(newspaperId));
}

function showSectionEditor(newspaperId, sectionId, article = {}, reporterNews = []) {
  const editor = document.getElementById("sectionEditor");
  editor.innerHTML = `
    <h3>Section editor</h3>
    <p class="muted">Section ${sectionId}. Write a new story, or choose a reporter story to auto-fill the fields.</p>
    <div class="form-group"><label>Auto-fill from reporter</label><select id="reporterStory"><option value="">Write manually</option>${reporterNews.map((story) => `<option value="${story.id}">${story.title} (${story.status})</option>`).join("")}</select></div>
    <div class="form-group"><label>News heading</label><input id="sectionTitle" value="${article.title || ""}" /></div>
    <div class="form-group"><label>Small heading / subtitle</label><input id="sectionSubtitle" value="${article.subtitle || ""}" /></div>
    <div class="form-group"><label>Context / description</label><textarea id="sectionDescription">${article.description || ""}</textarea></div>
    <div class="form-row"><div class="form-group"><label>Category</label><input id="sectionCategory" value="${article.category || ""}" /></div><div class="form-group"><label>Location</label><input id="sectionLocation" value="${article.location || ""}" /></div></div>
    <div class="form-row"><div class="form-group"><label>Tags</label><input id="sectionTags" value="${article.tags || ""}" /></div><div class="form-group"><label>Reporter name</label><input id="sectionReporter" value="${article.reporterName || ""}" /></div></div>
    <div class="form-group"><label>Add images for this section</label><input id="sectionImages" type="file" accept="image/*" multiple /><small class="muted">Reporter images are carried over when you auto-fill a story.</small></div>
    <button class="btn-submit" id="saveSection">Save section</button>
  `;
  document.getElementById("reporterStory").addEventListener("change", (event) => {
    const story = reporterNews.find((item) => item.id === Number(event.target.value));
    if (!story) return;
    document.getElementById("sectionTitle").value = story.title || "";
    document.getElementById("sectionSubtitle").value = story.subtitle || "";
    document.getElementById("sectionDescription").value = story.description || "";
    document.getElementById("sectionCategory").value = story.category || "";
    document.getElementById("sectionLocation").value = story.location || "";
    document.getElementById("sectionTags").value = story.tags || "";
    document.getElementById("sectionReporter").value = story.reporterName || "";
  });
  document.getElementById("saveSection").addEventListener("click", async () => {
    const reporterId = Number(document.getElementById("reporterStory").value) || null;
    const selectedReporter = reporterNews.find((item) => item.id === reporterId);
    let imageUrls = selectedReporter?.imageUrls || article.imageUrls || [];
    const imageFiles = document.getElementById("sectionImages").files;
    if (imageFiles.length) {
      const imageData = new FormData();
      Array.from(imageFiles).forEach((file) => imageData.append("images", file));
      const uploadResponse = await fetch("/api/uploads/images", { method: "POST", body: imageData });
      const uploadResult = await uploadResponse.json();
      if (!uploadResponse.ok) return alert(uploadResult.error || "Could not upload section images.");
      imageUrls = [...imageUrls, ...uploadResult.imageUrls];
    }
    const payload = {
      title: document.getElementById("sectionTitle").value.trim(),
      subtitle: document.getElementById("sectionSubtitle").value.trim(),
      description: document.getElementById("sectionDescription").value.trim(),
      category: document.getElementById("sectionCategory").value.trim(),
      location: document.getElementById("sectionLocation").value.trim(),
      tags: document.getElementById("sectionTags").value.trim(),
      reporterName: document.getElementById("sectionReporter").value.trim(),
      sourceNewsId: reporterId,
      imageUrls
    };
    if (!payload.title) return alert("Add a news heading before saving this section.");
    const response = await fetch(`/api/pages/${currentPage.id}/sections/${sectionId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!response.ok) return alert("Could not save this section.");
    currentPage = await response.json();
    editNewspaper(newspaperId);
  });
}

async function showPublicationFiles(newspaperId) {
  const newspaper = await fetch(`/api/newspapers/${newspaperId}`).then((r) => r.json());
  const editor = document.getElementById("sectionEditor");
  editor.innerHTML = `
    <h3>Scribus final touch-up</h3>
    <p class="muted">After finishing the page in Scribus, upload the editable .sla project and the CMYK print PDF here.</p>
    ${newspaper.scribusFile ? `<p><a href="${newspaper.scribusFile}" download>Download saved Scribus project</a></p>` : ""}
    ${newspaper.printPdf ? `<p><a href="${newspaper.printPdf}" target="_blank">View final CMYK PDF</a></p>` : ""}
    <div class="form-group"><label>Scribus project (.sla)</label><input id="scribusFile" type="file" accept=".sla" /></div>
    <div class="form-group"><label>Final print PDF (CMYK)</label><input id="printPdf" type="file" accept="application/pdf,.pdf" /></div>
    <button class="btn-submit" id="uploadPublication">Save final files</button>
  `;
  document.getElementById("uploadPublication").addEventListener("click", async () => {
    const formData = new FormData();
    const scribusFile = document.getElementById("scribusFile").files[0];
    const printPdf = document.getElementById("printPdf").files[0];
    if (scribusFile) formData.append("scribusFile", scribusFile);
    if (printPdf) formData.append("printPdf", printPdf);
    if (!scribusFile && !printPdf) return alert("Choose a Scribus .sla file or final PDF.");
    const response = await fetch(`/api/newspapers/${newspaperId}/final-files`, { method: "POST", body: formData });
    const result = await response.json();
    if (!response.ok) return alert(result.error || "Could not upload final files.");
    alert("Final files saved.");
    showPublicationFiles(newspaperId);
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
    [...existingImageUrls, ...selectedReporterImages.map((file) => URL.createObjectURL(file))].forEach((url) => {
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
      selectedReporterImages.map((file) => `${file.name}-${file.size}-${file.lastModified}`),
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
      document.getElementById("subtitle").value = draft.subtitle || "";
      document.getElementById("description").value = draft.description || "";
      document.getElementById("category").value = draft.category || "";
      document.getElementById("location").value = draft.location || "";
      document.getElementById("tags").value = draft.tags || "";
      existingImageUrls = draft.imageUrls?.length
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
  formData.append("subtitle", document.getElementById("subtitle").value);
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
    showReporterNewsList(
      status === "draft" ? "draft" : "pending",
      status === "draft" ? "My Drafts" : "Submitted",
    );
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
      <h2>${newsItem.title}</h2>
      <p><em>${newsItem.subtitle || ""}</em></p>
      <div class="info-row"><label>Category:</label><strong>${newsItem.category || "-"}</strong></div>
      <div class="info-row"><label>Location:</label><strong>${newsItem.location || "-"}</strong></div>
      <div class="info-row"><label>Tags:</label><strong>${newsItem.tags || "-"}</strong></div>
      <div class="form-group">
        <label>Description</label>
        <p>${newsItem.description || "-"}</p>
      </div>
      <div id="newsImages"></div>
    </div>
  `;

  const images = newsItem.imageUrls?.length
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

init();
