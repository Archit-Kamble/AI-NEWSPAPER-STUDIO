// Adding, editing and blocking a login - of any role.
//
// This was `reporter.service.js` and every function in it said `reporter`,
// because until there were four roles there was only one kind of account an
// owner could make. The route, the screen and the copy all followed. The rules
// below are the ones that are NOT merely "the same, with a role column".

const bcrypt = require('bcryptjs');
const userRepository = require('../repositories/user.repository');
const newsRepository = require('../repositories/news.repository');
const { isRole, labelOf } = require('../auth/roles');

const emailOf = (value) => String(value || '').trim().toLowerCase();
const text = (value, max = 255) => String(value || '').trim().slice(0, max);

// A password this short is not a policy decision, it is the floor below which
// the login throttle is the only thing standing between an account and a
// dictionary. It applies to a Sampadak exactly as it does to a reporter.
const MIN_PASSWORD = 8;

function staffFields(body = {}, { requireRole = false } = {}) {
  const name = text(body.name, 120);
  const email = emailOf(body.email);
  if (!name) return { error: 'A name is required.' };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: 'A valid email address is required.' };

  // An absent role means "leave it alone" on an edit, and "a reporter" on a
  // create - which is what /api/staff answered before roles existed, so an
  // existing caller that sends no role still gets exactly what it used to.
  let role = null;
  if (body.role !== undefined && body.role !== null && body.role !== '') {
    if (!isRole(body.role)) return { error: 'That is not a role on this paper.' };
    role = String(body.role);
  }
  if (requireRole && !role) role = 'reporter';

  return {
    name, email, role,
    phone: text(body.phone, 40), district: text(body.district, 120),
    beat: text(body.beat, 120), notes: text(body.notes, 4000),
  };
}

async function listStaff(query) {
  const roles = String(query?.role || '').split(',').map((r) => r.trim()).filter(isRole);
  return userRepository.listStaff(query?.search, roles.length ? roles : undefined);
}

async function staffProfile(id) {
  const person = await userRepository.findStaff(Number(id));
  if (!person) return null;
  const stories = await newsRepository.findAll({ created_by: Number(id) });
  // `reporter` is kept as the key beside `person` because the owner's screen
  // and tests already read it, and a filing history is a filing history
  // whoever wrote it.
  return { person, reporter: person, stories };
}

async function createStaff(body) {
  const fields = staffFields(body, { requireRole: true });
  if (fields.error) return fields;
  const password = String(body?.password || '');
  if (password.length < MIN_PASSWORD) return { error: `The password must be at least ${MIN_PASSWORD} characters.` };
  try {
    const person = await userRepository.createStaff({
      ...fields,
      passwordHash: await bcrypt.hash(password, 12),
    });
    return { person };
  } catch (error) {
    if (error.code === '23505') return { error: 'A user already uses that email address.' };
    throw error;
  }
}

/**
 * An owner may not demote the last owner, and that includes themselves.
 *
 * Only an owner can hand a login back out, so the moment the last active owner
 * stops being one there is no way back into the paper's own administration
 * except psql - which is exactly the position this product refused to leave a
 * desk in when it gave them a Delete button for an edition.
 */
async function updateStaff(id, body, actor) {
  const fields = staffFields(body);
  if (fields.error) return fields;
  const target = await userRepository.findStaff(Number(id));
  if (!target) return { notFound: true };

  if (fields.role && fields.role !== target.role && target.role === 'admin') {
    if ((await userRepository.activeOwnerCount(Number(id))) === 0) {
      return { error: 'This is the paper\'s only owner. Make somebody else an owner first.' };
    }
    if (actor && Number(actor.id) === Number(id)) {
      return { error: 'You cannot change your own role. Ask another owner to do it.' };
    }
  }

  try {
    const person = await userRepository.updateStaff(Number(id), fields);
    return person ? { person } : { notFound: true };
  } catch (error) {
    if (error.code === '23505') return { error: 'A user already uses that email address.' };
    throw error;
  }
}

async function setStaffAccess(id, active, actor) {
  if (typeof active !== 'boolean') return { error: 'Choose whether this account is active or blocked.' };
  const target = await userRepository.findStaff(Number(id));
  if (!target) return { notFound: true };

  if (!active) {
    if (actor && Number(actor.id) === Number(id)) {
      return { error: 'You cannot block your own login.' };
    }
    if (target.role === 'admin' && (await userRepository.activeOwnerCount(Number(id))) === 0) {
      return { error: `This is the paper's only ${labelOf('admin')}. Make somebody else an owner first.` };
    }
  }

  const person = await userRepository.setStaffActive(Number(id), active);
  return person ? { person } : { notFound: true };
}

module.exports = { listStaff, staffProfile, createStaff, updateStaff, setStaffAccess };
