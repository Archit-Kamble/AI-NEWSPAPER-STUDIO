// सूर्योदय-सूर्यास्त: the almanac box every Marathi daily prints.
//
// This one costs nothing at all. Sunrise, sunset, the length of the day and
// राहुकाळ are not facts anybody has to look up or a model has to invent - they
// fall out of the date and the town's latitude and longitude. So they are
// computed here, exactly, offline, for ever.
//
// Method: the standard sunrise equation (the same one the almanacs use),
// accurate to well under a minute at this latitude, with the -0.833° altitude
// that accounts for refraction and the sun's own disc.
//
// What is NOT here, deliberately: तिथी, नक्षत्र and योग. Those need the moon's
// true longitude, which needs a real ephemeris - not a formula that is right
// most days. A panchang that is wrong one day in twenty is worse than one that
// says it does not know, because a reader plans a wedding by it. When an
// ephemeris source is added it plugs in beside this.

const DEG = Math.PI / 180;
const J2000 = 2451545.0;

// Where the edition is printed. Mumbai, to three decimals.
const DEFAULT_PLACE = { name: 'मुंबई', latitude: 19.076, longitude: 72.877 };
// India Standard Time. A newspaper never prints UTC.
const IST_OFFSET_MINUTES = 5.5 * 60;

const DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
const devanagari = (value) => String(value).replace(/\d/g, (d) => DIGITS[Number(d)]);

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

const clock = (minutes) => {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return devanagari(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
};

/**
 * Sunrise and sunset, in minutes past local midnight.
 */
function solarEvents(isoDate, place = DEFAULT_PLACE) {
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
  // No sunrise or no sunset - never happens at Indian latitudes, but the code
  // should not return nonsense if the place is ever changed.
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

function rahuKaal(isoDate, events) {
  const [year, month, day] = String(isoDate).split('T')[0].split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const eighth = (events.sunset - events.sunrise) / 8;
  const start = events.sunrise + eighth * (RAHU_SEGMENT[weekday] - 1);
  return { start, end: start + eighth };
}

// शक संवत. The Shaka year runs from Chaitra 1, which falls on 22 March (21 in a
// Gregorian leap year), and is the Gregorian year less 78 from that point on.
function shakaYear(isoDate) {
  const [year, month, day] = String(isoDate).split('T')[0].split('-').map(Number);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const newYear = leap ? { month: 3, day: 21 } : { month: 3, day: 22 };
  const afterNewYear =
    month > newYear.month || (month === newYear.month && day >= newYear.day);
  return year - 78 - (afterNewYear ? 0 : 1);
}

async function build(isoDate, { place = DEFAULT_PLACE } = {}) {
  const events = solarEvents(isoDate, place);
  if (!events) return { error: 'That date could not be read.' };

  const rahu = rahuKaal(isoDate, events);
  const daylight = events.sunset - events.sunrise;

  const items = [
    { label: 'सूर्योदय', text: clock(events.sunrise) },
    { label: 'सूर्यास्त', text: clock(events.sunset) },
    { label: 'दिनमान', text: `${devanagari(Math.floor(daylight / 60))} तास ${devanagari(Math.round(daylight % 60))} मिनिटे` },
    { label: 'राहुकाळ', text: `${clock(rahu.start)} ते ${clock(rahu.end)}` },
    { label: 'शके', text: devanagari(shakaYear(isoDate)) },
  ];

  return {
    title: 'सूर्योदय - सूर्यास्त',
    subtitle: place.name,
    // The Smart Card payload: the same five lines, still as label and value
    // rather than run together into a paragraph a renderer would have to split
    // on " : " to get back.
    card: { place: place.name, items },
    items,
  };
}

module.exports = { build, solarEvents, rahuKaal, shakaYear, DEFAULT_PLACE };
