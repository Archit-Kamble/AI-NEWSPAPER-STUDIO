// Share and bullion rates for the शेअर / सोने बाजार Smart Card.
//
// WHAT A DISTRICT DAILY ACTUALLY PRINTS, AND WHAT THIS USED TO PRINT.
//
// The first version listed सोने and चांदी in **dollars per troy ounce**,
// straight off the international futures feed. No Marathi reader prices gold
// that way and no Marathi paper sets it that way: the rate a reader looks for
// is रुपये per १० ग्रॅम for gold and रुपये per किलो for silver. So the
// international close is converted here, through the live USD/INR rate from
// the same feed, and it is labelled for exactly what it is - an INDICATIVE
// rate derived from the international close, not a सराफ बाजार retail quote,
// which this newsroom has no feed for and must not invent. Printing a local
// retail rate nobody supplied would be a false statement over the masthead;
// printing an honest derived one, labelled, is ordinary financial journalism.
//
// Everything here is a fact returned by the provider or arithmetic on it. No
// model is asked to write market copy and there is no desk-entered fallback:
// a feed that cannot answer returns an error and the card is not filled.

const API = 'https://query1.finance.yahoo.com/v8/finance/chart';

// One troy ounce, in grams. The whole bullion conversion rests on this.
const GRAMS_PER_TROY_OUNCE = 31.1034768;

// The rate that turns an international bullion close into rupees. Fetched like
// any other instrument so it comes from the same session as the metal it
// converts - a gold close from Tuesday priced at Thursday's rupee would be two
// different days in one number.
const USD_INR = Object.freeze({ key: 'usdinr', symbol: 'INR=X', label: 'डॉलर', decimals: 2 });

const INSTRUMENTS = Object.freeze([
  { key: 'sensex', symbol: '^BSESN', label: 'सेन्सेक्स', decimals: 2, group: 'index' },
  { key: 'nifty', symbol: '^NSEI', label: 'निफ्टी ५०', decimals: 2, group: 'index' },
  {
    key: 'gold',
    symbol: 'GC=F',
    label: 'सोने',
    unit: '१० ग्रॅम',
    decimals: 0,
    group: 'bullion',
    // $/troy oz -> Rs/10 g
    toRupees: (close, usdInr) => (close * usdInr * 10) / GRAMS_PER_TROY_OUNCE,
  },
  {
    key: 'silver',
    symbol: 'SI=F',
    label: 'चांदी',
    unit: 'किलो',
    decimals: 0,
    group: 'bullion',
    // $/troy oz -> Rs/kg
    toRupees: (close, usdInr) => (close * usdInr * 1000) / GRAMS_PER_TROY_OUNCE,
  },
]);

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateInTimeZone(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

const numberMr = (value, decimals) => new Intl.NumberFormat('mr-IN', {
  minimumFractionDigits: decimals,
  maximumFractionDigits: decimals,
}).format(value);

// About one trading month.
const MONTH_SESSIONS = 22;

/** "१२ डिसें" - the short date a chart's axis ends are labelled with. */
const monthDayMr = (iso) => new Intl.DateTimeFormat('mr-IN', {
  day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata',
}).format(new Date(`${iso}T12:00:00Z`));

const percentMr = (value) => `${value >= 0 ? '+' : '−'}${numberMr(Math.abs(value), 2)}%`;

/** The move in the instrument's own unit, which a rate table prints beside the percentage. */
const deltaMr = (value, decimals) => `${value >= 0 ? '+' : '−'}${numberMr(Math.abs(value), decimals)}`;

function sessionPair(payload, requestedDate) {
  const result = payload?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes)) throw new Error('closing prices missing');
  const sessions = timestamps.map((timestamp, index) => ({
    date: new Date(Number(timestamp) * 1000).toISOString().slice(0, 10),
    close: Number(closes[index]),
  }))
  // An edition dated Thursday is prepared from Wednesday's completed market,
  // never Thursday's still-moving intraday quote. This also makes the rate
  // table and the "मागील सत्र" line describe the same session.
  //
  // AND A CLOSE OF ZERO IS NOT A PRICE. `Number.isFinite` alone let one
  // through: the FX feed returned `INR=X` close 0 for the most recent session,
  // which is the provider's way of saying "no settled figure yet", and the
  // card went out reading सोने ₹० and −१००.००%. Nothing this table prints - an
  // index, a metal, an exchange rate - can legitimately close at or below
  // zero, so that is the test.
    .filter((row) => row.date < requestedDate && Number.isFinite(row.close) && row.close > 0);
  if (sessions.length < 2) throw new Error('two completed sessions are not available');
  // The pair the rate table prints, AND the run behind it. A printed market
  // page carries a month's shape beside the day's figure - the number alone
  // says whether today moved, the line says whether the month did - so the
  // trailing sessions travel with the row and the card decides what to draw.
  return { pair: sessions.slice(-2), series: sessions.slice(-MONTH_SESSIONS) };
}

async function fetchInstrument(instrument, date, fetchImpl, apiUrl) {
  const requested = new Date(`${date}T00:00:00Z`);
  // Forty-five calendar days back, because a MONTH of trading is about
  // twenty-two sessions and weekends and holidays are not sessions. The old
  // twelve-day window could not have drawn a month's line.
  const from = new Date(requested); from.setUTCDate(from.getUTCDate() - 45);
  const until = new Date(requested); until.setUTCDate(until.getUTCDate() + 2);
  const query = new URLSearchParams({
    period1: String(Math.floor(from.getTime() / 1000)),
    period2: String(Math.floor(until.getTime() / 1000)),
    interval: '1d', events: 'history',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let response;
  try {
    response = await fetchImpl(`${apiUrl}/${encodeURIComponent(instrument.symbol)}?${query}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'SAHAS-Newspaper/1.0' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`${instrument.label}: HTTP ${response.status}`);
  const { pair, series } = sessionPair(await response.json(), date);
  const [previous, latest] = pair;
  const changePercent = ((latest.close - previous.close) / previous.close) * 100;
  return { ...instrument, previous, latest, series, changePercent };
}

/**
 * The previous session in ONE sentence.
 *
 * The old line read "सेन्सेक्स −०.२४% घसरला; निफ्टी ५० −०.५२% घसरला. सोने
 * −०.८६% आणि चांदी −०.९४% बदलले." - the same verb three times and a fourth
 * clause that says only "changed". A market brief says which way the day went
 * and names the mover, which is what a reader takes from it.
 */
function sessionBrief(rows) {
  const indices = rows.filter((row) => row.group === 'index');
  const bullion = rows.filter((row) => row.group === 'bullion');
  const up = indices.filter((row) => row.changePercent > 0).length;
  const down = indices.filter((row) => row.changePercent < 0).length;
  const mood = up && !down ? 'निर्देशांक वधारले'
    : down && !up ? 'निर्देशांक घसरले'
      : up && down ? 'निर्देशांकांत संमिश्र कल राहिला'
        : 'निर्देशांक जवळपास स्थिर राहिले';

  // The biggest single move of the session, in either direction - the one
  // number a reader remembers.
  const biggest = [...rows].sort(
    (a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent),
  )[0];
  const metal = bullion.length
    ? ` सराफा बाजारात ${bullion.map((row) => `${row.label} ${percentMr(row.changePercent)}`).join(' व ')}.`
    : '';
  const lead = biggest
    ? ` सर्वाधिक हालचाल ${biggest.label}मध्ये (${percentMr(biggest.changePercent)}).`
    : '';
  return `${mood}.${lead}${metal}`;
}

async function build(isoDate, {
  fetchImpl = global.fetch,
  marketApiUrl = process.env.MARKET_DATA_ENDPOINT || API,
  instruments = INSTRUMENTS,
  currentDate = dateInTimeZone(),
} = {}) {
  const date = String(isoDate || '').slice(0, 10);
  if (!validIsoDate(date)) return { error: 'बाजारासाठी वैध तारीख आवश्यक आहे.' };
  if (date > currentDate) {
    return { error: `${date} ही भविष्यातील तारीख आहे; त्या दिवसाचे बाजार बंद भाव अद्याप उपलब्ध नाहीत.` };
  }
  if (typeof fetchImpl !== 'function') return { error: 'बाजार डेटा स्रोत उपलब्ध नाही.', upstream: true };

  const needsRupees = instruments.some((instrument) => typeof instrument.toRupees === 'function');
  let rows;
  let usdInr = null;
  try {
    const fetched = await Promise.all([
      ...instruments.map((instrument) => fetchInstrument(instrument, date, fetchImpl, marketApiUrl)),
      ...(needsRupees ? [fetchInstrument(USD_INR, date, fetchImpl, marketApiUrl)] : []),
    ]);
    rows = fetched.slice(0, instruments.length);
    usdInr = needsRupees ? fetched[fetched.length - 1] : null;
  } catch (error) {
    return { error: `विश्वासार्ह बाजार बंद भाव मिळाले नाहीत. (${error.message})`, upstream: true };
  }

  // The rupee close, applied to both sessions of a bullion instrument so its
  // own change is computed in the unit it is printed in.
  const priced = rows.map((row) => {
    if (typeof row.toRupees !== 'function') {
      return {
        ...row,
        latestValue: row.latest.close,
        previousValue: row.previous.close,
      };
    }
    const latestValue = row.toRupees(row.latest.close, usdInr.latest.close);
    const previousValue = row.toRupees(row.previous.close, usdInr.previous.close);
    return {
      ...row,
      latestValue,
      previousValue,
      changePercent: ((latestValue - previousValue) / previousValue) * 100,
    };
  });

  const latestDate = rows[0].latest.date;

  // THE MONTH'S SHAPE, FOR THE HEADLINE INDEX.
  //
  // One line, not four. A printed market panel draws the benchmark and prints
  // the rest as figures - four overlaid series in a 40 mm box is a tangle, and
  // an index and a metal do not even share an axis. The card carries the raw
  // closes and the solver normalises them, so the chart on screen and the
  // chart on the plate come from the same numbers.
  const benchmark = priced.find((row) => row.group === 'index') || priced[0];
  const benchmarkSeries = Array.isArray(benchmark?.series) ? benchmark.series : [];
  const trend = benchmarkSeries.length >= 3 ? {
    label: benchmark.label,
    unit: benchmark.unit || '',
    values: benchmarkSeries.map((session) => session.close),
    from: monthDayMr(benchmarkSeries[0].date),
    to: monthDayMr(benchmarkSeries[benchmarkSeries.length - 1].date),
    sessions: benchmarkSeries.length,
    changePercent: percentMr(
      ((benchmarkSeries[benchmarkSeries.length - 1].close - benchmarkSeries[0].close)
        / benchmarkSeries[0].close) * 100,
    ),
    high: numberMr(Math.max(...benchmarkSeries.map((x) => x.close)), benchmark.decimals),
    low: numberMr(Math.min(...benchmarkSeries.map((x) => x.close)), benchmark.decimals),
  } : null;
  const items = priced.map((row) => ({
    key: row.key,
    label: row.label,
    unit: row.unit || '',
    group: row.group,
    // A rupee rate carries its sign; an index is a plain number.
    value: `${row.group === 'bullion' ? '₹' : ''}${numberMr(row.latestValue, row.decimals)}`,
    delta: deltaMr(row.latestValue - row.previousValue, row.decimals),
    change: percentMr(row.changePercent),
    direction: row.changePercent > 0 ? 'up' : row.changePercent < 0 ? 'down' : 'flat',
  }));

  return {
    title: 'शेअर / सोने बाजार',
    subtitle: 'स्वयंचलित बंद भाव',
    card: {
      title: 'शेअर / सोने बाजार',
      asOf: new Intl.DateTimeFormat('mr-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' })
        .format(new Date(`${latestDate}T12:00:00Z`)),
      items,
      trend,
      trendLabel: 'गेल्या महिन्याचा कल',
      briefLabel: 'मागील सत्र',
      yesterdayBrief: sessionBrief(priced),
      // Said in the card, not only in a comment: the bullion figures are
      // derived from the international close at the session's own rupee rate,
      // and are not a local सराफा retail quote.
      note: usdInr
        ? `सोने-चांदी दर आंतरराष्ट्रीय बंद भाव व डॉलर ₹${numberMr(usdInr.latest.close, 2)} वर आधारित सूचक दर.`
        : '',
      source: 'स्रोत : Yahoo Finance · बंद भाव',
    },
    items: items.map((item) => ({
      label: `${item.label}${item.unit ? ` (${item.unit})` : ''}`,
      text: `${item.value} · ${item.change}`,
    })),
  };
}

module.exports = {
  build, fetchInstrument, sessionPair, sessionBrief, validIsoDate, dateInTimeZone,
  INSTRUMENTS, USD_INR, GRAMS_PER_TROY_OUNCE, API,
};
