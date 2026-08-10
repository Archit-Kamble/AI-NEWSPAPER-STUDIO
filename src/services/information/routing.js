// Which configured feed SCOPE(s) a query should be checked against.
//
// Not a second intent classifier - `intent.classifyIntent()` already decided
// this seed needs retrieval at all. This only decides WHICH feeds are worth
// asking: a query naming Maharashtra or one of its districts should not be
// diluted by ten purely-national headlines, and a query about India at large
// should not be answered from a district paper's local page. Keyword rules
// only, same style as intent.js, deliberately not exhaustive - an unlisted
// district falls through to BOTH scopes rather than being silently dropped.

const MAHARASHTRA_WORDS = [
  'maharashtra', 'महाराष्ट्र',
  'mumbai', 'मुंबई', 'pune', 'पुणे', 'nagpur', 'नागपूर', 'nashik', 'नाशिक',
  'thane', 'ठाणे', 'kolhapur', 'कोल्हापूर', 'satara', 'सातारा', 'sangli', 'सांगली',
  'solapur', 'सोलापूर', 'aurangabad', 'औरंगाबाद', 'संभाजीनगर', 'amravati', 'अमरावती',
  'akola', 'अकोला', 'latur', 'लातूर', 'jalgaon', 'जळगाव', 'ahmednagar', 'अहमदनगर', 'अहिल्यानगर',
];

const NATIONAL_WORDS = ['india', 'भारत', 'national', 'देश', 'delhi', 'दिल्ली'];

function normalize(text) {
  return String(text || '').toLowerCase();
}

function hasAny(text, words) {
  return words.some((word) => text.includes(word.toLowerCase()));
}

/**
 * Which feed scope(s) to check for this query. Never empty: a query naming
 * neither Maharashtra nor India by name (or naming both) checks both rather
 * than guessing which coverage is safe to drop.
 */
function scopesFor(query) {
  const t = normalize(query);
  const maharashtra = hasAny(t, MAHARASHTRA_WORDS);
  const national = hasAny(t, NATIONAL_WORDS);
  if (maharashtra && !national) return ['maharashtra'];
  if (national && !maharashtra) return ['national'];
  return ['national', 'maharashtra'];
}

module.exports = { scopesFor, MAHARASHTRA_WORDS, NATIONAL_WORDS };
