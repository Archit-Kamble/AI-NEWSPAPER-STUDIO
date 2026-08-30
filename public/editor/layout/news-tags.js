// What a desk can ask an edition to be MADE OF - and it is a routing table,
// not a list of labels.
//
// A tag is the unit the Newsdesk Run is briefed in ("page 1: local x2, state
// politics x1"), and it decides three things nothing else can decide:
//
//   * WHICH WORDS are searched for. A Marathi daily's feeds are in Marathi;
//     an English category name matches nothing in them.
//   * WHICH FEEDS are asked. `information/routing.js` already splits national
//     from Maharashtra coverage, and a district story is in neither - it is on
//     the open web or nowhere, which is why `openWeb` is a per-tag property
//     rather than one switch over the whole run.
//   * WHAT BELONGS in it. The planner is handed `about` so it can put a
//     cabinet decision under state politics and a film release under
//     entertainment, rather than guessing from a one-word key.
//
// Free text was the obvious alternative and is wrong for the reason this
// codebase has already been bitten by twice: a typo in a free-text tag
// retrieves nothing, silently, and the desk is never told why the page came
// back empty. One catalogue, imported by the browser directly and by Node
// through the same dynamic import() the character grid and the ink palette
// already use.

/** Feed scopes, matching `src/services/information/routing.js`. */
export const FEED_SCOPES = { NATIONAL: 'national', MAHARASHTRA: 'maharashtra' };

/**
 * How hard a desk means it.
 *
 * A flat quantity treats "three entertainment stories" as a promise the run
 * has to keep, and a run that keeps it on a thin day fills the third block
 * with the best of a bad list. Required means leave the block empty rather
 * than print something weak; preferred means fill it if there is anything
 * worth printing; avoid means this paper does not want this today.
 */
export const DEMAND = { REQUIRED: 'required', PREFERRED: 'preferred', AVOID: 'avoid' };

/** The same three, as the form offers them. */
export const DEMAND_LEVELS = [
  { key: DEMAND.REQUIRED, name: 'Required' },
  { key: DEMAND.PREFERRED, name: 'Preferred' },
  { key: DEMAND.AVOID, name: 'Avoid' },
];

/**
 * How far back a run may reach.
 *
 * The keys must match src/services/information/freshness.js's DESK_WINDOWS -
 * this is the list a desk PICKS from and that file is what the window means in
 * milliseconds. An unknown key there falls back to the default rather than
 * throwing, so a drift is visible as a wrong window and never as a broken run.
 */
export const DESK_FRESHNESS = [
  { key: '6h', name: 'The last 6 hours' },
  { key: '24h', name: 'Today' },
  { key: '3d', name: 'The last 3 days' },
  { key: '7d', name: 'The last week' },
];

/** The words that make a query read as "today's news" to intent.js. */
const TODAY = 'आजच्या ताज्या बातम्या';

// `terms` are what is actually searched. They are Marathi first because the
// feeds are Marathi; the English word is included where a publisher's own
// Marathi feed still writes the topic in English (cricket, Bollywood).
//
// `openWeb`:
//   'required' - the checked feeds do not carry this at all (district news)
//   'optional' - the feeds carry it; the open web adds depth
//   'no'       - the checked feeds are sufficient and safer
const TAGS = [
  {
    key: 'local',
    name: 'Local',
    marathi: 'स्थानिक',
    // Filled from the paper's own place of publication - a district daily's
    // "local" is its own district and nobody else's.
    usesPlace: true,
    terms: [],
    termsEn: [],
    scopes: [FEED_SCOPES.MAHARASHTRA],
    openWeb: 'required',
    about: 'News from the paper\'s own district and talukas: local bodies, schemes, water, roads, local crime, local politics, village and taluka events.',
  },
  {
    key: 'state-politics',
    name: 'State politics',
    marathi: 'राज्य राजकारण',
    terms: ['महाराष्ट्र राजकारण', 'मंत्रिमंडळ', 'विधानसभा', 'सरकार निर्णय'],
    termsEn: ['maharashtra government', 'assembly', 'cabinet', 'minister'],
    scopes: [FEED_SCOPES.MAHARASHTRA],
    openWeb: 'optional',
    about: 'Maharashtra government and assembly: cabinet decisions, ministers, state parties, state-level appointments and policy.',
  },
  {
    key: 'national-politics',
    name: 'National politics',
    marathi: 'राष्ट्रीय राजकारण',
    terms: ['भारत राजकारण', 'संसद', 'केंद्र सरकार', 'पंतप्रधान'],
    termsEn: ['parliament', 'prime minister', 'union government', 'lok sabha', 'cabinet'],
    scopes: [FEED_SCOPES.NATIONAL],
    openWeb: 'no',
    about: 'Union government and Parliament: central policy, national parties, the Prime Minister and union ministers, national appointments.',
  },
  {
    key: 'agriculture',
    name: 'Agriculture',
    marathi: 'शेती',
    terms: ['शेतकरी', 'पीक', 'हमीभाव', 'कृषी', 'ऊस', 'कांदा'],
    termsEn: ['farmers', 'crop', 'agriculture', 'msp', 'sugarcane', 'onion'],
    scopes: [FEED_SCOPES.MAHARASHTRA, FEED_SCOPES.NATIONAL],
    openWeb: 'optional',
    about: 'Farming: crop prices and procurement, monsoon and irrigation, farm schemes and loan waivers, sugar, onion and cotton, farmer protests.',
  },
  {
    key: 'crime',
    name: 'Crime',
    marathi: 'गुन्हे',
    terms: ['गुन्हा', 'पोलीस', 'अटक', 'खून', 'अपघात'],
    termsEn: ['police', 'arrested', 'murder', 'accident', 'court'],
    scopes: [FEED_SCOPES.MAHARASHTRA],
    openWeb: 'optional',
    about: 'Crime and policing: arrests, investigations, court verdicts, road accidents and major incidents.',
  },
  {
    key: 'economy',
    name: 'Economy',
    marathi: 'अर्थकारण',
    terms: ['अर्थव्यवस्था', 'महागाई', 'बाजार', 'उद्योग', 'रोजगार'],
    termsEn: ['economy', 'inflation', 'market', 'industry', 'employment', 'budget'],
    scopes: [FEED_SCOPES.NATIONAL, FEED_SCOPES.MAHARASHTRA],
    openWeb: 'optional',
    about: 'Economy and business: prices and inflation, markets, industry and investment, employment, banking and budgets.',
  },
  {
    key: 'sports',
    name: 'Sports',
    marathi: 'क्रीडा',
    terms: ['क्रिकेट', 'सामना', 'क्रीडा', 'खेळाडू', 'cricket'],
    termsEn: ['cricket', 'match', 'tournament', 'player', 'olympic'],
    scopes: [FEED_SCOPES.NATIONAL, FEED_SCOPES.MAHARASHTRA],
    openWeb: 'optional',
    about: 'Sport: cricket and other results and fixtures, Indian and Maharashtra players, tournaments and selections.',
  },
  {
    key: 'entertainment',
    name: 'Entertainment',
    marathi: 'मनोरंजन',
    terms: ['मनोरंजन', 'मराठी चित्रपट', 'नाटक', 'मालिका'],
    termsEn: ['marathi film', 'theatre', 'serial', 'actor'],
    scopes: [FEED_SCOPES.MAHARASHTRA, FEED_SCOPES.NATIONAL],
    openWeb: 'optional',
    about: 'Entertainment, weighted to Marathi: films, theatre, television serials, music and the artists behind them.',
  },
  {
    key: 'bollywood',
    name: 'Bollywood',
    marathi: 'बॉलिवूड',
    terms: ['बॉलिवूड', 'हिंदी चित्रपट', 'bollywood'],
    termsEn: ['bollywood', 'hindi film', 'box office'],
    scopes: [FEED_SCOPES.NATIONAL],
    openWeb: 'optional',
    about: 'Hindi film industry: releases, box office, casting and the industry\'s own news. Not Marathi cinema, which is entertainment.',
  },
  {
    key: 'environment',
    name: 'Environment',
    marathi: 'पर्यावरण',
    terms: ['पर्यावरण', 'हवामान बदल', 'प्रदूषण', 'वनक्षेत्र', 'पाणी'],
    termsEn: ['pollution', 'climate', 'forest', 'wildlife', 'river', 'water'],
    scopes: [FEED_SCOPES.MAHARASHTRA, FEED_SCOPES.NATIONAL],
    openWeb: 'optional',
    about: 'Environment: pollution, water and rivers, forests and wildlife, climate, and the rules and protests around them.',
  },
  {
    key: 'education',
    name: 'Education',
    marathi: 'शिक्षण',
    terms: ['शिक्षण', 'परीक्षा', 'विद्यापीठ', 'शाळा', 'निकाल'],
    termsEn: ['exam', 'university', 'school', 'admission', 'result'],
    scopes: [FEED_SCOPES.MAHARASHTRA],
    openWeb: 'optional',
    about: 'Education: exams and results, schools and universities, admissions, teachers and education policy.',
  },
  {
    key: 'health',
    name: 'Health',
    marathi: 'आरोग्य',
    terms: ['आरोग्य', 'रुग्णालय', 'आजार', 'लस', 'औषध'],
    termsEn: ['hospital', 'vaccine', 'outbreak', 'disease', 'health ministry'],
    scopes: [FEED_SCOPES.MAHARASHTRA, FEED_SCOPES.NATIONAL],
    openWeb: 'optional',
    about: 'Health: hospitals and treatment, outbreaks and vaccination, medicines, and public health schemes.',
  },
  {
    key: 'world',
    name: 'World',
    marathi: 'जग',
    terms: ['जागतिक', 'आंतरराष्ट्रीय', 'परराष्ट्र'],
    termsEn: ['world', 'international', 'foreign', 'global'],
    scopes: [FEED_SCOPES.NATIONAL],
    openWeb: 'optional',
    about: 'News from outside India, and India\'s relations with other countries.',
  },
];

export const NEWS_TAGS = TAGS;

/** One tag by key, or null. Never throws - a stale saved brief must not crash a page. */
export function tagFor(key) {
  const want = String(key || '').trim().toLowerCase();
  return TAGS.find((tag) => tag.key === want) || null;
}

/** The catalogue as the form needs it. */
export function tagList() {
  return TAGS.map(({ key, name, marathi, about }) => ({ key, name, marathi, about }));
}

/**
 * The search query for a tag.
 *
 * Always ends in "today's latest news" - not decoration: `intent.js` reads
 * those words to classify a seed as a current event, and `rss.js` excludes
 * them from matching precisely because they carry no content, so appending
 * them cannot dilute what the query is actually about.
 *
 * A tag that uses the paper's own place with no place configured falls back
 * to Maharashtra rather than searching for nothing.
 */
export function queryFor(tag, { place = '' } = {}) {
  const resolved = typeof tag === 'string' ? tagFor(tag) : tag;
  if (!resolved) return '';
  // BOTH LANGUAGES, always, and this is not tidiness.
  //
  // The Maharashtra feeds publish in Marathi and the national ones (PIB, the
  // Times, the Hindu, NDTV) publish in English. Measured on the real national
  // feeds: the Marathi national-politics query returned FOUR items and the
  // English one returned 107 - so a Marathi-only vocabulary made the national
  // tags silently retrieve nothing at all, which reads to a desk as "there was
  // no national news today".
  //
  // Matching is per WORD (rss.js), so one combined query serves both: the
  // Marathi words match the Marathi feeds and the English words match the
  // English ones, and neither dilutes the other. The terms are deliberately
  // specific nouns for that reason - a broad word like "news" would match
  // everything, which is what the noise list already exists to prevent.
  const words = resolved.usesPlace
    ? [String(place || '').trim() || 'महाराष्ट्र', ...(resolved.termsEn || [])]
    : [...(resolved.terms || []), ...(resolved.termsEn || [])];
  return `${words.join(' ')} ${TODAY}`.replace(/\s+/g, ' ').trim();
}

/**
 * Every distinct query one brief needs, deduplicated.
 *
 * The fan-out is per TAG, never per block and never per page: two pages both
 * asking for state politics is one retrieval, and asking twice would spend
 * the request, halve the freshness cache's usefulness and return the same
 * items to be deduplicated later anyway.
 */
export function retrievalPlanFor(tagKeys, { place = '' } = {}) {
  const seen = new Set();
  const plan = [];
  for (const key of tagKeys || []) {
    const tag = tagFor(key);
    if (!tag || seen.has(tag.key)) continue;
    seen.add(tag.key);
    plan.push({
      tagKey: tag.key,
      query: queryFor(tag, { place }),
      scopes: tag.scopes,
      openWeb: tag.openWeb !== 'no',
      openWebOnly: tag.openWeb === 'required',
    });
  }
  return plan;
}
