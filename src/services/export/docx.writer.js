// WORD, as the edition's COPY.
//
// WHY THIS IS NOT THE PAGE, deliberately. Word is a flow processor. It has no
// concept of a frame at 42.5 mm holding type that runs round a photograph
// inside it, and the only way to force a newspaper page into it is a document
// of absolutely-positioned text boxes - which opens as something nobody can
// edit, and being editable is the entire reason anyone asks for Word. A .docx
// that reproduces the layout badly is worth less than one that reproduces the
// copy well.
//
// So this is the manuscript: every block's headline, deck, byline and story,
// in page and block order, as styled paragraphs a sub-editor can work in and
// send to somebody who does not have this system. The page itself has three
// other exports, and all three are exact.
//
// The stored copy is read through the SAME rich-text reader the compositor
// uses, so a word the desk set bold or coloured on the page is bold and
// coloured here too - the marks are the story's, not the layout's.

const { buildZip } = require('../pressPackage.service');

const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');
const xml = (value) => String(value === undefined || value === null ? '' : value)
  .replace(CONTROL, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// Word measures type in HALF-points and page geometry in twentieths of a
// point ("twips"). Both conversions live here and nowhere else.
const halfPt = (pt) => Math.max(2, Math.round(Number(pt) * 2));
const twips = (mm) => Math.round(Number(mm) * 72 / 25.4 * 20);

const FONT = { serif: 'Noto Serif Devanagari', sans: 'Noto Sans Devanagari' };

/**
 * One run. `cs`/`rtl` matter: without w:cs Word applies the Latin font to
 * Devanagari and substitutes, and without w:szCs the size applies to the Latin
 * script only - the two mistakes that make an Indic .docx open at the wrong
 * size in the wrong face.
 */
function runXml(text, { family = 'serif', bold = false, italic = false, underline = false, sizePt = 11, ink = null } = {}) {
  if (!text) return '';
  const font = FONT[family === 'sans' ? 'sans' : 'serif'];
  const colour = ink ? String(ink).replace('#', '').toUpperCase() : null;
  return '<w:r><w:rPr>'
    + `<w:rFonts w:ascii="${xml(font)}" w:hAnsi="${xml(font)}" w:cs="${xml(font)}"/>`
    + (bold ? '<w:b/><w:bCs/>' : '')
    + (italic ? '<w:i/><w:iCs/>' : '')
    + (underline ? '<w:u w:val="single"/>' : '')
    + (colour ? `<w:color w:val="${colour}"/>` : '')
    + `<w:sz w:val="${halfPt(sizePt)}"/><w:szCs w:val="${halfPt(sizePt)}"/>`
    + '</w:rPr>'
    + `<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
}

const paragraphXml = (runs, { style = null, align = null, spaceBefore = 0 } = {}) =>
  '<w:p><w:pPr>'
  + (style ? `<w:pStyle w:val="${style}"/>` : '')
  + (align ? `<w:jc w:val="${align}"/>` : '')
  + (spaceBefore ? `<w:spacing w:before="${spaceBefore}"/>` : '')
  + '<w:bidi w:val="0"/></w:pPr>'
  + runs + '</w:p>';

const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

// -------------------------------------------------------------- the copy ---

async function buildDocx(newspaper, pages) {
  const [richText, plainTextModule, identityModule] = [
    await import('../../../public/editor/layout/rich-text.js'),
    require('../../layout/plain-text'),
    require('../../layout/identity'),
  ];
  const identity = identityModule.identityFor(newspaper.publication_date, pages.length);
  const date = String(newspaper.publication_date).slice(0, 10);
  const warnings = [];

  const body = [];
  body.push(paragraphXml(runXml(identity.title, { family: 'sans', bold: true, sizePt: 22 }), { align: 'center' }));
  body.push(paragraphXml(runXml(`${identity.titleEnglish || 'Dainik Sahas Varta'} — ${date}`,
    { family: 'sans', sizePt: 10 }), { align: 'center' }));

  pages.forEach((page, pageIndex) => {
    if (pageIndex > 0) body.push(pageBreak);
    body.push(paragraphXml(
      runXml(`पृष्ठ ${identityModule.devanagari(page.page_number)}`, { family: 'sans', bold: true, sizePt: 14 }),
      { style: 'Heading1', spaceBefore: 240 },
    ));

    for (const section of page.sections || []) {
      const headline = plainTextModule.strip(section.headline || '');
      const deck = plainTextModule.strip(section.subheading || '');
      const story = section.body || '';
      if (!headline && !deck && !story) continue;

      body.push(paragraphXml(
        runXml(section.section_key || 'block', { family: 'sans', sizePt: 8, ink: '#888888' }),
        { spaceBefore: 200 },
      ));
      if (headline) {
        body.push(paragraphXml(runXml(headline, { family: 'sans', bold: true, sizePt: 16 }), { style: 'Heading2' }));
      }
      if (deck) {
        body.push(paragraphXml(runXml(deck, { family: 'sans', sizePt: 12 })));
      }
      const byline = [section.reporter_name, section.location].filter(Boolean).join(' · ');
      if (byline) {
        body.push(paragraphXml(runXml(byline, { family: 'sans', italic: true, sizePt: 9, ink: '#666666' })));
      }

      // The story, paragraph by paragraph as the reporter typed them, with the
      // desk's own marks carried through the compositor's own reader.
      for (const block of String(story).split(/\n{2,}|<\/p>\s*<p>/)) {
        const { text, marks } = richText.textWithMarks(block);
        if (!text.trim()) continue;
        const runs = richText.styledRuns(text, 0, marks, 11).map((piece) => runXml(piece.text, {
          family: 'serif', bold: Boolean(piece.bold), italic: Boolean(piece.italic),
          underline: Boolean(piece.underline), sizePt: 11, ink: piece.colour || null,
        })).join('');
        body.push(paragraphXml(runs, { align: 'both' }));
      }

      for (const image of section.images || []) {
        const caption = plainTextModule.strip(image.caption || '');
        body.push(paragraphXml(
          runXml(`[ चित्र: ${image.url}${caption ? ` — ${caption}` : ''} ]`,
            { family: 'sans', sizePt: 9, ink: '#666666' }),
        ));
      }
    }
  });

  // The paper's own page size, so a desk printing the manuscript gets
  // something the right shape rather than US Letter.
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body.join('\n    ')}
    <w:sectPr>
      <w:pgSz w:w="${twips(newspaper.page_width_px / 2)}" w:h="${twips(newspaper.page_height_px / 2)}"/>
      <w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const entries = [
    {
      name: '[Content_Types].xml',
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`, 'utf8'),
      deflate: true,
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`, 'utf8'),
      deflate: true,
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`, 'utf8'),
      deflate: true,
    },
    {
      name: 'word/styles.xml',
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr>
    <w:rFonts w:ascii="${xml(FONT.serif)}" w:hAnsi="${xml(FONT.serif)}" w:cs="${xml(FONT.serif)}"/>
    <w:sz w:val="22"/><w:szCs w:val="22"/>
  </w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
</w:styles>`, 'utf8'),
      deflate: true,
    },
    { name: 'word/document.xml', data: Buffer.from(document, 'utf8'), deflate: true },
  ];

  warnings.push('Word carries the edition’s COPY, not its layout — use the PDF, InDesign or Scribus export for the page.');
  return { docx: buildZip(entries, date), warnings };
}

module.exports = { buildDocx, halfPt, twips };
