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

test('production with a real secret starts normally', (t) => {
  withEnv(t, { NODE_ENV: 'production', SESSION_SECRET: 'a-real-generated-secret' });
  assert.doesNotThrow(() => createApp());
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
