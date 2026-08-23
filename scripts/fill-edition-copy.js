// Fills a disposable edition with deterministic Marathi copy, sized to each
// block's own measured capacity.
//
// WHY THIS EXISTS. The composition engine has to be looked at to be believed -
// "the blocks fill correctly now" is a claim about a printed page, and no unit
// test can make it. But driving a real edition through the AI writer to get
// something to look at costs real money, is rate limited (Google's free tier
// is 20 requests a day per model), and produces different copy every run, so
// two screenshots can never be compared.
//
// So this writes the copy instead. It is NOT a writer and it is NOT an AI
// stand-in for production: it assembles sentences from a fixed pool, in a
// fixed order, to a length the engine itself says the block holds. That makes
// it deterministic - the same edition fills identically every time - and free.
//
// The copy is ordinary civic prose for a paper dated 2099. It is fixture text
// for looking at type with, not journalism, and nothing here may be pointed at
// a real edition:
//
//   node scripts/fill-edition-copy.js <editionId>     # 2099-* dates only
//
// The refusal for any other date is deliberate and matches
// populate-db-composition-inbox.js, which guards itself the same way.

require('dotenv').config();
const path = require('node:path');
const pool = require('../src/config/db');

const ED = Number(process.argv[2]);

// ------------------------------------------------------------- the copy ---
//
// Whole sentences, so an assembled paragraph always reads as sentences rather
// than being cut mid-clause. Deliberately varied in word shape - some plain
// consonants, some conjunct-heavy - because a block of uniform copy would not
// exercise the width measurement the engine is being looked at for.

const SENTENCES = [
  'सातारा जिल्ह्यातील ग्रामीण भागात पाणीपुरवठा योजनेचे काम अंतिम टप्प्यात आले आहे.',
  'महापालिकेने शहरातील रस्त्यांच्या दुरुस्तीसाठी स्वतंत्र निधी मंजूर केला आहे.',
  'शिक्षण विभागाने विद्यार्थ्यांसाठी मोफत पुस्तक वाटपाचा कार्यक्रम जाहीर केला.',
  'कृषी विभागाच्या वतीने शेतकऱ्यांना बियाणे आणि खतांचे वितरण करण्यात आले.',
  'ज्ञानेश्वर महाराजांच्या पालखीचे प्रस्थान उद्या सकाळी होणार असल्याचे कळते.',
  'आरोग्य केंद्रात नव्याने रुग्णवाहिका दाखल झाल्याने नागरिकांना दिलासा मिळाला.',
  'तालुका प्रशासनाने पावसाळ्यापूर्वी नाले सफाईची कामे पूर्ण करण्याचे आदेश दिले.',
  'क्रीडा स्पर्धेत स्थानिक खेळाडूंनी उत्तम कामगिरी करून पदके पटकावली आहेत.',
  'ग्रामपंचायतीच्या सभेत घनकचरा व्यवस्थापनावर सविस्तर चर्चा करण्यात आली.',
  'वीज वितरण कंपनीने देखभालीच्या कामासाठी पुरवठा खंडित राहणार असल्याचे कळवले.',
  'सहकारी दूध संघाने उत्पादकांना वाढीव दराने बिले अदा करण्याचा निर्णय घेतला.',
  'नगर वाचनालयात रविवारपासून पुस्तक प्रदर्शन भरवण्यात येणार आहे.',
  'बस स्थानकात प्रवाशांच्या सोयीसाठी डिजिटल माहिती फलक बसवण्यात आले.',
  'पोलिस प्रशासनाने वाहतूक नियमांबाबत जनजागृती मोहीम हाती घेतली आहे.',
  'जिल्हा रुग्णालयात नेत्रतपासणी शिबिराचे आयोजन करण्यात आले होते.',
  'पर्यावरण दिनानिमित्त शाळकरी मुलांनी वृक्षारोपणात सहभाग नोंदवला.',
  'बांधकाम विभागाने पुलाच्या कामाची पाहणी करून अहवाल सादर केला आहे.',
  'महिला बचत गटांनी तयार केलेल्या वस्तूंना बाजारपेठेत चांगली मागणी आहे.',
  'संबंधित विभागाने नागरिकांच्या तक्रारींची तातडीने दखल घ्यावी अशी मागणी आहे.',
  'सांस्कृतिक कार्यक्रमात स्थानिक कलाकारांनी लोकनृत्याचे सादरीकरण केले.',
  // SHORT sentences, deliberately. The pool was 61-79 characters throughout,
  // so the smallest thing the filler could add was a line and a half - and on
  // a 112x160 brief that left a whole line standing empty at the foot (92%
  // set) because nothing in the pool was small enough to close it. Copy is
  // written in whole sentences, so the last fraction of a column is closed by
  // a SHORT one; a sub-editor has them and so must this.
  'निर्णय एकमताने घेण्यात आला.',
  'कार्यवाही सुरू आहे.',
  'नागरिकांनी समाधान व्यक्त केले.',
  'अहवाल लवकरच सादर होणार आहे.',
  'तपशील नंतर जाहीर केला जाईल.',
  'बैठकीस पदाधिकारी उपस्थित होते.',
  'कामाची पाहणी करण्यात आली.',
  'निधी मंजूर झाला आहे.',
  'प्रक्रिया पूर्ण झाली आहे.',
  'नियोजन अंतिम टप्प्यात आहे.',
];

// Headlines are short, because short headlines are good journalism - and
// because a bank of long ones would quietly hide the dynamic-band behaviour
// that a one-line headline is supposed to demonstrate.
const HEADLINES = [
  'पाणीपुरवठा योजना अंतिम टप्प्यात',
  'रस्ते दुरुस्तीसाठी निधी मंजूर',
  'विद्यार्थ्यांना मोफत पुस्तके',
  'शेतकऱ्यांना बियाणे वाटप',
  'पालखी प्रस्थान उद्या',
  'रुग्णवाहिका दाखल',
  'नाले सफाईचे आदेश',
  'खेळाडूंची सुवर्ण कामगिरी',
  'घनकचऱ्यावर चर्चा',
  'वीजपुरवठा खंडित राहणार',
  'दूध उत्पादकांना वाढीव दर',
  'वाचनालयात पुस्तक प्रदर्शन',
  'स्थानकात डिजिटल फलक',
  'वाहतूक जनजागृती मोहीम',
  'नेत्रतपासणी शिबिर',
  'शाळकरी मुलांचे वृक्षारोपण',
  // Longer candidates exist so a WIDE block has something that can actually
  // fill its measure. Without them the pool topped out around 28 characters
  // and a 620px banner could only ever reach 62% of its column, however the
  // headline was chosen - see headlineFor() below.
  'पाणीपुरवठा योजनेचे काम अंतिम टप्प्यात आले असल्याची माहिती',
  'रस्ते दुरुस्तीसाठी स्वतंत्र निधी मंजूर करण्यात आला आहे',
  'विद्यार्थ्यांना मोफत पुस्तक वाटपाचा कार्यक्रम जाहीर',
  'शेतकऱ्यांना बियाणे आणि खतांचे वितरण करण्यात येणार',
  'घनकचरा व्यवस्थापनावर सविस्तर चर्चा करण्यात आली',
  'वाचनालयात रविवारपासून पुस्तक प्रदर्शन भरवण्यात येणार',
  'नेत्रतपासणी शिबिराचे आयोजन करण्यात आले होते',
  'वाहतूक नियमांबाबत जनजागृती मोहीम हाती घेतली',
  'दूध उत्पादकांना वाढीव दराने बिले अदा करण्याचा निर्णय',
  'ग्रामपंचायतीच्या सभेत घनकचरा व्यवस्थापनावर चर्चा',
  // The pool must comfortably EXCEED the number of blocks an edition has, or
  // duplicates are forced arithmetically however well they are chosen: 26
  // headlines across 36 blocks meant at least ten repeats. Deliberately spread
  // across lengths, because the choice is by measure - a 111px brief and a
  // 620px banner need candidates that can fill quite different columns.
  'जिल्हा परिषदेच्या शाळांमध्ये डिजिटल वर्ग सुरू',
  'तालुका क्रीडा स्पर्धेचे उद्घाटन उत्साहात पार पडले',
  'नगरपालिकेच्या वतीने स्वच्छता मोहीम राबवण्यात आली',
  'बाजार समितीत शेतमालाची आवक वाढली असल्याचे चित्र',
  'आरोग्य विभागाकडून लसीकरण मोहिमेला गती देण्यात आली',
  'पर्यटन विकासासाठी नवीन आराखडा तयार करण्यात येणार',
  'महिला बचत गटांच्या उत्पादनांना बाजारपेठ मिळाली',
  'ग्रामीण भागात इंटरनेट सुविधा पोहोचवण्याचे नियोजन',
  'सहकारी संस्थांच्या निवडणुका पुढील महिन्यात होणार',
  'क्रीडा संकुलाच्या कामाला लवकरच सुरुवात होणार आहे',
  'पूरनियंत्रण उपाययोजनांचा आढावा घेण्यात आला',
  'वनविभागाकडून वृक्षलागवडीचे उद्दिष्ट निश्चित',
  'शिक्षकांच्या रिक्त जागा भरण्याची प्रक्रिया सुरू',
  'पाणीटंचाई निवारणासाठी टँकर सुरू करण्यात आले',
  'रेशन दुकानांची तपासणी मोहीम हाती घेण्यात आली',
  'उद्यानाच्या सुशोभीकरणाचे काम पूर्ण',
  'नवीन बसफेऱ्या सुरू करण्याची मागणी',
  'साखर कारखान्याचा गळीत हंगाम सुरू',
  'विहिरींचे खोलीकरण पूर्ण झाले',
  'ग्रंथालयाला नवीन पुस्तके मिळाली',
  'अंगणवाडी इमारतीचे लोकार्पण',
  'पशुवैद्यकीय शिबिर संपन्न',
  // The pool must be much larger than one edition's block count, or uniqueness
  // starves the later blocks and two editions converge: with 48 candidates for
  // 33 blocks, 52% of headlines were shared between two dates. Choice has to
  // survive to the last block on page four.
  //
  // Varied on purpose in CADENCE as well as length - a bank that all ends
  // '... करण्यात आले' fills every measure and still reads as one voice.
  'महामार्गाच्या रुंदीकरणाला मंजुरी',
  'दुग्ध व्यवसायाला चालना देणार',
  'शहरात नवीन उद्यान उभारणार',
  'पिकांच्या नुकसानीचे पंचनामे सुरू',
  'तलावातील गाळ काढण्याचे काम सुरू',
  'शालेय पोषण आहाराची तपासणी',
  'बालकांचे लसीकरण शंभर टक्के',
  'मत्स्यबीज संकलनाला सुरुवात',
  'नागरी सुविधांसाठी निधीची तरतूद',
  'स्मशानभूमीच्या दुरुस्तीस मान्यता',
  'कृषी पंपांना दिवसा वीजपुरवठा',
  'गावठाण भूमापनाचे काम पूर्णत्वास',
  'रोजगार मेळाव्यास तरुणांचा प्रतिसाद',
  'बचत गटांना फिरता निधी मिळणार',
  'दिव्यांगांसाठी स्वतंत्र कक्ष सुरू',
  'ऐतिहासिक वाड्याचे जतन होणार',
  'सौरऊर्जा प्रकल्पाचे भूमिपूजन',
  'पाणंद रस्त्यांची कामे मार्गी',
  'जनावरांच्या चाऱ्याची व्यवस्था',
  'ग्रामसभेत विकासकामांचा आढावा',
  'शेततळ्यांच्या अनुदानात वाढ',
  'आपत्ती व्यवस्थापन पथक सज्ज',
  'शहर वाहतुकीत बदल करण्यात आले असून नागरिकांना सूचना',
  'जिल्हा रुग्णालयात नवीन यंत्रसामग्री दाखल झाली आहे',
  'शेतमाल तारण योजनेचा लाभ घेण्याचे आवाहन करण्यात आले',
  'पर्यावरण संवर्धनासाठी विशेष मोहीम राबवली जाणार आहे',
  'ग्रामीण रस्त्यांच्या दर्जाबाबत तक्रारींची दखल घेतली',
  'नगर परिषदेच्या अर्थसंकल्पास सर्वानुमते मान्यता मिळाली',
  'क्रीडा साहित्य वाटपाचा कार्यक्रम उत्साहात पार पडला',
  'सांडपाणी प्रक्रिया प्रकल्पाचे काम गतीने सुरू आहे',
  // BRIEF-SIZED headlines, 20-25 characters. Measured on a 111x160 brief
  // (design 13px, hierarchy floor 11px), this is the only band that works:
  //
  //   16 chars -> one line at 13px, 81% of the measure   (too short)
  //   21 chars -> one line at 12px, 99%                  (right)
  //   27 chars -> one line at  9.5px                     (under the floor)
  //   44 chars -> two lines at 9.5px                     (under the floor)
  //
  // which is simply the typographic truth that a brief takes a short, punchy
  // headline. Page one alone has six blocks this size and the pool held nine
  // such headlines, so uniqueness starved the last of them down to 94%.
  'निधी मंजूर करण्यात आला',
  'रस्त्याचे काम सुरू झाले',
  'पाणीपुरवठा सुरळीत झाला',
  'शिबिरास उत्स्फूर्त प्रतिसाद',
  'नवीन इमारतीचे भूमिपूजन',
  'तक्रारींची दखल घेतली',
  'गावात स्वच्छता मोहीम',
  'पिकांचे पंचनामे सुरू',
  'वीजजोडणी पूर्ववत झाली',
  'बैठकीत आढावा घेतला',
  'अनुदान वाटपास मान्यता',
  'क्रीडा स्पर्धा उत्साहात',
  'ग्रंथ प्रदर्शन भरणार',
  'आरोग्य तपासणी शिबिर',
  'रोजगार मेळावा संपन्न',
  'तलाव खोलीकरण पूर्ण',
  'दूध संकलन वाढले',
  'नळजोडण्या मंजूर झाल्या',
];

const DECKS = [
  'प्रशासनाकडून कार्यवाही सुरू',
  'नागरिकांना दिलासा',
  'पुढील आठवड्यात अंमलबजावणी',
  'संबंधित विभागाची माहिती',
];

const LOCATIONS = ['सातारा', 'कऱ्हाड', 'वाई', 'फलटण', 'पाटण'];
// The paper signs its own filler copy, the same way the writer does
// (text-flow.js's DEFAULT_BYLINE). The three invented correspondent names that
// used to be here are what the desk was reading off the page and asked to be
// rid of - and a fixture that shows a byline the product would never produce
// is a fixture nobody can judge the page by.
const REPORTERS = ['साहस वार्ता'];

// A stable pick, so the same block gets the same copy on every run - two
// screenshots of the same edition must be comparable.
const pick = (list, seed) => list[Math.abs(seed) % list.length];

/**
 * The headline in the pool that best FILLS this block's measure.
 *
 * The pool used to be indexed by block number alone, so a 25-character
 * headline could land on a 620px banner and set at 62% of its column - and a
 * one-line headline lying two-fifths short of the measure is the single most
 * obvious thing that makes a made-up page read as a mock-up. The fixture is
 * what the desk judges the layout by, so a fixture that cannot produce a
 * professional headline makes the whole page unjudgeable.
 *
 * This is the same principle storyWriter's settleGeneratedHeadline() applies
 * to real copy, with the same authority: candidates are SHAPED by the exact
 * compositor and the one that actually fills is taken. A character count is a
 * search range, never headline geometry (CLAUDE.md) - which is exactly why
 * every candidate is composed rather than measured by length.
 *
 * Ties break on the stable seed, so two runs of the same edition still
 * produce the same page.
 */
function headlineFor(compose, section, placed, base, seed, used = new Set()) {
  const designPx = Number(base.headlineFontPx) || Number(section.headline_font_px) || 0;
  const HIERARCHY_FLOOR = 0.85;

  // EVERY candidate is measured, then one is chosen from those that qualify.
  //
  // Taking the first qualifying candidate from a seeded offset was the obvious
  // shape and it does not vary enough: the qualifying set for a given geometry
  // is much the same whatever the offset, so two editions kept landing on the
  // same headline for the same block - 61% of blocks in the worst pair. Seeded
  // INDEXING into the qualifying set gives a different answer per edition by
  // construction, while staying perfectly deterministic for one edition.
  const scored = [];
  for (const headline of HEADLINES) {
    // `headlineGrowth: false` is what makes this measurement honest, and is
    // what storyWriter's settleGeneratedHeadline() does. Against an empty
    // block the engine may grow the type until the words fill the measure, so
    // a candidate reads as filling, is chosen, and then sets short once the
    // copy is in and growth is withheld to keep a sentence on the page.
    // Measured on a 307x120 strip: 97% empty -> 82% with the copy.
    const composed = compose.composeSection(
      { ...section, images: placed },
      { ...base, headline, body: '', headlineGrowth: false },
    );
    const band = composed.bands?.headline;
    if (!band || band.overset) continue;
    const resolvedPx = Number(band.resolvedPx) || 0;
    scored.push({
      headline,
      fill: compose.headlineFill(composed),
      // A headline that has to SHRINK to fit is no longer a headline. Filling
      // is necessary and not sufficient: the engine will take a too-long
      // headline down until the words fit, and on a 150x232 block that gave 46
      // characters at 7.5px against a 6.4px body - 1.17x, which reads as bold
      // body copy. Every one of the 30 copy-carrying geometries has 17-33
      // candidates that fill at the block's own design size, so insisting on
      // hierarchy costs nothing.
      keepsSize: !designPx || resolvedPx >= designPx * HIERARCHY_FLOOR,
    });
  }

  // Nothing composed at all - every candidate overset this block's headline
  // band. That happens on a frame too small or too odd to carry any of them,
  // and it must not throw: a fixture that dies on one unusual block leaves the
  // whole edition half written. The shortest candidate is the best chance.
  if (!scored.length) {
    const shortest = [...HEADLINES].sort((x, y) => x.length - y.length)
      .find((h) => !used.has(h)) || HEADLINES[0];
    used.add(shortest);
    return shortest;
  }

  const at = (list) => list[Math.abs(seed) % list.length];
  // A newspaper never runs the same headline twice on the same day.
  const fresh = (list) => list.filter((c) => !used.has(c.headline));
  const good = scored.filter((c) => c.fill >= 0.95 && c.keepsSize);
  const sized = scored.filter((c) => c.keepsSize);

  // Among candidates that all clear the bar, the seed decides - that is what
  // makes two editions differ. Among candidates that do NOT clear it, the seed
  // must not decide: picking blind from the also-rans is how a 112x168 brief
  // ended up with a headline filling 56% of its column while better ones sat
  // unused. So every fallback takes the BEST fill it can still reach, with the
  // seed only breaking exact ties.
  const best = (list) => [...list].sort((x, y) => (y.fill - x.fill)
    || (x.headline < y.headline ? -1 : 1))[0];

  const freshGood = fresh(good);
  const chosen = (freshGood.length ? at(freshGood)
    : best(fresh(sized).length ? fresh(sized)
      : fresh(scored).length ? fresh(scored)
        : (good.length ? good : scored))).headline;

  used.add(chosen);
  return chosen;
}

/**
 * Sentences added until the block is genuinely full - COMPOSED, not counted.
 *
 * This used to assemble copy against `capacity.bodyCharRange.min`, the
 * guaranteed-safe FLOOR, and then stop one sentence before even that. On a
 * real page it left 41 of 43 blocks under 95% set - some at 62% - so every
 * screenshot taken to judge the layout was judging a page nobody had actually
 * filled. The whole point of this script is to make composition work visible,
 * and it was hiding the thing it exists to show.
 *
 * A character budget cannot answer "is this block full" - that is the
 * measured, settled result this codebase is built on (CLAUDE.md, "the
 * character budget is a range"). So this composes after every sentence and
 * keeps the last one that still fits. Deterministic, free, and it lands on
 * exactly the geometry the page will print.
 */
function bodyFor(compose, section, images, view, seed) {
  const fits = (body) => {
    const r = compose.composeSection({ ...section, images }, { ...view, body });
    return { ok: !r.overset.body && !(r.violations || []).some((v) => v.code === 'BODY_UNBREAKABLE_TOKEN_OVERSET'), r };
  };
  if (!fits('').ok) return '';

  const out = [];
  let best = '';
  // At every step, try EVERY sentence and take the first that still fits -
  // not just the next one in sequence.
  //
  // This used to break on the first sentence that did not fit, which reads as
  // reasonable and is wrong whenever the space left is smaller than that
  // particular sentence: a SHORTER one further down the pool would have gone
  // in. It shows up worst on a block carrying a picture, where the copy runs
  // out of room early and the residual is a fraction of a line - measured on
  // one real edition, a 307x296 anchor beside a photograph stopped at 31% of
  // its own column with twenty usable sentences still in the pool.
  //
  // Copy is written in whole sentences, so the last fraction of a column can
  // only ever be closed by a short one. Trying them all is what closes it.
  for (let guard = 0; guard < SENTENCES.length * 8; guard += 1) {
    let added = false;
    for (let k = 0; k < SENTENCES.length; k += 1) {
      const sentence = SENTENCES[(seed + guard + k) % SENTENCES.length];
      const candidate = [...out, sentence].join(' ');
      const { ok, r } = fits(candidate);
      if (!ok) continue;
      out.push(sentence);
      best = candidate;
      added = true;
      // Full to the foot: nothing more can be set in what is left.
      if (r.whitespace.occupancy.emptyEquivalentLines < 0.25) return best;
      break;
    }
    if (!added) break;
  }
  return best;
}

(async () => {
  if (!ED) throw new Error('usage: node scripts/fill-edition-copy.js <editionId>');

  const { rows: [edition] } = await pool.query('SELECT id, publication_date FROM newspapers WHERE id=$1', [ED]);
  if (!edition) throw new Error(`edition ${ED} does not exist`);

  const date = String(edition.publication_date).slice(0, 10);
  // Two DIFFERENT editions must not come out with the same copy, and the SAME
  // edition must come out identical on every run - two screenshots of one
  // edition have to be comparable, which is what `pick`'s stable seed is for.
  // Seeding from the block's position alone satisfies the second and breaks
  // the first: measured across two 4-page editions, 82% of headlines were
  // shared and 11 of 33 blocks got the identical headline. The edition's own
  // publication DATE is the thing that differs between them and is fixed
  // within one of them, so it is what the seed is offset by.
  const editionSeed = [...date].reduce((h, ch) => ((h * 33) ^ ch.charCodeAt(0)) >>> 0, 5381) % 9973;
  if (!date.startsWith('2099-')) {
    throw new Error(`refusing to write copy into ${date} - this script is for disposable 2099-* editions only`);
  }

  // The engine itself decides how much each block holds. That is the point of
  // the exercise: the copy is written TO the measurement, and the same
  // measurement then checks it.
  const compose = await import(path.join(__dirname, '..', 'public', 'editor', 'compose', 'section-adapter.js'));
  const metrics = await import(path.join(__dirname, '..', 'public', 'editor', 'compose', 'font-metrics.js'));
  const shaper = await import(path.join(__dirname, "..", "public", "editor", "compose", "shaper.js"));
  await Promise.all([metrics.ensureFontsLoaded(), shaper.ensureShaperReady()]);
  // Real HarfBuzz shaping, not summed hmtx advances. Without this the script
  // fills every block to a measure that overstates conjuncts by up to 80%,
  // and every screenshot taken to judge the composition judges a page filled
  // against numbers the browser never uses.
  shaper.requireShaperReady();

  const { rows: sections } = await pool.query(
    `SELECT ps.*, p.page_number
       FROM page_sections ps JOIN pages p ON p.id = ps.page_id
      WHERE p.newspaper_id = $1
      ORDER BY p.page_number, ps.y_px, ps.x_px`,
    [ED],
  );

  // The photographs actually placed in each block. A block is measured WITH
  // them or the budget is a lie: probing with an empty image list quoted the
  // whole frame as available and then overflowed exactly the blocks that had
  // a picture standing in them.
  // The same join page.repository.js uses, so this sees exactly the pictures
  // the page canvas draws - the link column is page_section_id.
  const { rows: images } = await pool.query(
    `SELECT si.*, ma.url
       FROM section_images si
       JOIN media_assets ma ON ma.id = si.media_asset_id
       JOIN page_sections ps ON ps.id = si.page_section_id
       JOIN pages p ON p.id = ps.page_id
      WHERE p.newspaper_id = $1
      ORDER BY si.z_index, si.id`,
    [ED],
  );
  const imagesBySection = new Map();
  for (const image of images) {
    if (!imagesBySection.has(image.page_section_id)) imagesBySection.set(image.page_section_id, []);
    imagesBySection.get(image.page_section_id).push(image);
  }

  let written = 0;
  let skipped = 0;
  // One edition, one headline each - see headlineFor().
  const usedHeadlines = new Set();

  for (const [index, section] of sections.entries()) {
    // Adverts are sold space and standing features are filled by the software
    // for the edition's own date. Neither is a reporter's to write into.
    if (section.block_type === 'advert' || section.feature_key || section.smart_card_key) { skipped += 1; continue; }
    if (!['article', 'briefs', 'photo'].includes(String(section.block_type))) { skipped += 1; continue; }

    const subheading = section.height_px > 240 ? pick(DECKS, editionSeed + index * 3) : '';
    const location = pick(LOCATIONS, editionSeed + index);
    const reporter = pick(REPORTERS, editionSeed + index * 5);
    const placed = imagesBySection.get(section.id) || [];

    // The headline is chosen AFTER the pictures are known, because the measure
    // it has to fill is what is left beside them.
    const headline = headlineFor(
      compose, section, placed,
      { subheading, location, author: reporter },
      editionSeed + index * 7 + section.page_number,
      usedHeadlines,
    );

    // Compose the block with its real headline and deck but no body, so the
    // budget returned is the room the STORY has - after the display type has
    // taken what it needs, and after the photographs have taken theirs.
    const probe = compose.composeSection(
      { ...section, images: placed },
      { headline, subheading, body: '', location, author: reporter },
    );

    const body = bodyFor(compose, section, placed, { headline, subheading, location, author: reporter }, editionSeed + index * 11);

    // A block whose photograph leaves no room for a sentence must not keep a
    // story anyway. Left alone, its old copy simply has nowhere to go, and the
    // page carries a permanent overset warning that no amount of editing can
    // clear - which is what an image companion holding orphaned copy IS.
    if (!body) {
      await pool.query('UPDATE page_sections SET body=$2 WHERE id=$1', [section.id, '']);
      console.log(`p${section.page_number} ${String(section.section_key).padEnd(16)} no room for copy beside its picture - body cleared`);
      skipped += 1;
      continue;
    }

    await pool.query(
      `UPDATE page_sections
          SET headline=$2, subheading=$3, body=$4, location=$5, reporter_name=$6
        WHERE id=$1`,
      [section.id, headline, subheading, body, location, reporter],
    );

    // And check the result the same way the page will.
    const after = compose.composeSection({ ...section, images: placed }, { headline, subheading, body, location, author: reporter });
    written += 1;
    console.log(
      `p${section.page_number} ${String(section.section_key).padEnd(16)}`,
      `wrote ${String(body.length).padStart(5)}`,
      `-> ${after.fitState}`,
      `${Math.round(after.whitespace.occupancy.ratio * 100)}% set`,
      after.overset.body ? `OVERSET +${after.overset.body.length}` : `hole ${after.whitespace.occupancy.emptyEquivalentLines}`,
    );
  }

  console.log(`\n${written} blocks written, ${skipped} left alone (adverts, features, furniture).`);
  await pool.end();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
