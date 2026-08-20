// Turns the accepted press PDF into one immutable public e-paper snapshot.
//
// The final PDF is the visual authority: rasterising that artifact means the
// public page is the page the press received, not a second HTML approximation.
// The live database supplies only the already-known story rectangles and
// readable text. Story cards are high-resolution crops with the real SAHAS
// nameplate composed above them, so sharing never depends on a phone taking a
// blurry screenshot.

const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const newspaperRepository = require('../repositories/newspaper.repository');
const publicationRepository = require('../repositories/publication.repository');
const pressReadiness = require('./pressReadiness.service');
const epaper = require('./epaper.service');

const execFileAsync = promisify(execFile);
const RASTER_DPI = 180;
const CARD_WIDTH = 1080;
const CARD_PADDING = 36;
const CARD_HEADER = 246;
const CARD_MAX_CROP_HEIGHT = 2300;
const CURRENT_RENDER_SCALE = 2;

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function failure(code, error, extra = {}) {
  return { ok: false, code, error, ...extra };
}

function publicFile(storagePath) {
  const value = String(storagePath || '');
  if (!value.startsWith('/uploads/')) return null;
  const resolved = path.resolve(epaper.PUBLIC_DIR, `.${value}`);
  const uploads = path.resolve(epaper.PUBLIC_DIR, 'uploads') + path.sep;
  return resolved.startsWith(uploads) ? resolved : null;
}

async function latestPdf(newspaperId) {
  const files = await publicationRepository.latestByNewspaper(newspaperId);
  return files.find((file) => file.file_type === 'print_pdf')?.storage_path || null;
}

async function rasterizePdf(pdfPath, outputPrefix, { run = execFileAsync } = {}) {
  await run(process.env.PDFTOPPM_BIN || '/usr/bin/pdftoppm', [
    '-png', '-cropbox', '-r', String(RASTER_DPI), pdfPath, outputPrefix,
  ], { timeout: 180000, maxBuffer: 1024 * 1024 });
}

async function numberedPageFiles(directory) {
  const files = await fs.readdir(directory);
  return files
    .map((name) => ({ name, match: /^page-(\d+)\.png$/i.exec(name) }))
    .filter((item) => item.match)
    .map((item) => ({ number: Number(item.match[1]), path: path.join(directory, item.name), name: item.name }))
    .sort((a, b) => a.number - b.number);
}

function cropBox(bitmap, hotspot = {}) {
  const left = Math.max(0, Math.floor((Number(hotspot.leftPct) || 0) * bitmap.width / 100));
  const top = Math.max(0, Math.floor((Number(hotspot.topPct) || 0) * bitmap.height / 100));
  const right = Math.min(bitmap.width, Math.ceil(((Number(hotspot.leftPct) || 0) + (Number(hotspot.widthPct) || 0)) * bitmap.width / 100));
  const bottom = Math.min(bitmap.height, Math.ceil(((Number(hotspot.topPct) || 0) + (Number(hotspot.heightPct) || 0)) * bitmap.height / 100));
  return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
}

async function storyCard(pageImage, nameplate, article, outputPath) {
  const { Jimp } = await import('jimp');
  const box = cropBox(pageImage.bitmap, article.hotspot);
  const crop = pageImage.clone().crop(box);
  const contentWidth = CARD_WIDTH - CARD_PADDING * 2;
  const scale = Math.min(contentWidth / crop.bitmap.width, CARD_MAX_CROP_HEIGHT / crop.bitmap.height);
  crop.resize({
    w: Math.max(1, Math.round(crop.bitmap.width * scale)),
    h: Math.max(1, Math.round(crop.bitmap.height * scale)),
  });

  const logo = nameplate.clone().resize({ w: contentWidth });
  const footerHeight = 34;
  const canvas = new Jimp({
    width: CARD_WIDTH,
    height: CARD_HEADER + crop.bitmap.height + CARD_PADDING + footerHeight,
    color: 0xffffffff,
  });
  canvas.composite(logo, CARD_PADDING, Math.round((CARD_HEADER - logo.bitmap.height) / 2) - 6);

  // One confident newspaper-red rule, not the many coloured bars in the
  // reference screenshot. It separates identity from the actual printed crop
  // without competing with the headline inside that crop.
  const rule = new Jimp({ width: contentWidth, height: 8, color: 0xc8102eff });
  canvas.composite(rule, CARD_PADDING, CARD_HEADER - 12);
  canvas.composite(crop, Math.round((CARD_WIDTH - crop.bitmap.width) / 2), CARD_HEADER);
  const footer = new Jimp({ width: CARD_WIDTH, height: footerHeight, color: 0xc8102eff });
  canvas.composite(footer, 0, canvas.bitmap.height - footerHeight);
  await canvas.write(outputPath);
}

async function enrichSnapshot(snapshot, pageFiles, tempDir, { makeStoryCard = storyCard } = {}) {
  const { Jimp } = await import('jimp');
  const nameplate = await Jimp.read(path.join(epaper.PUBLIC_DIR, epaper.LOGO_URL));
  const byNumber = new Map(pageFiles.map((page) => [page.number, page]));

  for (const page of snapshot.pages) {
    const raster = byNumber.get(Number(page.number));
    if (!raster) continue;
    const pageImage = await Jimp.read(raster.path);
    page.imageUrl = `/uploads/epaper/${snapshot.edition.id}/${raster.name}`;
    page.imageWidth = pageImage.bitmap.width;
    page.imageHeight = pageImage.bitmap.height;

    for (const article of page.articles) {
      const name = `story-${page.number}-${article.id}.png`;
      await makeStoryCard(pageImage, nameplate, article, path.join(tempDir, name));
      article.shareImageUrl = `/uploads/epaper/${snapshot.edition.id}/${name}`;
    }
  }
  return snapshot;
}

async function replaceDirectory(tempDir, finalDir) {
  const backup = `${finalDir}.previous-${crypto.randomUUID()}`;
  let hadPrevious = false;
  try {
    await fs.rename(finalDir, backup);
    hadPrevious = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await fs.rename(tempDir, finalDir);
  } catch (error) {
    if (hadPrevious) await fs.rename(backup, finalDir).catch(() => {});
    throw error;
  }
  if (hadPrevious) await fs.rm(backup, { recursive: true, force: true });
}

function currentPageHtml(snapshot, page, logoDataUrl) {
  const width = Number(page.width) || 660;
  const height = Number(page.height) || 1060;
  const articles = (page.articles || []).map((item) => {
    const h = item.hotspot || {};
    const picture = item.pictures?.[0]?.url
      ? `<img class="current-picture" src="${escapeHtml(item.pictures[0].url)}" alt="">` : '';
    return `<article class="current-story" style="left:${Number(h.leftPct) || 0}%;top:${Number(h.topPct) || 0}%;width:${Number(h.widthPct) || 0}%;height:${Number(h.heightPct) || 0}%;--headline:${Math.max(9, Number(item.headlineFontPx) || 18)}px;--deck:${Math.max(7, Number(item.subheadingFontPx) || 13)}px;--body:${Math.max(6, Number(item.bodyFontPx) || 8)}px;--leading:${Math.max(1.2, Number(item.lineHeight) || 1.45)};--columns:${Math.max(1, Number(item.columnCount) || 1)};text-align:${['left','center','right','justify'].includes(item.bodyAlign) ? item.bodyAlign : 'justify'}">
      ${item.kicker ? `<p class="current-kicker">${escapeHtml(item.kicker)}</p>` : ''}
      ${item.headline ? `<h1 style="text-align:${escapeHtml(item.headlineAlign || 'left')}">${escapeHtml(item.headline)}</h1>` : ''}
      ${item.subheading ? `<p class="current-deck" style="text-align:${escapeHtml(item.subheadingAlign || 'left')}">${escapeHtml(item.subheading)}</p>` : ''}
      ${picture}<div class="current-body">${escapeHtml(item.body || '')}</div>
    </article>`;
  }).join('');
  return `<!doctype html><html lang="mr"><meta charset="utf-8"><style>
    @font-face{font-family:SahasDeva;src:url(file://${path.join(epaper.PUBLIC_DIR, 'assets', 'fonts', 'NotoSerifDevanagari-Regular.ttf')}) format('truetype');font-weight:400;}@font-face{font-family:SahasDeva;src:url(file://${path.join(epaper.PUBLIC_DIR, 'assets', 'fonts', 'NotoSerifDevanagari-Bold.ttf')}) format('truetype');font-weight:700;}
    *{box-sizing:border-box}html,body{margin:0;width:${width}px;height:${height}px;background:#fff;color:#171414}body{font-family:SahasDeva,serif}.current-page{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:white}.current-masthead{position:absolute;z-index:2;top:8px;left:20px;width:calc(100% - 40px);height:70px;object-fit:contain;border-bottom:2px solid #c8102e}.current-story{position:absolute;overflow:hidden;padding:3px 4px;border-top:1px solid #302c2b;background:#fff}.current-story h1{margin:0 0 2px;font:700 var(--headline)/1.12 SahasDeva,serif}.current-kicker{margin:0 0 2px;color:#a90d27;font:700 max(7px,calc(var(--headline)*.42))/1.1 SahasDeva,serif}.current-deck{margin:0 0 3px;color:#494342;font:var(--deck)/1.25 SahasDeva,serif}.current-picture{display:block;float:right;max-width:48%;max-height:45%;margin:0 0 3px 5px;object-fit:cover}.current-body{white-space:pre-wrap;column-count:var(--columns);column-gap:8px;font:var(--body)/var(--leading) SahasDeva,serif;overflow:hidden}.current-story:has(.current-body:empty){display:none}
  </style><body><main class="current-page"><img class="current-masthead" src="${logoDataUrl}" alt="">${articles}</main></body></html>`;
}

async function embeddedUploadUrl(url) {
  const file = publicFile(url);
  if (!file) return '';
  try {
    const extension = path.extname(file).slice(1).toLowerCase();
    const mime = ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })[extension];
    if (!mime) return '';
    return `data:${mime};base64,${(await fs.readFile(file)).toString('base64')}`;
  } catch {
    return '';
  }
}

async function pageWithEmbeddedPictures(page) {
  return {
    ...page,
    articles: await Promise.all((page.articles || []).map(async (article) => ({
      ...article,
      pictures: await Promise.all((article.pictures || []).map(async (picture) => ({
        ...picture,
        url: await embeddedUploadUrl(picture.url),
      }))),
    }))),
  };
}

async function renderCurrentPages(snapshot, outputDir, { run = execFileAsync, chromeBin = process.env.EPAPER_CHROME_BIN || '/usr/bin/google-chrome' } = {}) {
  const logo = await fs.readFile(path.join(epaper.PUBLIC_DIR, epaper.LOGO_URL));
  const logoDataUrl = `data:image/png;base64,${logo.toString('base64')}`;
  const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sahas-epaper-current-'));
  try {
    for (const page of snapshot.pages) {
      const width = Number(page.width) || 660;
      const height = Number(page.height) || 1060;
      const htmlPath = path.join(sourceDir, `page-${page.number}.html`);
      const outputPath = path.join(outputDir, `page-${page.number}.png`);
      await fs.writeFile(htmlPath, currentPageHtml(snapshot, await pageWithEmbeddedPictures(page), logoDataUrl), 'utf8');
      await run(chromeBin, [
        '--headless=new', '--no-sandbox', '--disable-gpu',
        `--force-device-scale-factor=${CURRENT_RENDER_SCALE}`,
        `--screenshot=${outputPath}`, `--window-size=${width},${height}`,
        `file://${htmlPath}`,
      ], { timeout: 90000, maxBuffer: 1024 * 1024 });
    }
  } finally {
    await fs.rm(sourceDir, { recursive: true, force: true });
  }
}

async function finishRelease(snapshot, paper, tempDir, options = {}) {
  const pageFiles = await numberedPageFiles(tempDir);
  if (pageFiles.length !== snapshot.pages.length) {
    return failure('EPAPER_PAGE_COUNT_MISMATCH', `The generated e-paper has ${pageFiles.length} pages but this edition has ${snapshot.pages.length}.`);
  }
  snapshot.edition = {
    ...snapshot.edition,
    source: options.source || 'press_pdf',
    status: paper.status,
    publishedAt: new Date().toISOString(),
    pdfUrl: options.pdfUrl || '',
    readerUrl: '/epaper',
  };
  await enrichSnapshot(snapshot, pageFiles, tempDir, options);
  await fs.writeFile(path.join(tempDir, 'manifest.json'), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  await replaceDirectory(tempDir, epaper.editionDirectory(paper.id));
  const selected = await epaper.selectAfterRelease(paper.id, { ...paper, epaper_source: snapshot.edition.source });
  snapshot.edition.selected = Boolean(selected.epaper_selected);
  return { ok: true, edition: snapshot.edition, pages: snapshot.pages.length, stories: snapshot.pages.reduce((n, page) => n + page.articles.length, 0), selected: Boolean(selected.epaper_selected) };
}

async function publishEdition(newspaperId, actor, options = {}) {
  const id = Number(newspaperId);
  const paper = await newspaperRepository.findById(id);
  if (!paper) return failure('EPAPER_NOT_FOUND', 'No such edition.');

  const readiness = await pressReadiness.assessEdition(id);
  if (!readiness?.readyForPress) {
    return failure('PRESS_NOT_READY', 'Clear review and page-signoff blockers before publishing.', { readiness });
  }

  const pdfUrl = await latestPdf(id);
  const pdfPath = publicFile(pdfUrl);
  if (!pdfPath) return failure('EPAPER_PDF_REQUIRED', 'Upload the final print PDF before publishing the e-paper.');
  try { await fs.access(pdfPath); }
  catch { return failure('EPAPER_PDF_MISSING', 'The saved final PDF cannot be found. Upload it again.'); }

  const snapshot = await epaper.buildEdition(id);
  if (!snapshot) return failure('EPAPER_NOT_FOUND', 'No such edition.');

  await fs.mkdir(epaper.EPAPER_DIR, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(epaper.EPAPER_DIR, `.publishing-${id}-`));
  try {
    const rasterize = options.rasterize || rasterizePdf;
    await rasterize(pdfPath, path.join(tempDir, 'page'), options);
    const pageFiles = await numberedPageFiles(tempDir);
    if (pageFiles.length !== snapshot.pages.length) {
      return failure(
        'EPAPER_PAGE_COUNT_MISMATCH',
        `The final PDF has ${pageFiles.length} pages but this edition has ${snapshot.pages.length}.`,
      );
    }

    return await finishRelease(snapshot, paper, tempDir, { ...options, source: 'press_pdf', pdfUrl: `/epaper/${id}/pdf` });
  } catch (error) {
    return failure('EPAPER_BUILD_FAILED', `The e-paper could not be built: ${error.message}`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function publishCurrentEdition(newspaperId, actor, options = {}) {
  const id = Number(newspaperId);
  const paper = await newspaperRepository.findById(id);
  if (!paper) return failure('EPAPER_NOT_FOUND', 'No such edition.');
  const snapshot = await epaper.buildEdition(id);
  if (!snapshot?.pages?.length) return failure('EPAPER_CURRENT_EMPTY', 'This edition has no pages to publish.');

  await fs.mkdir(epaper.EPAPER_DIR, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(epaper.EPAPER_DIR, `.publishing-current-${id}-`));
  try {
    await (options.renderCurrentPages || renderCurrentPages)(snapshot, tempDir, options);
    return await finishRelease(snapshot, paper, tempDir, { ...options, source: 'editor_snapshot', pdfUrl: '' });
  } catch (error) {
    const unavailable = error.code === 'ENOENT' || /google-chrome|chrome/i.test(error.message || '');
    return failure(
      unavailable ? 'CURRENT_EPAPER_RENDERER_UNAVAILABLE' : 'EPAPER_CURRENT_BUILD_FAILED',
      unavailable ? 'Current e-paper publishing needs Google Chrome on this server. Set EPAPER_CHROME_BIN if it is installed elsewhere.' : `The current e-paper could not be built: ${error.message}`,
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function unpublishEdition(newspaperId) {
  const id = Number(newspaperId);
  const paper = await newspaperRepository.findById(id);
  if (!paper) return failure('EPAPER_NOT_FOUND', 'No such edition.');
  // Hide first. If derivative cleanup fails, no anonymous route can reach it.
  await newspaperRepository.clearEpaperRelease(id);
  await fs.rm(epaper.editionDirectory(id), { recursive: true, force: true });
  return { ok: true, id };
}

module.exports = {
  RASTER_DPI,
  publicFile, cropBox, rasterizePdf, numberedPageFiles, storyCard, enrichSnapshot,
  currentPageHtml, renderCurrentPages, publishEdition, publishCurrentEdition, unpublishEdition,
};
