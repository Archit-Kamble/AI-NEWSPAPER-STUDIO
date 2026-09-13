// Crops every picture a measured page names out of the desk's own scan, at the
// rectangle the spec gives - so a crop can never disagree with the frame it is
// set in (a crop taken at one box and framed at another is cropped again by
// the frame, which is how a logo lost its top line).
//
//   node scripts/reference-layout/crop-pictures.js <spec-key> <scan.jpg>
//
// Writes into public/uploads/, which is gitignored: a reference paper's
// pictures are for local calibration only.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const [key, scan] = process.argv.slice(2);
const spec = require(path.join(__dirname, '../../src/layout/measured-pages', key));
const jobs = spec.blocks.flatMap((block) => (block.pictures || []).map((p) => [p.file, p.box]));
const script = `
import sys, json
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
for file, box in json.loads(sys.argv[2]):
    im.crop(tuple(box)).save(sys.argv[3] + '/' + file, quality=92)
print(len(json.loads(sys.argv[2])), 'crops')
`;
console.log(execFileSync('python3', ['-c', script, scan, JSON.stringify(jobs), path.join(__dirname, '../../public/uploads')]).toString().trim());
