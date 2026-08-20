const authService = require('../services/auth.service');
const userRepository = require('../repositories/user.repository');

async function login(req, res) {
  const result = await authService.login(req.body);
  if (result.error) {
    const status = result.error === 'Email and password required' ? 400
      : result.error.includes('blocked') ? 403 : 401;
    return res.status(status).json({ error: result.error });
  }
  req.session.user = result.user;
  res.json({ user: result.user });
}

async function me(req, res) {
  const sessionUser = req.session.user;
  if (!sessionUser) return res.json({ user: null });

  const user = await userRepository.findById(sessionUser.id);
  if (!user || !user.is_active) {
    req.session.destroy(() => {});
    return res.json({ user: null });
  }

  res.json({ user: sessionUser });
}

module.exports = { login, me };
