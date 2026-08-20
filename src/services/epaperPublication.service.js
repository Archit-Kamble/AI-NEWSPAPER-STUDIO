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
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const newspaperRepository = require('../repositories/newspaper.repository');
const publicationRepository = require('../repositories/publication.repository');
const pressReadiness = require('./pressReadiness.service');
const epaper = require('./epaper.service');
const canvasCapture = require('./epaperCanvasRender.service');

const execFileAsync = promisify(execFile);
const RASTER_DPI = 180;
const CARD_WIDTH = 1080;
const CARD_PADDING = 36;
const CARD_HEADER = 246;
const CARD_MAX_CROP_HEIGHT = 2300;
const CURRENT_RENDER_SCALE = 2;

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

async function latestEpaperPdf(newspaperId) {
  const files = await publicationRepository.latestByNewspaper(newspaperId);
  // An e-paper upload belongs to the web release and never claims to be the
  // accepted CMYK press artifact. A real press PDF remains a fallback for the
  // stricter production release route.
  return files.find((file) => file.file_type === 'epaper_pdf')?.storage_path
    || files.find((file) => file.file_type === 'print_pdf')?.storage_path
    || null;
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

async function renderCurrentPages(snapshot, outputDir, {
  run = execFileAsync,
  chromeBin = process.env.EPAPER_CHROME_BIN || '/usr/bin/google-chrome',
  canvasEdition,
  renderBaseUrl = process.env.EPAPER_RENDER_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`,
} = {}) {
  if (!canvasEdition?.newspaper || !canvasEdition?.pages) {
    throw new Error('The exact editor canvas was not available for this e-paper release.');
  }
  for (const snapshotPage of snapshot.pages) {
    const page = canvasEdition.pages.find((item) => Number(item.page_number) === Number(snapshotPage.number));
    if (!page) throw new Error(`Page ${snapshotPage.number} is missing from the current editor canvas.`);
    const width = Number(canvasEdition.newspaper.page_width_px) || 660;
    const height = Number(canvasEdition.newspaper.page_height_px) || 1060;
    const token = canvasCapture.createCanvasCapture(canvasEdition.newspaper, page, canvasEdition.pages.length);
    const url = `${String(renderBaseUrl).replace(/\/$/, '')}/_internal/epaper-canvas/${token}`;
    await run(chromeBin, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=4000', `--force-device-scale-factor=${CURRENT_RENDER_SCALE}`,
      `--screenshot=${path.join(outputDir, `page-${snapshotPage.number}.png`)}`,
      `--window-size=${width},${height}`, url,
    ], { timeout: 90000, maxBuffer: 1024 * 1024 });
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
  const canvasEdition = await epaper.buildCanvasEdition(id);
  if (!canvasEdition?.pages?.length) return failure('EPAPER_CURRENT_EMPTY', 'This edition has no pages to publish.');

  await fs.mkdir(epaper.EPAPER_DIR, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(epaper.EPAPER_DIR, `.publishing-current-${id}-`));
  try {
    await (options.renderCurrentPages || renderCurrentPages)(snapshot, tempDir, { ...options, canvasEdition });
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

// E-paper PDF publishing is intentionally independent of press readiness.
// A desk may receive an already-designed PDF for web publication while blocks
// are still empty or editorial sign-off is incomplete. The saved block frames
// remain the sole map for page links and share-image crops; no second,
// PDF-specific coordinate system is introduced here.
async function publishUploadedPdfEdition(newspaperId, uploadedFile, actor, options = {}) {
  const id = Number(newspaperId);
  const paper = await newspaperRepository.findById(id);
  if (!paper) return failure('EPAPER_NOT_FOUND', 'No such edition.');
  if (!uploadedFile?.filename) return failure('EPAPER_PDF_REQUIRED', 'Choose a PDF to publish.');

  const pdfUrl = `/uploads/${uploadedFile.filename}`;
  const pdfPath = publicFile(pdfUrl);
  if (!pdfPath) return failure('EPAPER_PDF_INVALID', 'The uploaded PDF could not be found.');
  let recorded = false;
  try {
    await fs.access(pdfPath);
    const snapshot = await epaper.buildEdition(id);
    if (!snapshot?.pages?.length) return failure('EPAPER_CURRENT_EMPTY', 'This edition has no pages to publish.');

    await fs.mkdir(epaper.EPAPER_DIR, { recursive: true });
    const tempDir = await fs.mkdtemp(path.join(epaper.EPAPER_DIR, `.publishing-pdf-${id}-`));
    try {
      const rasterize = options.rasterize || rasterizePdf;
      await rasterize(pdfPath, path.join(tempDir, 'page'), options);
      const pageFiles = await numberedPageFiles(tempDir);
      if (pageFiles.length !== snapshot.pages.length) {
        return failure(
          'EPAPER_PAGE_COUNT_MISMATCH',
          `The uploaded PDF has ${pageFiles.length} pages but this edition has ${snapshot.pages.length}.`,
        );
      }
      await publicationRepository.save(id, 'epaper_pdf', pdfUrl, actor?.id);
      recorded = true;
      return await finishRelease(snapshot, paper, tempDir, {
        ...options,
        source: 'uploaded_pdf',
        pdfUrl: `/epaper/${id}/pdf`,
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (error) {
    return failure('EPAPER_BUILD_FAILED', `The e-paper could not be built: ${error.message}`);
  } finally {
    // Multer has already written the temporary upload into public/uploads. If
    // it could not become a release record, remove it so failed page-count or
    // rasterisation attempts do not accumulate orphaned public files.
    if (!recorded) await fs.rm(pdfPath, { force: true }).catch(() => {});
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
  publicFile, latestEpaperPdf, cropBox, rasterizePdf, numberedPageFiles, storyCard, enrichSnapshot,
  renderCurrentPages, publishEdition, publishCurrentEdition, publishUploadedPdfEdition, unpublishEdition,
};
