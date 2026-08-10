// Background removal that runs here, with no external service and no licence
// entanglement.
//
// The two obvious options were both unusable: remove.bg is paid per image, and
// @imgly/background-removal is AGPL-3.0, which would oblige SAHAS to publish its
// own source. So this does the job locally with Jimp (MIT).
//
// The method is a flood fill inward from the edges: anything continuous with the
// border and close enough in colour to it is background. That is exactly right
// for the press photographs a newsroom actually gets - a person against a wall,
// a sky, a studio backdrop - and it is honest about what it cannot do: a subject
// touching a busy background will not cut out cleanly, and the editor can see
// that immediately in the preview and undo it.
//
// When BIREFNET_URL is set, that model is used instead and this is the fallback.
// See backgroundRemoval.service.js.

const path = require('path');
const fs = require('fs/promises');

// Colour distance at which a pixel still counts as "the same as the border".
const DEFAULT_TOLERANCE = 38;
// How far the alpha is ramped at the edge of the cut, so it does not look
// scissored out.
const FEATHER_PX = 2;

let JimpModule = null;
async function getJimp() {
  if (!JimpModule) ({ Jimp: JimpModule } = await import('jimp'));
  return JimpModule;
}

const distance = (a, b) =>
  Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);

function pixelAt(image, x, y) {
  const index = (y * image.bitmap.width + x) * 4;
  const data = image.bitmap.data;
  return { r: data[index], g: data[index + 1], b: data[index + 2] };
}

// The average colour of the border ring - what the background is assumed to be.
function borderColour(image) {
  const { width, height } = image.bitmap;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const sample = (x, y) => {
    const p = pixelAt(image, x, y);
    r += p.r;
    g += p.g;
    b += p.b;
    n += 1;
  };
  for (let x = 0; x < width; x += 1) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    sample(0, y);
    sample(width - 1, y);
  }
  return { r: r / n, g: g / n, b: b / n };
}

// Flood fill from every border pixel. Only background that is *connected to the
// edge* is removed, so a patch of sky-coloured shirt in the middle survives.
function backgroundMask(image, tolerance) {
  const { width, height } = image.bitmap;
  const target = borderColour(image);
  const isBackground = new Uint8Array(width * height);
  const queue = [];

  const consider = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (isBackground[index]) return;
    if (distance(pixelAt(image, x, y), target) > tolerance) return;
    isBackground[index] = 1;
    queue.push(index);
  };

  for (let x = 0; x < width; x += 1) {
    consider(x, 0);
    consider(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    consider(0, y);
    consider(width - 1, y);
  }

  while (queue.length) {
    const index = queue.pop();
    const x = index % width;
    const y = (index - x) / width;
    consider(x + 1, y);
    consider(x - 1, y);
    consider(x, y + 1);
    consider(x, y - 1);
  }
  return isBackground;
}

// Softens the cut so the subject does not look scissored out.
function feather(mask, width, height) {
  const alpha = new Uint8Array(width * height).fill(255);
  for (let i = 0; i < mask.length; i += 1) if (mask[i]) alpha[i] = 0;

  for (let pass = 0; pass < FEATHER_PX; pass += 1) {
    const next = Uint8Array.from(alpha);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * width + x;
        if (alpha[i] === 0) continue;
        const neighbours =
          alpha[i - 1] + alpha[i + 1] + alpha[i - width] + alpha[i + width];
        if (neighbours < 4 * 255) next[i] = Math.round((alpha[i] + neighbours / 4) / 2);
      }
    }
    alpha.set(next);
  }
  return alpha;
}

// The occupancy grid the character map wraps text around.
//
// A cell counts as covered as soon as a *meaningful* part of it is opaque, not
// once it is mostly opaque. Requiring a quarter of the cell let thin parts of a
// subject - an outstretched hand, a microphone, a raised arm - read as empty,
// and copy printed straight over them. In print the rule is the opposite of
// tidy: when in doubt, keep the type off the picture.
const COVERED_SHARE = 0.08;

function occupancyMask(alpha, width, height, cols = 32, rows = 44) {
  const cells = [];
  const cellW = width / cols;
  const cellH = height / rows;

  for (let row = 0; row < rows; row += 1) {
    const line = [];
    for (let col = 0; col < cols; col += 1) {
      let opaque = 0;
      let total = 0;
      for (let y = Math.floor(row * cellH); y < Math.floor((row + 1) * cellH); y += 1) {
        for (let x = Math.floor(col * cellW); x < Math.floor((col + 1) * cellW); x += 1) {
          total += 1;
          if (alpha[y * width + x] > 32) opaque += 1;
        }
      }
      line.push(total && opaque / total > COVERED_SHARE ? 1 : 0);
    }
    cells.push(line);
  }
  return { cols, rows, cells };
}

// Writes the transparent PNG and describes it. Shared with the model-based
// cut-out in segment.service.js so both paths produce the same thing: a new
// asset beside the original, plus the occupancy grid the character map wraps
// copy around.
async function writeCutout(publicDir, image, alpha, relative) {
  const { width, height } = image.bitmap;
  for (let i = 0; i < alpha.length; i += 1) image.bitmap.data[i * 4 + 3] = alpha[i];

  // Trimmed to the subject.
  //
  // Taking the background out leaves the person standing in the middle of the
  // ORIGINAL rectangle, surrounded by transparency. The picture then still
  // occupies its old box: the frame drawn round it, the cells the character
  // grid counts and the space it takes on the page are all the rectangle's, not
  // the person's. The desk cuts a background out precisely so the picture stops
  // being a rectangle, and it stayed one.
  const bounds = subjectBounds(alpha, width, height);
  let trim = null;
  if (bounds && (bounds.width < width || bounds.height < height)) {
    image.crop({ x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height });
    alpha = cropAlpha(alpha, width, bounds);
    trim = { ...bounds, originalWidth: width, originalHeight: height };
  }
  const cut = { width: image.bitmap.width, height: image.bitmap.height };

  const stem = path.basename(relative).replace(/\.[^.]+$/, '');
  const name = `cutout-${Date.now()}-${stem}.png`;
  const outPath = path.join(publicDir, 'uploads', name);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await image.write(outPath);

  let opaque = 0;
  for (let i = 0; i < alpha.length; i += 1) if (alpha[i] > 128) opaque += 1;

  return {
    url: `/uploads/${name}`,
    // Measured on what was WRITTEN, so the cells the copy wraps to describe the
    // file that exists rather than the rectangle it was cut from.
    mask: occupancyMask(alpha, cut.width, cut.height),
    removedShare: Number((1 - opaque / (width * height)).toFixed(3)),
    trim,
  };
}

/** The smallest rectangle holding everything that is not transparent. */
function subjectBounds(alpha, width, height) {
  let top = -1; let bottom = -1; let left = width; let right = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] <= 32) continue;
      if (top === -1) top = y;
      bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (top === -1 || right === -1) return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function cropAlpha(alpha, width, bounds) {
  const out = new Uint8Array(bounds.width * bounds.height);
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      out[y * bounds.width + x] = alpha[(bounds.y + y) * width + (bounds.x + x)];
    }
  }
  return out;
}

/**
 * Cuts the background out of an uploaded picture.
 *
 * Returns the URL of a new transparent PNG plus the occupancy mask, or an
 * explanation of why it could not.
 */
async function cutout(publicDir, imageUrl, { tolerance = DEFAULT_TOLERANCE } = {}) {
  const relative = imageUrl.replace(/^\/+/, '');
  const source = path.join(publicDir, relative);

  let image;
  try {
    const Jimp = await getJimp();
    image = await Jimp.read(source);
  } catch {
    return { error: 'That picture could not be read from disk.' };
  }

  const { width, height } = image.bitmap;
  // A very large photograph would make the flood fill slow for no benefit; the
  // mask is coarse anyway.
  if (width * height > 6_000_000) {
    return { error: 'That picture is too large to cut out. Resize it first.' };
  }

  const mask = backgroundMask(image, tolerance);
  const removed = mask.reduce((sum, value) => sum + value, 0);
  const share = removed / (width * height);

  if (share < 0.02) {
    return {
      error:
        'No clear background found. This works on a subject against a plain ' +
        'or even background; this picture has no edge colour to remove.',
    };
  }
  if (share > 0.97) {
    return { error: 'Almost the whole picture matched the background - nothing would be left.' };
  }

  const alpha = feather(mask, width, height);
  return writeCutout(publicDir, image, alpha, relative);
}

module.exports = { cutout, writeCutout, occupancyMask, DEFAULT_TOLERANCE };
