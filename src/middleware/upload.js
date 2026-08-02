const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Do not let two files selected in the same upload overwrite each other.
    const extension = path.extname(file.originalname);
    cb(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: { files: 10, fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, file.mimetype.startsWith('image/'));
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

module.exports = { uploadsDir, storage, upload, publicationUpload };
