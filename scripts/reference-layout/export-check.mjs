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
  console.error('usage: export-check.mjs <editionId> <page> <canvas.png> <out-prefix> [dpr] [x0,y0,x1,y1]');
  process.exit(2);
}

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
console.log(`press PDF: ${built.body.length} bytes, ${built.warnings?.length || 0} warnings, ${built.missingImages?.length || 0} missing images; page ${PAGE} rasterised at ${dpi} dpi`);

const py = `
import sys
from PIL import Image, ImageOps, ImageChops, ImageFilter
canvas = ImageOps.grayscale(Image.open(sys.argv[1]).convert('RGB'))
plate = ImageOps.grayscale(Image.open(sys.argv[2]).convert('RGB'))
dpr = float(sys.argv[4])
if plate.size != canvas.size:
    print(f'plate {plate.size} and canvas {canvas.size} differ; the plate is resized to the canvas once, as a whole page')
    plate = plate.resize(canvas.size, Image.LANCZOS)
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
`;
const report = execFileSync('python3', ['-c', py, CANVAS, plate, OUT, DPR, BOX || ''], { encoding: 'utf8' });
process.stdout.write(report);
console.log(`wrote ${OUT}-plate-side.png ${OUT}-plate-overlay.png`);
process.exit(0);
