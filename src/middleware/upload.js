const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const multer = require('multer');

const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// WHAT A PICTURE MAY BE CALLED, AND WHAT IT MUST ACTUALLY CONTAIN.
//
// The extension used to be taken from `file.originalname` and the only check
// was `file.mimetype.startsWith('image/')`. BOTH of those are the caller's
// own words - a browser sends whatever Content-Type it likes, and the filename
// is a string in the request. So a file called `evil.html`, declared
// `image/png`, was written to `public/uploads/<uuid>.html` and served straight
// back by `express.static` as `text/html`:
//
//   $ curl .../uploads/1787919329122-<uuid>.html
//   <script>alert(document.domain)</script>          200 text/html
//
// That is stored cross-site scripting on the newsroom's own origin, and the
// sessions live on that origin - so any account that can upload (a reporter
// needs only `requireSignIn`) could run script in an editor's or the owner's
// browser and take the paper over. Verified by doing it, then removed.
//
// Three things close it, and they are deliberately layered, because each one
// alone has a hole:
//
//   1. the mimetype must be one this paper actually prints, exactly - not
//      "starts with image/", which admits `image/svg+xml`, and an SVG is a
//      document that can carry script;
//   2. the stored extension comes from THAT whitelist, never from the caller's
//      filename, so the name on disk cannot be chosen at all;
//   3. the bytes are read back and checked against the format's own signature,
//      because a caller can state `image/png` for anything.
//
// `X-Content-Type-Options: nosniff` in server.js is the fourth layer, so a
// browser cannot decide for itself that one of these is really HTML.

// The formats a newspaper page actually places, and the one extension each is
// stored under. A format not in here cannot be uploaded, which is the point.
const IMAGE_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/pjpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/bmp', '.bmp'],
  ['image/tiff', '.tif'],
]);

// The first bytes each format must begin with. A picture that does not start
// with its own signature is not that picture, whatever the request called it.
const SIGNATURES = {
  '.jpg': [[0xff, 0xd8, 0xff]],
  '.png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  '.gif': [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
  '.bmp': [[0x42, 0x4d]],
  '.tif': [[0x49, 0x49, 0x2a, 0x00], [0x4d, 0x4d, 0x00, 0x2a]],
  // RIFF....WEBP - the format's own two marks, four bytes apart.
  '.webp': [[0x52, 0x49, 0x46, 0x46]],
};

function startsWith(buffer, bytes) {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, i) => buffer[i] === byte);
}

/** Whether these opening bytes really are the format this extension claims. */
function looksLikeImage(buffer, extension) {
  const signatures = SIGNATURES[extension];
  if (!signatures) return false;
  if (!signatures.some((bytes) => startsWith(buffer, bytes))) return false;
  // WebP's signature is split: "RIFF" then, four bytes on, "WEBP".
  if (extension === '.webp') {
    return buffer.length >= 12 && buffer.slice(8, 12).toString('latin1') === 'WEBP';
  }
  return true;
}

/**
 * Reads back what was written and removes anything that is not the picture it
 * said it was.
 *
 * Multer's `fileFilter` runs before a byte has been stored, so it can only ever
 * judge the request's own claims. This is the check that can look at the file,
 * and it runs after multer and before any route sees it - so a rejected upload
 * never reaches the newsroom and never stays on disk.
 */
async function verifyUploadedImages(req, res, next) {
  const files = [].concat(req.files || [], req.file ? [req.file] : []);
  if (!files.length) return next();

  const bad = [];
  for (const file of files) {
    let handle = null;
    try {
      handle = await fsp.open(file.path, 'r');
      const buffer = Buffer.alloc(16);
      const { bytesRead } = await handle.read(buffer, 0, 16, 0);
      if (!looksLikeImage(buffer.slice(0, bytesRead), path.extname(file.path).toLowerCase())) {
        bad.push(file);
      }
    } catch {
      bad.push(file);
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  if (!bad.length) return next();
  await Promise.all(bad.map((file) => fsp.unlink(file.path).catch(() => {})));
  const error = new Error('That file is not a picture this paper can place. Upload a JPEG, PNG, GIF, WebP, BMP or TIFF.');
  error.status = 400;
  return next(error);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // The extension is THIS PAPER'S, from the type whitelist - never the
    // caller's filename. A name on disk that the request can choose is how a
    // picture upload becomes an HTML page. Anything not in the map is not an
    // image route upload and keeps its own checked extension (.sla/.pdf).
    const fromType = IMAGE_TYPES.get(String(file.mimetype || '').toLowerCase());
    const checked = fromType || safeDocumentExtension(file);
    cb(null, `${Date.now()}-${crypto.randomUUID()}${checked}`);
  },
});

/**
 * The extension for the press documents, taken from the FIELD the route
 * declared rather than from the filename - `publicationUpload` already refuses
 * anything else, so this can only ever be one of two values.
 */
function safeDocumentExtension(file) {
  if (file.fieldname === 'scribusFile') return '.sla';
  if (file.fieldname === 'printPdf') return '.pdf';
  return '.bin';
}

const upload = multer({
  storage,
  limits: { files: 10, fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // An exact whitelist, not `startsWith('image/')`. That test admitted
    // `image/svg+xml`, and an SVG is a document that can carry script.
    cb(null, IMAGE_TYPES.has(String(file.mimetype || '').toLowerCase()));
  },
});

const publicationUpload = multer({
  storage,
  limits: { files: 2, fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed =
      file.fieldname === 'scribusFile'
        ? /\.sla$/i.test(file.originalname)
        : file.fieldname === 'printPdf' &&
          (file.mimetype === 'application/pdf' ||
            /\.pdf$/i.test(file.originalname));
    cb(
      allowed
        ? null
        : new Error('Upload a Scribus .sla file and/or a PDF file'),
      allowed,
    );
  },
});

module.exports = { uploadsDir, storage, upload, publicationUpload, verifyUploadedImages, looksLikeImage, IMAGE_TYPES };
