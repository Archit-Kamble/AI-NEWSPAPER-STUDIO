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

const newspaperRepository = require('./repositories/newspaper.repository');
const pageRepository = require('./repositories/page.repository');

async function createNewspaper(payload) {
  return newspaperRepository.create({
    name: payload.name || 'साहस',
    publicationDate: payload.date,
    createdBy: payload.createdBy || null
  });
}

async function updateNewspaper(id, updates) {
  return newspaperRepository.update(id, updates);
}

async function listNewspapers() {
  return newspaperRepository.findAll();
}

async function getNewspaper(id) {
  return newspaperRepository.findById(id);
}

async function getLatestNewspaper() {
  const newspapers = await newspaperRepository.findAll();
  return newspapers[0] || null;
}

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
  createNewspaper,
  updateNewspaper,
  listNewspapers,
  getNewspaper,
  getLatestNewspaper,
  createPage,
  updatePage,
  listPages,
  addArticleToPage,
  savePageSection
};
