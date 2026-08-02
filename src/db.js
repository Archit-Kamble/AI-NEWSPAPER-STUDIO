const bcrypt = require('bcryptjs');
const userRepository = require('./repositories/user.repository');



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

const pageRepository = require('./repositories/page.repository');

async function createPage(payload) {
  return pageRepository.create(payload.newspaperId, payload.pageNumber, payload.templateKey || payload.template || 'front');
}

async function updatePage(id, updates) {
  if (!updates.templateKey && !updates.template) return pageRepository.findById(id);
  return pageRepository.updateTemplate(id, updates.templateKey || updates.template);
}

async function listPages(newspaperId) {
  return pageRepository.findByNewspaper(newspaperId);
}

async function addArticleToPage() {
  throw new Error('Use savePageSection with a section key');
}

async function savePageSection(pageId, sectionId, article) {
  await pageRepository.saveSection(pageId, sectionId, article);
  return pageRepository.findById(pageId);
}

module.exports = {
  authenticateUser,
  createPage,
  updatePage,
  listPages,
  addArticleToPage,
  savePageSection
};
