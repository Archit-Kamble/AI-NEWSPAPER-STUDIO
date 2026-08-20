// A one-use, in-process handoff from the publisher to headless Chrome.
//
// Current-editor e-paper pages must be captured from the SAME canvas renderer
// the desk approved, not re-typeset by a second HTML approximation. The token
// is intentionally opaque, random, short-lived and consumed on first read:
// Chrome receives one frozen page payload, while no visitor receives a route
// that can enumerate or edit newsroom data.

const crypto = require('crypto');

const TTL_MS = 2 * 60 * 1000;
const captures = new Map();

function pagePayload(newspaper, page, pageCount) {
  return {
    newspaper,
    page,
    pageCount,
  };
}

function createCanvasCapture(newspaper, page, pageCount) {
  const token = crypto.randomBytes(32).toString('base64url');
  const timeout = setTimeout(() => captures.delete(token), TTL_MS);
  timeout.unref?.();
  captures.set(token, { expiresAt: Date.now() + TTL_MS, payload: pagePayload(newspaper, page, pageCount) });
  return token;
}

function takeCanvasCapture(token) {
  const capture = captures.get(String(token || ''));
  if (!capture || capture.expiresAt < Date.now()) {
    captures.delete(String(token || ''));
    return null;
  }
  captures.delete(String(token || ''));
  return capture.payload;
}

function serialisedPayload(payload) {
  // A JSON script value must not be able to end the script element if an
  // imported headline/body contains `</script>`.
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

function canvasCaptureHtml(payload) {
  return `<!doctype html>
<html lang="mr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/styles.css"><style>
  html,body{margin:0!important;padding:0!important;overflow:hidden!important;background:#fff!important}
  body{width:${Number(payload.newspaper?.page_width_px) || 660}px;height:${Number(payload.newspaper?.page_height_px) || 1060}px}
  #canvas{width:100%;height:100%}.canvas-stage{width:100%;height:100%;overflow:hidden}.canvas-viewport{position:absolute!important;inset:0!important;display:block!important;overflow:hidden!important;background:#fff!important}.canvas-sizer{margin:0!important}.newspaper-canvas{box-shadow:none!important;border:0!important}
</style></head><body class="print-view epaper-canvas-capture"><main id="canvas"></main>
<script>window.__EPAPER_CANVAS_CAPTURE__=${serialisedPayload(payload)};</script>
<script type="module" src="/editor/epaper-canvas-capture.js"></script>
</body></html>`;
}

module.exports = { createCanvasCapture, takeCanvasCapture, canvasCaptureHtml };
