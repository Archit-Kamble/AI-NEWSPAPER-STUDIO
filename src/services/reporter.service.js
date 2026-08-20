const bcrypt = require('bcryptjs');
const userRepository = require('../repositories/user.repository');
const newsRepository = require('../repositories/news.repository');

const emailOf = (value) => String(value || '').trim().toLowerCase();
const text = (value, max = 255) => String(value || '').trim().slice(0, max);

function reporterFields(body = {}) {
  const name = text(body.name, 120);
  const email = emailOf(body.email);
  if (!name) return { error: 'Reporter name is required.' };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: 'A valid reporter email is required.' };
  return {
    name, email,
    phone: text(body.phone, 40), district: text(body.district, 120),
    beat: text(body.beat, 120), notes: text(body.notes, 4000),
  };
}

async function listReporters(query) {
  return userRepository.listReporters(query?.search);
}

async function reporterProfile(id) {
  const reporter = await userRepository.findReporter(Number(id));
  if (!reporter) return null;
  const stories = await newsRepository.findAll({ created_by: Number(id) });
  return { reporter, stories };
}

async function createReporter(body) {
  const fields = reporterFields(body);
  if (fields.error) return fields;
  const password = String(body?.password || '');
  if (password.length < 8) return { error: 'Reporter password must be at least 8 characters.' };
  try {
    const reporter = await userRepository.createReporter({
      ...fields,
      passwordHash: await bcrypt.hash(password, 12),
    });
    return { reporter };
  } catch (error) {
    if (error.code === '23505') return { error: 'A user already uses that email address.' };
    throw error;
  }
}

async function updateReporter(id, body) {
  const fields = reporterFields(body);
  if (fields.error) return fields;
  try {
    const reporter = await userRepository.updateReporter(Number(id), fields);
    return reporter ? { reporter } : { notFound: true };
  } catch (error) {
    if (error.code === '23505') return { error: 'A user already uses that email address.' };
    throw error;
  }
}

async function setReporterAccess(id, active) {
  if (typeof active !== 'boolean') return { error: 'Choose whether this reporter is active or blocked.' };
  const reporter = await userRepository.setReporterActive(Number(id), active);
  return reporter ? { reporter } : { notFound: true };
}

module.exports = { listReporters, reporterProfile, createReporter, updateReporter, setReporterAccess };
