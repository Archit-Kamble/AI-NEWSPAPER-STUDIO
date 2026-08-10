const authService = require('../services/auth.service');

async function login(req, res) {
  const result = await authService.login(req.body);
  if (result.error) {
    const status = result.error === 'Email and password required' ? 400 : 401;
    return res.status(status).json({ error: result.error });
  }
  req.session.user = result.user;
  res.json({ user: result.user });
}

function me(req, res) {
  res.json({ user: req.session.user || null });
}

module.exports = { login, me };
