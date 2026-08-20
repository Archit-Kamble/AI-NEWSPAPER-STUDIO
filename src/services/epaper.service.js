// The public e-paper.
//
// Publication is a boundary, not merely another GET of the live newsroom row.
// A released issue must not change because somebody later opens yesterday's
// layout and moves a picture. `epaperPublication.service.js` therefore writes
// one immutable manifest beside the page/story PNGs made from the accepted
// final PDF or a current-editor proof. Public readers load only that manifest
// while the newspaper row has its explicit e-paper selection; the live edition
// remains available to the desk through buildEdition() for preview and republishing.

const path = require('path');
const fs = require('fs/promises');
const pool = require('../config/db');
const newspaperRepository = require('../repositories/newspaper.repository');
const publicationRepository = require('../repositories/publication.repository');
const { strip: plainText, load: loadPlainText } = require('../layout/plain-text');
const { identityFor, dateLine, devanagari } = require('../layout/identity');
const districtEditions = require('./districtEdition.service');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const EPAPER_DIR = path.join(PUBLIC_DIR, 'uploads', 'epaper');
const LOGO_URL = '/assets/masthead/sahas-nameplate.png';

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const safeAlignment = (value) => ['left', 'center', 'right'].includes(value) ? value : 'left';
const isReadable = (section) =>
  Boolean(section.headline || section.body)
  && !['advert', 'feature'].includes(String(section.block_type || '').toLowerCase())
  && !section.smart_card_key
  && !section.feature_key;

function editionDirectory(newspaperId) {
  const id = Number(newspaperId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid e-paper id');
  return path.join(EPAPER_DIR, String(id));
}

function manifestPath(newspaperId) {
  return path.join(editionDirectory(newspaperId), 'manifest.json');
}

/** The live desk edition, used only to create/preview the next snapshot. */
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
      logoUrl: LOGO_URL,
      status: paper.status,
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
          kicker: plainText(section.kicker || ''),
          headline: plainText(section.headline || ''),
          subheading: plainText(section.subheading || ''),
          headlineAlign: safeAlignment(section.headline_align),
          subheadingAlign: safeAlignment(section.subheading_align),
          body: plainText(section.body || ''),
          category: section.category || '',
          location: section.location || '',
          reporter: section.reporter_name || '',
          bodyAlign: safeAlignment(section.text_align),
          headlineFontPx: Number(section.headline_font_px) || 18,
          subheadingFontPx: Number(section.subheading_font_px) || 13,
          bodyFontPx: Number(section.body_font_px) || 8,
          columnCount: Math.max(1, Number(section.column_count) || 1),
          lineHeight: Number(section.line_height) || 1.45,
          continuedFrom: section.continued_from_section_id || null,
          pictures: (section.images || []).map((image) => ({ url: image.url, caption: image.caption || '' })),
          hotspot: {
            leftPct: Number(((Number(section.x_px) / pageWidth) * 100).toFixed(3)),
            topPct: Number(((Number(section.y_px) / pageHeight) * 100).toFixed(3)),
            widthPct: Number(((Number(section.width_px) / pageWidth) * 100).toFixed(3)),
            heightPct: Number(((Number(section.height_px) / pageHeight) * 100).toFixed(3)),
          },
        })),
      width: pageWidth,
      height: pageHeight,
    })),
  };
}

// The browser canvas receives its full persisted page rows, not the smaller
// public reader manifest. Current-editor publishing uses this shape solely for
// a one-use local capture, so every real setting - image transform, marks,
// border, Smart Card and exact type choice - is painted by the same module the
// desk sees before it presses Publish.
async function buildCanvasEdition(newspaperId) {
  const paper = await newspaperRepository.findById(Number(newspaperId));
  if (!paper) return null;
  const pages = await districtEditions.pagesOf(Number(newspaperId));
  return { newspaper: paper, pages };
}

async function readRelease(newspaperId, { publicOnly = false } = {}) {
  const paper = await newspaperRepository.findById(Number(newspaperId));
  if (!paper || !paper.epaper_released_at || (publicOnly && !paper.epaper_selected)) return null;
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath(newspaperId), 'utf8'));
    return Number(manifest?.edition?.id) === Number(newspaperId) ? manifest : null;
  } catch {
    return null;
  }
}

/** Public means the one selected release: knowing an id never reveals a draft. */
async function loadPublishedEdition(newspaperId) {
  return readRelease(newspaperId, { publicOnly: true });
}

async function loadSelectedEdition() {
  const selected = await newspaperRepository.findPublicEpaper();
  return selected ? readRelease(selected.id, { publicOnly: true }) : null;
}

async function listReleasedEditions() {
  const rows = await newspaperRepository.findEpaperReleases();
  const editions = await Promise.all(rows.map(async (row) => {
    const snapshot = await readRelease(row.id);
    if (!snapshot) return null;
    const meta = snapshot.edition || {};
    return {
      id: Number(meta.id),
      name: meta.title || row.name,
      district: meta.district || '',
      date: String(meta.date || row.publication_date).slice(0, 10),
      pageCount: snapshot.pages?.length || 0,
      publishedAt: meta.publishedAt || row.epaper_released_at,
      pdfUrl: meta.pdfUrl || '',
      previewUrl: `/epaper/preview/${row.id}`,
      publicUrl: '/epaper',
      coverUrl: snapshot.pages?.[0]?.imageUrl || LOGO_URL,
      selected: row.epaper_selected === true,
      source: row.epaper_source || meta.source || 'press_pdf',
    };
  }));
  return editions
    .filter(Boolean)
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0) || b.id - a.id);
}

async function selectReleasedEdition(newspaperId) {
  const snapshot = await readRelease(newspaperId);
  if (!snapshot) return null;
  await newspaperRepository.selectPublicEpaper(Number(newspaperId));
  return { ...snapshot, edition: { ...snapshot.edition, readerUrl: '/epaper' } };
}

async function selectAfterRelease(newspaperId, paper) {
  const selected = await newspaperRepository.findPublicEpaper();
  const date = String(paper.publication_date).slice(0, 10);
  // "Today" is the newsroom's current edition, not necessarily the host
  // machine's wall-clock date (a test or a planned issue can deliberately use
  // a later publication date). A newly released issue becomes public when it
  // is at least as current as the selected issue; backfilling an older archive
  // never steals the public URL.
  const selectedDate = String(selected?.publication_date || '').slice(0, 10);
  const shouldSelect = !selected || Number(selected.id) === Number(newspaperId) || date >= selectedDate;
  return newspaperRepository.recordEpaperRelease(Number(newspaperId), {
    source: paper.epaper_source || undefined,
    selected: shouldSelect,
  });
}

/**
 * Resolve a generated public PNG only while its owning snapshot is published.
 * Express' general static middleware must never be allowed to bypass this.
 */
async function releasedAsset(newspaperId, filename, { includePrivate = false } = {}) {
  const clean = String(filename || '');
  if (!/^(?:page-\d+|story-\d+-[a-zA-Z0-9_-]+)\.png$/i.test(clean)) return null;
  const snapshot = await readRelease(newspaperId, { publicOnly: !includePrivate });
  if (!snapshot) return null;
  const urls = (snapshot.pages || []).flatMap((page) => [
    page.imageUrl,
    ...(page.articles || []).map((article) => article.shareImageUrl),
  ]).filter(Boolean);
  if (!urls.some((url) => path.basename(String(url)) === clean)) return null;
  return path.join(editionDirectory(newspaperId), clean);
}

async function publishedAsset(newspaperId, filename) {
  return releasedAsset(newspaperId, filename);
}

/** The PDF named by the frozen release is public through this route only. */
async function releasedPdf(newspaperId, { includePrivate = false } = {}) {
  const snapshot = await readRelease(newspaperId, { publicOnly: !includePrivate });
  if (!snapshot) return null;
  const files = await publicationRepository.latestByNewspaper(Number(newspaperId));
  const source = snapshot.edition?.source;
  const url = source === 'uploaded_pdf'
    ? files.find((file) => file.file_type === 'epaper_pdf')?.storage_path
    : files.find((file) => file.file_type === 'print_pdf')?.storage_path;
  if (!String(url || '').startsWith('/uploads/')) return null;
  const file = path.resolve(PUBLIC_DIR, `.${url}`);
  const root = path.resolve(PUBLIC_DIR, 'uploads') + path.sep;
  if (!file.startsWith(root)) return null;
  return { file, name: `sahas-varta-${snapshot.edition.date}.pdf` };
}

async function publishedPdf(newspaperId) {
  return releasedPdf(newspaperId);
}

function dateText(meta) {
  const date = meta.dateLine;
  return date?.day ? `${date.day} ${date.monthYear}, ${date.weekday}` : meta.date;
}

function storyId(pageNumber, item) {
  return `story-p${pageNumber}-${String(item.sectionKey || item.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function icon(name) {
  const paths = {
    download: '<path d="M12 3v11m0 0 4-4m-4 4-4-4M5 19h14"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.5-4.4m-7.5 6.8 7.5 4.4"/>',
    whatsapp: '<path d="M20 11.7a8 8 0 0 1-11.8 7L4 20l1.4-4A8 8 0 1 1 20 11.7Z"/><path d="M9 8.2c.4 3 2 4.7 5 5.6l1.2-1.2 2 .9c-.2 1.5-1.1 2.2-2.5 2.2-4.4-.5-7-3.2-7.6-7.5 0-1.3.8-2.2 2.2-2.4l1 2Z"/>',
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>',
    facebook: '<path d="M14 21v-8h3l.5-3H14V8.3c0-.9.4-1.8 2-1.8h1.7V3.8c-.7-.1-1.5-.2-2.3-.2-2.4 0-4.4 1.5-4.4 4.5V10H8v3h3v8"/>',
    x: '<path d="M5 4l14 16M19 4 5 20"/>',
    linkedin: '<rect x="4" y="9" width="3" height="11"/><circle cx="5.5" cy="5.5" r="1.5" fill="currentColor" stroke="none"/><path d="M11 20V9h3v1.8c1-1.4 5-2.4 5 3.2v6h-3v-5.3c0-2.4-2-2.1-2-0.1V20Z"/>',
    email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || paths.share}</svg>`;
}

function shareControls(item, pageNumber) {
  const id = storyId(pageNumber, item);
  const readerUrl = `${item.readerUrl || '/epaper'}#${id}`;
  const image = escapeHtml(item.shareImageUrl || '');
  return `<div class="story-share" data-share-title="${escapeHtml(item.headline)}" data-share-url="${escapeHtml(readerUrl)}" data-share-image="${image}">
    <a class="share-action share-download" href="${image}" download>${icon('download')}<span>PNG</span></a>
    <button class="share-action share-native" type="button" data-share-file>${icon('share')}<span>Share</span></button>
    <div class="share-app">
      <span class="share-brand whatsapp">${icon('whatsapp')}<b>WhatsApp</b></span>
      <button type="button" data-share-file data-share-target="WhatsApp Status">Status</button>
      <a href="#" data-direct-share="whatsapp">Send</a>
    </div>
    <div class="share-app">
      <span class="share-brand instagram">${icon('instagram')}<b>Instagram</b></span>
      <button type="button" data-share-file data-share-target="Instagram Story">Story</button>
      <button type="button" data-share-file data-share-target="Instagram Post">Post</button>
    </div>
    <div class="share-app">
      <span class="share-brand facebook">${icon('facebook')}<b>Facebook</b></span>
      <button type="button" data-share-file data-share-target="Facebook Story">Story</button>
      <a href="#" data-direct-share="facebook">Post</a>
    </div>
    <a class="share-action share-x" href="#" data-direct-share="x" aria-label="Post on X">${icon('x')}<span>X</span></a>
    <a class="share-action share-linkedin" href="#" data-direct-share="linkedin" aria-label="Post on LinkedIn">${icon('linkedin')}<span>LinkedIn</span></a>
    <a class="share-action share-email" href="#" data-direct-share="email">${icon('email')}<span>Email</span></a>
    <p class="share-help" role="status">On mobile, Story/Status opens the system share sheet with the PNG. Choose the matching destination in the app.</p>
  </div>`;
}

function articleTranscript(item, pageNumber) {
  const id = storyId(pageNumber, item);
  const pictures = (item.pictures || []).map((picture) =>
    `<figure><img src="${escapeHtml(picture.url)}" alt="${escapeHtml(picture.caption)}" loading="lazy">${picture.caption ? `<figcaption>${escapeHtml(picture.caption)}</figcaption>` : ''}</figure>`).join('');
  const paragraphs = String(item.body || '').split(/\n{2,}/).filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('');
  return `<article class="story-transcript" id="${id}">
    ${item.kicker ? `<p class="kicker" style="text-align:${safeAlignment(item.headlineAlign)}">${escapeHtml(item.kicker)}</p>` : ''}
    <h3 style="text-align:${safeAlignment(item.headlineAlign)}">${escapeHtml(item.headline)}</h3>
    ${item.subheading ? `<p class="deck" style="text-align:${safeAlignment(item.subheadingAlign)}">${escapeHtml(item.subheading)}</p>` : ''}
    ${[item.location, item.reporter].filter(Boolean).length ? `<p class="dateline">${escapeHtml([item.location, item.reporter].filter(Boolean).join(' · '))}</p>` : ''}
    ${pictures}${paragraphs}
    ${item.shareImageUrl ? `<button type="button" class="read-story-card" data-story-dialog="dialog-${id}">Open share card</button>` : ''}
  </article>
  ${item.shareImageUrl ? `<dialog class="story-dialog" id="dialog-${id}" aria-labelledby="title-${id}">
    <div class="story-dialog-shell">
      <button type="button" class="story-dialog-close" data-close-dialog aria-label="Close">${icon('close')}</button>
      <div class="story-dialog-heading"><p>Share this story</p><h2 id="title-${id}">${escapeHtml(item.headline)}</h2></div>
      <img class="story-card-image" src="${escapeHtml(item.shareImageUrl)}" alt="PNG share card: ${escapeHtml(item.headline)}" loading="lazy">
      ${shareControls({ ...item, readerUrl: '/epaper' }, pageNumber)}
    </div>
  </dialog>` : ''}`;
}

function pageViewer(page) {
  const hotspots = (page.articles || []).map((item) => {
    const id = storyId(page.number, item);
    const h = item.hotspot || {};
    return `<a class="story-hotspot" href="#${id}" data-story-dialog="dialog-${id}"
      style="left:${Number(h.leftPct) || 0}%;top:${Number(h.topPct) || 0}%;width:${Number(h.widthPct) || 0}%;height:${Number(h.heightPct) || 0}%"
      aria-label="Read: ${escapeHtml(item.headline)}"><span>${escapeHtml(item.headline)}</span></a>`;
  }).join('');
  return `<section class="epaper-page" data-page="${page.number}" ${page.number === 1 ? '' : 'hidden'} aria-label="Page ${page.number}">
    ${page.imageUrl
      ? `<div class="page-image-wrap"><img class="page-image" src="${escapeHtml(page.imageUrl)}" width="${Number(page.imageWidth) || ''}" height="${Number(page.imageHeight) || ''}" alt="Newspaper page ${page.number}" ${page.number === 1 ? '' : 'loading="lazy"'}>${hotspots}</div>`
      : `<p class="page-image-missing">This published page image is unavailable. The readable stories remain below.</p>`}
  </section>`;
}

function renderHtml(snapshot) {
  const { edition: meta, pages } = snapshot;
  const when = dateText(meta);
  const title = `${meta.title} — ${when}`;
  const cover = pages[0]?.imageUrl || LOGO_URL;
  const pageButtons = pages.map((page) => `<button type="button" data-page-button="${page.number}" ${page.number === 1 ? 'aria-current="page"' : ''}>${devanagari(page.number)}</button>`).join('');
  const transcript = pages.map((page) => `<section class="transcript-page"><h2>पृष्ठ ${devanagari(page.number)}</h2>${page.articles.map((item) => articleTranscript(item, page.number)).join('')}</section>`).join('');

  return `<!doctype html>
<html lang="mr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#a90d27">
<meta name="description" content="${escapeHtml(title)}. ${escapeHtml(meta.volumeLine)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:image" content="${escapeHtml(cover)}">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/epaper.css">
</head>
<body class="epaper-reader">
<header class="reader-header">
  <a class="reader-brand" href="/epaper"><img src="${LOGO_URL}" alt="${escapeHtml(meta.title)}"></a>
  <div class="reader-meta"><strong>${escapeHtml(when)}</strong><span>${escapeHtml(meta.district)} · ${escapeHtml(meta.volumeLine)}</span></div>
  <div class="reader-downloads">
    <a href="/epaper" class="reader-archive-link">All editions</a>
    ${meta.pdfUrl ? `<a class="reader-pdf" href="${escapeHtml(meta.pdfUrl)}" download>${icon('download')}<span>Whole newspaper PDF</span></a>` : ''}
  </div>
</header>
<nav class="page-navigation" aria-label="Newspaper pages"><button type="button" class="page-step" data-page-prev aria-label="Previous page">‹</button><div class="page-numbers">${pageButtons}</div><button type="button" class="page-step" data-page-next aria-label="Next page">›</button></nav>
<main>
  <div class="epaper-stage" data-page-stage tabindex="0" aria-live="polite">${pages.map(pageViewer).join('')}</div>
  <p class="reader-tip">Tap a news block to open its clear PNG card. Swipe left or right to change page.</p>
  <section class="epaper-transcript" aria-label="Readable edition text"><div class="transcript-intro"><h2>Stories in this edition</h2><p>The full searchable text remains available below the printed pages.</p></div>${transcript}</section>
</main>
<div class="epaper-toast" role="status" aria-live="polite" hidden></div>
<script src="/epaper-reader.js" defer></script>
</body>
</html>`;
}

function renderArchiveHtml(editions) {
  const cards = editions.map((item) => `<article class="archive-card" data-archive-card data-search="${escapeHtml(`${item.name} ${item.district} ${item.date}`.toLowerCase())}">
    <a class="archive-cover" href="${item.readerUrl}"><img src="${escapeHtml(item.coverUrl)}" alt="${escapeHtml(item.name)} ${escapeHtml(item.date)} cover" loading="lazy"></a>
    <div class="archive-card-copy"><p class="archive-date">${escapeHtml(item.date)}</p><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(item.district || 'सातारा')} · ${devanagari(item.pageCount)} pages</p><div class="archive-actions"><a href="${item.readerUrl}">Read edition</a>${item.pdfUrl ? `<a href="${escapeHtml(item.pdfUrl)}" download>Download PDF</a>` : ''}</div></div>
  </article>`).join('');
  return `<!doctype html><html lang="mr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#a90d27"><title>दैनिक साहस वार्ता — E-paper</title><link rel="stylesheet" href="/epaper.css"></head><body class="epaper-archive"><header class="archive-header"><img src="${LOGO_URL}" alt="दैनिक साहस वार्ता"><div><h1>E-paper archive</h1><p>Published editions, newest update first</p></div></header><main class="archive-main"><label class="archive-search"><span>Find an edition</span><input type="search" placeholder="Search date, district or newspaper…" data-archive-search></label><p class="archive-empty" data-archive-empty ${editions.length ? 'hidden' : ''}>No published editions yet.</p><section class="archive-grid">${cards}</section></main><script src="/epaper-reader.js" defer></script></body></html>`;
}

module.exports = {
  PUBLIC_DIR, EPAPER_DIR, LOGO_URL,
  editionDirectory, manifestPath,
  buildEdition, buildCanvasEdition, readRelease, loadPublishedEdition, loadSelectedEdition,
  listReleasedEditions, selectReleasedEdition, selectAfterRelease,
  releasedAsset, publishedAsset, releasedPdf, publishedPdf,
  renderHtml, renderArchiveHtml,
};
