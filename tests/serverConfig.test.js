// A real gap found during Phase 14's route audit: the session secret that
// signs every desk's login cookie fell back to a hardcoded "dev-secret" with
// no enforcement anywhere. Fine on a desk machine on a newsroom LAN in
// development; not fine on a production deploy, where the fallback string is
// public (it's in this repository). createApp() now refuses to start under
// NODE_ENV=production without a real SESSION_SECRET.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../server');

function withEnv(t, overrides) {
  const previous = {};
  for (const key of Object.keys(overrides)) previous[key] = process.env[key];
  Object.assign(process.env, overrides);
  t.after(() => {
    for (const key of Object.keys(overrides)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

test('production with no SESSION_SECRET refuses to start', (t) => {
  withEnv(t, { NODE_ENV: 'production', SESSION_SECRET: '' });
  assert.throws(() => createApp(), /SESSION_SECRET/);
});

test('production with the dev fallback value refuses to start', (t) => {
  withEnv(t, { NODE_ENV: 'production', SESSION_SECRET: 'dev-secret' });
  assert.throws(() => createApp(), /SESSION_SECRET/);
});

// A REAL secret, generated the way the refusal message tells a deploy to
// generate one. The fixture used to read 'a-real-generated-secret' - 23
// characters that only LOOK like a secret, which is the same mistake as the
// guard that let the published placeholder through, sitting in the test that
// was supposed to prove the guard worked.
const REAL_SECRET = require('crypto').randomBytes(48).toString('base64url');

test('production with a real secret starts normally', (t) => {
  withEnv(t, { NODE_ENV: 'production', SESSION_SECRET: REAL_SECRET });
  assert.doesNotThrow(() => createApp());
});

// .env.example ships this exact string. A guard that named only "dev-secret"
// accepted it, so a deploy that copied the example and changed everything
// except the line telling it to change that line signed every desk's cookie
// with a constant published in this repository.
test('production with .env.example\'s own placeholder refuses to start', (t) => {
  withEnv(t, { NODE_ENV: 'production', SESSION_SECRET: 'change-this-secret' });
  assert.throws(() => createApp(), /placeholder/);
});

test('production refuses a secret that is merely short', (t) => {
  withEnv(t, { NODE_ENV: 'production', SESSION_SECRET: 'aB3$xQ7!zM2' });
  assert.throws(() => createApp(), /at least 32/);
});

// Long, and carries almost no entropy - the other way to satisfy a length
// floor without satisfying what the floor is for.
test('production refuses a long secret made of too few characters', (t) => {
  withEnv(t, { NODE_ENV: 'production', SESSION_SECRET: 'abababababababababababababababababab' });
  assert.throws(() => createApp(), /distinct characters/);
});

// The example is a file in this repository, so the guard can be pointed at
// the actual value rather than at a copy of it that could drift.
test('whatever .env.example ships is refused in production', (t) => {
  const fs = require('fs');
  const path = require('path');
  const example = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  const line = example.split('\n').find((l) => l.startsWith('SESSION_SECRET='));
  assert.ok(line, '.env.example still names SESSION_SECRET');
  const shipped = line.slice('SESSION_SECRET='.length).trim();
  if (!shipped) return; // an empty example value is refused by the "not set" branch
  withEnv(t, { NODE_ENV: 'production', SESSION_SECRET: shipped });
  assert.throws(() => createApp(), /SESSION_SECRET/,
    'the value published in .env.example must never be accepted in production');
});

test('development with no SESSION_SECRET still starts (the LAN-desk default)', (t) => {
  withEnv(t, { NODE_ENV: 'development', SESSION_SECRET: '' });
  assert.doesNotThrow(() => createApp());
});

test('no NODE_ENV at all (npm test\'s own environment) still starts', (t) => {
  const previous = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  t.after(() => {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  });
  assert.doesNotThrow(() => createApp());
});
