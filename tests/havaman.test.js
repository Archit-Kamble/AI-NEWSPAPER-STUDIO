const test = require('node:test');
const assert = require('node:assert/strict');

const havaman = require('../src/features/havaman');

function forecastResponse(date, overrides = {}) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        daily: {
          time: [date],
          weather_code: [overrides.weatherCode ?? 53],
          temperature_2m_max: [overrides.maxC ?? 27.34],
          temperature_2m_min: [overrides.minC ?? 21.86],
          precipitation_sum: [overrides.rainMm ?? 3.26],
          precipitation_probability_max: [overrides.rainChance ?? 82.4],
        },
      };
    },
  };
}

test('Havaman requests the edition date and required daily fields from Open-Meteo', async () => {
  const calls = [];
  const location = { key: 'satara', name: 'सातारा', latitude: 17.6805, longitude: 74.0183 };
  const fetchImpl = async (url, options) => {
    calls.push({ url: new URL(url), options });
    return forecastResponse('2026-08-27');
  };

  const result = await havaman.build('2026-08-27', { fetchImpl, weatherLocations: [location] });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin + calls[0].url.pathname, havaman.API);
  assert.equal(calls[0].url.searchParams.get('start_date'), '2026-08-27');
  assert.equal(calls[0].url.searchParams.get('end_date'), '2026-08-27');
  assert.equal(calls[0].url.searchParams.get('timezone'), 'Asia/Kolkata');
  for (const field of ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max']) {
    assert.ok(calls[0].url.searchParams.get('daily').split(',').includes(field), `${field} must be requested`);
  }
  assert.equal(result.card.cities[0].maxC, 27.3);
  assert.equal(result.card.cities[0].minC, 21.9);
  assert.equal(result.card.cities[0].rainMm, 3.3);
  assert.equal(result.card.cities[0].rainChance, 82);
  assert.equal(result.card.cities[0].condition, 'रिमझिम पाऊस');
  assert.equal(result.card.source, 'स्रोत : Open-Meteo');
});

test('Havaman refuses invalid dates and incomplete upstream data', async () => {
  assert.equal(havaman.validIsoDate('2026-02-29'), false);
  assert.equal(havaman.validIsoDate('2028-02-29'), true);
  assert.match((await havaman.build('2026-02-29')).error, /वैध तारीख/);

  const result = await havaman.build('2026-08-27', {
    weatherLocations: [havaman.DEFAULT_LOCATIONS[0]],
    fetchImpl: async () => ({
      ok: true,
      async json() { return { daily: { time: ['2026-08-27'] } }; },
    }),
  });
  assert.equal(result.upstream, true);
  assert.match(result.error, /विश्वासार्ह अंदाज/);
});

test('commercial newspaper use requires the customer endpoint and API key', async () => {
  const unconfigured = await havaman.build('2026-08-27', { commercialUse: true, openMeteoApiKey: '' });
  assert.equal(unconfigured.unconfigured, true);

  let requested;
  const result = await havaman.build('2026-08-27', {
    commercialUse: true,
    openMeteoApiKey: 'test-customer-key',
    weatherLocations: [havaman.DEFAULT_LOCATIONS[0]],
    fetchImpl: async (url) => {
      requested = new URL(url);
      return forecastResponse('2026-08-27');
    },
  });
  assert.equal(requested.origin + requested.pathname, havaman.CUSTOMER_API);
  assert.equal(requested.searchParams.get('apikey'), 'test-customer-key');
  assert.equal(result.card.cities.length, 1);
});

test('Havaman maps official WMO weather-code groups to concise Marathi conditions', () => {
  assert.equal(havaman.conditionFor(0), 'निरभ्र');
  assert.equal(havaman.conditionFor(3), 'ढगाळ');
  assert.equal(havaman.conditionFor(80), 'पावसाच्या सरी');
  assert.equal(havaman.conditionFor(95), 'मेघगर्जनेसह पाऊस');
});
