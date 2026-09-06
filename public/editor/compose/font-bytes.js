/**
 * THE PUBLICATION FACES, READ ONCE.
 *
 * `font-metrics.js` and `shaper.js` each carried their own byte-identical
 * `readFontFile()` and each independently fetched EVERY face - the metrics
 * reader to parse hmtx and cmap, the shaper to hand the same bytes to
 * HarfBuzz. Both run on the first paint of every edition, so a desk opening a
 * paper downloaded the paper's ten faces twice: 3.2 MB of TTF became 6.4 MB
 * over the wire, on the one request a desk waits through before the sheet
 * appears.
 *
 * A second copy of the same function is also the drift this project has been
 * bitten by repeatedly - and this pair had already drifted once in spirit, in
 * that one of them documented the two-runtime split and the other did not.
 * `layout/typefaces.js` says the same thing about three copies of the face
 * catalogue.
 *
 * The cache is keyed by PATH and holds the ArrayBuffer, handing each caller
 * its own view. Neither reader writes to the bytes - the metrics reader walks
 * them through a DataView and HarfBuzz copies them into its own WASM heap - so
 * one buffer is safe, and a view rather than a copy is what keeps this from
 * trading network for memory.
 *
 * A failed read is deliberately NOT cached. A face that could not be fetched
 * because the connection dropped must be askable again; caching the failure
 * would make one bad moment permanent for the life of the tab, which is the
 * fault this codebase already fixed for the templates and geometry caches.
 */

const bytes = new Map();

export function readFontFile(path) {
  const cached = bytes.get(path);
  if (cached) return cached.then((buffer) => new Uint8Array(buffer));

  // One module, two runtimes. The server reads the file off disk; the browser
  // asks for the same URL the @font-face rule already asks for, so the bytes
  // measured here are the bytes that paint.
  const reading = (async () => {
    if (typeof process !== 'undefined' && process.versions?.node) {
      const { readFile } = await import('node:fs/promises');
      const { fileURLToPath } = await import('node:url');
      const here = fileURLToPath(import.meta.url);
      const root = here.slice(0, here.indexOf('/public/'));
      const file = await readFile(`${root}/public${path}`);
      return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    }
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${path} could not be read`);
    return response.arrayBuffer();
  })();

  bytes.set(path, reading);
  reading.catch(() => bytes.delete(path));
  return reading.then((buffer) => new Uint8Array(buffer));
}
