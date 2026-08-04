// The e-paper.
//
// esahas.com's e-paper today is a photograph of each page with an image map
// over it; tapping a story opens a JPEG crop of that story. It works, but the
// words are pixels: nothing in it can be searched, quoted, read aloud, enlarged
// by a reader with poor sight, or found by anyone on the internet looking for
// the news it carries. A district paper's entire archive is invisible.
//
// The interesting thing is that SAHAS does not have to choose. It already holds
// two things esahas.com does not:
//
//   * the real Marathi text of every block, and
//   * the exact rectangle each block occupies on the printed page.
//
// So the hotspot map that an image e-paper needs comes out for nothing, AND the
// text can be served as text. This builds both: an edition as structured data
// with per-block rectangles in page percentages (ready to overlay on a page
// JPEG when the print pipeline produces one), and a plain, indexable HTML
// edition that reads correctly with no page images at all.

const pool = require('../config/db');
// The e-paper is read by the public: it must show the story, never its markup.
const { strip: plainText, load: loadPlainText } = require('../layout/plain-text');
const { identityFor, dateLine, devanagari } = require('../layout/identity');
const districtEditions = require('./districtEdition.service');

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// A block only belongs in the e-paper if it carries something a reader would
// read. Advert slots, empty blocks and picture strips without copy do not.
const isReadable = (section) =>
  Boolean(section.headline || section.body) && section.block_type !== 'advert';

/**
 * The edition as data.
 *
 * Rectangles are given as percentages of the page rather than pixels, so the
 * same map works over a page image at any resolution - a 300 dpi print raster,
 * a phone-sized JPEG, or nothing at all.
 */
async function buildEdition(newspaperId) {
  await loadPlainText();
  const { rows: papers } = await pool.query('SELECT * FROM newspapers WHERE id = $1', [newspaperId]);
  const paper = papers[0];
  if (!paper) return null;

  const pages = await districtEditions.pagesOf(newspaperId);
  const identity = identityFor(paper.publication_date, pages.length);
  const pageWidth = Number(paper.page_width_px) || 660;
  const pageHeight = Number(paper.page_height_px) || 1060;

  return {
    edition: {
      id: paper.id,
      title: identity.title,
      district: paper.district || identity.placeOfPublication,
      date: String(paper.publication_date).slice(0, 10),
      dateLine: dateLine(paper.publication_date),
      volumeLine: identity.volumeLine,
      pages: pages.length,
    },
    pages: pages.map((page) => ({
      number: page.page_number,
      printsColour: page.prints_colour !== false,
      origin: page.origin,
      articles: (page.sections || [])
        .filter(isReadable)
        .map((section) => ({
          id: section.id,
          sectionKey: section.section_key,
          kicker: section.kicker || '',
          headline: section.headline || '',
          subheading: section.subheading || '',
          body: section.body || '',
          category: section.category || '',
          location: section.location || '',
          reporter: section.reporter_name || '',
          continuedFrom: section.continued_from_section_id || null,
          pictures: (section.images || []).map((image) => ({ url: image.url, caption: image.caption || '' })),
          // The hotspot. This is the block's own rectangle, which is exactly
          // where its story will be on the printed page.
          hotspot: {
            leftPct: Number(((section.x_px / pageWidth) * 100).toFixed(3)),
            topPct: Number(((section.y_px / pageHeight) * 100).toFixed(3)),
            widthPct: Number(((section.width_px / pageWidth) * 100).toFixed(3)),
            heightPct: Number(((section.height_px / pageHeight) * 100).toFixed(3)),
          },
        })),
    })),
  };
}

/**
 * The same edition as a page anyone - and any search engine - can read.
 *
 * Deliberately plain: real headings, real paragraphs, one stylesheet, no
 * script. It is the archive copy, and an archive that depends on JavaScript is
 * not an archive.
 */
function renderHtml(edition) {
  const { edition: meta, pages } = edition;
  const date = meta.dateLine;
  const dateText = date?.day ? `${date.day} ${date.monthYear}, ${date.weekday}` : meta.date;

  const article = (item, pageNumber) => `
      <article class="story" id="p${pageNumber}-${escapeHtml(item.sectionKey)}">
        ${item.kicker ? `<p class="kicker">${escapeHtml(item.kicker)}</p>` : ''}
        <h3>${escapeHtml(plainText(item.headline))}</h3>
        ${item.subheading ? `<p class="deck">${escapeHtml(item.subheading)}</p>` : ''}
        ${
          [item.location, item.reporter].filter(Boolean).length
            ? `<p class="dateline">${escapeHtml([item.location, item.reporter].filter(Boolean).join(', '))}</p>`
            : ''
        }
        ${item.pictures
          .map(
            (picture) =>
              `<figure><img src="${escapeHtml(picture.url)}" alt="${escapeHtml(picture.caption)}" loading="lazy">${
                picture.caption ? `<figcaption>${escapeHtml(picture.caption)}</figcaption>` : ''
              }</figure>`,
          )
          .join('')}
        ${plainText(item.body)
          .split(/\n{2,}/)
          .filter(Boolean)
          .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
          .join('')}
      </article>`;

  return `<!doctype html>
<html lang="mr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title)} — ${escapeHtml(dateText)}</title>
<meta name="description" content="${escapeHtml(meta.title)}, ${escapeHtml(meta.district)} — ${escapeHtml(dateText)}. ${escapeHtml(meta.volumeLine)}">
<style>
  body { font-family: "Noto Serif Devanagari", Georgia, serif; max-width: 44rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; color: #111; line-height: 1.65; }
  header { border-bottom: 3px solid #c8102e; padding-bottom: .75rem; margin-bottom: 1.5rem; }
  h1 { font-family: "Noto Sans Devanagari", Arial, sans-serif; color: #c8102e; margin: 0 0 .25rem; }
  .meta { color: #555; font-size: .9rem; }
  h2 { font-family: "Noto Sans Devanagari", Arial, sans-serif; font-size: 1.05rem; margin: 2.5rem 0 .5rem; border-bottom: 1px solid #ccc; padding-bottom: .25rem; }
  h3 { font-family: "Noto Sans Devanagari", Arial, sans-serif; font-size: 1.35rem; margin: 0 0 .35rem; }
  .story { margin: 0 0 2.25rem; }
  .kicker { font-family: "Noto Sans Devanagari", Arial, sans-serif; font-size: .85rem; font-weight: 700; margin: 0 0 .2rem; }
  .deck { font-size: 1rem; color: #333; margin: 0 0 .5rem; }
  .dateline { font-weight: 700; font-size: .85rem; margin: 0 0 .5rem; }
  figure { margin: 0 0 .75rem; }
  img { max-width: 100%; height: auto; }
  figcaption { font-size: .8rem; color: #555; }
  footer { margin-top: 3rem; border-top: 1px solid #ccc; padding-top: .75rem; font-size: .8rem; color: #555; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(meta.title)}</h1>
  <p class="meta">${escapeHtml(meta.district)} । ${escapeHtml(dateText)} । ${escapeHtml(meta.volumeLine)} । पृष्ठे ${devanagari(meta.pages)}</p>
</header>
${pages
  .map(
    (page) => `<section>
  <h2>पृष्ठ ${devanagari(page.number)}</h2>
  ${page.articles.map((item) => article(item, page.number)).join('')}
</section>`,
  )
  .join('\n')}
<footer>${escapeHtml(meta.title)} — ${escapeHtml(dateText)}</footer>
</body>
</html>`;
}

module.exports = { buildEdition, renderHtml };
