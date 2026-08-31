const authService = require('../services/auth.service');
const userRepository = require('../repositories/user.repository');
const { capabilitiesOf, labelOf } = require('../auth/roles');

/**
 * What the browser is TOLD it may do.
 *
 * public/admin.js used to carry its own `DESK_ROLES = [...]` copy to decide
 * which dashboard to open - a second statement of a rule whose first statement
 * is src/auth/roles.js, and this project's recurring failure is exactly that.
 * The server answers instead, so the browser has no rules in it at all: it
 * hides a control it is told `false` for, and the server checks the same table
 * again on the request. Hiding is a courtesy; the guard is on the route.
 */
function withCapabilities(user) {
  return { ...user, roleLabel: labelOf(user.role), can: capabilitiesOf(user) };
}

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
        res.json({ user: withCapabilities(result.user) });
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

  // The ROLE comes off the live row, not the session's copy of it. An owner who
  // makes somebody a Sampadak at 6pm should not have to ask them to sign out
  // and in again before the screen grows the controls - and the reverse matters
  // more: a demotion has to take the controls away on the next page load, which
  // is the same reason the guard reads the role back per request.
  res.json({ user: withCapabilities({ ...sessionUser, role: user.role, name: user.name }) });
}

module.exports = { login, me };
