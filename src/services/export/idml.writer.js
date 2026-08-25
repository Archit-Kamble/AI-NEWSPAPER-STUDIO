// ADOBE INDESIGN, as IDML.
//
// IDML is InDesign's own interchange format and the only one worth writing: a
// .indd is undocumented and version-locked, while IDML is a documented zip of
// XML that every InDesign since CS4 opens directly. It is also the format a
// designer can be handed without asking which version they run.
//
// The document it writes is the same document the press PDF and the Scribus
// project write - `print-model.js` walked the composition once - so a designer
// opening this in InDesign gets the page the desk approved, not a re-flowed
// approximation of it. Every composed LINE is its own text frame, exactly as
// the .sla does, and for the same reason: InDesign must never be asked to wrap
// Devanagari a second time, because its answer would differ from the
// compositor's and the page would move.
//
// UNITS. IDML geometry is POINTS, and an object is placed by its own centre
// through an ItemTransform. The model is millimetres from the page's top-left,
// so the conversion is one multiply and one shift, done here.

const fs = require('fs');
const path = require('path');
const { buildZip } = require('../pressPackage.service');
const { cmykOf } = require('./pdf.writer');

const PUBLIC_DIR = path.join(__dirname, '..', '..', '..', 'public');
const MM_TO_PT = 72 / 25.4;
const pt = (mm) => Number((Number(mm) * MM_TO_PT).toFixed(4));

// XML 1.0 cannot carry a C0 control character at all, and InDesign refuses the
// whole document rather than the one character.
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');
const xml = (value) => String(value === undefined || value === null ? '' : value)
  .replace(CONTROL, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const FACE = {
  'serif/400': ['Noto Serif Devanagari', 'Regular'],
  'serif/700': ['Noto Serif Devanagari', 'Bold'],
  'sans/400': ['Noto Sans Devanagari', 'Regular'],
  'sans/700': ['Noto Sans Devanagari', 'Bold'],
};
const faceKey = (family, weight) =>
  `${family === 'sans' ? 'sans' : 'serif'}/${Number(weight) >= 600 ? 700 : 400}`;

const ALIGN = { left: 'LeftAlign', center: 'CenterAlign', right: 'RightAlign', justify: 'LeftJustified' };

const INK_NAMES = new Map();
function colourName(ink) {
  const key = ink ? String(ink).toLowerCase() : 'black';
  if (!INK_NAMES.has(key)) INK_NAMES.set(key, `SahasInk${INK_NAMES.size}`);
  return INK_NAMES.get(key);
}

/** InDesign states a process colour as four 0-100 percentages. */
const cmyk = (ink) => cmykOf(ink).map((n) => Math.round(n * 100)).join(' ');

let uid = 0;
const id = (prefix) => `${prefix}${(uid += 1)}`;

// ---------------------------------------------------------------- stories ---
//
// In IDML a frame's words live in a Story part of their own and the frame
// points at it. ONE STORY PER COMPOSED LINE: the lines are already broken, and
// a shared story is precisely what would let InDesign reflow them.

function storyXml(storyId, item) {
  const runs = item.runs.map((run) => {
    const [family, style] = FACE[faceKey(run.family, run.weight)];
    return '<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"'
      + ` PointSize="${run.sizePt}" FillColor="Color/${colourName(run.ink)}"`
      + (run.underline ? ' Underline="true"' : '')
      + '>'
      + `<Properties><AppliedFont type="string">${xml(family)}</AppliedFont></Properties>`
      + `<FontStyle type="string">${xml(style)}</FontStyle>`
      + `<Content>${xml(run.text)}</Content>`
      + '</CharacterStyleRange>';
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0">
  <Story Self="${storyId}" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="$ID/" AppliedNamedGrid="n">
    <StoryPreference OpticalMarginAlignment="false" OpticalMarginSize="12" FrameType="TextFrameType"
      StoryOrientation="Horizontal" StoryDirection="LeftToRightDirection"/>
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/[No paragraph style]"
      Justification="${ALIGN[item.align] || 'LeftAlign'}">${runs}</ParagraphStyleRange>
  </Story>
</idPkg:Story>`;
}

// ----------------------------------------------------------------- spreads ---

/**
 * A frame's outline. Four corners for a rectangle - and an arbitrary point
 * list for a `poly`, which is how a pie slice, a line chart and a dot all
 * reach this file. The arc was already turned into segments in the print
 * model, once, so nothing here needs bezier geometry.
 */
function pathGeometry(halfW, halfH, points = null, open = false) {
  const corners = points || [[-halfW, -halfH], [-halfW, halfH], [halfW, halfH], [halfW, -halfH]];
  return `<Properties><PathGeometry><GeometryPathType PathOpen="${open ? 'true' : 'false'}"><PathPointArray>`
    + corners.map(([x, y]) =>
      `<PathPointType Anchor="${x} ${y}" LeftDirection="${x} ${y}" RightDirection="${x} ${y}"/>`).join('')
    + '</PathPointArray></GeometryPathType></PathGeometry></Properties>';
}

function frameXml(item, storyId, model) {
  const cx = pt(item.x + item.width / 2) - pt(model.widthMm) / 2;
  const cy = pt(item.y + item.height / 2) - pt(model.heightMm) / 2;
  const halfW = pt(item.width) / 2;
  const halfH = pt(item.height) / 2;
  const bounds = pathGeometry(halfW, halfH);

  if (item.kind === 'text') {
    // No inset and no auto-size: the compositor already owns every pixel of
    // padding this line needed, and InDesign's own default frame inset would
    // silently re-introduce a second, un-composed margin round type that was
    // placed exactly.
    return `<TextFrame Self="${id('tf')}" ParentStory="${storyId}" ItemTransform="1 0 0 1 ${cx} ${cy}"`
      + ' ContentType="TextType" StrokeWeight="0" FillColor="Swatch/None">'
      + '<TextFramePreference TextColumnCount="1" FirstBaselineOffset="AscentOffset"'
      + ' AutoSizingType="Off" VerticalJustification="TopAlign" InsetSpacing="0 0 0 0"/>'
      + bounds + '</TextFrame>';
  }

  if (item.kind === 'poly') {
    // Points arrive in absolute page millimetres; InDesign wants them relative
    // to the frame's own centre, which is the same transform the rectangle
    // above already uses.
    const local = (item.points || []).map(([x, y]) => [pt(x) - pt(item.x + item.width / 2), pt(y) - pt(item.y + item.height / 2)]);
    const width = Number(item.strokeWidth) || 0;
    return `<Polygon Self="${id('poly')}" ItemTransform="1 0 0 1 ${cx} ${cy}"`
      + ` ContentType="Unassigned" StrokeWeight="${width > 0 ? pt(width) : 0}"`
      + ` StrokeColor="Color/${colourName(item.ink)}"`
      + ` FillColor="${width > 0 ? 'Swatch/None' : `Color/${colourName(item.ink)}`}">`
      + pathGeometry(halfW, halfH, local, !item.close) + '</Polygon>';
  }

  if (item.kind === 'image') {
    // A LINK, not embedded bytes: a designer wants the real photograph on disk
    // beside the document, which is the same contract the Scribus press
    // package already has.
    return `<Rectangle Self="${id('rect')}" ItemTransform="1 0 0 1 ${cx} ${cy}"`
      + ' ContentType="GraphicType" StrokeWeight="0" FillColor="Swatch/None">'
      + bounds
      + `<Image Self="${id('img')}" ItemTransform="1 0 0 1 ${-halfW} ${-halfH}">`
      + '<Properties><Profile type="string">$ID/Embedded</Profile></Properties>'
      + `<Link Self="${id('lnk')}" LinkResourceURI="file:${xml(item.file)}"/>`
      + '</Image></Rectangle>';
  }

  return `<Rectangle Self="${id('rect')}" ItemTransform="1 0 0 1 ${cx} ${cy}"`
    + ` ContentType="Unassigned" StrokeWeight="0" FillColor="Color/${colourName(item.ink)}">`
    + bounds + '</Rectangle>';
}

function spreadXml(page, model, frames) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Spread xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0">
  <Spread Self="spread${page.number}" PageCount="1" BindingLocation="0" ShowMasterItems="true"
    PageTransitionType="None" PageTransitionDirection="NotApplicable" PageTransitionDuration="Medium">
    <FlattenerPreference LineArtAndTextResolution="300" GradientAndMeshResolution="150"
      ClipComplexRegions="false" ConvertAllStrokesToOutlines="false" ConvertAllTextToOutlines="false"/>
    <Page Self="page${page.number}" Name="${page.number}" AppliedMaster="n"
      GeometricBounds="0 0 ${pt(model.heightMm)} ${pt(model.widthMm)}"
      ItemTransform="1 0 0 1 ${-pt(model.widthMm) / 2} ${-pt(model.heightMm) / 2}">
      <MarginPreference Top="${pt(model.marginMm)}" Bottom="${pt(model.marginMm)}"
        Left="${pt(model.marginMm)}" Right="${pt(model.marginMm)}" ColumnCount="1" ColumnGutter="0"/>
    </Page>
${frames}
  </Spread>
</idPkg:Spread>`;
}

// ------------------------------------------------------------- the package ---

async function buildIdml(model) {
  uid = 0;
  INK_NAMES.clear();
  const warnings = [];
  const missingImages = [];
  const entries = [];
  const storyIds = [];
  const spreadNumbers = [];

  for (const page of model.pages) {
    const frames = [];
    for (const item of page.items) {
      if (item.kind === 'text') {
        const storyId = id('story');
        storyIds.push(storyId);
        entries.push({ name: `Stories/Story_${storyId}.xml`, data: Buffer.from(storyXml(storyId, item), 'utf8'), deflate: true });
        frames.push(frameXml(item, storyId, model));
        continue;
      }
      if (item.kind === 'image' && !fs.existsSync(path.join(PUBLIC_DIR, item.file))) {
        missingImages.push(item.file);
      }
      frames.push(frameXml(item, null, model));
    }
    spreadNumbers.push(page.number);
    entries.push({
      name: `Spreads/Spread_spread${page.number}.xml`,
      data: Buffer.from(spreadXml(page, model, frames.join('\n')), 'utf8'), deflate: true,
    });
  }

  // The swatches, gathered after every item has named the ink it uses.
  const colours = [...INK_NAMES.entries()].map(([ink, swatch]) =>
    `<Color Self="Color/${swatch}" Model="Process" Space="CMYK" ColorValue="${cmyk(ink === 'black' ? null : ink)}"`
    + ` ColorOverride="Normal" Name="${swatch}"/>`).join('\n  ');

  const families = [...new Set(Object.values(FACE).map(([family]) => family))];
  const safe = (name) => name.replace(/[^A-Za-z0-9]/g, '');

  entries.unshift(
    // STORED and FIRST, the same rule ODF and EPUB carry: a reader identifies
    // the package by reading these bytes straight out of the archive header.
    { name: 'mimetype', data: Buffer.from('application/vnd.adobe.indesign-idml-package', 'utf8'), deflate: false },
    {
      name: 'META-INF/container.xml',
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles><rootfile full-path="designmap.xml" media-type="text/xml"/></rootfiles>
</container>`, 'utf8'),
      deflate: true,
    },
    {
      name: 'designmap.xml',
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0"
  Self="sahasDoc" StoryList="${storyIds.join(' ')}">
  <idPkg:Graphic src="Resources/Graphic.xml"/>
  <idPkg:Fonts src="Resources/Fonts.xml"/>
  <idPkg:Styles src="Resources/Styles.xml"/>
  <DocumentPreference PageWidth="${pt(model.widthMm)}" PageHeight="${pt(model.heightMm)}"
    FacingPages="false" PagesPerDocument="${model.pages.length}"/>
  ${spreadNumbers.map((n) => `<idPkg:Spread src="Spreads/Spread_spread${n}.xml"/>`).join('\n  ')}
  ${storyIds.map((s) => `<idPkg:Story src="Stories/Story_${s}.xml"/>`).join('\n  ')}
</Document>`, 'utf8'),
      deflate: true,
    },
    {
      name: 'Resources/Graphic.xml',
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Graphic xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0">
  <Swatch Self="Swatch/None" Name="None" ColorEditable="false" ColorRemovable="false" Visible="true" SwatchCreatorID="7937"/>
  ${colours}
</idPkg:Graphic>`, 'utf8'),
      deflate: true,
    },
    {
      name: 'Resources/Fonts.xml',
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Fonts xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0">
  ${families.map((family) => `<FontFamily Self="ff${safe(family)}" Name="${xml(family)}">
    <Font Self="font${safe(family)}R" FontFamily="${xml(family)}" Name="${xml(family)} Regular" FontStyleName="Regular" Status="Substituted"/>
    <Font Self="font${safe(family)}B" FontFamily="${xml(family)}" Name="${xml(family)} Bold" FontStyleName="Bold" Status="Substituted"/>
  </FontFamily>`).join('\n  ')}
</idPkg:Fonts>`, 'utf8'),
      deflate: true,
    },
    {
      name: 'Resources/Styles.xml',
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Styles xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="8.0">
  <RootCharacterStyleGroup Self="rootChar">
    <CharacterStyle Self="CharacterStyle/$ID/[No character style]" Name="$ID/[No character style]"/>
  </RootCharacterStyleGroup>
  <RootParagraphStyleGroup Self="rootPara">
    <ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]"/>
  </RootParagraphStyleGroup>
</idPkg:Styles>`, 'utf8'),
      deflate: true,
    },
  );

  if (missingImages.length) {
    warnings.push(`${missingImages.length} linked picture(s) are not on this server; InDesign will report them missing.`);
  }
  // The publication faces have to be installed on the designer's machine, and
  // saying so here is cheaper than a page of substituted type nobody expects.
  warnings.push('InDesign needs Noto Serif Devanagari and Noto Sans Devanagari installed, or it will substitute the type.');

  return { idml: buildZip(entries, model.date), warnings, missingImages };
}

module.exports = { buildIdml, pt, faceKey };
