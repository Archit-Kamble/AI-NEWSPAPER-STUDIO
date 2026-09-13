// A WHOLE PAGE SOLD AS ONE ADVERTISEMENT. The advertiser supplies the artwork,
// so the page is one frame the artwork is set in, at the scan's own rectangle.

const { kit } = require('./kit');

const SCAN = { x0: 59, x1: 2742, y0: 119, y1: 4318, top: 56 };
const SY = (1008 - SCAN.top) / (SCAN.y1 - SCAN.y0);
const { BODY } = kit({ sy: SY });

module.exports = {
  key: 'broadsheet-advertorial',
  name: 'Broadsheet advertorial (reference)',
  description: 'A whole page sold as one advertisement.',
  scan: SCAN,
  blocks: [
    {
      key: 'page-advert', box: [59, 119, 2742, 4318], type: 'advert', story: 'ADVERTISEMENT', priority: 1,
      style: { ...BODY, showDateline: false },
      pictures: [{ file: 'reference-lokmat/advertorial-page.jpg', box: [59, 119, 2742, 4318], standOffPx: 1 }],
      panels: [],
    },
  ],
};
