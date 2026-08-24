// EVERY WAY THIS PAPER LEAVES THE BUILDING.
//
// Four destinations, one composition. `print-model.js` walks the edition
// exactly once and hands out a list of placed items; each writer here renders
// that list and decides nothing about where anything goes. A block that sits
// at 42.5 mm sits at 42.5 mm in all four, or one writer has a bug - there is
// no second layout engine anywhere in this folder to disagree with.
//
//   scribus  .sla   an editable Scribus project (src/services/scribus.service.js)
//   indesign .idml  an editable InDesign document
//   pdf      .pdf   the CMYK press file - the artifact a press actually takes
//   word     .docx  the COPY, as an editable manuscript, not the page
//
// WORD IS DELIBERATELY NOT THE PAGE. Word is a flow processor: it has no
// concept of a frame at 42.5 mm that type runs round a photograph inside. A
// .docx of absolutely-positioned text boxes can be made, and it opens as
// something nobody can edit - which defeats the only reason to want Word at
// all. So the Word export is the edition's COPY: every block's headline, deck,
// byline and story, in page and block order, as styled paragraphs. That is
// what a desk actually asks Word for - to send a story to somebody who does
// not have the system.

const path = require('path');
const { buildPrintModel, ensureComposeReady } = require('./print-model');

const FORMATS = {
  scribus: { extension: 'sla', type: 'application/vnd.scribus', label: 'Scribus project' },
  indesign: { extension: 'idml', type: 'application/vnd.adobe.indesign-idml-package', label: 'Adobe InDesign' },
  pdf: { extension: 'pdf', type: 'application/pdf', label: 'CMYK print PDF' },
  word: { extension: 'docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word document' },
};

/** The shaper and the metrics the compositor itself uses - never a second set. */
async function compositorDeps() {
  await ensureComposeReady();
  const [shaper, metrics] = await Promise.all([
    import('../../../public/editor/compose/shaper.js'),
    import('../../../public/editor/compose/font-metrics.js'),
  ]);
  return { shapeRun: shaper.shapeRun, faceMetrics: metrics.faceMetrics };
}

/**
 * One edition, in one format.
 *
 * @returns {{ body: Buffer, filename: string, type: string, warnings: string[],
 *             missingImages: string[] }}
 */
async function exportEdition(format, newspaper, pages) {
  const spec = FORMATS[format];
  if (!spec) {
    const error = new Error(`No such export format: ${format}`);
    error.code = 'UNKNOWN_EXPORT_FORMAT';
    throw error;
  }

  const date = String(newspaper.publication_date).slice(0, 10);
  const filename = `sahas-${date}.${spec.extension}`;

  if (format === 'scribus') {
    // The one destination that predates this folder, and it is left exactly
    // where it is: it is the tested press path, and rewriting it onto the
    // shared model would risk the file that actually goes to the plate for no
    // gain the desk can see. It already shares the Smart Card walk.
    const scribus = require('../scribus.service');
    const sla = await scribus.buildDocument(newspaper, pages);
    return { body: Buffer.from(sla, 'utf8'), filename, type: spec.type, warnings: [], missingImages: [] };
  }

  const model = await buildPrintModel(newspaper, pages);

  if (format === 'pdf') {
    const { buildPdf } = require('./pdf.writer');
    const { pdf, warnings, missingImages } = await buildPdf(model, await compositorDeps());
    return { body: pdf, filename, type: spec.type, warnings, missingImages };
  }

  if (format === 'indesign') {
    const { buildIdml } = require('./idml.writer');
    const { idml, warnings, missingImages } = await buildIdml(model);
    return { body: idml, filename, type: spec.type, warnings, missingImages };
  }

  const { buildDocx } = require('./docx.writer');
  const { docx, warnings } = await buildDocx(newspaper, pages);
  return { body: docx, filename, type: spec.type, warnings, missingImages: [] };
}

module.exports = { exportEdition, FORMATS, buildPrintModel };
