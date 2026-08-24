// The current-editor e-paper capture surface.
//
// This invokes the ordinary canvas renderer, then removes only editor chrome
// through the existing `.print-view` contract. It is intentionally not another
// composition engine: if it differs from the desk canvas, that is a bug here.

import { renderCanvas } from './canvas/canvas.js';
import { loadGeometry } from './canvas/grid.js';
import { loadIdentity } from './canvas/masthead.js';
import { ensureFontsLoaded } from './compose/font-metrics.js';
import { ensureShaperReady, requireShaperReady } from './compose/shaper.js';

const capture = window.__EPAPER_CANVAS_CAPTURE__;

async function waitForImages() {
  const images = [...document.images];
  await Promise.all(images.map((image) => {
    if (image.complete) return image.decode?.().catch(() => {}) || Promise.resolve();
    return new Promise((resolve) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    });
  }));
}

async function render() {
  if (!capture?.newspaper || !capture?.page) throw new Error('Missing one-use e-paper canvas capture.');
  await Promise.all([
    loadGeometry(),
    loadIdentity(capture.newspaper.publication_date, capture.pageCount),
    ensureFontsLoaded(),
    ensureShaperReady(),
  ]);
  requireShaperReady();
  renderCanvas(capture.page, capture.newspaper, {
    selectedSectionKey: null,
    draft: null,
    dirty: false,
  }, { guides: [], guidesVisible: false });

  // Canvas view normally fits the sheet into its available editor viewport.
  // This capture IS the page, so remove only that view transform; all page
  // geometry and every block remains the same editor-owned value.
  const surface = document.getElementById('canvasSurface');
  const sizer = document.getElementById('canvasSizer');
  const width = Number(capture.newspaper.page_width_px) || 660;
  const height = Number(capture.newspaper.page_height_px) || 1060;
  if (surface) surface.style.transform = 'none';
  if (sizer) {
    sizer.style.width = `${width}px`;
    sizer.style.height = `${height}px`;
  }
  await document.fonts.ready;
  await waitForImages();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  document.documentElement.dataset.epaperCanvasReady = 'true';
}

render().catch((error) => {
  console.error('E-paper canvas capture failed:', error);
  document.documentElement.dataset.epaperCanvasError = error.message || 'capture failed';
});
