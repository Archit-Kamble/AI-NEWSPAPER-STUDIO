const bcrypt = require('bcryptjs');
const userRepository = require('./repositories/user.repository');



const memoryNews = [];
const memoryPages = [];
const memoryNewspapers = [];

async function authenticateUser(email, password) {
  const user = await userRepository.findByEmail(email);

  if (!user) {
    return null;
  }

  const valid = await bcrypt.compare(password, user.password_hash);

  if (!valid) {
    return null;
  }

  return {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
  };
}

async function createNews(payload) {
  const item = {
    id: memoryNews.length + 1,
    ...payload,
    imageUrls: payload.imageUrls || [],
    imageFiles: payload.imageFiles || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  memoryNews.push(item);
  return item;
}

function updateNews(id, updates) {
  const item = memoryNews.find(n => n.id === id);
  if (!item) return null;
  Object.assign(item, updates, { updatedAt: new Date().toISOString() });
  return item;
}

function listNews(filter = {}) {
  return memoryNews.filter(n => {
    if (filter.status && n.status !== filter.status) return false;
    if (filter.language && n.language !== filter.language) return false;
    if (filter.reporterId && n.reporterId !== filter.reporterId) return false;
    return true;
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getNewsByStatus(status) {
  return listNews({ status });
}

function createNewspaper(payload) {
  const newspaper = {
    id: memoryNewspapers.length + 1,
    ...payload,
    createdAt: new Date().toISOString(),
    pages: []
  };
  memoryNewspapers.push(newspaper);
  return newspaper;
}

function updateNewspaper(id, updates) {
  const newspaper = memoryNewspapers.find(n => n.id === id);
  if (!newspaper) return null;
  Object.assign(newspaper, updates);
  return newspaper;
}

function listNewspapers() {
  return memoryNewspapers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getLatestNewspaper() {
  return memoryNewspapers[memoryNewspapers.length - 1] || null;
}

function createPage(payload) {
  const page = {
    id: memoryPages.length + 1,
    ...payload,
    articles: [],
    createdAt: new Date().toISOString()
  };
  memoryPages.push(page);
  return page;
}

function updatePage(id, updates) {
  const page = memoryPages.find(p => p.id === id);
  if (!page) return null;
  Object.assign(page, updates);
  return page;
}

function listPages(newspaperId) {
  return memoryPages.filter(p => p.newspaperId === newspaperId);
}

function addArticleToPage(pageId, article) {
  const page = memoryPages.find(p => p.id === pageId);
  if (!page) return null;
  page.articles.push(article);
  return page;
}

function savePageSection(pageId, sectionId, article) {
  const page = memoryPages.find(p => p.id === pageId);
  if (!page) return null;
  const index = page.articles.findIndex(item => item.sectionId === sectionId);
  const savedArticle = { ...article, sectionId, updatedAt: new Date().toISOString() };
  if (index === -1) page.articles.push(savedArticle);
  else page.articles[index] = { ...page.articles[index], ...savedArticle };
  return page;
}

module.exports = {
  authenticateUser,
  createNews,
  updateNews,
  listNews,
  getNewsByStatus,
  createNewspaper,
  updateNewspaper,
  listNewspapers,
  getLatestNewspaper,
  createPage,
  updatePage,
  listPages,
  addArticleToPage,
  savePageSection
};
