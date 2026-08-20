const settingsRepository = require('../repositories/settings.repository');

const TIMEZONES = new Set(['Asia/Kolkata', 'UTC']);
const LANGUAGES = new Set(['mr', 'hi', 'en']);
const text = (value, max) => String(value || '').trim().slice(0, max);

async function generalSettings() { return settingsRepository.get(); }

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
  const settings = await settingsRepository.update({
    publicationName, contactEmail, publicWebsite: website, timezone, defaultLanguage,
    publisherName: text(body?.publisherName, 200), address: text(body?.address, 4000),
    contactPhone: text(body?.contactPhone, 40),
  }, actor?.id || null);
  return { settings };
}

module.exports = { generalSettings, saveGeneralSettings };
