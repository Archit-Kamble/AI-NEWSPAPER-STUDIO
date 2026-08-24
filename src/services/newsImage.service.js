// AI-GENERATED PICTURES FOR A STORY - proposed, never placed.
//
// THE WORKFLOW IS THE FEATURE. A generated photograph is a proposal exactly as
// generated copy is:
//
//   story -> generate -> a person looks at it -> a person places and sizes it
//                     -> only THEN does the fill run, against the real
//                        geometry of the picture they actually placed
//
// Nothing here places a picture, sizes one, or marks one accepted. That is not
// caution for its own sake: where a photograph sits decides how the copy sets
// around it (compose/exclusion.js), so a machine that both invents the picture
// and decides where it goes has decided how the story reads. It is also the
// point at which a newspaper stops being edited by people.
//
// So this returns CANDIDATES. They are stored as ordinary media assets - the
// same table an upload lands in, so the existing placement path, the cut-out
// service and the exports all work on them without knowing where they came
// from - and the block is untouched until a desk drags one onto it.
//
// WHAT IS VERIFIED AND WHAT IS NOT. The request shape below is Google's
// documented image-generation call and the failure classification is the one
// the rest of this folder uses. It has NOT been run successfully against a live
// provider: the newsroom's key returns 429 (no image quota on the free tier)
// and Imagen 404s on this project. So the refusal path is exercised and the
// success path is not. Enable billing before an edition depends on it.

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const conditions = require('./ai/conditions');
const sectionImageRepository = require('../repositories/sectionImage.repository');

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');

const model = () => process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const key = () => process.env.GEMINI_API_KEY;

/** How many a desk is offered. More than one, because choosing is the point. */
const DEFAULT_COUNT = 2;
const MAX_COUNT = 4;

/**
 * The brief.
 *
 * A newspaper photograph is a record of something that happened, and a
 * generated one is not - so the brief says so in as many words and asks for
 * something generic enough to be honest: a scene, not an event; no faces that
 * could be taken for a real person; no text, because generated Devanagari is
 * gibberish and a reader would take it for the paper's own.
 */
function briefFor({ headline, subheading, body, location, category }) {
  const subject = [headline, subheading].filter(Boolean).join('. ')
    || String(body || '').slice(0, 240);
  return [
    'A documentary-style news photograph for a Marathi daily newspaper.',
    location ? `Setting: ${location}, Maharashtra, India.` : 'Setting: rural Maharashtra, India.',
    category ? `Section: ${category}.` : '',
    `Subject: ${subject}`,
    '',
    'Requirements:',
    '- A general scene that illustrates the subject. NOT a depiction of a specific real event.',
    '- No recognisable faces of real people, no public figures, no crowds of identifiable individuals.',
    '- No text, no signage, no watermarks, no logos of any kind.',
    '- Natural daylight, plain composition, room around the subject so it can be cropped to a column.',
    '- Landscape orientation.',
  ].filter(Boolean).join('\n');
}

/** Google's own words, classified once, where they are understood. */
function classify(status, detail) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'unavailable';
  if (status === 429) {
    return /quota|billing|plan/i.test(detail || '') ? 'quotaExhausted' : 'rateLimit';
  }
  if (status >= 500) return 'unavailable';
  return 'badShape';
}

async function requestImage(prompt, { signal } = {}) {
  const response = await fetch(`${BASE}/${model()}:generateContent?key=${key()}`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { condition: classify(response.status, detail), detail };
  }

  const payload = await response.json().catch(() => null);
  const part = payload?.candidates?.[0]?.content?.parts
    ?.find((p) => p.inlineData?.data);
  if (!part) return { condition: 'empty', detail: '' };
  return { data: Buffer.from(part.inlineData.data, 'base64'), mimeType: part.inlineData.mimeType || 'image/png' };
}

/**
 * Candidate pictures for a block, as media assets a desk can drag onto it.
 *
 * Returns `{ candidates, warning }`. `candidates` is empty and `warning` says
 * why when the provider cannot answer - never a throw, because a picture is an
 * optional embellishment and the editor must keep working without one.
 */
async function propose(section = {}, { count = DEFAULT_COUNT, ownerId = null, signal } = {}) {
  if (!key()) {
    return { candidates: [], warning: conditions.deskSentence('unconfigured', 'Google Gemini') };
  }
  const wanted = Math.max(1, Math.min(MAX_COUNT, Number(count) || DEFAULT_COUNT));
  const prompt = briefFor(section);

  const candidates = [];
  let warning = null;
  for (let i = 0; i < wanted; i += 1) {
    const result = await requestImage(prompt, { signal });
    if (result.condition) {
      // One failure ends the run. Asking again for a picture the provider has
      // just refused is latency the desk waits through and, on a metered
      // account, a second charge - the same rule ai/index.js already holds for
      // copy.
      warning = conditions.deskSentence(result.condition, 'Google Gemini');
      break;
    }
    candidates.push(await store(result, ownerId));
  }
  return { candidates, warning };
}

/**
 * A generated picture on disk and in media_assets - the same table an upload
 * lands in, so everything downstream works on it without special-casing.
 *
 * The filename says what it is. A newsroom that later has to answer "where did
 * this photograph come from" can answer it from the filename alone, which is a
 * question about a newspaper rather than about software.
 */
async function store({ data, mimeType }, ownerId) {
  const extension = mimeType.includes('png') ? 'png' : 'jpg';
  const name = `ai-${Date.now()}-${crypto.randomUUID()}.${extension}`;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, name), data);
  const url = `/uploads/${name}`;
  const asset = await sectionImageRepository.findOrCreateAsset({
    url, filename: name, mimeType, ownerId,
  });
  // Marked so a desk always knows, and so it can never be mistaken for a
  // photograph a reporter filed.
  return { ...asset, aiGenerated: true, url };
}

module.exports = { propose, briefFor, classify, DEFAULT_COUNT, MAX_COUNT };
