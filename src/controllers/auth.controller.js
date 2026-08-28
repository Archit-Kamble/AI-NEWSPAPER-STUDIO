const authService = require('../services/auth.service');
const userRepository = require('../repositories/user.repository');

async function login(req, res, next) {
  const result = await authService.login(req.body);
  if (result.error) {
    const status = result.error === 'Email and password required' ? 400
      : result.error.includes('blocked') ? 403 : 401;
    return res.status(status).json({ error: result.error });
  }
  // THE LOGIN MUST BE WRITTEN DOWN BEFORE IT IS ANNOUNCED.
  //
  // Assigning `req.session.user` and answering immediately left the write to
  // whenever the session middleware got round to it. With sessions held in
  // memory that is the same tick and nothing shows; with them in PostgreSQL it
  // is a round trip, and the FIRST request a browser makes after signing in
  // raced it. Measured: sign in, then ask who is signed in - `user: null`, and
  // the very next identical request answers correctly. A desk would see
  // "Sign in to do that" immediately after signing in, sometimes.
  //
  // `regenerate` is here for a second reason, and it is the more important
  // one: it issues a NEW session id at the moment the account changes. Without
  // it, an id fixed on a browser before sign-in still identifies the session
  // after it - session fixation, where an attacker who can plant a cookie ends
  // up holding an editor's authority. The id a desk's authority is attached to
  // must be one this server minted after the password was checked.
  return new Promise((resolve) => {
    req.session.regenerate((regenerateError) => {
      if (regenerateError) return resolve(next(regenerateError));
      req.session.user = result.user;
      return req.session.save((saveError) => {
        if (saveError) return resolve(next(saveError));
        res.json({ user: result.user });
        return resolve();
      });
    });
  });
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
