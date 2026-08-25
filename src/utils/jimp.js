// A Jimp class that can actually decode WEBP.
//
// The bare `jimp` package only registers bmp/gif/jpeg/png/tiff (see its own
// `defaultFormats`) - no webp, even though `Jimp.read()` fails on one with a
// generic "does not support decoding" error that both cutout.service.js and
// segment.service.js were swallowing into the same unhelpful "could not be
// read from disk" message. A photograph saved as .webp (a Chrome screenshot,
// most phone camera exports) made "Remove background" fail on every path -
// the flood fill AND the U^2-Net segmenter both decode through this same
// class. Adding `@jimp/wasm-webp` (the same MIT-licensed family as `jimp`
// itself, pinned to the identical 1.6.1) via `createJimp()` is Jimp's own
// documented extension point for a format it does not ship by default.
//
// One shared instance rather than each service registering its own - the
// two services already had two copies of the same `getJimp()` before this,
// which is exactly the duplication CLAUDE.md flags as a failure mode.
//
// `@jimp/wasm-webp` decodes through `@jsquash/webp`, an Emscripten build that
// loads its .wasm by `fetch()`-ing a `file://` URL built from
// `import.meta.url` - a browser assumption. Node's built-in fetch (undici)
// does not implement the `file:` scheme at all ("not implemented... yet...",
// confirmed live - every webp decode failed with a bare "fetch failed").
// `@jsquash/webp` also exposes an `init(wasmModule)` escape hatch that skips
// fetch, but `@jimp/wasm-webp` calls the bare, argument-less `init()` itself
// on every decode (see its dist/esm/index.js), which unconditionally
// re-triggers the broken fetch path even after a caller has pre-warmed the
// module - so pre-compiling the .wasm ahead of time does not help.
//
// The fix that actually holds: patch `fetch` to serve `file:` URLs itself,
// scoped narrowly so a real network request is never touched. This is a gap
// in Node's fetch, not a bug in the wasm module, so patching fetch - not
// patching around `@jsquash/webp`'s own init call sites - is the fix that
// survives an upstream version bump of either package.
let filePatchApplied = false;
function ensureFileFetchSupport() {
  if (filePatchApplied) return;
  filePatchApplied = true;
  const fs = require('fs');
  const { fileURLToPath } = require('url');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input?.url;
    if (href && href.startsWith('file://')) {
      const buffer = fs.readFileSync(fileURLToPath(href));
      return new Response(buffer, { status: 200, headers: { 'Content-Type': 'application/wasm' } });
    }
    return originalFetch(input, init);
  };
}

let JimpModule = null;

async function getJimp() {
  if (!JimpModule) {
    ensureFileFetchSupport();
    const [{ createJimp }, { defaultFormats, defaultPlugins }, { default: webp }] = await Promise.all([
      import('@jimp/core'),
      import('jimp'),
      import('@jimp/wasm-webp'),
    ]);
    JimpModule = createJimp({
      formats: [...defaultFormats, webp],
      plugins: defaultPlugins,
    });
  }
  return JimpModule;
}

module.exports = { getJimp };
