require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');
const { createApp } = require('../server');
const { signIn } = require('./helpers/desk');
const { identityFor } = require('../src/layout/identity');
const settingsService = require('../src/services/settings.service');

test.after(() => pool.end());

async function ensureOwner() {
  const password = await bcrypt.hash('admin123', 4);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, is_active)
     VALUES ('Owner', 'admin@esahas.com', $1, 'admin', TRUE)
     ON CONFLICT (email) DO UPDATE SET password_hash = $1, role = 'admin', is_active = TRUE`,
    [password],
  );
}

test('the owner can manage reporter identity, review filings, and block access without losing the filing record', async () => {
  const server = createApp().listen(0);
  const port = server.address().port;
  const suffix = `${process.pid}-${Date.now()}`;
  const email = `reporter-${suffix}@example.test`;
  let reporterId = null;
  let storyId = null;
  try {
    await ensureOwner();
    const owner = await signIn(port);
    const created = await owner('/api/reporters', {
      method: 'POST', body: JSON.stringify({
        name: 'Asha Reporter', email, password: 'safe-pass-123', phone: '9000000000', district: 'Satara', beat: 'Civic', notes: 'Morning desk',
      }),
    });
    assert.equal(created.status, 201);
    const reporter = await created.json();
    reporterId = reporter.id;
    assert.equal(reporter.is_active, true);
    assert.equal(Object.hasOwn(reporter, 'password_hash'), false);

    const reporterSession = await signIn(port, { email, password: 'safe-pass-123', role: 'reporter' });
    const filed = await reporterSession('/api/news', {
      method: 'POST', body: JSON.stringify({ title: 'Reporter filing', description: 'Filed for desk review.', reporterName: 'Forged byline', status: 'pending' }),
    });
    assert.equal(filed.status, 201);
    const story = await filed.json();
    storyId = story.id;
    assert.equal(story.reporter_name, 'Asha Reporter', 'the session owns the byline');
    assert.equal((await reporterSession(`/api/news/${storyId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'approved' }) })).status, 403);

    const profileResponse = await owner(`/api/reporters/${reporterId}`);
    assert.equal(profileResponse.status, 200);
    const profile = await profileResponse.json();
    assert.equal(profile.reporter.beat, 'Civic');
    assert.equal(profile.stories.length, 1);

    const reviewed = await owner(`/api/news/${storyId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'rejected', reviewNote: 'Please confirm the ward number.' }) });
    assert.equal(reviewed.status, 200);
    assert.equal((await reviewed.json()).review_note, 'Please confirm the ward number.');

    const blocked = await owner(`/api/reporters/${reporterId}/access`, { method: 'PATCH', body: JSON.stringify({ active: false }) });
    assert.equal(blocked.status, 200);
    assert.equal((await reporterSession('/api/news')).status, 403, 'a live session is checked against the current access state');
    const blockedLogin = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'safe-pass-123' }) });
    assert.equal(blockedLogin.status, 403);

    assert.equal((await owner(`/api/reporters/${reporterId}/access`, { method: 'PATCH', body: JSON.stringify({ active: true }) })).status, 200);
    const restoredSession = await signIn(port, { email, password: 'safe-pass-123', role: 'reporter' });
    assert.equal((await restoredSession('/api/news')).status, 200);
  } finally {
    if (storyId) await pool.query('DELETE FROM news_items WHERE id = $1', [storyId]);
    if (reporterId) await pool.query('DELETE FROM users WHERE id = $1', [reporterId]);
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections?.();
    await closed;
  }
});

test('general settings are owner-only, validated, and persist as one durable record', async () => {
  const server = createApp().listen(0);
  const port = server.address().port;
  let before;
  try {
    await ensureOwner();
    const owner = await signIn(port);
    before = await (await owner('/api/settings/general')).json();
    assert.equal((await owner('/api/settings/general', { method: 'PUT', body: JSON.stringify({ publicationName: 'SAHAS', publicWebsite: 'not-a-url' }) })).status, 400);
    const save = await owner('/api/settings/general', { method: 'PUT', body: JSON.stringify({
      publicationName: 'Sahas Varta Test', publisherName: 'Owner', address: 'Satara', contactEmail: 'desk@example.test', contactPhone: '12345', publicWebsite: 'https://example.test', timezone: 'Asia/Kolkata', defaultLanguage: 'mr',
    }) });
    assert.equal(save.status, 200);
    assert.equal((await save.json()).publication_name, 'Sahas Varta Test');
    assert.equal((await (await owner('/api/settings/general')).json()).contact_email, 'desk@example.test');
    const identity = identityFor('2026-08-20', 4);
    assert.equal(identity.title, 'Sahas Varta Test');
    assert.equal(identity.owner, 'Owner');
    assert.equal(identity.office, 'Satara');
    assert.equal(identity.email, 'desk@example.test');
    assert.equal(identity.website, 'example.test');
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/settings/general`)).status, 401);
  } finally {
    if (before) await pool.query(
      `UPDATE publication_settings SET publication_name=$1, publisher_name=$2, address=$3, contact_email=$4, contact_phone=$5, public_website=$6, timezone=$7, default_language=$8 WHERE singleton=TRUE`,
      [before.publication_name, before.publisher_name, before.address, before.contact_email, before.contact_phone, before.public_website, before.timezone, before.default_language],
    );
    if (before) await settingsService.hydratePublicationIdentity();
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections?.();
    await closed;
  }
});
