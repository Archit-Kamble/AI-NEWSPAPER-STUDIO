const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const preflight = require('./preflight.service');
const districtEditions = require('./districtEdition.service');
const { buildEditionContentManifest } = require('../layout/edition-content-manifest');

const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'public');
const ACTIVE_RUN_STATES = ['PREPARING', 'PREPARED', 'PERSISTING', 'VERIFYING', 'HUMAN_REQUIRED'];
const COUNTS = Object.freeze({ preflightErrors: 0, needsReview: 0, provenanceMissing: 0, imageSafetyErrors: 0, pagesNotPassed: 0, staleSignoffs: 0, missingAssets: 0, uncertainRuns: 0, publicationContentIncomplete: 0 });
const PRINT_FIELDS = ['news_item_id','story_type','editorial_priority','kicker','headline','subheading','body','caption','category','location','tags','reporter_name','language','status','ai_generated','image_url','headline_font_px','subheading_font_px','body_font_px','column_count','margin_px','line_height','editorial_presentation'];
const imageIdentity = (image) => [image.media_asset_id,image.source_news_item_id,image.url,image.x_px,image.y_px,image.width_px,image.height_px,image.crop_x_px,image.crop_y_px,image.crop_width_px,image.crop_height_px,image.rotation,image.flip_h,image.flip_v,image.shape,image.stand_off_px,image.caption];
function pageFingerprint(page) {
  const value = [page.id,page.page_number,page.template_key,page.prints_colour,(page.sections || []).map((section) => [section.section_key,section.x_px,section.y_px,section.width_px,section.height_px,section.block_type,...PRINT_FIELDS.map((field) => section[field] ?? null),(section.images || []).map(imageIdentity)])];
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function blocker(code, page, sectionKey, message) { return { code, page: Number(page) || null, sectionKey: sectionKey || null, message }; }
function countsOf(blockers) {
  const counts = { ...COUNTS };
  for (const item of blockers) {
    if (item.code.startsWith('PREFLIGHT_') || item.code === 'TEXT_OVERFLOW') counts.preflightErrors += 1;
    if (item.code === 'EDITORIAL_REVIEW_REQUIRED') counts.needsReview += 1;
    if (item.code.includes('PROVENANCE')) counts.provenanceMissing += 1;
    if (['IMAGE_TEXT_COLLISION','CAPTION_TEXT_COLLISION','CAPTION_OUTSIDE_SECTION'].includes(item.code)) counts.imageSafetyErrors += 1;
    if (item.code === 'PAGE_NOT_PASSED') counts.pagesNotPassed += 1;
    if (item.code === 'PAGE_SIGNOFF_STALE') counts.staleSignoffs += 1;
    if (item.code === 'PRESS_ASSET_MISSING') counts.missingAssets += 1;
    if (item.code === 'COMPOSITION_RUN_UNCERTAIN') counts.uncertainRuns += 1;
    if (['EDITORIAL_DEMAND_UNRESOLVED','IMAGE_COMPANION_ORPHAN','IMAGE_REQUIRED_MISSING','FEATURE_REQUIRED_MISSING','FEATURE_NEEDS_REVIEW','ADVERT_REQUIRED_MISSING','UTILITY_REQUIRED_MISSING','UTILITY_NEEDS_REVIEW','FRAME_PURPOSE_UNKNOWN','REQUIRED_FRAME_POLICY_MISSING'].includes(item.code)) counts.publicationContentIncomplete += 1;
  }
  return counts;
}
function printableEditorial(section) {
  return Boolean(section.ai_generated && !section.smart_card_key && !section.feature_key && !['feature','advert'].includes(String(section.block_type || '').toLowerCase()) && (section.headline || section.body || section.caption));
}
function localAsset(url) {
  const clean = String(url || '');
  if (!clean.startsWith('/uploads/') || clean.includes('..')) return null;
  const resolved = path.resolve(PUBLIC_DIR, `.${clean}`);
  return resolved.startsWith(path.join(PUBLIC_DIR, 'uploads') + path.sep) ? resolved : null;
}
const CONTENT_BLOCKER = Object.freeze({
  EDITORIAL_REQUIRED_MISSING: ['EDITORIAL_DEMAND_UNRESOLVED', 'A required editorial destination has no story content.'],
  IMAGE_REQUIRED_MISSING: ['IMAGE_REQUIRED_MISSING', 'A required story-package image companion is empty.'],
  IMAGE_COMPANION_ORPHAN: ['IMAGE_COMPANION_ORPHAN', 'An image companion has no canonical story-package owner.'],
  FEATURE_REQUIRED_MISSING: ['FEATURE_REQUIRED_MISSING', 'A required standing feature is missing or invalid.'],
  FEATURE_NEEDS_REVIEW: ['FEATURE_NEEDS_REVIEW', 'A generated standing feature needs explicit review.'],
  ADVERT_REQUIRED_MISSING: ['ADVERT_REQUIRED_MISSING', 'A required external advert slot is empty.'],
  UTILITY_REQUIRED_MISSING: ['UTILITY_REQUIRED_MISSING', 'A required utility block is missing or invalid.'],
  UTILITY_NEEDS_REVIEW: ['UTILITY_NEEDS_REVIEW', 'A generated utility block needs explicit review.'],
  FRAME_PURPOSE_UNKNOWN: ['FRAME_PURPOSE_UNKNOWN', 'A physical frame has no canonical publication owner.'],
  REQUIRED_FRAME_POLICY_MISSING: ['REQUIRED_FRAME_POLICY_MISSING', 'A physical frame lacks its publication requirement policy.'],
});
async function pageBlockers(page, newspaper, { requirePassed = true, checkUncertainRuns = true, contentFrames = null } = {}) {
  const blockers = [];
  const manifestFrames = contentFrames || buildEditionContentManifest([page]).frames;
  for (const frame of manifestFrames) {
    const mapped = CONTENT_BLOCKER[frame.contentState];
    if (mapped) blockers.push(blocker(mapped[0], frame.page, frame.sectionKey, mapped[1]));
  }
  const report = await preflight.validatePageLayout(page, newspaper);
  for (const finding of [...report.collisions, ...report.overflow].filter((item) => item.level === 'error')) blockers.push(blocker(finding.type || `PREFLIGHT_${String(finding.check).toUpperCase().replace(/-/g, '_')}`, page.page_number, finding.sectionKey, finding.message));
  for (const section of page.sections || []) {
    if (printableEditorial(section) && !['ready','published'].includes(section.status)) blockers.push(blocker('EDITORIAL_REVIEW_REQUIRED', page.page_number, section.section_key, 'Generated editorial copy needs explicit review.'));
    if (printableEditorial(section) && !section.news_item_id) blockers.push(blocker('STORY_PROVENANCE_MISSING', page.page_number, section.section_key, 'Generated newsroom copy is not linked to its source item.'));
    for (const image of section.images || []) {
      const file = localAsset(image.url);
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) blockers.push(blocker('PRESS_ASSET_MISSING', page.page_number, section.section_key, 'A placed photograph is not readable for press output.'));
      if (section.ai_generated && section.news_item_id && !image.source_news_item_id) blockers.push(blocker('IMAGE_PROVENANCE_MISSING', page.page_number, section.section_key, 'A composition-owned photograph lacks newsroom provenance.'));
    }
  }
  const currentFingerprint = pageFingerprint(page);
  if (requirePassed && page.production_state !== 'passed') blockers.push(blocker('PAGE_NOT_PASSED', page.page_number, null, 'Page has not been passed for press.'));
  if (requirePassed && page.production_state === 'passed' && page.signoff_fingerprint !== currentFingerprint) blockers.push(blocker('PAGE_SIGNOFF_STALE', page.page_number, null, 'Page changed after its last press signoff.'));
  if (checkUncertainRuns) {
    const { rows } = await pool.query('SELECT run_id, state FROM edition_composition_runs WHERE edition_id = $1 AND state = ANY($2::varchar[]) ORDER BY started_at, run_id', [page.newspaper_id, ACTIVE_RUN_STATES]);
    for (const run of rows) blockers.push(blocker('COMPOSITION_RUN_UNCERTAIN', page.page_number, null, `Composition run ${run.run_id} is ${run.state}.`));
  }
  return { pageId: page.id, pageNumber: page.page_number, fingerprint: currentFingerprint, blockers };
}
async function loadPage(pageId) {
  const { rows } = await pool.query('SELECT newspaper_id FROM pages WHERE id = $1', [pageId]);
  if (!rows[0]) return null;
  const pages = await districtEditions.pagesOf(rows[0].newspaper_id);
  const page = pages.find((item) => Number(item.id) === Number(pageId));
  const { rows: papers } = await pool.query('SELECT * FROM newspapers WHERE id = $1', [rows[0].newspaper_id]);
  return page && papers[0] ? { page, newspaper: papers[0] } : null;
}
async function assessPage(pageId, options = {}) {
  const loaded = await loadPage(pageId); if (!loaded) return null;
  const result = await pageBlockers(loaded.page, loaded.newspaper, options);
  const contentManifest = buildEditionContentManifest([loaded.page]);
  return { readyForPress: result.blockers.length === 0, blockers: result.blockers, counts: countsOf(result.blockers), editorialCompositionState: contentManifest.editorialCompositionState, publicationContentState: contentManifest.publicationContentState, contentManifest, ...result };
}
async function assessEdition(newspaperId) {
  const { rows: papers } = await pool.query('SELECT * FROM newspapers WHERE id = $1', [newspaperId]);
  if (!papers[0]) return null;
  const pages = await districtEditions.pagesOf(newspaperId);
  const contentManifest = buildEditionContentManifest(pages);
  const pageResults = [];
  for (const page of pages) pageResults.push(await pageBlockers(page, papers[0], { requirePassed: true, checkUncertainRuns: false, contentFrames: contentManifest.frames.filter((frame) => Number(frame.pageId) === Number(page.id)) }));
  const blockers = pageResults.flatMap((item) => item.blockers);
  const { rows: runs } = await pool.query('SELECT run_id, state FROM edition_composition_runs WHERE edition_id = $1 AND state = ANY($2::varchar[]) ORDER BY started_at, run_id', [newspaperId, ACTIVE_RUN_STATES]);
  for (const run of runs) blockers.push(blocker('COMPOSITION_RUN_UNCERTAIN', null, null, `Composition run ${run.run_id} is ${run.state}.`));
  blockers.sort((a, b) => (a.page ?? 999) - (b.page ?? 999) || String(a.sectionKey || '').localeCompare(String(b.sectionKey || '')) || a.code.localeCompare(b.code));
  const signoffTimes = pages.map((page) => page.state_changed_at && new Date(page.state_changed_at).getTime()).filter(Number.isFinite);
  const assessedAt = signoffTimes.length ? new Date(Math.max(...signoffTimes)).toISOString() : null;
  return { editionId: Number(newspaperId), assessedAt, editorialCompositionState: contentManifest.editorialCompositionState, publicationContentState: contentManifest.publicationContentState, readyForPress: blockers.length === 0, blockers, counts: countsOf(blockers), contentManifest, pages: pageResults };
}

module.exports = { assessPage, assessEdition, pageFingerprint, ACTIVE_RUN_STATES };
