// सूर्योदय-सूर्यास्त, shared - the tenth catalogue the browser and the server
// read from one file, beside the character grid, the block kinds, the picture
// style, the inks, the borders, the typefaces, the news tags, the places and
// the furniture styles.
//
// The math itself has lived in src/features/panchang.js since the almanac
// Smart Card was built (Phase 8-ish): the standard sunrise equation, computed
// offline from the date and a town's latitude/longitude, accurate to well
// under a minute. That module is server-only (a plain CommonJS `require()`
// chain from src/features/index.js), so when the folio needed the same three
// numbers - sunrise, sunset, day length - for a compact header strip, the
// canvas had no way to reach them without either a second copy of the
// equation (the exact duplicated-catalogue failure this project keeps
// finding and fixing) or a round trip to the server for arithmetic that costs
// nothing and never changes for a given date and place.
//
// So the pure computation moved here, where both sides already know to look,
// and src/features/panchang.js now imports it instead of carrying its own
// copy. The full Smart Card's behaviour is unchanged to the number - this is
// the same formula, moved, not rewritten.
const DEG = Math.PI / 180;
const J2000 = 2451545.0;

// Where the edition is printed. Mumbai, to three decimals - the same default
// panchang.js has always used. A desk can pass its own place.
export const DEFAULT_PLACE = { name: 'मुंबई', latitude: 19.076, longitude: 72.877 };
// India Standard Time. A newspaper never prints UTC.
const IST_OFFSET_MINUTES = 5.5 * 60;

const DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
export const devanagari = (value) => String(value).replace(/\d/g, (d) => DIGITS[Number(d)]);

// Julian day number for a civil date at 00:00 UTC.
function julianDay(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

// A Julian date back to minutes past midnight IST.
function toLocalMinutes(julian) {
  const dayFraction = julian - Math.floor(julian) - 0.5;
  const utcMinutes = (dayFraction + (dayFraction < 0 ? 1 : 0)) * 24 * 60;
  return (utcMinutes + IST_OFFSET_MINUTES + 1440) % 1440;
}

export const clock = (minutes) => {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return devanagari(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
};

/**
 * Sunrise and sunset, in minutes past local midnight. Returns null when the
 * place genuinely has no sunrise/sunset that day (never happens at Indian
 * latitudes, but the arithmetic should not return nonsense if that changes).
 */
export function solarEvents(isoDate, place = DEFAULT_PLACE) {
  const [year, month, day] = String(isoDate).split('T')[0].split('-').map(Number);
  if (!year || !month || !day) return null;

  const n = Math.round(julianDay(year, month, day) - J2000 + 0.0008);
  const meanSolarNoon = n + (-place.longitude) / 360;

  const M = (357.5291 + 0.98560028 * meanSolarNoon) % 360;
  const C =
    1.9148 * Math.sin(M * DEG) + 0.02 * Math.sin(2 * M * DEG) + 0.0003 * Math.sin(3 * M * DEG);
  const lambda = (M + C + 180 + 102.9372) % 360;

  const transit =
    J2000 + meanSolarNoon + 0.0053 * Math.sin(M * DEG) - 0.0069 * Math.sin(2 * lambda * DEG);

  const sinDec = Math.sin(lambda * DEG) * Math.sin(23.4397 * DEG);
  const cosDec = Math.cos(Math.asin(sinDec));

  const cosOmega =
    (Math.sin(-0.833 * DEG) - Math.sin(place.latitude * DEG) * sinDec) /
    (Math.cos(place.latitude * DEG) * cosDec);
  if (cosOmega < -1 || cosOmega > 1) return null;

  const omega = Math.acos(cosOmega) / DEG;
  return {
    sunrise: toLocalMinutes(transit - omega / 360),
    sunset: toLocalMinutes(transit + omega / 360),
  };
}

// राहुकाळ. Daylight is divided into eight equal parts and one of them is Rahu's
// - which part depends only on the weekday. Sunday takes the eighth, Monday the
// second, and so on. Exact, and standard across every almanac.
const RAHU_SEGMENT = [8, 2, 7, 5, 6, 4, 3]; // Sunday .. Saturday

export function rahuKaal(isoDate, events) {
  const [year, month, day] = String(isoDate).split('T')[0].split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const eighth = (events.sunset - events.sunrise) / 8;
  const start = events.sunrise + eighth * (RAHU_SEGMENT[weekday] - 1);
  return { start, end: start + eighth };
}

// शक संवत. The Shaka year runs from Chaitra 1, which falls on 22 March (21 in a
// Gregorian leap year), and is the Gregorian year less 78 from that point on.
export function shakaYear(isoDate) {
  const [year, month, day] = String(isoDate).split('T')[0].split('-').map(Number);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const newYear = leap ? { month: 3, day: 21 } : { month: 3, day: 22 };
  const afterNewYear =
    month > newYear.month || (month === newYear.month && day >= newYear.day);
  return year - 78 - (afterNewYear ? 0 : 1);
}

/** "१० तास ५९ मिनिटे" - rounded to the minute as one quantity, never in halves. */
export function dayLengthMr(minutes) {
  const total = Math.round(Number(minutes) || 0);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  // "११ तास ० मिनिटे" is not how a printed almanac says eleven hours.
  return mins ? `${devanagari(hours)} तास ${devanagari(mins)} मिनिटे` : `${devanagari(hours)} तास`;
}

/**
 * The one line a compact header strip needs: sunrise, sunset, day length.
 * Returns '' rather than throwing when the date cannot be read, so a caller
 * that forgets to guard still prints an empty strip instead of a crash.
 *
 * राहुकाळ and शके are deliberately left out of the strip - they are read
 * off the full Smart Card, and a header line a reader skims in passing is
 * three facts, not five.
 */
export function stripLine(isoDate, place = DEFAULT_PLACE) {
  const events = solarEvents(isoDate, place);
  if (!events) return '';
  const daylight = events.sunset - events.sunrise;
  return `सूर्योदय ${clock(events.sunrise)} · सूर्यास्त ${clock(events.sunset)} · दिनमान ${dayLengthMr(daylight)}`;
}
