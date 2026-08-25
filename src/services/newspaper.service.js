const newspaperRepository = require('../repositories/newspaper.repository');
const publicationRepository = require('../repositories/publication.repository');
const { identity } = require('../layout/identity');
const { TYPEFACES } = require('../../public/editor/layout/typefaces');
const pressReadiness = require('./pressReadiness.service');

function withPublicationFiles(newspaper, files) {
  return files.reduce((result, file) => {
    if (file.file_type === 'scribus_project') result.scribusFile = file.storage_path;
    if (file.file_type === 'print_pdf') result.printPdf = file.storage_path;
    return result;
  }, { ...newspaper });
}

// Today, where the paper is printed.
//
// `new Date().toISOString()` is UTC, and India is five and a half hours ahead
// of it: between midnight and half past five every morning - which is exactly
// when a daily paper is being made up - UTC is still on yesterday. An edition
// created at 3 a.m. for that morning's paper was being dated the day before.
//
// The date on page one is the edition's identity and the key its archive is
// indexed by, so it is worked out in the paper's own timezone.
function todayWhereWePrint() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: identity.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function createNewspaper(body, sessionUser) {
  // `publicationDate` is what every caller in this application sends - the
  // workspace, the tests and the API docs. This used to read only `body.date`,
  // so the date the caller asked for was silently dropped and every edition was
  // dated today. Both spellings are accepted now; neither is ignored.
  const requested = body.publicationDate || body.date;
  return newspaperRepository.create({
    name: body.name || 'साहस',
    publicationDate: requested || todayWhereWePrint(),
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
  });
  if (!result) return { notFound: true };
  return result;
}

module.exports = {
  setHouseStyle,
  createNewspaper,
  listNewspapers,
  getLatestNewspaper,
  getNewspaper,
  updateNewspaper,
  saveFinalFiles,
};
