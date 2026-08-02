const pageRepository = require('../repositories/page.repository');

async function saveSection(pageId, sectionKey, body) {
  const article = {
    newsItemId: body.newsItemId || body.sourceNewsId,
    headline: body.headline || body.title,
    headlineFontPx: body.headlineFontPx,
    subheading: body.subheading || body.subtitle,
    subheadingFontPx: body.subheadingFontPx,
    body: body.body || body.description,
    bodyFontPx: body.bodyFontPx,
    category: body.category,
    location: body.location,
    tags: body.tags,
    reporterName: body.reporterName,
    aiNotes: body.aiNotes,
  };

  await pageRepository.saveSection(parseInt(pageId, 10), sectionKey, article);
  return pageRepository.findById(parseInt(pageId, 10));
}

module.exports = { saveSection };
