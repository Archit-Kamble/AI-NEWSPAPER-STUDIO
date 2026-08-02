const newspaperRepository = require('../repositories/newspaper.repository');
const publicationRepository = require('../repositories/publication.repository');

function withPublicationFiles(newspaper, files) {
  return files.reduce((result, file) => {
    if (file.file_type === 'scribus_project') result.scribusFile = file.storage_path;
    if (file.file_type === 'print_pdf') result.printPdf = file.storage_path;
    return result;
  }, { ...newspaper });
}

async function createNewspaper(body, sessionUser) {
  const today = new Date().toISOString().split('T')[0];
  return newspaperRepository.create({
    name: body.name || 'साहस',
    publicationDate: body.date || today,
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

module.exports = {
  createNewspaper,
  listNewspapers,
  getLatestNewspaper,
  getNewspaper,
  updateNewspaper,
  saveFinalFiles,
};
