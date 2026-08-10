const bcrypt = require('bcryptjs');
const userRepository = require('../repositories/user.repository');

async function authenticateUser(email, password) {
  const user = await userRepository.findByEmail(email);
  if (!user) return null;

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;

  return {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
  };
}

async function login({ email, password, role }) {
  if (!email || !password) {
    return { error: 'Email and password required' };
  }

  const user = await authenticateUser(email, password);
  if (!user || user.role !== role) {
    return { error: 'Invalid credentials' };
  }

  return { user };
}

module.exports = { authenticateUser, login };
