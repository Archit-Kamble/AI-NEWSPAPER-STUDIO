// THE DESK LOGIN THE BROWSER NETS USE.
//
// Every one of these nets had `admin@esahas.com` and `admin123` written into
// it - the real administrator of a real newspaper, with a password published
// in this repository. They only worked because seven files under tests/ were
// upserting that account and REPLACING its password on every `npm test` run,
// so the corruption looked like configuration. Those upserts are gone
// (tests/helpers/desk-owner.js says why), which means the nets have to say out
// loud what login they need instead of relying on one being forced.
//
// The defaults are what they always were, so nothing changes on a machine that
// already works. What changes is that the credential is now a setting rather
// than a constant, so a CI run - or an owner who has since set their own
// password, which they could not previously make stick - points these at an
// account of their own instead of editing twenty files.
//
//   SAHAS_DESK_EMAIL=… SAHAS_DESK_PASSWORD=… node tests/browser/workspace.browser.js

const DESK_EMAIL = process.env.SAHAS_DESK_EMAIL || 'admin@esahas.com';
const DESK_PASSWORD = process.env.SAHAS_DESK_PASSWORD || 'admin123';

module.exports = { DESK_EMAIL, DESK_PASSWORD };
