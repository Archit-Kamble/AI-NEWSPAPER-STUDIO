import { renderWorkspace } from "./editor/workspace.js";
import { renderEditions } from "./admin/editions.js";

const app = document.getElementById("app");
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
  document.querySelector(".sidebar").addEventListener("click", (event) => {
    if (event.target.classList.contains("sidebar-btn")) closeAppSidebar();
  });
}

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
        <div class="header-left">
          <button class="hamburger-btn" id="appSidebarToggle" title="Menu">&#9776;</button>
          SAHAS
        </div>
        <div class="header-center">Hi ${currentUser.name}</div>
        <div class="header-right"><button id="logoutBtn">Logout</button></div>
      </div>
      <div class="container">
        <div class="sidebar-app-backdrop" id="sidebarAppBackdrop"></div>
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

  wireAppSidebarToggle();

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
        <p>${newsItem.subheading || newsItem.subtitle || ""}</p>

<small>
${newsItem.category || ""} •
${newsItem.location || ""} •
${new Date(newsItem.created_at || newsItem.createdAt).toLocaleDateString()}
</small>
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
        <div class="header-left">
          <button class="hamburger-btn" id="appSidebarToggle" title="Menu">&#9776;</button>
          SAHAS
        </div>
        <div class="header-center">Hi Admin</div>
        <div class="header-right"><button id="logoutBtn">Logout</button></div>
      </div>
      <div class="container">
        <div class="sidebar-app-backdrop" id="sidebarAppBackdrop"></div>
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

  wireAppSidebarToggle();

  const logout = () => {
    currentUser = null;
    renderLogin();
  };
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("logoutBtn2").addEventListener("click", logout);

  const goDashboard = (fn) => () => {
    document.querySelector(".container")?.classList.remove("container--workspace");
    const rightPanel = document.getElementById("rightPanel");
    if (rightPanel) rightPanel.style.display = "";
    fn();
  };
  document
    .getElementById("pastBtn")
    .addEventListener("click", goDashboard(showPastNewspapers));
  document
    .getElementById("pastNewsBtn")
    .addEventListener("click", goDashboard(showPastNews));
  document
    .getElementById("reportersBtn")
    .addEventListener("click", goDashboard(showReporters));
  document
    .getElementById("settingsBtn")
    .addEventListener("click", goDashboard(showSettings));

  showPastNewspapers();
}

async function showPastNewspapers() {
  const content = document.getElementById("content");
  const rightPanel = document.getElementById("rightPanel");

  const newspapers = await fetch("/api/newspapers").then((r) => r.json());
  const news = await fetch("/api/news").then((r) => r.json());

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
  await renderEditions(content, { onOpen: (id) => editNewspaper(id) });
}

async function showPastNews() {
  const content = document.getElementById("content");
  const rightPanel = document.getElementById("rightPanel");
  const news = await fetch("/api/news").then((r) => r.json());
  rightPanel.innerHTML =
    "<h3>Reporter News</h3><p>Review every reporter submission and approve it for publication.</p>";
  content.innerHTML =
    '<div class="form-section"><h2>REPORTER NEWS REVIEW</h2><div class="news-list" id="adminNewsList"></div></div>';
  const list = document.getElementById("adminNewsList");
  if (!news.length) {
    list.innerHTML = "<p>No reporter news yet.</p>";
    return;
  }
  news.forEach((item) => {
    const card = document.createElement("div");
    card.className = "admin-news-card";
    card.innerHTML = `<div><strong>${item.title}</strong><small>${item.reporter_name || item.reporterName || "Reporter"} · ${item.category || "Uncategorised"}</small><p>${item.description || "No description"}</p></div><div class="status-actions"><span class="status-pill ${item.status}">${item.status}</span><button class="btn-secondary approve">Approve</button><button class="btn-secondary reject">Reject</button></div>`;
    card.querySelector(".approve").addEventListener("click", async () => {
      await fetch(`/api/news/${item.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });
      showPastNews();
    });
    card.querySelector(".reject").addEventListener("click", async () => {
      await fetch(`/api/news/${item.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "rejected" }),
      });
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
      <p><em>${newsItem.subheading || newsItem.subtitle || ""}</em></p>
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

async function editNewspaper(newspaperId) {
  document.querySelector(".container")?.classList.add("container--workspace");
  closeAppSidebar();
  const rightPanel = document.getElementById("rightPanel");
  rightPanel.innerHTML = "";
  rightPanel.style.display = "none";
  await renderWorkspace(newspaperId);
}

init();
