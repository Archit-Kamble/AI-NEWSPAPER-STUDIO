// Who is allowed to change the newspaper.
//
// Until now: nobody was checked. Every route that creates an edition, edits a
// block, deletes a page or uploads a file answered to an anonymous caller, and
// an unauthenticated request could and did create a live edition. On a desk
// machine on a newsroom LAN that is not a theoretical problem - it is the whole
// paper, writable by anything that can reach port 3000.
//
// The rule this applies is the one the production flow already implies:
//
//   read     the finished edition and the e-paper are public. That is what an
//            e-paper is for.
//   file     a reporter files stories.
//   make up  only the desk - an editor or an admin - lays out pages, places
//            pictures, runs the AI, moves blocks or passes a page for press.
//
// Session-based, using the session the login route already establishes. No new
// mechanism, no tokens to leak; just the check that was never made.

const DESK_ROLES = ['admin', 'editor', 'chief_editor'];
const userRepository = require('../repositories/user.repository');

function currentUser(req) {
  return req.session?.user || null;
}

function requireSignIn(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Sign in to do that.' });
  }
  return userRepository.findById(user.id)
    .then((live) => {
      if (!live?.is_active) {
        req.session?.destroy?.(() => {});
        return res.status(403).json({ error: 'This reporter account is blocked. Contact the newspaper owner.' });
      }
      return next();
    })
    .catch(next);
}

/**
 * Only the desk may make up the paper.
 *
 * A reporter files copy; they do not move blocks about on page one. Keeping
 * that boundary in one place means a new route cannot quietly become editable
 * by everyone just because whoever added it forgot.
 */
function requireDesk(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in to do that.' });
  if (!DESK_ROLES.includes(user.role)) {
    return res.status(403).json({ error: 'Only an editor can make up the paper.' });
  }
  return userRepository.findById(user.id)
    .then((live) => {
      if (!live?.is_active) {
        req.session?.destroy?.(() => {});
        return res.status(403).json({ error: 'This account is blocked. Contact the newspaper owner.' });
      }
      return next();
    })
    .catch(next);
}

function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in to do that.' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Only the newspaper owner can manage reporters and settings.' });
  return requireDesk(req, res, next);
}

/**
 * Guards every method that changes something, and leaves GET alone.
 *
 * Used as router-level middleware so a route added tomorrow is covered without
 * anybody having to remember - the failure mode being guarded against is
 * forgetting, so the guard must not itself need to be remembered per route.
 */
function deskWrites(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  return requireDesk(req, res, next);
}

module.exports = { requireSignIn, requireDesk, requireAdmin, deskWrites, currentUser, DESK_ROLES };
