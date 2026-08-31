const staffService = require('../services/staff.service');
const { assignableRoles } = require('../auth/roles');

async function list(req, res) { res.json(await staffService.listStaff(req.query)); }

/**
 * The roles an owner may hand out, from the one catalogue.
 *
 * Served rather than restated in the browser, for the same reason the templates
 * and the ink palette are: a second list of these keys in a <select> is a
 * catalogue that drifts, and this product has been bitten by that twice.
 */
async function roles(req, res) { res.json(assignableRoles()); }

async function getOne(req, res) {
  const profile = await staffService.staffProfile(req.params.id);
  if (!profile) return res.status(404).json({ error: 'That account does not exist.' });
  res.json(profile);
}

async function create(req, res) {
  const result = await staffService.createStaff(req.body);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result.person);
}

async function update(req, res) {
  // The actor is the LIVE row the guard read back, not the session's copy -
  // "is this me?" and "am I still an owner?" must both be asked of the database.
  const result = await staffService.updateStaff(req.params.id, req.body, req.user);
  if (result.notFound) return res.status(404).json({ error: 'That account does not exist.' });
  if (result.error) return res.status(400).json(result);
  res.json(result.person);
}

async function access(req, res) {
  const result = await staffService.setStaffAccess(req.params.id, req.body?.active, req.user);
  if (result.notFound) return res.status(404).json({ error: 'That account does not exist.' });
  if (result.error) return res.status(400).json(result);
  res.json(result.person);
}

module.exports = { list, roles, getOne, create, update, access };
