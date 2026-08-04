// Background removal.
//
// The instruction was "use both if both are free, else whichever is free". On
// checking, neither of the obvious two is usable:
//
//   remove.bg               - not free. ~50 preview credits a month, then paid
//                             per image. At one edition a day that is a running
//                             cost for something a model does locally.
//   @imgly/background-removal - free of charge, but AGPL-3.0. Running it inside
//                             SAHAS would oblige the newspaper to publish
//                             SAHAS's own source to its users. That is a
//                             licensing decision, not a technical one, and it
//                             is not ours to make quietly.
//
// So there are three paths, all free, tried in this order:
//
//   1. BiRefNet (MIT, self-hosted) when BIREFNET_URL is set. Best edge quality
//      on hair and foliage, but it is a service someone has to stand up.
//
//   2. U^2-Net (Apache-2.0) run here through onnxruntime-node (MIT) - see
//      segment.service.js. 4.5 MB of weights in models/, no service, no
//      network, and it works on the busy backgrounds a real press photograph
//      has. This is the path that actually runs today.
//
//   3. The flood fill in cutout.service.js, if the weights are missing. It only
//      handles a plain or even background, so it is the last resort rather than
//      the default it used to be.

const path = require('path');
const repo = require('../repositories/sectionImage.repository');
const localCutout = require('./cutout.service');
const segment = require('./segment.service');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

const BIREFNET_URL = process.env.BIREFNET_URL || '';
const TIMEOUT_MS = Number(process.env.BIREFNET_TIMEOUT_MS || 60000);

function isConfigured() {
  return Boolean(BIREFNET_URL);
}

async function callBiRefNet(imageUrl, origin) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BIREFNET_URL.replace(/\/$/, '')}/remove-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: new URL(imageUrl, origin).toString() }),
      signal: controller.signal,
    });
    if (!response.ok) return { error: `Background service returned ${response.status}` };
    return response.json();
  } catch (error) {
    return { error: error.name === 'AbortError' ? 'Background removal timed out' : error.message };
  } finally {
    clearTimeout(timer);
  }
}

// The model when its weights are present, the flood fill when they are not. If
// the model declines - it genuinely found no subject - the flood fill is still
// worth a try, because a plain studio backdrop is the one case the fill is
// better at.
async function cutoutLocally(imageUrl) {
  if (segment.isAvailable()) {
    const result = await segment.cutout(PUBLIC_DIR, imageUrl);
    if (!result.error) return result;
  }
  return localCutout.cutout(PUBLIC_DIR, imageUrl);
}

async function removeBackground(sectionId, imageId, origin) {
  const images = await repo.listBySection(sectionId);
  const image = images.find((row) => row.id === Number(imageId));
  if (!image) return { error: 'Picture not found' };

  const result = isConfigured()
    ? await callBiRefNet(image.url, origin)
    : await cutoutLocally(image.url);

  if (result.error) return result;
  if (!result.url) return { error: 'Background removal returned no picture' };

  // The cut-out replaces the original as a new asset, so the untouched
  // photograph is still there if the desk wants it back.
  const asset = await repo.findOrCreateAsset({
    url: result.url,
    filename: `cutout-${image.original_filename || 'picture'}`,
    mimeType: 'image/png',
  });

  // The mask is what makes copy wrap the subject instead of its box.
  await repo.update(image.id, { shape: 'cutout', mask: result.mask || null });
  await repo.replaceAsset(image.id, asset.id);

  return { ok: true, removedShare: result.removedShare };
}

module.exports = { removeBackground, isConfigured };
