const settingsRepository = require('../repositories/settings.repository');
const { applyPublicationSettings } = require('../layout/identity');

const TIMEZONES = new Set(['Asia/Kolkata', 'UTC']);
const LANGUAGES = new Set(['mr', 'hi', 'en']);
const text = (value, max) => String(value || '').trim().slice(0, max);

async function generalSettings() { return settingsRepository.get(); }

async function hydratePublicationIdentity() {
  const settings = await generalSettings();
  applyPublicationSettings(settings);
  return settings;
}

async function saveGeneralSettings(body, actor) {
  const publicationName = text(body?.publicationName, 200);
  const contactEmail = text(body?.contactEmail, 255);
  const website = text(body?.publicWebsite, 255);
  const timezone = text(body?.timezone, 80) || 'Asia/Kolkata';
  const defaultLanguage = text(body?.defaultLanguage, 20) || 'mr';
  if (!publicationName) return { error: 'Publication name is required.' };
  if (contactEmail && !/^\S+@\S+\.\S+$/.test(contactEmail)) return { error: 'Contact email is not valid.' };
  if (website && !/^https?:\/\/[^\s]+$/i.test(website)) return { error: 'Website must begin with http:// or https://.' };
  if (!TIMEZONES.has(timezone)) return { error: 'Choose a supported newsroom timezone.' };
  if (!LANGUAGES.has(defaultLanguage)) return { error: 'Choose a supported default language.' };
  // WHERE THIS PAPER COVERS. Checked against the one place catalogue, so a
  // district the retrieval could never match cannot be stored - a misspelt
  // district returns nothing and looks exactly like a district with no news
  // today, which is the worst kind of silence.
  // ABSENT MEANS LEAVE IT ALONE, not "clear it". A payload that never mentions
  // the coverage - which is every caller written before it existed, and the
  // test that saves the identity fields - wiped the district to empty and the
  // Newsdesk Run then opened on the whole state. Found by watching the panel
  // say "Chasing: Maharashtra" where it should have said Satara.
  const { placeOf } = await import('../../public/editor/layout/places.js');
  const current = await settingsRepository.get();
  const said = (value, fallback) => (value === undefined ? fallback : value);
  const coverage = placeOf({
    country: said(body?.coverageCountry, current?.coverage_country),
    state: said(body?.coverageState, current?.coverage_state),
    district: said(body?.coverageDistrict, current?.coverage_district),
    city: said(body?.coverageCity, current?.coverage_city),
  });

  const settings = await settingsRepository.update({
    publicationName, contactEmail, publicWebsite: website, timezone, defaultLanguage,
    coverageCountry: coverage.country, coverageState: coverage.state,
    coverageDistrict: coverage.district, coverageCity: coverage.city,
    publisherName: text(body?.publisherName, 200), address: text(body?.address, 4000),
    contactPhone: text(body?.contactPhone, 40),
  }, actor?.id || null);
  // Canvas masthead/folios, e-paper metadata and Scribus all consume
  // identityFor(), so this is the one update that reaches every output.
  applyPublicationSettings(settings);
  return { settings };
}

module.exports = { generalSettings, saveGeneralSettings, hydratePublicationIdentity };
