// Live district weather for the Havaman Smart Card.
//
// IMD publishes the most authoritative Indian observations, but its documented
// city API requires the caller's public IP to be whitelisted. The default
// integration is Open-Meteo: its public endpoint is used only for development
// and evaluation, while commercial production requires OPEN_METEO_API_KEY and
// the provider's dedicated customer endpoint. The source stays explicit in
// the card and a failed response returns an error; weather is never guessed or
// carried from a previous edition.

const API = 'https://api.open-meteo.com/v1/forecast';
const CUSTOMER_API = 'https://customer-api.open-meteo.com/v1/forecast';
const TIMEZONE = 'Asia/Kolkata';

const DEFAULT_LOCATIONS = Object.freeze([
  { key: 'satara', name: 'सातारा', latitude: 17.6805, longitude: 74.0183 },
  { key: 'karad', name: 'कराड', latitude: 17.285, longitude: 74.184 },
  { key: 'wai', name: 'वाई', latitude: 17.952, longitude: 73.89 },
  { key: 'phaltan', name: 'फलटण', latitude: 17.991, longitude: 74.431 },
]);

function conditionFor(code) {
  const n = Number(code);
  if (n === 0) return 'निरभ्र';
  if (n === 1) return 'बहुतेक निरभ्र';
  if (n === 2) return 'अंशतः ढगाळ';
  if (n === 3) return 'ढगाळ';
  if (n === 45 || n === 48) return 'धुके';
  if (n >= 51 && n <= 57) return 'रिमझिम पाऊस';
  if (n >= 61 && n <= 67) return 'पावसाची शक्यता';
  if (n >= 71 && n <= 77) return 'हिमवृष्टी';
  if (n >= 80 && n <= 82) return 'पावसाच्या सरी';
  if (n >= 85 && n <= 86) return 'हिमसरी';
  if (n >= 95) return 'मेघगर्जनेसह पाऊस';
  return 'हवामान बदलते';
}

const oneDecimal = (value) => Number(Number(value).toFixed(1));

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function forecastFor(location, isoDate, fetchImpl, { apiUrl = API, apiKey = '' } = {}) {
  const query = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max',
    timezone: TIMEZONE,
    start_date: isoDate,
    end_date: isoDate,
  });
  if (apiKey) query.set('apikey', apiKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let response;
  try {
    response = await fetchImpl(`${apiUrl}?${query}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'SAHAS-Newspaper/1.0' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const daily = payload?.daily;
  const at = Array.isArray(daily?.time) ? daily.time.indexOf(isoDate) : -1;
  if (at < 0) throw new Error('forecast date missing');

  const maxC = Number(daily.temperature_2m_max?.[at]);
  const minC = Number(daily.temperature_2m_min?.[at]);
  const rainMm = Number(daily.precipitation_sum?.[at]);
  const rainChance = Number(daily.precipitation_probability_max?.[at]);
  const weatherCode = Number(daily.weather_code?.[at]);
  if (![maxC, minC, rainMm, rainChance, weatherCode].every(Number.isFinite)) {
    throw new Error('forecast fields missing');
  }
  return {
    key: location.key,
    name: location.name,
    maxC: oneDecimal(maxC),
    minC: oneDecimal(minC),
    rainMm: oneDecimal(rainMm),
    rainChance: Math.round(rainChance),
    weatherCode,
    condition: conditionFor(weatherCode),
  };
}

async function build(isoDate, {
  fetchImpl = global.fetch,
  weatherLocations = DEFAULT_LOCATIONS,
  openMeteoApiKey = process.env.OPEN_METEO_API_KEY,
  openMeteoEndpoint,
  commercialUse = process.env.NODE_ENV === 'production',
} = {}) {
  const date = String(isoDate || '').slice(0, 10);
  if (!validIsoDate(date)) return { error: 'हवामानासाठी वैध तारीख आवश्यक आहे.' };
  if (typeof fetchImpl !== 'function') return { error: 'हवामान स्रोत उपलब्ध नाही.', upstream: true };

  const apiKey = String(openMeteoApiKey || '').trim();
  if (commercialUse && !apiKey) {
    return {
      error: 'उत्पादन वापरासाठी OPEN_METEO_API_KEY आवश्यक आहे; हवामानाचा अंदाज भरलेला नाही.',
      unconfigured: true,
    };
  }
  const apiUrl = String(openMeteoEndpoint || (apiKey ? CUSTOMER_API : API)).trim();

  const locations = Array.isArray(weatherLocations) ? weatherLocations.filter(Boolean).slice(0, 6) : [];
  if (!locations.length) return { error: 'हवामानासाठी शहरांची यादी उपलब्ध नाही.' };

  let cities;
  try {
    cities = await Promise.all(locations.map((location) => forecastFor(
      location, date, fetchImpl, { apiUrl, apiKey },
    )));
  } catch (error) {
    return {
      error: `हवामान स्रोताकडून ${date} चा विश्वासार्ह अंदाज मिळाला नाही. (${error.message})`,
      upstream: true,
    };
  }

  return {
    title: 'हवामान',
    subtitle: 'सातारा जिल्हा',
    card: {
      subtitle: 'सातारा जिल्हा · हवामान अंदाज',
      date,
      cities,
      source: 'स्रोत : Open-Meteo',
    },
    items: cities.map((city) => ({
      label: city.name,
      text: `${city.condition} · कमाल ${city.maxC}° · किमान ${city.minC}° · पाऊस ${city.rainMm} मिमी (${city.rainChance}%)`,
    })),
  };
}

module.exports = {
  build, forecastFor, conditionFor, validIsoDate,
  DEFAULT_LOCATIONS, API, CUSTOMER_API, TIMEZONE,
};
