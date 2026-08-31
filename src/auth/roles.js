// WHO IS WHO IN THIS NEWSROOM, AND WHAT EACH OF THEM MAY DO.
//
// There were two roles, `admin` and `reporter`, and the gap between them was
// the whole paper: anybody who could make up a page could also approve a
// reporter's copy, release the public e-paper and delete an edition. A daily
// does not work that way, and neither does this product's own pipeline, which
// has said so since VISION.md was written:
//
//     Reporter -> Editor -> Chief Editor -> Page Designer -> ...
//
// Two of these four roles were ALREADY WRITTEN DOWN and could not exist.
// `DESK_ROLES = ['admin', 'editor', 'chief_editor']` has been in
// src/middleware/auth.js (and mirrored in public/admin.js) since the auth
// boundary was added, while `users.role` carried
// `CHECK (role IN ('admin','reporter'))` - so every request was tested against
// two roles the database refused to store. It is the same half-wired shape
// this codebase has already found three times (`drop_cap` BOOLEAN,
// `list_style`, `letter_spacing_px`): a control, a column or a constant that
// reaches nothing.
//
// SAMPADAK IS `chief_editor`, and that is deliberate. संपादक is the Marathi
// for the editor who answers for what the paper prints, which is exactly the
// rung `chief_editor` already names in that constant. Adding `sampadak` as a
// THIRD spelling of one rung is the duplicated-catalogue failure this project
// has been bitten by twice (the drifted template keys, `object-fit` cover
// against contain). One key, stored; the desk reads the label below.
//
// A CAPABILITY, NOT A RANK. A ladder reads well and cannot say the true thing
// about a newsroom: filing copy is the reporter's job and NOT the owner's
// superpower, so `admin > reporter` would quietly grant the owner a reporter's
// inbox and every rule in news.service.js that keys off it. Each capability
// names its own roles, and a role that is not listed does not have it.

const ROLES = {
  admin: {
    key: 'admin',
    label: 'Owner',
    marathi: 'मालक',
    // What this role is FOR, in one line, shown beside it wherever an owner
    // picks one. A role nobody can tell apart from its neighbour is a role
    // that gets handed out wrongly.
    describes: 'Runs the paper. Everything below, plus logins, settings and deleting an edition.',
  },
  chief_editor: {
    key: 'chief_editor',
    label: 'Sampadak',
    marathi: 'संपादक',
    describes: "Answers for what prints. Makes up the paper, approves reporters' copy and publishes the e-paper.",
  },
  editor: {
    key: 'editor',
    label: 'Editor',
    marathi: 'उप-संपादक',
    describes: 'Makes up the paper - pages, blocks, pictures, the AI. Does not approve copy or publish.',
  },
  reporter: {
    key: 'reporter',
    label: 'Reporter',
    marathi: 'वार्ताहर',
    describes: 'Files stories and edits their own drafts. Sees nothing else.',
  },
};

const ROLE_KEYS = Object.keys(ROLES);

// Every capability the server checks, and the roles that hold it. This table
// is the ONLY statement of the rule: the middleware is a lookup into it, and
// the browser is TOLD the answer rather than given a copy (see
// `capabilitiesOf` - it goes out on /api/auth/me and /api/auth/login). A copy
// in the browser is a second catalogue, and a second catalogue drifts.
const CAPABILITIES = {
  // Lay out the paper: pages, blocks, pictures, type, the AI writer. What
  // `requireDesk`/`deskWrites` has always meant.
  makeUp: ['admin', 'chief_editor', 'editor'],
  // Pass or refuse a reporter's filing. A reporter's copy carries their name
  // into print, so accepting it is the act the Sampadak answers for.
  reviewCopy: ['admin', 'chief_editor'],
  // Release, re-map or withdraw the public e-paper. The moment the paper stops
  // being the newsroom's and becomes the reader's.
  publish: ['admin', 'chief_editor'],
  // Add, edit, or block a login of any role.
  manageStaff: ['admin'],
  // Remove an edition. Irreversible, and the archive is the paper's own record.
  deleteEdition: ['admin'],
  // The publication's own identity record - masthead, imprint, contact.
  settings: ['admin'],
};

const CAPABILITY_KEYS = Object.keys(CAPABILITIES);

function isRole(key) {
  return Object.hasOwn(ROLES, String(key));
}

/**
 * May this user do this?
 *
 * An unknown capability is FALSE, never true - a typo in a route guard must
 * close the door, not open it.
 */
function can(user, capability) {
  const roles = CAPABILITIES[capability];
  if (!roles) return false;
  return roles.includes(user?.role);
}

/**
 * What this user may do, as a flat object for the wire.
 *
 * The browser hides a control it reads `false` for; the server checks the same
 * table again on the request. Hiding is a courtesy, never the guard.
 */
function capabilitiesOf(user) {
  return Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, can(user, key)]));
}

/** The roles an owner may hand out, in the order a newsroom ranks them. */
function assignableRoles() {
  return ROLE_KEYS.map((key) => ({ ...ROLES[key] }));
}

function labelOf(key) {
  return ROLES[key]?.label || String(key || '');
}

module.exports = {
  ROLES, ROLE_KEYS, CAPABILITIES, CAPABILITY_KEYS,
  can, capabilitiesOf, assignableRoles, isRole, labelOf,
};
