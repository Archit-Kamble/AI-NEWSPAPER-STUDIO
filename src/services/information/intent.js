// Is this seed asking for something that changes day to day?
//
// Deliberately not a model call. An LLM classifying "does this need current
// information" is the same category of risk this whole layer exists to avoid
// - a judgement call made by something that cannot check its own answer. This
// is a small set of keyword rules instead: slower to extend, but its answer
// for any given input never changes between two runs, and a test can hold it
// forever.
//
// Five categories:
//
//   evergreen      history, explainers, anything with no "today" about it.
//                  Never triggers retrieval - the existing, unmodified flow.
//   reporter_copy  the desk is asking to rewrite copy that already exists.
//                  Also never triggers retrieval: a date or place NAME inside
//                  existing reporter copy is not a request for today's facts.
//   current_news   a general update, timely but not a single hard fact.
//   current_data   a specific fact that is only true for a while: a result, a
//                  score, a weather reading.
//   ambiguous      mentions a current-events-shaped topic (an election, a
//                  match) without saying whether it wants today's outcome or
//                  the topic in general. Treated the SAME as the current_*
//                  categories: retrieval is attempted, because assuming
//                  "evergreen" here is the one guess this layer exists to
//                  never make.

const DATA_WORDS = ['हवामान', 'weather', 'स्कोअर', 'score', 'निकाल', 'result'];
const NEWS_WORDS = ['बातम्या', 'ब्रेकिंग', 'breaking', 'news'];
const TEMPORAL_WORDS = ['आज', 'आजचे', 'आजच्या', 'सध्या', 'ताज्या', 'ताजे', 'latest', 'today', 'current', 'currently'];
const TOPIC_WORDS = ['निवडणूक', 'election', 'सामना', 'match'];

// "Rewrite this reporter copy" / "edit the existing story" - referring to
// copy that already exists, not asking for a fresh fact.
const REPORTER_COPY_PATTERN = /reporter'?s?\s+(copy|story|draft)|rewrite\s+(this|the)\s+(reporter\s+)?(copy|story|draft)|(this|existing)\s+reporter\s+(copy|story|draft)/i;

function normalize(text) {
  return String(text || '').toLowerCase();
}

function hasAny(text, words) {
  return words.some((word) => text.includes(word.toLowerCase()));
}

/** One of the five categories above. Pure function of the text alone. */
function classifyIntent(text) {
  const t = normalize(text);
  if (!t.trim()) return 'evergreen';

  if (REPORTER_COPY_PATTERN.test(t)) return 'reporter_copy';
  // A result/score/weather word is, by itself, a request for a fact that is
  // only true for a while - "election result" needs no "today" beside it to
  // mean today's.
  if (hasAny(t, DATA_WORDS)) return 'current_data';
  if (hasAny(t, NEWS_WORDS) && hasAny(t, TEMPORAL_WORDS)) return 'current_news';
  if (hasAny(t, NEWS_WORDS)) return 'ambiguous';
  if (hasAny(t, TOPIC_WORDS)) return 'ambiguous';
  if (hasAny(t, TEMPORAL_WORDS)) return 'ambiguous';
  return 'evergreen';
}

/** Whether this category should ever reach `information.fetchContext()`. */
function needsRetrieval(category) {
  return category === 'current_news' || category === 'current_data' || category === 'ambiguous';
}

module.exports = { classifyIntent, needsRetrieval, DATA_WORDS, NEWS_WORDS, TEMPORAL_WORDS, TOPIC_WORDS };
