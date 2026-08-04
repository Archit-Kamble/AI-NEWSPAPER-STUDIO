// Subject segmentation — the thing that actually makes "Remove background" work
// on a real press photograph.
//
// The flood fill in cutout.service.js only ever worked on a subject against a
// plain wall or a studio backdrop. A reporter's photograph — a person at a
// rally, a minister at a podium, a crowd — has no single edge colour, so the
// fill found nothing and the button honestly said so. Honest, but useless: the
// desk needs the cut-outs Navarashtra runs on its front page every day.
//
// So this runs a real segmentation model locally: U^2-Net (Apache-2.0) through
// onnxruntime-node (MIT). Both licences are clean for a commercial newspaper —
// unlike @imgly/background-removal (AGPL-3.0), which would oblige SAHAS to
// publish its own source — and nothing is sent to a paid service like
// remove.bg. The weights are ~4.5 MB and live in models/.
//
// If the weights are absent the caller falls back to the flood fill, so a fresh
// checkout still boots and the button still does something.

const path = require('path');
const fs = require('fs');

const MODEL_DIR = process.env.SEGMENT_MODEL_DIR || path.join(__dirname, '..', '..', 'models');
// u2netp is the small U^2-Net. It is a 4.5 MB file and segments a person or an
// object out of a busy scene well enough for a 300 dpi newspaper cut-out.
const MODEL_FILE = process.env.SEGMENT_MODEL || path.join(MODEL_DIR, 'u2netp.onnx');

// U^2-Net's fixed input. The matte is produced at this size and scaled back up;
// at newspaper reproduction the softness that costs is invisible.
const INPUT_SIZE = 320;
// ImageNet normalisation, as the network was trained.
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let sessionPromise = null;
let JimpModule = null;

async function getJimp() {
  if (!JimpModule) ({ Jimp: JimpModule } = await import('jimp'));
  return JimpModule;
}

function isAvailable() {
  return fs.existsSync(MODEL_FILE);
}

// One session for the life of the process — loading the graph costs far more
// than running it, and the desk cuts out several pictures per page.
function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = require('onnxruntime-node');
      return ort.InferenceSession.create(MODEL_FILE, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      });
    })().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

// Image -> NCHW float tensor at 320x320, ImageNet-normalised.
function toTensor(ort, resized) {
  const data = resized.bitmap.data;
  const pixels = INPUT_SIZE * INPUT_SIZE;
  const input = new Float32Array(pixels * 3);

  // U^2-Net divides by the image's own maximum rather than by 255, which is
  // what the reference implementation does and what the weights expect.
  let max = 0;
  for (let i = 0; i < pixels; i += 1) {
    max = Math.max(max, data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  }
  const scale = max > 0 ? max : 255;

  for (let i = 0; i < pixels; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      input[c * pixels + i] = (data[i * 4 + c] / scale - MEAN[c]) / STD[c];
    }
  }
  return new ort.Tensor('float32', input, [1, 3, INPUT_SIZE, INPUT_SIZE]);
}

// The network emits several side outputs; d0 (the first, and the largest) is the
// fused prediction. Its range is arbitrary, so it is stretched to 0..1.
function toMatte(output) {
  const raw = output.data;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] < min) min = raw[i];
    if (raw[i] > max) max = raw[i];
  }
  const span = max - min || 1;
  const matte = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    matte[i] = Math.round(((raw[i] - min) / span) * 255);
  }
  return matte;
}

/**
 * Produces a full-resolution alpha matte for the subject of an image.
 *
 * Returns { alpha, width, height } where alpha is one byte per pixel, or
 * { error } if the model could not be run.
 */
async function matteFor(sourcePath) {
  const ort = require('onnxruntime-node');
  const Jimp = await getJimp();

  const image = await Jimp.read(sourcePath);
  const { width, height } = image.bitmap;

  const small = image.clone().resize({ w: INPUT_SIZE, h: INPUT_SIZE });
  const session = await getSession();
  const feeds = { [session.inputNames[0]]: toTensor(ort, small) };
  const results = await session.run(feeds);
  const matte = toMatte(results[session.outputNames[0]]);

  // Bilinear back up to the photograph's own size, so the cut edge follows the
  // subject rather than a 320-pixel staircase.
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sy = ((y + 0.5) * INPUT_SIZE) / height - 0.5;
    const y0 = Math.max(0, Math.min(INPUT_SIZE - 1, Math.floor(sy)));
    const y1 = Math.min(INPUT_SIZE - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, sy - y0));
    for (let x = 0; x < width; x += 1) {
      const sx = ((x + 0.5) * INPUT_SIZE) / width - 0.5;
      const x0 = Math.max(0, Math.min(INPUT_SIZE - 1, Math.floor(sx)));
      const x1 = Math.min(INPUT_SIZE - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));

      const top = matte[y0 * INPUT_SIZE + x0] * (1 - fx) + matte[y0 * INPUT_SIZE + x1] * fx;
      const bottom = matte[y1 * INPUT_SIZE + x0] * (1 - fx) + matte[y1 * INPUT_SIZE + x1] * fx;
      alpha[y * width + x] = Math.round(top * (1 - fy) + bottom * fy);
    }
  }

  return { alpha, width, height, image };
}

// A raw matte is soft everywhere. On newsprint a soft edge prints as a grey
// halo, so the middle of the ramp is pushed apart: clearly-subject goes solid,
// clearly-background goes clear, and only a narrow band stays semi-transparent
// to keep the edge from looking scissored.
const SOLID_ABOVE = 190;
const CLEAR_BELOW = 70;

function harden(alpha) {
  const span = SOLID_ABOVE - CLEAR_BELOW;
  for (let i = 0; i < alpha.length; i += 1) {
    const value = alpha[i];
    if (value >= SOLID_ABOVE) alpha[i] = 255;
    else if (value <= CLEAR_BELOW) alpha[i] = 0;
    else alpha[i] = Math.round(((value - CLEAR_BELOW) / span) * 255);
  }
  return alpha;
}

/**
 * Cuts the background out with the model. Same shape of result as
 * cutout.service.cutout, so the two are interchangeable to the caller.
 */
async function cutout(publicDir, imageUrl) {
  const relative = imageUrl.replace(/^\/+/, '');
  const source = path.join(publicDir, relative);

  let matte;
  try {
    matte = await matteFor(source);
  } catch (error) {
    return { error: `The cut-out model could not run: ${error.message}` };
  }

  const { alpha, width, height, image } = matte;
  harden(alpha);

  let opaque = 0;
  for (let i = 0; i < alpha.length; i += 1) if (alpha[i] > 128) opaque += 1;
  const kept = opaque / (width * height);

  // If the model found essentially nothing, say so rather than handing back an
  // empty frame the desk has to undo.
  if (kept < 0.01) {
    return { error: 'No subject could be found in this picture to keep.' };
  }
  if (kept > 0.995) {
    return { error: 'The whole picture reads as the subject — there is no background to remove.' };
  }

  const { writeCutout } = require('./cutout.service');
  return writeCutout(publicDir, image, alpha, relative);
}

module.exports = { cutout, matteFor, isAvailable, MODEL_FILE, INPUT_SIZE };
