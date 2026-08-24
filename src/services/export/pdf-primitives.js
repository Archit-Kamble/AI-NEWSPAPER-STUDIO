// A PDF file, written by hand.
//
// WHY BY HAND. This project ships no PDF library and adding one for this is a
// bad trade: every general-purpose PDF writer in npm either cannot embed a
// CID-keyed font from shaped glyph ids (which is the only way Devanagari can
// print correctly) or drags in a font engine that would become a SECOND
// opinion about glyph advances - and this codebase has spent a great deal of
// effort making sure there is exactly one. HarfBuzz already tells us the glyph
// ids and where each one goes; a PDF that draws those is about three hundred
// lines, and it is three hundred lines nobody has to keep in step with
// compose.js.
//
// Everything here is structure only: objects, streams, the cross-reference
// table and the trailer. It knows nothing about newspapers.

const zlib = require('zlib');

const NUMBER = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  // PDF has no exponent notation, and a press file full of 1e-7 is a press
  // file some RIPs refuse.
  return (Math.round(n * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '') || '0';
};

/** A PDF name, with the characters that must be escaped, escaped. */
const name = (value) => `/${String(value).replace(/[^\w.\-+]/g, (c) => `#${c.charCodeAt(0).toString(16).padStart(2, '0')}`)}`;

/** A PDF literal string. Bytes, not text: callers pass Latin-1 already. */
const literal = (value) => `(${String(value).replace(/[\\()]/g, (c) => `\\${c}`)})`;

/** A PDF hex string, which is how glyph ids reach a Type0 font. */
const hex = (bytes) => `<${Buffer.from(bytes).toString('hex')}>`;

/**
 * Builds a PDF one indirect object at a time.
 *
 * Objects are numbered from 1 in the order they are added; `reserve()` hands
 * out a number for an object whose body is not known yet, which is what a
 * page needs (it must name its content stream, which must name its resources,
 * which name the fonts, which are added last).
 */
class PdfBuilder {
  constructor() {
    this.objects = [];   // index 0 unused; objects[n] is the body of object n
    this.next = 1;
  }

  reserve() {
    const id = this.next;
    this.next += 1;
    this.objects[id] = null;
    return id;
  }

  put(id, body) {
    this.objects[id] = body;
    return id;
  }

  add(body) {
    return this.put(this.reserve(), body);
  }

  /**
   * A stream object. Compressed with Flate unless told not to - a page of
   * Devanagari is tens of thousands of glyph ids and compresses about 5:1,
   * and an uncompressed press PDF of a broadsheet is not something anybody
   * wants to email.
   */
  addStream(dict, data, { compress = true } = {}) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'binary');
    const body = compress ? zlib.deflateSync(raw, { level: 9 }) : raw;
    const entries = { ...dict, Length: body.length };
    if (compress) entries.Filter = entries.Filter ? [name('FlateDecode'), entries.Filter].join(' ') : name('FlateDecode');
    return this.add({ dict: entries, stream: body });
  }

  /** The whole file, as bytes. */
  build({ root, info }) {
    const chunks = [];
    let offset = 0;
    const push = (buffer) => {
      const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer, 'binary');
      chunks.push(bytes);
      offset += bytes.length;
    };

    // The binary comment on line two is what tells a transfer agent this is
    // not a text file. PDF 1.4: no transparency, which is what a press wants.
    push('%PDF-1.4\n');
    push(Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    const offsets = [0];
    for (let id = 1; id < this.next; id += 1) {
      offsets[id] = offset;
      const object = this.objects[id];
      push(`${id} 0 obj\n`);
      if (object && object.stream !== undefined) {
        push(`${dictionary(object.dict)}\nstream\n`);
        push(object.stream);
        push('\nendstream\n');
      } else {
        push(`${serialise(object)}\n`);
      }
      push('endobj\n');
    }

    const xref = offset;
    push(`xref\n0 ${this.next}\n`);
    push('0000000000 65535 f \n');
    for (let id = 1; id < this.next; id += 1) {
      push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
    }
    push(`trailer\n${dictionary({ Size: this.next, Root: `${root} 0 R`, ...(info ? { Info: `${info} 0 R` } : {}) })}\n`);
    push(`startxref\n${xref}\n%%EOF\n`);

    return Buffer.concat(chunks);
  }
}

function serialise(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return NUMBER(value);
  if (typeof value === 'string') return value;          // already a PDF token
  if (Array.isArray(value)) return `[${value.map(serialise).join(' ')}]`;
  if (typeof value === 'object') return dictionary(value);
  return String(value);
}

function dictionary(entries) {
  const body = Object.entries(entries)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${name(key)} ${serialise(value)}`)
    .join(' ');
  return `<< ${body} >>`;
}

module.exports = { PdfBuilder, name, literal, hex, NUMBER, dictionary, serialise };
