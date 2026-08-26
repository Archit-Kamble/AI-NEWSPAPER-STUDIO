// A Smart Card owns its printable frame. Ordinary article headline and
// subheading fields are deliberately excluded because the cards will acquire
// their own display treatment later. Canvas, preflight and press output must
// all make that same decision.

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = (file) => import(path.join(__dirname, '..', 'public', 'editor', file));

let sectionThumb;
let sectionAdapter;
let smartCardLayout;
let fontMetrics;
let shaper;

test.before(async () => {
  fontMetrics = await load('compose/font-metrics.js');
  shaper = await load('compose/shaper.js');
  sectionAdapter = await load('compose/section-adapter.js');
  smartCardLayout = await load('smart-cards/layout.js');
  sectionThumb = await load('canvas/section-thumb.js');

  const fontsReady = await fontMetrics.ensureFontsLoaded();
  assert.equal(fontsReady, true, 'the publication fonts must be measurable');
  const shaped = await shaper.ensureShaperReady();
  assert.equal(shaped, true, 'the real shaper must be measurable - this suite is meaningless against the hmtx fallback');
});

// A block with a genuinely conjunct-heavy, multi-line headline and a real
// subheading, holding a panchang card - close to the fit boundary, so a
// wrong frame actually changes the fit verdict rather than passing either
// way by coincidence.
function conjunctHeavySection(overrides = {}) {
  return {
    section_key: 'panchang',
    width_px: 200,
    height_px: 260,
    margin_px: 12,
    kicker: '',
    headline: 'क्ष ज्ञान श्री कर्म ज्ञानेश्वर शेतकऱ्यांसाठी योजना जाहीर',
    subheading: 'शेतकऱ्यांसाठी नवी योजना जाहीर करण्यात आली',
    headline_font_px: 22,
    subheading_font_px: 14,
    body_font_px: 12,
    body: 'जुनी मजकूर जो कार्डाच्या डेटाशी संबंधित नाही',
    smart_card_key: 'panchang',
    smart_card_data: {
      items: [
        { label: 'सूर्योदय', text: '०६:२३' },
        { label: 'सूर्यास्त', text: '१८:५५' },
        { label: 'दिनमान', text: '१२ तास ३२ मिनिटे' },
        { label: 'राहुकाळ', text: '१५:४७ ते १७:२१' },
        { label: 'शके', text: '२०२१' },
      ],
    },
    ...overrides,
  };
}

function viewOf(section) {
  return {
    kicker: section.kicker,
    headline: section.headline,
    subheading: section.subheading,
    headlineFontPx: section.headline_font_px,
    subheadingFontPx: section.subheading_font_px,
    bodyFontPx: section.body_font_px,
    body: section.body,
    marginPx: section.margin_px,
    smartCardKey: section.smart_card_key,
    smartCardData: section.smart_card_data,
  };
}

test('the Smart Card frame is the exact composition with article display bands removed', () => {
  const section = conjunctHeavySection();
  const view = viewOf(section);

  const composition = sectionAdapter.composeSection(
    { ...section, images: [], headline: '', subheading: '', body: '' },
    { ...view, headline: '', subheading: '', body: '' },
  );
  const frame = smartCardLayout.smartCardFrameFromComposition(composition);

  assert.equal(frame.padding, 0, 'the composition has already subtracted the block\'s own edge padding - nothing left to reserve twice');
  assert.ok(Math.abs(frame.width - composition.content.measure) < 1e-6, 'frame width is content.measure exactly');
  assert.ok(Math.abs(frame.height - (composition.content.bottom - composition.bodyTop)) < 1e-6, 'frame height is content.bottom - bodyTop exactly');

  // And this is what smartCardFrame() (section-thumb.js), the function every
  // real caller (Layout, the Block Editor, workspace.js's proposal request)
  // actually calls, returns for the identical section/view.
  const viaHelper = sectionThumb.smartCardFrame(section, view);
  assert.deepEqual(viaHelper, frame, 'smartCardFrame() must be exactly smartCardFrameFromComposition(the same composition)');
});

test('changing an old stored headline does not take space away from a Smart Card', () => {
  const oneLineHeadline = conjunctHeavySection({ headline: 'ज्ञानेश्वर' });
  const multiLineHeadline = conjunctHeavySection(); // the long conjunct-heavy headline from above

  const frameFor = (section) => sectionThumb.smartCardFrame(section, viewOf(section));

  const short = frameFor(oneLineHeadline);
  const long = frameFor(multiLineHeadline);

  assert.deepEqual(long, short, 'article headline text is not part of Smart Card geometry');
});

test('a Smart Card composition contains no headline or subheading bands', () => {
  const section = conjunctHeavySection({ headline_font_px: 40, width_px: 140 });
  const view = viewOf(section);

  const composition = sectionAdapter.composeSection(
    { ...section, images: [], headline: '', subheading: '', body: '' },
    { ...view, headline: '', subheading: '', body: '' },
  );
  assert.equal(composition.bands.headline, undefined);
  assert.equal(composition.bands.subheading, undefined);
  assert.equal(composition.bodyTop, composition.content.top);
});

test('a Smart Card block\'s frame is measured with an EMPTY body, never through the flattened smartCardText() fallback stored in the row', () => {
  // section.body still carries the old flattened fallback text (real data:
  // sectionAdapter.composeSection's own body-pouring/whitespace logic must
  // never be asked to pour a Smart Card's copy - only the display bands
  // above it are real prose).
  const withLeftoverBody = conjunctHeavySection({ body: 'ही जुनी मजकूर आहे जी सुडोकूच्या आधीची आहे आणि आता वापरली जात नाही.'.repeat(20) });
  const withoutBody = conjunctHeavySection({ body: '' });

  const frameWithLeftover = sectionThumb.smartCardFrame(withLeftoverBody, viewOf(withLeftoverBody));
  const frameWithout = sectionThumb.smartCardFrame(withoutBody, viewOf(withoutBody));

  assert.deepEqual(frameWithLeftover, frameWithout,
    'the frame must be identical whether or not the row still carries old flattened body text - the card never measures against it');
});

test('Layout and preflight compute the identical Smart Card frame from the identical section/view', async () => {
  const section = conjunctHeavySection();
  const view = viewOf(section);

  const layoutFrame = sectionThumb.smartCardFrame(section, view);

  // The same construction preflight.service.js's checkPage() now performs:
  // composeSection() with an empty body and no images, then
  // smartCardFrameFromComposition() - reproduced here rather than spinning
  // up a full page/newspaper/DB fixture, since the frame arithmetic itself
  // is what is under test, and it is a pure function of section+view either
  // way.
  const preflightComposition = sectionAdapter.composeSection(
    { ...section, images: [], headline: '', subheading: '', body: '' },
    { ...view, headline: '', subheading: '', body: '' },
  );
  const preflightFrame = smartCardLayout.smartCardFrameFromComposition(preflightComposition);

  assert.deepEqual(layoutFrame, preflightFrame, 'Layout and preflight must solve the SAME frame for the same block');
});
