// Populates only a disposable edition's real `news_items` inbox. The final
// B8B ingress proof reads these through news.repository, never from a JS pool.
require('dotenv').config();
const news = require('../src/repositories/news.repository');
const papers = require('../src/repositories/newspaper.repository');
const pool = require('./ai-test-news-pool');

const editionId = Number(process.argv[2]);
if (!editionId) throw new Error('usage: node scripts/populate-db-composition-inbox.js <editionId>');
const body = (topic, facts, depth = 1) => `${facts.join(' ')} ${Array.from({ length: depth }, (_, index) => `${topic} संदर्भात विभागाने नोंद, अंमलबजावणीचा टप्पा आणि नागरिकांसाठी पुढील सूचना स्पष्ट केल्या आहेत. स्थानिक अधिकाऱ्यांनी साप्ताहिक आढावा घेऊन लेखी प्रगती अहवाल देण्याचे सांगितले. उपलब्ध नोंदींची पडताळणी करून पुढील निर्णय जाहीर केला जाईल. ${index % 2 ? 'तपासणी, सेवा-वेळ आणि तक्रार नोंदणीची माहिती स्वतंत्र नोंदीत उपलब्ध आहे.' : 'कामाच्या प्रत्येक टप्प्यासाठी जबाबदार अधिकारी आणि पडताळणीची पद्धत स्पष्ट करण्यात आली आहे.'}`).join(' ')}`;
// These are semantic treatments, not section keys. Their count is the actual
// ordinary external demand of the standard four-page templates. Keep this
// disposable seed broad enough for that semantic demand; production derives
// the real count from frame-purpose metadata and never imports this fixture.
const demand = {
  FRONT: ['LEAD', 'SECONDARY', 'SECONDARY', 'SECONDARY', 'STANDARD', 'STANDARD', 'STANDARD', 'BRIEF', 'BRIEF', 'BRIEF'],
  LOCAL: ['LEAD', 'ANALYSIS', 'STANDARD', 'BRIEF', 'STANDARD'],
  FEATURES: ['PHOTO_FEATURE', 'OPINION', 'DATA'],
  BACK: ['LEAD', 'SECONDARY', 'STANDARD', 'BRIEF', 'BRIEF', 'BRIEF', 'BRIEF', 'BRIEF', 'BRIEF', 'BRIEF', 'BRIEF', 'SIDEBAR', 'SIDEBAR', 'SIDEBAR', 'ANALYSIS', 'STANDARD'],
};

async function main() {
  const paper = await papers.findById(editionId);
  if (!paper || !String(paper.publication_date).startsWith('2099-')) throw new Error('Refusing non-disposable inbox target');
  const records = [];
  for (const [role, treatments] of Object.entries(demand)) {
    for (let index = 0; index < treatments.length; index += 1) {
      const seed = pool[(Object.keys(demand).indexOf(role) * 5 + index) % pool.length]; const storyType = treatments[index];
      records.push({
        // Tiny sidebar frames must start with a compact factual label; a long
        // database-source headline is not allowed to erase their body budget.
        title: storyType === 'SIDEBAR' ? `आजची नोंद ${index + 1}` : `${seed.title} — ${role} विशेष ${index + 1}`,
        description: body(seed.title, [seed.body, 'निर्धारित वेळापत्रकानुसार कामाची माहिती संबंधित विभागाने दिली.', 'नोंदवलेल्या अडचणींसाठी स्वतंत्र संपर्क व्यवस्था ठेवण्यात आली आहे.'], storyType === 'ANALYSIS' ? 4 : storyType === 'LEAD' ? 2 : 1),
        category: seed.category, location: seed.location, city: seed.location, tags: seed.tags, reporter_name: seed.reporter_name,
        story_type: storyType, editorial_priority: Math.max(1, 5 - Math.min(index, 4)), desired_page_role: role,
        // The standard features-page photo story has its own newsroom image;
        // companion photo slots remain owned by their parent story packages.
        image_urls: storyType === 'PHOTO_FEATURE' ? ['/uploads/zz-test-edition-feature-package.jpg'] : [],
        status: 'approved', newspaper_id: editionId, created_by: null,
      });
    }
  }
  const created = [];
  for (const item of records) created.push(await news.create(item));
  console.log(JSON.stringify({ editionId, created: created.length, ids: created.map((item) => item.id) }, null, 2));
}
main().catch((error) => { console.error(error.message); process.exit(1); });
