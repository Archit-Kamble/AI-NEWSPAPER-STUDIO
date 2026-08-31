// WHERE THIS PAPER COVERS - country, state, district, city.
//
// The desk's report: "it should ask like local then which city, state then
// which state, with dropdowns - default Satara, Maharashtra, India - but if he
// wants to cover another local news like Sangli he should be able to; make it
// bigger to smaller, first country then state then district then city."
//
// A district daily's local news is not "local" in the abstract: it is a named
// taluka, and a query for "सातारा ताज्या बातम्या" finds different stories from
// one for "सांगली". The Newsdesk Run could only ever ask about the paper's own
// place of publication, so a desk who wanted a Sangli story on page three had
// no way to say so.
//
// WHY THIS IS A CATALOGUE AND NOT A FREE-TEXT BOX. The place reaches a search
// query and a feed match, and a misspelt district silently returns nothing
// while looking exactly like a district with no news today. Named places are
// the difference between "there is nothing" and "you typed it wrong".
//
// WHAT IS IN IT, AND WHY IT STOPS WHERE IT DOES. Every Indian state and union
// territory, because a paper occasionally runs a story datelined elsewhere;
// Maharashtra's districts in full, because that is the ground this paper
// actually covers; and the CITY is free text, because there is no defensible
// list of every taluka and village in a district and a wrong one is worse than
// none. A city is only ever added to a query, never used to filter, so a name
// this file has never heard of still works.
//
// Loaded as an ES module in the browser and reached from Node by the same
// dynamic import() the character grid and the ink palette are.

export const COUNTRIES = Object.freeze([
  { key: 'IN', name: 'India', marathi: 'भारत' },
]);

// The states, and for Maharashtra its districts. `districts: null` means this
// file does not carry them - the district box falls back to free text there,
// which is honest rather than pretending to a completeness it has not got.
export const STATES = Object.freeze([
  { key: 'MH', name: 'Maharashtra', marathi: 'महाराष्ट्र', districts: Object.freeze([
    'Ahmednagar', 'Akola', 'Amravati', 'Beed', 'Bhandara', 'Buldhana', 'Chandrapur',
    'Chhatrapati Sambhajinagar', 'Dharashiv', 'Dhule', 'Gadchiroli', 'Gondia', 'Hingoli',
    'Jalgaon', 'Jalna', 'Kolhapur', 'Latur', 'Mumbai City', 'Mumbai Suburban', 'Nagpur',
    'Nanded', 'Nandurbar', 'Nashik', 'Palghar', 'Parbhani', 'Pune', 'Raigad', 'Ratnagiri',
    'Sangli', 'Satara', 'Sindhudurg', 'Solapur', 'Thane', 'Wardha', 'Washim', 'Yavatmal',
  ]) },
  { key: 'AP', name: 'Andhra Pradesh', marathi: 'आंध्र प्रदेश', districts: null },
  { key: 'AR', name: 'Arunachal Pradesh', marathi: 'अरुणाचल प्रदेश', districts: null },
  { key: 'AS', name: 'Assam', marathi: 'आसाम', districts: null },
  { key: 'BR', name: 'Bihar', marathi: 'बिहार', districts: null },
  { key: 'CG', name: 'Chhattisgarh', marathi: 'छत्तीसगड', districts: null },
  { key: 'GA', name: 'Goa', marathi: 'गोवा', districts: null },
  { key: 'GJ', name: 'Gujarat', marathi: 'गुजरात', districts: null },
  { key: 'HR', name: 'Haryana', marathi: 'हरियाणा', districts: null },
  { key: 'HP', name: 'Himachal Pradesh', marathi: 'हिमाचल प्रदेश', districts: null },
  { key: 'JH', name: 'Jharkhand', marathi: 'झारखंड', districts: null },
  { key: 'KA', name: 'Karnataka', marathi: 'कर्नाटक', districts: null },
  { key: 'KL', name: 'Kerala', marathi: 'केरळ', districts: null },
  { key: 'MP', name: 'Madhya Pradesh', marathi: 'मध्य प्रदेश', districts: null },
  { key: 'MN', name: 'Manipur', marathi: 'मणिपूर', districts: null },
  { key: 'ML', name: 'Meghalaya', marathi: 'मेघालय', districts: null },
  { key: 'MZ', name: 'Mizoram', marathi: 'मिझोराम', districts: null },
  { key: 'NL', name: 'Nagaland', marathi: 'नागालँड', districts: null },
  { key: 'OD', name: 'Odisha', marathi: 'ओडिशा', districts: null },
  { key: 'PB', name: 'Punjab', marathi: 'पंजाब', districts: null },
  { key: 'RJ', name: 'Rajasthan', marathi: 'राजस्थान', districts: null },
  { key: 'SK', name: 'Sikkim', marathi: 'सिक्कीम', districts: null },
  { key: 'TN', name: 'Tamil Nadu', marathi: 'तामिळनाडू', districts: null },
  { key: 'TS', name: 'Telangana', marathi: 'तेलंगणा', districts: null },
  { key: 'TR', name: 'Tripura', marathi: 'त्रिपुरा', districts: null },
  { key: 'UK', name: 'Uttarakhand', marathi: 'उत्तराखंड', districts: null },
  { key: 'UP', name: 'Uttar Pradesh', marathi: 'उत्तर प्रदेश', districts: null },
  { key: 'WB', name: 'West Bengal', marathi: 'पश्चिम बंगाल', districts: null },
  { key: 'DL', name: 'Delhi', marathi: 'दिल्ली', districts: null },
  { key: 'JK', name: 'Jammu and Kashmir', marathi: 'जम्मू आणि काश्मीर', districts: null },
  { key: 'LA', name: 'Ladakh', marathi: 'लडाख', districts: null },
  { key: 'PY', name: 'Puducherry', marathi: 'पुद्दुचेरी', districts: null },
  { key: 'CH', name: 'Chandigarh', marathi: 'चंदीगड', districts: null },
  { key: 'AN', name: 'Andaman and Nicobar Islands', marathi: 'अंदमान आणि निकोबार', districts: null },
  { key: 'DH', name: 'Dadra and Nagar Haveli and Daman and Diu', marathi: 'दादरा नगर हवेली', districts: null },
  { key: 'LD', name: 'Lakshadweep', marathi: 'लक्षद्वीप', districts: null },
]);

/** What this paper covers unless the owner says otherwise, in Settings. */
export const DEFAULT_PLACE = Object.freeze({
  country: 'IN', state: 'MH', district: 'Satara', city: '',
});

export function stateOf(key) {
  return STATES.find((entry) => entry.key === String(key || '')) || null;
}

export function districtsOf(stateKey) {
  return stateOf(stateKey)?.districts || null;
}

/**
 * The place as a QUERY reads it: most specific first, and nothing empty.
 *
 * A retrieval asks about a place by name, so what matters is the name a
 * publisher would print - "Satara", not "IN/MH/Satara". The country is left
 * out of an in-country query for the same reason a Satara paper does not
 * write "Satara, India" over a local story: it is noise in a search that is
 * already about this country's news.
 */
export function placeQuery(place = {}) {
  const parts = [place.city, place.district, stateOf(place.state)?.name]
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  return [...new Set(parts)].join(', ');
}

/** The most specific name the desk chose - what a `local` tag is about. */
export function placeName(place = {}) {
  return String(place.city || '').trim()
    || String(place.district || '').trim()
    || stateOf(place.state)?.name
    || '';
}

/** A stored place, sanitised. An unknown state or country falls back. */
export function placeOf(raw = {}) {
  const country = COUNTRIES.some((c) => c.key === raw.country) ? raw.country : DEFAULT_PLACE.country;
  const state = stateOf(raw.state) ? raw.state : DEFAULT_PLACE.state;
  const known = districtsOf(state);
  const asked = String(raw.district || '').trim();
  // A state this file carries districts for only accepts one of them; a state
  // it does not carries whatever the desk typed, because refusing a real
  // district on the grounds that this file has not heard of it would be worse
  // than accepting it.
  const district = known ? (known.includes(asked) ? asked : '') : asked.slice(0, 80);
  return { country, state, district, city: String(raw.city || '').trim().slice(0, 80) };
}
