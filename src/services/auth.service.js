const bcrypt = require('bcryptjs');
const userRepository = require('../repositories/user.repository');

async function authenticateUser(email, password) {
  const user = await userRepository.findByEmail(email);
  if (!user) return null;

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;
  if (!user.is_active) return { blocked: true };

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
  if (user?.blocked) return { error: 'This reporter account is blocked. Contact the newspaper owner.' };
  if (!user) return { error: 'Invalid credentials' };

  // `role` is optional, and asking for it is the caller saying "I expect this
  // account to be a reporter/an admin" - a check, never a grant: the role that
  // reaches the session is always the one on the user row. It used to be
  // REQUIRED, which turned it into a second password nobody had been issued:
  // the sign-in form guessed it from whether the email contained "admin", so a
  // desk user at any other address was refused with the right credentials.
  // Callers that still send it (tests/helpers/desk.js) behave exactly as before.
  if (role && user.role !== role) return { error: 'Invalid credentials' };

  return { user };
}

module.exports = { authenticateUser, login };
