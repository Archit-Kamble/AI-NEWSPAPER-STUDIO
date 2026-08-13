// Getting the paper off the screen and onto the press.
//
// This was the hole in the middle of the system. SAHAS could lay a page out
// exactly, measure it, flow copy round a cut-out and tell you what the advert
// was worth - and then produce nothing a printer could use. The pipeline in
// CLAUDE.md ends "Workspace → Generate Scribus → Editor adjusts → Export CMYK
// PDF", and only the last step, uploading the finished file, existed.
//
// Scribus rather than a PDF written here, deliberately:
//
//   * The page designer has to be able to open it and nudge things. A PDF is
//     final; an .sla is the job, and Scribus is what a small Indian press room
//     already has.
//   * Scribus does CMYK separation, overprint and ICC properly. Re-implementing
//     that would be re-implementing a print engine.
//   * .sla is XML. Everything it needs - frames in millimetres, fonts, colours,
//     the text itself - is what the workspace already holds.
//
// Everything below is in MILLIMETRES. The editor works at 2 px/mm and CLAUDE.md
// forbids mixing the two silently, so px→mm happens once, here, at the boundary.

const { geometryOf, pxToMm } = require('../layout/geometry');
// A story is stored with the marks a printer can set; a text frame takes the
// text. Without this a page goes to press with "<b>" set in type.
const { strip } = require('../layout/plain-text');
const { identityFor, dateLine } = require('../layout/identity');
const { captionBox, PLACED_CAPTION_METRICS } = require('../../public/editor/layout/caption-geometry');

const escapeXml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const mm = (px) => Number(pxToMm(px).toFixed(4));
// Scribus works in points for type sizes. The editor's px are 2 per mm.
const pxToPt = (px) => Number(((Number(px) / 2) * 72 / 25.4).toFixed(2));

// The paper's inks, as separations rather than as screen colours. A newspaper
// is printed from four plates; naming the spot colours here is what lets the
// press see the red of the masthead as one ink and not as a rich black mess.
const COLOURS = `
  <COLOR NAME="Black" CMYK="#00000000" Spot="0" Register="0"/>
  <COLOR NAME="Registration" CMYK="#ffffffff" Spot="0" Register="1"/>
  <COLOR NAME="White" CMYK="#00000000" Spot="0" Register="0"/>
  <COLOR NAME="SahasRed" CMYK="#00ffe61a" Spot="0" Register="0"/>
  <COLOR NAME="None" CMYK="#00000000" Spot="0" Register="0"/>`;

// Type. Scribus needs a real family name that exists on the machine that opens
// the file; these are the ones the workspace itself sets and that ship with the
// application in public/assets/fonts.
const BODY_FONT = 'Noto Serif Devanagari Regular';
const HEAD_FONT = 'Noto Sans Devanagari Bold';

let frameId = 1;
const nextId = () => (frameId += 1);

// A Scribus text frame. PTYPE 4 is text; PTYPE 2 is an image.
function textFrame({ xMm, yMm, widthMm, heightMm, text, fontPt, font, colour = 'Black', align = 0, columns = 1, gapMm = 3 }) {
  if (!String(text || '').trim()) return '';
  const paragraphs = String(text)
    .split(/\n+/)
    .filter((line) => line.trim())
    .map(
      (line) =>
        `<ITEXT CH="${escapeXml(line)}" FONT="${escapeXml(font)}" FONTSIZE="${fontPt}" FCOLOR="None" TXTFILL="${colour}"/><para ALIGN="${align}"/>`,
    )
    .join('');

  return `
  <PAGEOBJECT XPOS="${xMm}" YPOS="${yMm}" WIDTH="${widthMm}" HEIGHT="${heightMm}"
              OwnPage="0" ItemID="${nextId()}" PTYPE="4" ANNAME="" FRTYPE="0"
              PWIDTH="0" PCOLOR="None" PCOLOR2="None" LOCALSCX="1" LOCALSCY="1"
              COLUMNS="${columns}" COLGAP="${gapMm}" TEXTFLOWMODE="1"
              EXTRA="1.5" TEXTRA="1.5" BEXTRA="1.5" REXTRA="1.5">${paragraphs}
  </PAGEOBJECT>`;
}

// An image frame. `PFILE` is a path the press box has to be able to resolve, so
// it is written relative to the .sla - the export ships the pictures beside it.
function imageFrame({ xMm, yMm, widthMm, heightMm, file, rotation = 0 }) {
  return `
  <PAGEOBJECT XPOS="${xMm}" YPOS="${yMm}" WIDTH="${widthMm}" HEIGHT="${heightMm}"
              ROT="${rotation}" OwnPage="0" ItemID="${nextId()}" PTYPE="2" FRTYPE="0"
              PWIDTH="0" PCOLOR="None" PCOLOR2="None"
              PFILE="${escapeXml(file)}" LOCALSCX="1" LOCALSCY="1" SCALETYPE="0" RATIO="1"
              TEXTFLOWMODE="2"/>`;
}

// Every block on a page becomes frames: a headline, a deck, the body, and one
// frame per placed picture. TEXTFLOWMODE="2" on the pictures is what makes
// Scribus run the copy round them the way the workspace already does.
function blockFrames(section, publicDir) {
  const xMm = mm(section.x_px);
  const yMm = mm(section.y_px);
  const widthMm = mm(section.width_px);
  const heightMm = mm(section.height_px);
  const padMm = mm(Number(section.margin_px) || 12);

  const innerX = xMm + padMm;
  const innerWidth = Math.max(1, widthMm - padMm * 2);
  let cursor = yMm + padMm;
  const parts = [];

  const advance = (h) => {
    const at = cursor;
    cursor += h;
    return at;
  };

  if (section.kicker) {
    const h = mm(Number(section.body_font_px) * 1.6);
    parts.push(textFrame({
      xMm: innerX, yMm: advance(h), widthMm: innerWidth, heightMm: h,
      text: strip(section.kicker), fontPt: pxToPt(section.body_font_px), font: HEAD_FONT,
    }));
  }

  if (section.headline) {
    // The painted word is marked with asterisks in the workspace. Scribus takes
    // a separate colour per run, so the marks come out and the whole headline is
    // set in the accent when the layout asked for it.
    const accented = strip(section.headline).includes('*') || section.headline_style === 'accent';
    const h = mm(Number(section.headline_font_px) * 2.6);
    parts.push(textFrame({
      xMm: innerX, yMm: advance(h), widthMm: innerWidth, heightMm: h,
      text: strip(section.headline).replace(/\*/g, ''),
      fontPt: pxToPt(section.headline_font_px), font: HEAD_FONT,
      colour: accented ? 'SahasRed' : 'Black',
    }));
  }

  if (section.subheading) {
    const h = mm(Number(section.subheading_font_px) * 2.4);
    parts.push(textFrame({
      xMm: innerX, yMm: advance(h), widthMm: innerWidth, heightMm: h,
      text: strip(section.subheading), fontPt: pxToPt(section.subheading_font_px), font: HEAD_FONT,
    }));
  }

  if (section.body) {
    const remaining = Math.max(4, yMm + heightMm - padMm - cursor);
    // The same measure rule the canvas uses: a wide block sets its copy in
    // several narrow columns rather than one unreadable line.
    const columns = Math.max(1, Math.min(4, Math.floor(innerWidth / 38)));
    const dateline = [section.location, section.reporter_name].filter(Boolean).join(', ');
    parts.push(textFrame({
      xMm: innerX, yMm: cursor, widthMm: innerWidth, heightMm: remaining,
      text: `${dateline ? `■ ${dateline} ` : ''}${strip(section.body)}`,
      fontPt: pxToPt(section.body_font_px), font: BODY_FONT,
      align: 3, // justified, as a newspaper sets body copy
      columns,
    }));
  }

  for (const image of section.images || []) {
    parts.push(imageFrame({
      xMm: xMm + mm(image.x_px),
      yMm: yMm + mm(image.y_px),
      widthMm: mm(image.width_px),
      heightMm: mm(image.height_px),
      rotation: Number(image.rotation) || 0,
      file: `.${image.url}`,
      publicDir,
    }));
    const caption = captionBox(image);
    if (caption) parts.push(textFrame({
      xMm: xMm + mm(caption.x),
      yMm: yMm + mm(caption.y),
      widthMm: mm(caption.width),
      heightMm: mm(caption.height),
      text: strip(image.caption),
      fontPt: pxToPt(PLACED_CAPTION_METRICS.fontPx),
      font: BODY_FONT,
    }));
  }

  return parts.filter(Boolean).join('');
}

/**
 * The whole edition as one Scribus document.
 *
 * One .sla with every page in it, rather than a file per page: the designer
 * opens the paper, not eight separate jobs, and Scribus's own page navigation
 * is what they already know.
 */
function buildDocument(newspaper, pages) {
  frameId = 1;
  const g = geometryOf(newspaper);
  const identity = identityFor(newspaper.publication_date, pages.length);
  const date = dateLine(newspaper.publication_date);

  const pageWidthMm = g.pageWidthMm;
  const pageHeightMm = g.pageHeightMm;
  const marginXMm = (pageWidthMm - g.matterWidthMm) / 2;
  const marginYMm = (pageHeightMm - g.matterHeightMm) / 2;

  const pageElements = pages
    .map(
      (page, index) => `
  <PAGE PAGEXPOS="0" PAGEYPOS="${index * (pageHeightMm + 20)}" PAGEWIDTH="${pageWidthMm}" PAGEHEIGHT="${pageHeightMm}"
        BORDERLEFT="${marginXMm}" BORDERRIGHT="${marginXMm}" BORDERTOP="${marginYMm}" BORDERBOTTOM="${marginYMm}"
        NUM="${index}" NAM="" MNAM="Normal" Size="Custom" Orientation="0"
        LEFT="0" PRESET="0" VerticalGuides="" HorizontalGuides=""/>`,
    )
    .join('');

  const objects = pages
    .map((page, index) => {
      const offset = index * (pageHeightMm + 20);
      return (page.sections || [])
        .map((section) => blockFrames(section).replace(/YPOS="([\d.]+)"/g, (_, y) => `YPOS="${(Number(y) + offset).toFixed(4)}"`))
        .join('');
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<SCRIBUSUTF8NEW Version="1.5.8">
<DOCUMENT ANZPAGES="${pages.length}" PAGEWIDTH="${pageWidthMm}" PAGEHEIGHT="${pageHeightMm}"
          BORDERLEFT="${marginXMm}" BORDERRIGHT="${marginXMm}" BORDERTOP="${marginYMm}" BORDERBOTTOM="${marginYMm}"
          ORIENTATION="0" PAGESIZE="Custom" FIRSTNUM="1" BOOK="0" AUTOSPALTEN="1" ABSTSPALTEN="${g.gridGutterMm}"
          UNITS="1" DFONT="${escapeXml(BODY_FONT)}" DSIZE="9"
          AUTHOR="${escapeXml(identity.title)}"
          TITLE="${escapeXml(`${identity.title} — ${date.day || ''} ${date.monthYear || ''}`)}"
          KEYWORDS="${escapeXml(identity.volumeLine)}"
          COMMENTS="Generated by SAHAS. Colour space CMYK; ${g.printDpi} dpi target."
          BLEEDTOP="${g.bleedMm}" BLEEDLEFT="${g.bleedMm}" BLEEDRIGHT="${g.bleedMm}" BLEEDBOTTOM="${g.bleedMm}">
${COLOURS}
${pageElements}
${objects}
</DOCUMENT>
</SCRIBUSUTF8NEW>
`;
}

module.exports = { buildDocument, blockFrames, escapeXml, mm, pxToPt, BODY_FONT, HEAD_FONT };
