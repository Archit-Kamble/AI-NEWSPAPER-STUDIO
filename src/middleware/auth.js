// Who is allowed to change the newspaper.
//
// Until this existed: nobody was checked. Every route that creates an edition,
// edits a block, deletes a page or uploads a file answered to an anonymous
// caller, and an unauthenticated request could and did create a live edition.
// On a desk machine on a newsroom LAN that is not a theoretical problem - it is
// the whole paper, writable by anything that can reach port 3000.
//
// The rule this applies is the one the production flow already implies:
//
//   read      the finished edition and the e-paper are public. That is what an
//             e-paper is for.
//   file      a reporter files stories.
//   make up   the desk - an editor, a Sampadak or the owner - lays out pages,
//             places pictures, runs the AI and moves blocks.
//   pass      approving a reporter's copy and releasing the public e-paper are
//             the Sampadak's, because they are what the paper answers for.
//   own       logins, settings and deleting an edition are the owner's alone.
//
// Session-based, using the session the login route already establishes. No new
// mechanism, no tokens to leak; just the check that was never made.
//
// EVERY RULE HERE IS A LOOKUP INTO src/auth/roles.js. This file used to carry
// its own `DESK_ROLES` list and a hand-written `role !== 'admin'`, which is two
// statements of one rule in a codebase whose recurring failure is exactly that.
// Nothing imports `DESK_ROLES` any more; every caller asks for a capability.

const { can, capabilitiesOf } = require('../auth/roles');
const userRepository = require('../repositories/user.repository');

function currentUser(req) {
  return req.session?.user || null;
}

/**
 * The one guard. Signed in, still active, and holds the capability.
 *
 * THE ROLE IS READ BACK FROM THE DATABASE, not from the session. A session
 * carries a copy of the user row as it was at sign-in, so an owner who demotes
 * a Sampadak at 6pm was leaving them their approval and publish authority until
 * they happened to sign out - the same hole `is_active` was already read live
 * to close, one field along. The row is fetched here anyway; using the role on
 * it costs nothing and closes it.
 *
 * `capability` may be null, which means "signed in and active" and nothing more.
 */
function guard(capability) {
  return function check(req, res, next) {
    const sessionUser = currentUser(req);
    if (!sessionUser) return res.status(401).json({ error: 'Sign in to do that.' });

    return userRepository.findById(sessionUser.id)
      .then((live) => {
        if (!live) {
          req.session?.destroy?.(() => {});
          return res.status(401).json({ error: 'Sign in to do that.' });
        }
        if (!live.is_active) {
          req.session?.destroy?.(() => {});
          return res.status(403).json({ error: 'This account is blocked. Contact the newspaper owner.' });
        }
        if (capability && !can(live, capability)) {
          return res.status(403).json({ error: REFUSALS[capability] });
        }
        // What the rest of the request sees is the row as it is NOW, so a
        // handler reading req.user cannot act on a stale role either.
        req.user = live;
        return next();
      })
      .catch(next);
  };
}

// A refusal names the person who CAN do the thing, because the reader of it is
// standing at a desk on deadline and their next move is to go and find them.
// "Forbidden" tells them nothing they can act on.
const REFUSALS = {
  makeUp: 'Only the desk can make up the paper.',
  reviewCopy: "Only the Sampadak can pass a reporter's copy.",
  publish: 'Only the Sampadak can publish the paper.',
  manageStaff: 'Only the newspaper owner can add or block a login.',
  deleteEdition: 'Only the newspaper owner can delete an edition.',
  settings: "Only the newspaper owner can change the publication's settings.",
};

const requireSignIn = guard(null);

/** Only the desk may make up the paper. A reporter files copy; they do not move blocks about on page one. */
const requireDesk = guard('makeUp');

/** The Sampadak's two: passing a reporter's copy, and releasing it to readers. */
const requireReview = guard('reviewCopy');
const requirePublish = guard('publish');

/** The owner's. `requireAdmin` keeps its name - it is imported by server.js and by tests. */
const requireAdmin = guard('manageStaff');
const requireOwnerDelete = guard('deleteEdition');

/**
 * Guards every method that changes something, and leaves GET alone.
 *
 * Used as router-level middleware so a route added tomorrow is covered without
 * anybody having to remember - the failure mode being guarded against is
 * forgetting, so the guard must not itself need to be remembered per route.
 *
 * It only ever grants `makeUp`. A route needing more than that says so itself,
 * at the route (see newspaper.routes.js) - which is also why every GET that
 * returns production data has to repeat `requireDesk`.
 */
function deskWrites(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  return requireDesk(req, res, next);
}

module.exports = {
  requireSignIn,
  requireDesk,
  requireReview,
  requirePublish,
  requireAdmin,
  requireOwnerDelete,
  deskWrites,
  currentUser,
  capabilitiesOf,
};
