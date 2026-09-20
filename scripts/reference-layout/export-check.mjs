// CANVAS AGAINST PLATE: the second of the two independent visual checks. The
// reference-to-canvas comparison says whether the page looks like the paper
// it was measured from; this says whether the press file prints what the
// canvas shows. An export that matches an inaccurate canvas perfectly is still
// inaccurate, and a canvas that matches the reference is worth nothing if the
// plate prints something else - so the two are checked separately.
//
//   node scripts/reference-layout/export-check.mjs <editionId> <page> <canvas.png> <out-prefix> [dpr] [x0,y0,x1,y1]
//
// <canvas.png> is shoot.js's capture of the same page at `dpr` device pixels
// per editor pixel. The CMYK press PDF is built through the export service
// exactly as GET /api/newspapers/:id/export/pdf builds it, rasterised with
// pdftoppm at the same resolution (the editor is 2 px per mm, so dpr 4.33 is
// 220 dpi), and the two are overlaid: red is ink only on the canvas, green is
// ink only on the plate, black is both. The optional box (editor pixels)
// limits the report to one region.

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = new URL('../../', import.meta.url).pathname;
require(`${ROOT}node_modules/dotenv`).config({ path: `${ROOT}.env` });

const [ED, PAGE, CANVAS, OUT, DPR = '4.33', BOX] = process.argv.slice(2);
if (!ED || !PAGE || !CANVAS || !OUT) {
  console.error('usage: export-check.mjs <editionId> <page> <canvas.png> <out-prefix> [dpr] [x0,y0,x1,y1 | blockKey]');
  process.exit(2);
}
// A block KEY rather than a rectangle asks for the block AND a score for each
// of its parts - see regionsOf() below.
const BLOCK_KEY = BOX && !/^[\d.,-]+$/.test(BOX) ? BOX : null;

const newspaperService = require(`${ROOT}src/services/newspaper.service.js`);
const districtEditionService = require(`${ROOT}src/services/districtEdition.service.js`);
const plainText = require(`${ROOT}src/layout/plain-text`);
const exportService = require(`${ROOT}src/services/export`);

const newspaper = await newspaperService.getNewspaper(Number(ED));
const pages = await districtEditionService.pagesOf(newspaper.id);
await plainText.load();
const built = await exportService.exportEdition('pdf', newspaper, pages);
const dir = mkdtempSync(path.join(tmpdir(), 'export-check-'));
const pdf = path.join(dir, 'edition.pdf');
writeFileSync(pdf, built.body);
const index = pages.findIndex((p) => p.page_number === Number(PAGE)) + 1;
const dpi = String(Math.round(Number(DPR) * 2 * 25.4));
execFileSync('pdftoppm', ['-f', String(index), '-l', String(index), '-r', dpi, '-png', pdf, path.join(dir, 'plate')]);
const plate = path.join(dir, readdirSync(dir).find((f) => f.startsWith('plate')));

/**
 * ONE SCORE PER PART OF THE BLOCK, because one number over a whole region says
 * almost nothing. A photograph is thousands of pixels of continuous tone and a
 * deck is two hundred pixels of thin strokes, so an aggregate is a photograph
 * score with a rounding error in it - and a headline 13px out of place moved
 * that aggregate by eleven points while every other part was already perfect.
 *
 * The regions are the composition's own: the display bands where it put them,
 * the body's real extent, each panel at the rectangle it is drawn at, each
 * picture at its frame. Nothing is re-derived - a region measured differently
 * from the way it is drawn would score its own arithmetic.
 */
async function regionsOf(key) {
  const page = pages.find((p) => p.page_number === Number(PAGE));
  const section = page?.sections?.find((s) => s.section_key === key);
  if (!section) {
    console.error(`no block "${key}" on page ${PAGE}`);
    process.exit(2);
  }
  const { composeSection } = await import(`${ROOT}public/editor/compose/section-adapter.js`);
  const { panelsOf, panelTop } = require(`${ROOT}public/editor/layout/inset-panels.js`);
  const composition = composeSection(section, {});
  const x0 = Number(section.x_px) || 0;
  const y0 = Number(section.y_px) || 0;
  const at = (x, y, w, h) => [x0 + x, y0 + y, x0 + x + w, y0 + y + h];
  const regions = [];
  for (const [name, band] of Object.entries(composition.bands || {})) {
    const lines = band?.lines || [];
    if (!lines.length) continue;
    const left = Math.min(...lines.map((l) => l.x));
    const right = Math.max(...lines.map((l) => l.x + (l.width || l.measure || 0)));
    const top = Math.min(...lines.map((l) => l.y));
    const bottom = Math.max(...lines.map((l) => l.y + l.height));
    regions.push({ name, box: at(left, top, right - left, bottom - top) });
  }
  const body = composition.bodyLines || [];
  if (body.length) {
    const left = Math.min(...body.map((l) => l.x));
    const right = Math.max(...body.map((l) => l.x + (l.measure || l.width || 0)));
    const top = Math.min(...body.map((l) => l.y));
    const bottom = Math.max(...body.map((l) => l.y + l.height));
    regions.push({ name: 'body', box: at(left, top, right - left, bottom - top) });
  }
  for (const panel of panelsOf(section)) {
    regions.push({
      name: `${panel.kind === 'ornament' ? 'rule' : 'panel'} ${panel.id || panel.kind}`,
      box: at(panel.x, panelTop(panel, composition), panel.width, panel.height),
    });
  }
  for (const image of section.images || []) {
    regions.push({
      name: `picture ${image.id || ''}`.trim(),
      box: at(Number(image.x_px) || 0, Number(image.y_px) || 0, Number(image.width_px) || 0, Number(image.height_px) || 0),
    });
  }
  const block = [x0, y0, x0 + (Number(section.width_px) || 0), y0 + (Number(section.height_px) || 0)];
  return { block, regions };
}

const scope = BLOCK_KEY ? await regionsOf(BLOCK_KEY) : null;
console.log(`press PDF: ${built.body.length} bytes, ${built.warnings?.length || 0} warnings, ${built.missingImages?.length || 0} missing images; page ${PAGE} rasterised at ${dpi} dpi`);

const py = `
import sys
from PIL import Image, ImageOps, ImageChops, ImageFilter
canvas = ImageOps.grayscale(Image.open(sys.argv[1]).convert('RGB'))
plate = ImageOps.grayscale(Image.open(sys.argv[2]).convert('RGB'))
dpr = float(sys.argv[4])
# A SIZE MISMATCH IS A REFUSAL, not something to resize away. Rasterising the
# same page at the same resolution can land a pixel out either way from
# rounding (2859x4591 against 2858x4590 is the pair this was written for), and
# absorbing THAT is fair. Anything larger means the two sides are not the same
# page - a different dpr, a different page size, the wrong page index - and
# resizing it produces a confident number about nothing, which is worse than
# no number at all.
if plate.size != canvas.size:
    slack = max(abs(plate.size[0] - canvas.size[0]), abs(plate.size[1] - canvas.size[1]))
    if slack > 2:
        print(f'REFUSED: plate {plate.size} and canvas {canvas.size} are not the same page '
              f'({slack}px apart). Re-shoot the canvas at this dpr, or check the page number.')
        sys.exit(3)
    print(f'plate {plate.size} and canvas {canvas.size} differ by {slack}px of raster rounding; '
          f'the plate is resized to the canvas once, as a whole page')
    plate = plate.resize(canvas.size, Image.LANCZOS)
import json
regions = json.loads(sys.argv[6]) if len(sys.argv) > 6 and sys.argv[6] else None
whole = canvas, plate
if sys.argv[5]:
    x0, y0, x1, y1 = [round(float(v) * dpr) for v in sys.argv[5].split(',')]
    canvas, plate = canvas.crop((x0, y0, x1, y1)), plate.crop((x0, y0, x1, y1))
Image.merge('RGB', (plate, canvas, ImageChops.darker(canvas, plate))).save(sys.argv[3] + '-plate-overlay.png')
side = Image.new('L', (canvas.size[0] * 2 + 12, canvas.size[1]), 0)
side.paste(canvas, (0, 0)); side.paste(plate, (canvas.size[0] + 12, 0)); side.save(sys.argv[3] + '-plate-side.png')
# WHERE THE INK IS, never how dark it is. The canvas is sRGB and the plate is
# rendered from DeviceCMYK, and poppler's own transform puts 93% K at RGB
# 50,46,47 and 100% K at 35,31,32 - so the same ink is a different number on
# the two sides and only the geometry can be compared. Masks at 0/255, because
# ImageChops.multiply divides by 255 and 0/1 masks multiply to nothing.
c = canvas.point(lambda v: 255 if v < 128 else 0); p = plate.point(lambda v: 255 if v < 128 else 0)
both = sum(ImageChops.multiply(c, p).getdata()) // 255; cc = sum(c.getdata()) // 255; pp = sum(p.getdata()) // 255
print(f'ink pixels: canvas {cc}, plate {pp}; shared {both} = {both / max(1, cc) * 100:.1f}% of the canvas ink, {both / max(1, pp) * 100:.1f}% of the plate ink')
# AND THE SAME AGAIN WITH A TOLERANCE, because an exact-pixel count is the
# wrong instrument for type: a 6px Devanagari body sets strokes two or three
# pixels wide at this resolution, so half a pixel of sub-pixel positioning
# halves the overlap on a line that is in exactly the right place. The
# tolerance figure is what says whether the two surfaces really disagree -
# measured on the front page's lead package, a 13px baseline error read 66%
# exact / 89% at 2px, and the same package with the error fixed reads 78% /
# 98%. Judge the page on the tolerant number and the overlay, never on the
# exact one.
for k in (3, 5):
    cd = c.filter(ImageFilter.MaxFilter(k)); pd = p.filter(ImageFilter.MaxFilter(k))
    a = sum(ImageChops.multiply(c, pd).getdata()) / max(1, sum(c.getdata()))
    b = sum(ImageChops.multiply(p, cd).getdata()) / max(1, sum(p.getdata()))
    print(f'  within {k // 2}px: {a * 100:.1f}% of the canvas ink, {b * 100:.1f}% of the plate ink')

# PER REGION, BOTH DIRECTIONS. One aggregate over a block is a photograph score
# with a rounding error in it: a picture is thousands of pixels of continuous
# tone and a deck is two hundred pixels of thin strokes. Both directions,
# because they answer different questions - ink on the canvas the plate does
# not print, and ink on the plate the canvas never showed.
if regions:
    print('')
    print(f"{'region':26} {'ink c/p':>15}  {'exact c/p':>13}  {'within 1px c/p':>15}")
    for r in regions:
        x0, y0, x1, y1 = [round(v * dpr) for v in r['box']]
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        rc = whole[0].crop((x0, y0, x1, y1)).point(lambda v: 255 if v < 128 else 0)
        rp = whole[1].crop((x0, y0, x1, y1)).point(lambda v: 255 if v < 128 else 0)
        ci = sum(rc.getdata()) // 255; pi = sum(rp.getdata()) // 255
        if ci + pi == 0:
            print(f"{r['name'][:26]:26} {'no ink either side':>15}")
            continue
        exact = sum(ImageChops.multiply(rc, rp).getdata()) // 255
        a1 = sum(ImageChops.multiply(rc, rp.filter(ImageFilter.MaxFilter(3))).getdata()) / max(1, sum(rc.getdata()))
        b1 = sum(ImageChops.multiply(rp, rc.filter(ImageFilter.MaxFilter(3))).getdata()) / max(1, sum(rp.getdata()))
        flag = '' if min(a1, b1) > 0.9 else '   <<'
        print(f"{r['name'][:26]:26} {ci:7}/{pi:<7} {exact / max(1, ci) * 100:5.1f}%/{exact / max(1, pi) * 100:5.1f}%  "
              f"{a1 * 100:6.1f}%/{b1 * 100:6.1f}%{flag}")
`;
const report = execFileSync('python3', [
  '-c', py, CANVAS, plate, OUT, DPR,
  scope ? scope.block.join(',') : (BOX || ''),
  scope ? JSON.stringify(scope.regions) : '',
], { encoding: 'utf8' });
process.stdout.write(report);
console.log(`wrote ${OUT}-plate-side.png ${OUT}-plate-overlay.png`);
process.exit(0);
