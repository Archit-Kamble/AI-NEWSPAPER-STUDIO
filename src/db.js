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

async function savePageSection(pageId, sectionId, article) {
  await pageRepository.saveSection(pageId, sectionId, article);
  return pageRepository.findById(pageId);
}

module.exports = {
  authenticateUser,
  savePageSection
};
