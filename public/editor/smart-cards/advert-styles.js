// THE SHAPES A DISPLAY ADVERTISEMENT COMES IN.
//
// A district daily does not print one kind of advert. The trader's panel with
// a photograph, the शुभेच्छा greeting inside a decorated चौकट, the strip across
// the foot of a page, the poster where a supplied photograph IS the advert,
// and the small all-type classified are five different printed objects, and a
// desk chooses between them the way they choose a template.
//
// This is a CATALOGUE, not five layouts. layoutAdvert() solves one set of type
// bands - the advertiser's name, the line that shouts, the standfirst, the
// detail, the offer, the contact - and reads the parameters below to decide
// where the artwork goes, how the bands are aligned, what rules the panel
// carries and whether the type is reversed out of ink. Five renderers would
// drift; five rows of parameters cannot.
//
// It lives here rather than in layout.js because the GENERATE PANEL needs the
// list too - to draw a demo of each shape - and the panel must never carry a
// second copy of what a style is.

// How the artwork is used:
//   band      a picture across the head of the panel, type beneath
//   medallion a small centred picture over the type, as a greeting card sets
//   full      the picture IS the panel; the type sits on a reversed block over
//             its foot
//   side      a square at the left with the type beside it - a strip advert
//   none      an all-type advert; a supplied picture is ignored rather than
//             squeezed in somewhere it does not belong
//
// How the panel is ruled, INSIDE the card's own ring (cardRuleFor):
//   none      nothing; the card's ring is the advert's rule
//   double    one more rule inside the ring - the printed चौकट
//   rule      a rule over and under the type, as a classified is set
export const ADVERT_STYLES = Object.freeze({
  classic: Object.freeze({
    key: 'classic',
    label: 'क्लासिक पॅनेल',
    detail: 'नाव, ठळक ओळ, तपशील, सवलतीचा पट्टा',
    english: 'Trader panel',
    shape: 'stack',
    art: 'band',
    align: 'left',
    frame: 'none',
    offer: 'reverse',
    reversed: false,
    block: Object.freeze({ width: 268, height: 300 }),
  }),
  framed: Object.freeze({
    key: 'framed',
    label: 'शुभेच्छा चौकट',
    detail: 'सजावटी चौकट, मध्यभागी मजकूर',
    english: 'Greeting frame',
    shape: 'stack',
    art: 'medallion',
    align: 'centre',
    frame: 'double',
    offer: 'rule',
    reversed: false,
    block: Object.freeze({ width: 268, height: 300 }),
  }),
  poster: Object.freeze({
    key: 'poster',
    label: 'छायाचित्र जाहिरात',
    detail: 'पूर्ण छायाचित्र, त्यावर उलटा मजकूर',
    english: 'Photo poster',
    shape: 'stack',
    art: 'full',
    align: 'centre',
    frame: 'none',
    offer: 'reverse',
    reversed: true,
    block: Object.freeze({ width: 307, height: 380 }),
  }),
  banner: Object.freeze({
    key: 'banner',
    label: 'पट्टी जाहिरात',
    detail: 'डावीकडे चित्र, बाजूला मजकूर',
    english: 'Strip banner',
    shape: 'row',
    art: 'side',
    align: 'left',
    frame: 'none',
    offer: 'reverse',
    reversed: false,
    block: Object.freeze({ width: 620, height: 176 }),
  }),
  classified: Object.freeze({
    key: 'classified',
    label: 'छोटी जाहिरात',
    detail: 'फक्त मजकूर, वर-खाली रेघ',
    english: 'Classified',
    shape: 'stack',
    art: 'none',
    align: 'centre',
    frame: 'rule',
    offer: 'plain',
    reversed: false,
    block: Object.freeze({ width: 148, height: 176 }),
  }),
});

export const DEFAULT_ADVERT_STYLE = 'classic';

// LET THE PAPER'S OWN AI DESIGN IT.
//
// This is a REQUEST, not a shape: it is what a desk asks for, and the builder
// turns it into one of the shapes above before anything is stored. Nothing in
// the database ever carries `auto` - a stored style is always a key this
// renderer can draw, which is the difference between a choice and a state.
//
// The model picks the shape from this same catalogue and writes the brief for
// the illustration, so two adverts from the same copy are not the same advert.
// It cannot invent a shape the compositor has no geometry for, and it cannot
// remove the picture guards (no text, no faces) - those are the image
// service's and are added after its brief, not by it.
export const ADVERT_DESIGN_REQUEST = 'auto';

/** Whether a desk's answer is "you decide" rather than a shape. */
export function isDesignRequest(key) {
  return String(key || '') === ADVERT_DESIGN_REQUEST;
}

export const ADVERT_STYLE_KEYS = Object.keys(ADVERT_STYLES);

/** The style a card asks for, or the paper's default. Never null. */
export function advertStyle(key) {
  return ADVERT_STYLES[String(key || '')] || ADVERT_STYLES[DEFAULT_ADVERT_STYLE];
}

/** The block a printed paper gives this shape of advert. */
export function advertBlockSize(key) {
  return advertStyle(key).block;
}

// THE DEMO, so a desk chooses a shape by looking at one.
//
// One advertiser's copy, drawn five ways: the point of the picker is to
// compare SHAPES, and different copy in each would compare the copy instead.
// It is drawn through the real renderer, so a demo cannot show a shape the
// page would not print.
export const ADVERT_SAMPLE = Object.freeze({
  advertiser: 'श्री गणेश ट्रेडर्स, सातारा',
  headline: 'शेती अवजारे व ठिबक संच',
  subheadline: 'विक्री, बसवणूक आणि दुरुस्ती — एकाच ठिकाणी',
  lines: Object.freeze(['सर्व प्रकारचे पाण्याचे पंप', 'ठिबक व तुषार सिंचन संच', 'अधिकृत सेवा केंद्र']),
  offer: 'सर्व पंपांवर १०% सवलत · २० सप्टेंबरपर्यंत',
  contact: '९८२२० १२३४५ / ०२१६२-२२२२२२',
  address: 'पोवई नाका, सातारा ४१५००१',
  footer: 'अटी लागू',
});
