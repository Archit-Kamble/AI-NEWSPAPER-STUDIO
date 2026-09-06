// Who the paper is — the standing furniture of every edition.
//
// There are three kinds of ink on a newspaper page, and only one of them is
// anybody's daily work:
//
//   1. Standing furniture   never changes: the nameplate, the strapline, the
//                           editions line, the RNI number, the editor's name,
//                           the cover price, the printline at the foot.
//   2. Edition variables    change once a day but are DERIVABLE: the date line,
//                           the volume and issue number, the page numbers.
//   3. The day's file       the stories, the pictures, the advertisements.
//
// Everything in (1) and (2) is drawn by the software and cannot be typed into.
// A desk that has to key the issue number every morning will eventually key it
// wrong, and a wrong issue number is a wrong archive. So (2) is computed here
// from the edition's date, not stored and incremented - nothing to drift.
//
// A front page is not a grid of stories with a logo on top. Look at any Marathi
// daily: the nameplate sits between an ear on the left carrying the date, the
// place of publication, the volume, the page count and the cover price, and an
// ear on the right carrying a teaser. Above it runs a hairline strip with the
// paper's line and the editions it prints. None of that is decoration — it is
// the legal and commercial identity of the edition, and a page without it is
// not a newspaper.
//
// The nameplate artwork and the values below are SAHAS VARTA's own, read off
// their masthead at esahas.com. The few that are genuinely per-edition
// commercial facts — volume, page count, cover price — are marked; the desk
// sets them once and they ride every edition after that.

const NAMEPLATE = '/assets/masthead/sahas-nameplate.png';

const identity = {
  // The nameplate is set artwork, not type. Redrawing "साहस वार्ता" in a web
  // font would not be their masthead — it would be a lookalike.
  nameplateUrl: NAMEPLATE,
  nameplateAspect: 1600 / 300,

  title: 'दैनिक साहस वार्ता',
  titleEnglish: 'Dainik Sahas Varta',

  // Read off the printed masthead.
  rni: 'RNI No. MAHMUL/2015/67123',
  editor: 'संपादक : श्री. श्रीकांत शिवनाथ मुळे',
  website: 'www.esahas.com',
  epaper: 'esahas.com/epaper',
  socials: [
    { icon: 'facebook', handle: '/sahasvarta01' },
    { icon: 'instagram', handle: '/sahasvarta' },
    { icon: 'youtube', handle: '/sahasvarta' },
    { icon: 'whatsapp', handle: '8409494949' },
  ],

  // The strip above the nameplate.
  // Read off the printed nameplate of 4 August 2026, not invented.
  strapline: 'मराठी, हिंदी, इंग्रजी भाषेत प्रसिद्ध होणारे दैनिक',
  editions: 'मुंबई, ठाणे, पुणे, नाशिक, नागपूर, छत्रपती संभाजीनगर, सोलापूर, कोल्हापूर',
  owner: 'मालक - संपादक : श्री. श्रीकांत शिवनाथ मुळे',
  office: 'ऑफिस : ३११/अ, म.न.पा.च.४, वाढे, सातारा - ४१५००२',
  phone: '८४०९४९४९४९',
  email: 'sahasnews@gmail.com',

  // The paper's first edition. Everything about volume and issue numbering
  // follows from this date and the edition's own date - see numberingFor().
  // Taken from the RNI registration on the masthead.
  foundedOn: '2015-01-01',

  // Where the paper is printed, which is what "today" means to it. Not the
  // server's timezone and certainly not UTC.
  timezone: 'Asia/Kolkata',

  price: 'किंमत - २ रू',
  placeOfPublication: 'सातारा',
  // Where "सातारा" actually is, so anything computed from the town - right
  // now just the folio's sunrise/sunset strip - reads its own place rather
  // than panchang.js's unrelated Mumbai default. Satara city, to four
  // decimals; a district daily printed anywhere else would carry its own.
  placeCoordinates: { latitude: 17.6805, longitude: 74.0183 },

  // The printline at the foot of the page. This is a legal requirement on an
  // Indian newspaper, not decoration, and it is identical in every edition -
  // exactly the kind of thing that should never be re-keyed.
  printline:
    'मुद्रक, प्रकाशक व मालक श्री. श्रीकांत शिवनाथ मुळे यांनी दैनिक साहस वार्ता साठी प्रकाशित केले. ' +
    'संपादक : श्री. श्रीकांत शिवनाथ मुळे. सर्व वाद सातारा न्यायकक्षेत.',

  // The full printer's declaration. Every Indian newspaper carries one, and
  // this paper carries it at the FOOT OF PAGE TWO rather than on every page -
  // which is why it is separate from the short printline above. It is a legal
  // statement under the Press and Registration of Books Act; not one word of it
  // should ever be re-keyed by a desk.
  imprint:
    'साहस वार्ता हे दैनिक प्रकाशक, मालक, संपादक श्रीकांत शिवनाथ मुळे यांनी प्रिंटर अश्विनी मुळे, ' +
    'साहस प्रिंट्स, नर्मदा, ६७/बी, रामनगर पवार कॉलनी, शाहूपुरी, सातारा (महाराष्ट्र) ४१५००२ येथे मुद्रित ' +
    'करून साहस वार्ता कार्यालय, नर्मदा, ६७/बी, रामनगर पवार कॉलनी, शाहूपुरी, सातारा (महाराष्ट्र) ' +
    '४१५००२ येथून प्रकाशित केले. (सर्व वाद सातारा न्यायकक्षेत) संपादक श्रीकांत शिवनाथ मुळे ' +
    '(प्रे. आ. अ‍ॅक्ट अंतर्गत जबाबदार) संपर्क क्र. ८४०९४९४९४९, ई-मेल : sahasvarta@gmail.com',
  imprintEnglish:
    'Sahas Varta is printed by Owner, Publisher, Editor SHRIKANT SHIVNATH MULE at Printer ' +
    'Ashwini Mule, Sahas Prints, Narmada, 67/B, Ramnagar Pawar Colony, Shahupuri, Satara ' +
    '(Maharashtra) - 415002 & Published from Sahas Varta office, Narmada, 67/B, Ramnagar Pawar ' +
    'Colony, Shahupuri, Satara (Maharashtra) - 415002. (All disputes subject to Satara ' +
    'jurisdiction) Editor SHRIKANT SHIVNATH MULE (Responsible under PRB Act). ' +
    'Contact No. 8409494949, E-mail: sahasvarta@gmail.com',

  // Told once, on the same page as the printer's declaration - and now INSIDE
  // it, in each language's own paragraph, rather than as a third band of its
  // own beneath both.
  //
  // It used to stand apart, set centred and bold under a hairline, on the
  // reasoning that it is not part of the Press and Registration of Books Act
  // statement and must not read as though it were. True, and the price was
  // that page two carried three separate notices where a reader expects one
  // imprint: the desk's report was to put it in the block that already says
  // who prints this paper, in both languages, boxed.
  //
  // ONE SENTENCE, and the Marathi does not use the letters "AI". The English
  // says "artificial intelligence" because that is what the phrase is in
  // English; the Marathi says कृत्रिम बुद्धिमत्ता, which is the same words in
  // its own script, and a Latin abbreviation dropped into a Devanagari
  // sentence is not a translation.
  //
  // It no longer states the second half - that a person on the desk passed it
  // - because that half is the imprint's own subject: the paragraph it now
  // sits inside names the editor who is responsible under the Act, one line
  // above.
  aiDisclosure:
    'हे वृत्तपत्र कृत्रिम बुद्धिमत्तेच्या साहाय्याने तयार करण्यात आले आहे.',
  aiDisclosureEnglish:
    'This newspaper is produced with the help of artificial intelligence.',

  // Which page the declaration prints on. The paper puts it on page two.
  imprintPage: 2,
};

// The registered nameplate artwork, RNI number and printer's declaration stay
// in the canonical identity above: changing those needs a verified legal/brand
// asset, not a text field. The owner-maintained publication details below are
// the parts that may safely appear throughout the living newspaper furniture.
const editableIdentityDefaults = Object.freeze({
  title: identity.title,
  owner: identity.owner,
  office: identity.office,
  phone: identity.phone,
  email: identity.email,
  website: identity.website,
  epaper: identity.epaper,
  timezone: identity.timezone,
});

function visibleWebsite(url) {
  return String(url || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

function applyPublicationSettings(settings = {}) {
  identity.title = String(settings.publication_name || editableIdentityDefaults.title).trim();
  identity.owner = String(settings.publisher_name || editableIdentityDefaults.owner).trim();
  identity.office = String(settings.address || editableIdentityDefaults.office).trim();
  identity.phone = String(settings.contact_phone || editableIdentityDefaults.phone).trim();
  identity.email = String(settings.contact_email || editableIdentityDefaults.email).trim();
  identity.website = visibleWebsite(settings.public_website) || editableIdentityDefaults.website;
  identity.epaper = identity.website ? `${identity.website.replace(/\/$/, '')}/epaper` : editableIdentityDefaults.epaper;
  identity.timezone = String(settings.timezone || editableIdentityDefaults.timezone).trim();
  // THE GROUND THIS PAPER COVERS - country, state, district, city. Not part of
  // the masthead and never printed: it is what the Newsdesk Run opens on, so a
  // district daily asks about its own district rather than about the place its
  // office happens to be in. Carried on the identity because that is the one
  // record every surface already reads.
  identity.coverage = {
    country: String(settings.coverage_country || 'IN'),
    state: String(settings.coverage_state || 'MH'),
    district: String(settings.coverage_district || ''),
    city: String(settings.coverage_city || ''),
  };
  return identity;
}

// --- Marathi date line -------------------------------------------------------
// The date is the loudest thing in the left ear of a Marathi front page: a
// numeral two or three times the size of anything near it. It has to be set in
// Devanagari numerals and Marathi month names, not localised at render time by
// whatever the browser happens to support.

const DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
const WEEKDAYS = ['रविवार', 'सोमवार', 'मंगळवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'];
const MONTHS = [
  'जानेवारी', 'फेब्रुवारी', 'मार्च', 'एप्रिल', 'मे', 'जून',
  'जुलै', 'ऑगस्ट', 'सप्टेंबर', 'ऑक्टोबर', 'नोव्हेंबर', 'डिसेंबर',
];

function devanagari(value) {
  return String(value).replace(/\d/g, (d) => DIGITS[Number(d)]);
}

/**
 * The three lines of the date ear, from an ISO date.
 * Parsed as parts rather than through the local timezone, so an edition dated
 * the 3rd never prints as the 2nd on a machine set west of UTC.
 */
function dateLine(isoDate) {
  const [year, month, day] = String(isoDate || '').split('T')[0].split('-').map(Number);
  if (!year || !month || !day) return { day: '', weekday: '', monthYear: '' };
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return {
    day: devanagari(day),
    weekday,
    monthYear: `${MONTHS[month - 1]} ${devanagari(year)}`,
  };
}

// --- edition numbering -------------------------------------------------------
// "वर्ष ११ । अंक २१२" — the volume is which year of publication this is, the
// issue is which edition of that year. Both fall straight out of two dates, so
// they are computed rather than stored: no counter to advance, nothing to
// forget on a day the paper does not print, and a back edition opened a year
// from now still shows the number it went to press with.

const DAY_MS = 24 * 60 * 60 * 1000;

const atUtcMidnight = (iso) => {
  const [y, m, d] = String(iso || '').split('T')[0].split('-').map(Number);
  return y && m && d ? Date.UTC(y, m - 1, d) : null;
};

function numberingFor(isoDate, founded = identity.foundedOn) {
  const day = atUtcMidnight(isoDate);
  const start = atUtcMidnight(founded);
  if (!day || !start || day < start) return { volume: null, issue: null, line: '' };

  const from = new Date(start);
  const to = new Date(day);
  // Volume turns over on the anniversary of the first edition.
  let volume = to.getUTCFullYear() - from.getUTCFullYear() + 1;
  const anniversary = Date.UTC(to.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  if (day < anniversary) volume -= 1;

  const volumeStart = Date.UTC(
    day < anniversary ? to.getUTCFullYear() - 1 : to.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  );
  const issue = Math.round((day - volumeStart) / DAY_MS) + 1;

  return {
    volume,
    issue,
    line: `वर्ष ${devanagari(volume)} । अंक ${devanagari(issue)}`,
  };
}

/**
 * The identity as page one needs it for one particular edition: the standing
 * facts, plus the numbers derived from that edition's date.
 */
function identityFor(isoDate, pageCount) {
  const numbering = numberingFor(isoDate);
  return {
    ...identity,
    volumeLine: numbering.line,
    volume: numbering.volume,
    issue: numbering.issue,
    pageCountLabel: pageCount ? `पृष्ठे ${devanagari(pageCount)}` : '',
  };
}

module.exports = { identity, identityFor, applyPublicationSettings, numberingFor, dateLine, devanagari, WEEKDAYS, MONTHS };
