const fsp = require('fs/promises');
const newspaperRepository = require('../repositories/newspaper.repository');
const { publicationDateFrom } = require('./publicationDate');
const publicationRepository = require('../repositories/publication.repository');
const { identity } = require('../layout/identity');
const { TYPEFACES } = require('../../public/editor/layout/typefaces');
const pressReadiness = require('./pressReadiness.service');
// Deleting an edition has to take its FILES with it, and both of these already
// know where those live. Neither requires this module back, so there is no
// cycle - checked rather than assumed.
const epaper = require('./epaper.service');
const epaperPublication = require('./epaperPublication.service');

function withPublicationFiles(newspaper, files) {
  return files.reduce((result, file) => {
    if (file.file_type === 'scribus_project') result.scribusFile = file.storage_path;
    if (file.file_type === 'print_pdf') result.printPdf = file.storage_path;
    return result;
  }, { ...newspaper });
}

// The date this edition carries is worked out and checked in one place, by
// `src/services/publicationDate.js`. This service used to keep its own copy of
// `todayWhereWePrint()` and `editionStart.service.js` kept a second - the same
// function twice, both of them there because `new Date().toISOString()` is UTC
// and India is five and a half hours ahead, so between midnight and half past
// five (exactly when a daily paper is made up) UTC is still on yesterday.
// One copy now, beside the validation that belongs with it.

async function createNewspaper(body, sessionUser) {
  // `publicationDate` is what every caller in this application sends - the
  // workspace, the tests and the API docs. This used to read only `body.date`,
  // so the date the caller asked for was silently dropped and every edition was
  // dated today. Both spellings are accepted now; neither is ignored.
  //
  // The date is CHECKED, not merely read. It used to be passed through
  // untouched, so "2099-13-45" or an object reached PostgreSQL and answered
  // `invalid input syntax for type date` - reported to the desk as a 500 for
  // a date it had typed.
  const { date, error } = publicationDateFrom(body);
  if (error) return { error };

  return newspaperRepository.create({
    name: body.name || 'साहस',
    publicationDate: date,
    createdBy: sessionUser?.id || null,
  });
}

async function listNewspapers() {
  return newspaperRepository.findAll();
}

async function getLatestNewspaper() {
  const newspapers = await newspaperRepository.findAll();
  return newspapers[0] || null;
}

async function getNewspaper(id) {
  const newspaper = await newspaperRepository.findById(parseInt(id, 10));
  if (!newspaper) return null;
  const files = await publicationRepository.latestByNewspaper(newspaper.id);
  return withPublicationFiles(newspaper, files);
}

async function updateNewspaper(id, updates) {
  return newspaperRepository.update(parseInt(id, 10), updates);
}

async function saveFinalFiles(id, files, sessionUser) {
  const scribusFile = files.scribusFile?.[0];
  const printPdf = files.printPdf?.[0];

  if (!scribusFile && !printPdf) {
    return { error: 'Choose a Scribus .sla file or final PDF' };
  }

  const newspaperId = parseInt(id, 10);
  const readiness = await pressReadiness.assessEdition(newspaperId);
  if (readiness && !readiness.readyForPress) return { error: 'PRESS_NOT_READY', code: 'PRESS_NOT_READY', readiness };
  const newspaper = await newspaperRepository.findById(newspaperId);
  if (!newspaper) return { notFound: true };

  const response = { ...newspaper };

  if (scribusFile) {
    const file = await publicationRepository.save(
      newspaperId,
      'scribus_project',
      `/uploads/${scribusFile.filename}`,
      sessionUser?.id,
    );
    response.scribusFile = file.storage_path;
  }

  if (printPdf) {
    const file = await publicationRepository.save(
      newspaperId,
      'print_pdf',
      `/uploads/${printPdf.filename}`,
      sessionUser?.id,
    );
    response.printPdf = file.storage_path;
    response.status = 'finalised';
    await newspaperRepository.update(newspaperId, { status: 'finalised' });
  }

  return { item: response };
}

/**
 * Set the paper's own type and whether it rules its gutters.
 *
 * The two faces are checked against the ONE typeface catalogue, the same way a
 * block's are - a family that is not in typefaces.js has no metrics file, so
 * the compositor would measure it as the serif and the press writer could not
 * embed it at all.
 */
/**
 * DELETING AN EDITION.
 *
 * This did not exist, and the absence showed: this newsroom's own database
 * reached 221 editions across 13 dates, most of them empty starts and test
 * fixtures, and the only way to be rid of one was SQL. A desk cannot be asked
 * to open psql to tidy up after a mis-typed date.
 *
 * It is a hard delete, deliberately. There is no `archived` column and adding
 * one would put a filter on every list query in the product for a state
 * nothing else understands - and a "deleted" edition that still occupies its
 * date would go on blocking `POST /start`, which is idempotent per date, so
 * the desk could neither see it nor replace it. The protection is at the
 * front instead: one thing that can refuse, and a confirmation that names
 * what is about to go.
 *
 * ONE REFUSAL, AND IT IS ABOUT THE READER, NOT THE DESK. An edition with a
 * public e-paper release is a promise already made to whoever has the link;
 * the desk removes the public copy first (that route exists and says so in
 * those words), and then the edition. Everything else - a draft, a finished
 * paper, a paper that went to press - is the desk's own to remove, because a
 * newspaper's archive is the desk's to keep and theirs to prune.
 */
async function deleteNewspaper(id) {
  const summary = await newspaperRepository.contentSummary(id);
  if (!summary) return { notFound: true };

  if (summary.epaper_released_at) {
    return {
      error: 'This edition is published as an e-paper. Remove the public copy first, then delete it.',
      code: 'EPAPER_RELEASED',
      status: 409,
      summary,
    };
  }

  // The rows cascade; the FILES do not. A press PDF, a Scribus project and any
  // e-paper derivative left on disk after the row is gone are unreachable
  // bytes nobody can ever account for, so they go first - and if that fails,
  // the edition stays, because an edition with orphaned files is recoverable
  // and orphaned files with no edition are not.
  const files = await publicationRepository.latestByNewspaper(id);
  for (const file of files) {
    const onDisk = epaperPublication.publicFile(file.storage_path);
    if (onDisk) await fsp.rm(onDisk, { force: true }).catch(() => {});
  }
  await fsp.rm(epaper.editionDirectory(id), { recursive: true, force: true }).catch(() => {});

  const removed = await newspaperRepository.remove(id);
  if (!removed) return { notFound: true };
  return { ok: true, id: Number(id), removed: summary };
}

async function setHouseStyle(id, body = {}) {
  const known = (value) => TYPEFACES.some((face) => face.key === value);
  const named = (key) => {
    const value = body[key];
    if (value === undefined || value === null || String(value).trim() === '') return null;
    return String(value);
  };
  const bodyFamily = named('bodyFamily');
  const displayFamily = named('displayFamily');
  const bad = [bodyFamily, displayFamily].find((value) => value && !known(value));
  if (bad) return { error: `The face must be one of ${TYPEFACES.map((f) => f.key).join(', ')}.` };
  // A text face for the story and a display face for the headline are separate
  // decisions (schema.sql, and compose.js's DISPLAY_TYPOGRAPHY), but either
  // slot may legally hold either face - a paper set entirely in one family is
  // a real house style, so this checks that the face EXISTS, not what it is
  // nominally for.
  const result = await newspaperRepository.setHouseStyle(parseInt(id, 10), {
    bodyFamily, displayFamily,
    columnRules: typeof body.columnRules === 'boolean' ? body.columnRules : undefined,
    // Only ever true because a desk was told how many blocks would be left
    // behind and said "every block" - never a default, and never inferred.
    applyToAll: body.applyToAll === true,
  });
  if (!result) return { notFound: true };
  return result;
}

module.exports = {
  deleteNewspaper,
  setHouseStyle,
  createNewspaper,
  listNewspapers,
  getLatestNewspaper,
  getNewspaper,
  updateNewspaper,
  saveFinalFiles,
};
