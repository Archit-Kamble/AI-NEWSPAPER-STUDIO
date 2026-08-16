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
];

const DECKS = [
  'प्रशासनाकडून कार्यवाही सुरू',
  'नागरिकांना दिलासा',
  'पुढील आठवड्यात अंमलबजावणी',
  'संबंधित विभागाची माहिती',
];

const LOCATIONS = ['सातारा', 'कऱ्हाड', 'वाई', 'फलटण', 'पाटण'];
const REPORTERS = ['प्रतिनिधी', 'वार्ताहर', 'विशेष प्रतिनिधी'];

// A stable pick, so the same block gets the same copy on every run - two
// screenshots of the same edition must be comparable.
const pick = (list, seed) => list[Math.abs(seed) % list.length];

/** Sentences joined until adding another would pass the block's own budget. */
function bodyFor(budgetChars, seed) {
  if (budgetChars <= 0) return '';
  const out = [];
  let used = 0;
  for (let i = 0; i < SENTENCES.length * 4; i += 1) {
    const sentence = SENTENCES[(seed + i) % SENTENCES.length];
    if (used + sentence.length + 1 > budgetChars) break;
    out.push(sentence);
    used += sentence.length + 1;
  }
  return out.join(' ');
}

(async () => {
  if (!ED) throw new Error('usage: node scripts/fill-edition-copy.js <editionId>');

  const { rows: [edition] } = await pool.query('SELECT id, publication_date FROM newspapers WHERE id=$1', [ED]);
  if (!edition) throw new Error(`edition ${ED} does not exist`);

  const date = String(edition.publication_date).slice(0, 10);
  if (!date.startsWith('2099-')) {
    throw new Error(`refusing to write copy into ${date} - this script is for disposable 2099-* editions only`);
  }

  // The engine itself decides how much each block holds. That is the point of
  // the exercise: the copy is written TO the measurement, and the same
  // measurement then checks it.
  const compose = await import(path.join(__dirname, '..', 'public', 'editor', 'compose', 'section-adapter.js'));
  const metrics = await import(path.join(__dirname, '..', 'public', 'editor', 'compose', 'font-metrics.js'));
  await metrics.ensureFontsLoaded();

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

  for (const [index, section] of sections.entries()) {
    // Adverts are sold space and standing features are filled by the software
    // for the edition's own date. Neither is a reporter's to write into.
    if (section.block_type === 'advert' || section.feature_key || section.smart_card_key) { skipped += 1; continue; }
    if (!['article', 'briefs', 'photo'].includes(String(section.block_type))) { skipped += 1; continue; }

    const headline = pick(HEADLINES, index * 7 + section.page_number);
    const subheading = section.height_px > 240 ? pick(DECKS, index * 3) : '';
    const location = pick(LOCATIONS, index);
    const reporter = pick(REPORTERS, index * 5);

    // Compose the block with its real headline and deck but no body, so the
    // budget returned is the room the STORY has - after the display type has
    // taken what it needs, and after the photographs have taken theirs.
    const placed = imagesBySection.get(section.id) || [];
    const probe = compose.composeSection(
      { ...section, images: placed },
      { headline, subheading, body: '', location, author: reporter },
    );

    const body = bodyFor(probe.capacity.bodyCharRange.min, index * 11);

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
      `budget ${String(probe.capacity.bodyCharRange.min).padStart(5)}`,
      `wrote ${String(body.length).padStart(5)}`,
      `-> ${after.fitState}`,
      after.overset.body ? `OVERSET +${after.overset.body.length}` : `hole ${after.whitespace.largestHoleLines}`,
    );
  }

  console.log(`\n${written} blocks written, ${skipped} left alone (adverts, features, furniture).`);
  await pool.end();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
