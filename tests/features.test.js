// The day's standing features.
//
// These hold the two things that matter about this part of the system: the
// boxes that can be computed are computed exactly, and the boxes that would
// need a source outside the building do not run at all rather than being
// filled with something plausible.

const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/config/db');
const features = require('../src/features');
const panchang = require('../src/features/panchang');
const written = require('../src/features/written');

test.after(() => pool.end());

test('sunrise and sunset are computed, and the solstices come out right', async () => {
  const summer = panchang.solarEvents('2026-06-21');
  const winter = panchang.solarEvents('2026-12-21');

  const daylight = (e) => (e.sunset - e.sunrise) / 60;
  // Mumbai: about 13h15m at midsummer, about 11h at midwinter.
  assert.ok(daylight(summer) > 13.1 && daylight(summer) < 13.4, `midsummer was ${daylight(summer)}h`);
  assert.ok(daylight(winter) > 10.8 && daylight(winter) < 11.1, `midwinter was ${daylight(winter)}h`);
  assert.ok(daylight(summer) > daylight(winter));
});

test('राहुकाळ is an eighth of the day, and moves with the weekday', () => {
  const events = panchang.solarEvents('2026-08-03'); // Monday
  const monday = panchang.rahuKaal('2026-08-03', events);
  const tuesday = panchang.rahuKaal('2026-08-04', events);

  const eighth = (events.sunset - events.sunrise) / 8;
  assert.ok(Math.abs(monday.end - monday.start - eighth) < 0.001);
  assert.notEqual(Math.round(monday.start), Math.round(tuesday.start));
});

test('the Shaka year turns over at the start of Chaitra, not in January', () => {
  assert.equal(panchang.shakaYear('2026-03-21'), 1947);
  assert.equal(panchang.shakaYear('2026-03-22'), 1948);
  assert.equal(panchang.shakaYear('2026-01-15'), 1947);
});

test('a feature that needs an outside source refuses to run rather than inventing one', async () => {
  for (const key of ['sone-chandi', 'bajarbhav']) {
    const result = await features.build(key, '2026-08-03');
    assert.ok(result.error, `${key} must not produce content without a source`);
    assert.match(result.error, /Not run/);
  }
});

test('Havaman is the one connected feed and uses the supplied live-source client', async () => {
  const result = await features.build('havaman', '2026-08-03', {
    weatherLocations: [{ key: 'satara', name: 'सातारा', latitude: 17.6805, longitude: 74.0183 }],
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          daily: {
            time: ['2026-08-03'], weather_code: [2],
            temperature_2m_max: [28], temperature_2m_min: [21],
            precipitation_sum: [0.4], precipitation_probability_max: [20],
          },
        };
      },
    }),
  });
  assert.equal(result.card.cities[0].name, 'सातारा');
  assert.equal(result.card.cities[0].condition, 'अंशतः ढगाळ');
});

test('दिनविशेष is a checked lookup, and stays silent on a date nobody checked', async () => {
  const independence = await features.build('dinvishesh', '2026-08-15');
  assert.equal(independence.items[0].text, 'स्वातंत्र्य दिन');
  assert.equal(independence.card.entries[0].symbol, 'flag');

  // A date with no curated entry reports that it is empty - it does not ask a
  // model to make an anniversary up.
  const quiet = await features.build('dinvishesh', '2026-08-07');
  assert.equal(quiet.empty, true);
});

test('the whole day of model-written features is briefed in one prompt', () => {
  const prompt = written.promptFor('2026-08-03', 'सोमवार', 90);

  // One brief, covering every written box, naming all twelve signs.
  assert.match(prompt, /राशिभविष्य/);
  assert.match(prompt, /सुविचार/);
  for (const sign of written.RASHIS) assert.ok(prompt.includes(sign.name), `${sign.name} missing`);

  // The measure the copy has to fit travels with the brief.
  assert.match(prompt, /90 अक्षरांचा/);
  // And the things a newspaper must not print.
  assert.match(prompt, /मृत्यू/);
});

test('building the day reports every box that did not run', async () => {
  const day = await features.buildAll('2026-08-03');

  assert.ok(day.features.panchang, 'the almanac box is computable and must be built');
  assert.ok(day.notes.some((note) => note.includes('सोने')), 'an unavailable feed must be reported');
  assert.equal(day.date, '2026-08-03');
});
