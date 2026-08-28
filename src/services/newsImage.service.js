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
/**
 * The brief for a DISPLAY ADVERTISEMENT's artwork, which is a different job
 * from a news photograph and must not borrow its brief.
 *
 * A news picture is a record of something and this project's brief says so at
 * length. An advert's artwork is openly a made image: it illustrates a product
 * or a service, it is composed to sit behind or beside set type, and it may
 * not carry text of its own - generated Devanagari is unreadable, and the
 * advertiser's own words are set by the compositor, not drawn by a model.
 *
 * `aspect` is the shape of the hole the artwork is going into, so what comes
 * back fits the block rather than being cropped to fit it.
 */
function advertBriefFor({ advertiser, headline, subject, aspect = '4:3', look = '' } = {}) {
  const what = [headline, subject].filter(Boolean).join('. ') || String(advertiser || '');
  const wanted = String(look || '').trim();
  return [
    'A clean, uncluttered illustration for a display advertisement in a Marathi daily newspaper.',
    `Subject: ${what}`,
    // THE DESIGN THE NEWSROOM ASKED FOR, and only that.
    //
    // When a desk asks the paper's own AI to design the advert, the model
    // writes this line and it is what makes two adverts from the same copy two
    // different pictures. It is added to the brief and never replaces it: the
    // requirements below are the NEWSPAPER's - no lettering, no real faces,
    // readable at newsprint screen - and a written brief may not lift them.
    ...(wanted ? [`Look and treatment: ${wanted}`] : []),
    '',
    'Requirements:',
    '- NO text, no lettering, no numerals, no signage, no logos, no watermarks of any kind.',
    '  The advertiser\'s own words are set as type by the newspaper, never drawn into the image.',
    '- No recognisable faces of real people and no public figures.',
    '- Simple, bright, high-contrast composition that stays readable at newsprint screen.',
    '- Generous plain area so the compositor can set type over or beside it.',
    `- Aspect ratio approximately ${aspect}.`,
  ].join('\n');
}

async function propose(section = {}, {
  count = DEFAULT_COUNT, ownerId = null, signal, brief = null,
} = {}) {
  if (!key()) {
    return { candidates: [], warning: conditions.deskSentence('unconfigured', 'Google Gemini') };
  }
  const wanted = Math.max(1, Math.min(MAX_COUNT, Number(count) || DEFAULT_COUNT));
  // A caller with its own brief supplies it - an advertisement's artwork is
  // not a news photograph and must not be asked for as one.
  const prompt = brief || briefFor(section);

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

module.exports = { propose, briefFor, advertBriefFor, classify, DEFAULT_COUNT, MAX_COUNT };
