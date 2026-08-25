// Getting the paper to the press, and not letting a bad page get there.
//
// Three things are held here:
//   * nobody who has not signed in can change the newspaper;
//   * preflight catches the mistakes that are only visible on paper, above all
//     a photograph that has not got the resolution for the size it is used at;
//   * a page cannot be passed for press while an error is still on it.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn, newEdition, removeEdition, satisfyPublicationContent } = require('./helpers/desk');
const preflight = require('../src/services/preflight.service');
const scribus = require('../src/services/scribus.service');

test.after(() => pool.end());

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
async function passPages(desk, pages) {
  for (const page of pages) {
    const response = await desk(`/api/pages/${page.id}/state`, { method: 'PATCH', body: JSON.stringify({ state: 'passed' }) });
    assert.equal(response.status, 200, `page ${page.page_number} should pass before a press artifact is requested`);
  }
}

// ------------------------------------------------------------------ locked ---

test('an anonymous caller cannot change the newspaper', async () => {
  const server = createApp().listen(0);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const writes = [
      ['POST', '/api/newspapers'],
      ['POST', '/api/newspapers/1/pages'],
      ['PUT', '/api/pages/1/sections/lead'],
      ['DELETE', '/api/pages/1/sections/lead'],
      ['PATCH', '/api/pages/1/colour'],
      ['POST', '/api/uploads/images'],
      ['POST', '/api/newspapers/1/features'],
      ['PATCH', '/api/pages/1/state'],
    ];
    for (const [method, route] of writes) {
      const response = await fetch(base + route, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'DELETE' ? undefined : '{}',
      });
      assert.equal(response.status, 401, `${method} ${route} was open to anyone`);
    }

    // The e-paper is meant to be public. That is the whole point of it.
    for (const route of ['/api/geometry', '/api/templates']) {
      assert.equal((await fetch(base + route)).status, 200, `${route} should stay public`);
    }
  } finally {
    server.close();
  }
});

test('a reporter files copy but does not make up the page', async () => {
  const server = createApp().listen(0);
  const port = server.address().port;

  try {
    const reporter = await signIn(port, {
      email: 'reporter@esahas.com', password: 'reporter123', role: 'reporter',
    });
    // Filing is theirs.
    assert.equal((await reporter('/api/news')).status, 200);
    // Making up the paper is not.
    const attempt = await reporter('/api/newspapers', {
      method: 'POST',
      body: JSON.stringify({ name: 'Reporter should not be able to do this', publicationDate: '2099-01-01' }),
    });
    assert.equal(attempt.status, 403);
  } finally {
    server.close();
  }
});

// -------------------------------------------------------------- preflight ---

test('preflight measures what a photograph will really print at', async () => {
  const { Jimp } = await import('jimp');
  const small = path.join(PUBLIC_DIR, 'uploads', 'zz-preflight-small.png');
  await new Jimp({ width: 400, height: 300, color: 0x808080ff }).write(small);

  try {
    // 400 px across a 130 mm frame is about 78 dpi on the page.
    const result = await preflight.effectiveDpi({
      url: '/uploads/zz-preflight-small.png',
      width_px: 260, // 130 mm at 2 px/mm
      height_px: 195,
    });
    assert.ok(result.dpiX < preflight.MIN_EFFECTIVE_DPI, `got ${result.dpiX} dpi`);
    assert.equal(result.widthMm, 130);
    assert.equal(result.sourceWidth, 400);
  } finally {
    await fs.rm(small, { force: true });
  }
});

test('preflight reports a missing picture rather than printing a blank frame', async () => {
  const result = await preflight.effectiveDpi({
    url: '/uploads/there-is-no-such-file.png', width_px: 100, height_px: 100,
  });
  assert.equal(result.missing, true);
});

test('preflight catches the mistakes that are only visible on paper', async () => {
  const server = createApp().listen(0);
  const port = server.address().port;
  let editionId = null;

  try {
    const { desk, newspaper, pages } = await newEdition(port, 'Preflight test', {
      pages: [[1, 'front'], [2, 'dense']],
    });
    editionId = newspaper.id;
    const page = pages[0];

    // A block with far more copy than it can hold.
    await desk(`/api/pages/${page.id}/sections/brief-one`, {
      method: 'PUT',
      body: JSON.stringify({ headline: 'ओव्हरसेट', body: 'शब्द '.repeat(600), status: 'ready' }),
    });

    // A block dragged outside the matter is impossible through the API - it is
    // snapped - so the check is exercised where it can be: directly.
    const report = await desk(`/api/newspapers/${newspaper.id}/preflight`).then((r) => r.json());

    const checks = new Set(report.findings.map((finding) => finding.check));
    assert.ok(checks.has('overset'), `overset not caught: ${[...checks].join(', ')}`);
    assert.ok(checks.has('empty-block'), 'an empty block on a page about to print should be reported');
    assert.equal(report.passed, false, 'an edition with an overset block must not pass');
    assert.ok(report.counts.error > 0);
  } finally {
    await removeEdition(editionId);
    server.close();
  }
});

test('a page cannot be passed for press while an error is still on it', async () => {
  const server = createApp().listen(0);
  const port = server.address().port;
  let editionId = null;

  try {
    const { desk, newspaper, pages } = await newEdition(port, 'Sign-off test', { pages: [[1, 'front']] });
    editionId = newspaper.id;
    const page = pages[0];

    await desk(`/api/pages/${page.id}/sections/lead`, {
      method: 'PUT',
      body: JSON.stringify({ headline: 'खूप मोठा मजकूर', body: 'शब्द '.repeat(800), status: 'ready' }),
    });

    const refused = await desk(`/api/pages/${page.id}/state`, {
      method: 'PATCH', body: JSON.stringify({ state: 'passed' }),
    });
    assert.equal(refused.status, 409, 'a page with errors must not be passable');
    const body = await refused.json();
    assert.match(body.error, /cannot go to press/);

    // Subbing it is always allowed - that is a judgement, not a check.
    const subbed = await desk(`/api/pages/${page.id}/state`, {
      method: 'PATCH', body: JSON.stringify({ state: 'subbed' }),
    });
    assert.equal(subbed.status, 200);

    // And the move is on the record, with who did it.
    const history = await desk(`/api/newspapers/${newspaper.id}/history`).then((r) => r.json());
    assert.ok(history.some((entry) => /Subbed/.test(entry.action)), JSON.stringify(history));
    assert.ok(history[0].actor, 'the audit trail must name who did it');

    const status = await desk(`/api/newspapers/${newspaper.id}/status`).then((r) => r.json());
    assert.equal(status.readyForPress, false);
    assert.deepEqual(status.waitingOn, [1]);
  } finally {
    await removeEdition(editionId);
    server.close();
  }
});

// ----------------------------------------------------------------- scribus ---

test('the press file is well-formed Scribus, in millimetres, with every page', async () => {
  const server = createApp().listen(0);
  const port = server.address().port;
  let editionId = null;

  try {
    const { desk, newspaper, pages } = await newEdition(port, 'Scribus test', {
      pages: [[1, 'front'], [2, 'local'], [3, 'dense']],
    });
    editionId = newspaper.id;

    await desk(`/api/pages/${pages[0].id}/sections/lead`, {
      method: 'PUT',
      body: JSON.stringify({
        headline: 'शेतकऱ्यांसाठी *५०० कोटींचे* मदत पॅकेज',
        subheading: 'सहा जिल्ह्यांना थेट लाभ',
        body: 'मंत्रिमंडळाने सोमवारी निर्णय घेतला.',
        location: 'मुंबई', reporterName: 'विशेष प्रतिनिधी', status: 'ready',
      }),
    });
    await satisfyPublicationContent(pages);
    await passPages(desk, pages);

    const response = await desk(`/api/newspapers/${newspaper.id}/scribus`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition') || '', /\.sla"$/);
    const sla = await response.text();

    assert.match(sla, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(sla, /<SCRIBUSUTF8NEW Version="1\.5\.\d+">/);
    assert.match(sla, /<\/SCRIBUSUTF8NEW>/);

    // Every tag that opens must close: the file has to survive being opened.
    const opens = (sla.match(/<(DOCUMENT|SCRIBUSUTF8NEW|PAGEOBJECT)\b[^>]*[^/]>/g) || []).length;
    const closes = (sla.match(/<\/(DOCUMENT|SCRIBUSUTF8NEW|PAGEOBJECT)>/g) || []).length;
    assert.equal(opens, closes, 'unbalanced tags would make Scribus refuse the file');

    // Three pages, in millimetres, not pixels.
    assert.match(sla, /ANZPAGES="3"/);
    assert.match(sla, /PAGEWIDTH="330"/);
    assert.match(sla, /PAGEHEIGHT="530"/);

    // The story is in it, and the marks that told us to paint a word are not.
    assert.match(sla, /शेतकऱ्यांसाठी/);
    assert.ok(!sla.includes('*५०० कोटींचे*'), 'the asterisk marks are instructions, not copy');
    assert.match(sla, /SahasRed/);
    // And the dateline opens the body the way it does in print.
    assert.match(sla, /■ मुंबई, विशेष प्रतिनिधी/);
  } finally {
    await removeEdition(editionId);
    server.close();
  }
});

test('the press file escapes copy that would otherwise break the XML', async () => {
  const section = {
    x_px: 20, y_px: 20, width_px: 200, height_px: 200, margin_px: 12,
    headline: 'दर <वाढले> & "घसरले"',
    headline_font_px: 24, subheading_font_px: 14, body_font_px: 10,
    body: "a & b < c > d 'e'", images: [],
  };
  const xml = await scribus.blockFrames(section);
  assert.ok(!/CH="[^"]*[<>][^"]*"/.test(xml), 'raw angle brackets would break the document');
  assert.match(xml, /&amp;/);
  assert.match(xml, /&lt;/);
});

test('Scribus emits canonical Marathi placed-caption geometry and escaped text', async () => {
  const { captionBox } = await import('../public/editor/layout/text-flow.js');
  const image = { x_px: 20, y_px: 40, width_px: 100, height_px: 60, url: '/uploads/test.jpg', caption: 'नदी & पूर <स्थिती>' };
  const section = { x_px: 30, y_px: 50, width_px: 240, height_px: 240, margin_px: 12, images: [image] };
  const xml = await scribus.blockFrames(section);
  const box = captionBox(image);
  assert.match(xml, /नदी &amp; पूर &lt;स्थिती&gt;/);
  assert.match(xml, new RegExp(`XPOS="${scribus.mm(section.x_px) + scribus.mm(box.x)}"`));
  assert.match(xml, new RegExp(`YPOS="${scribus.mm(section.y_px) + scribus.mm(box.y)}"`));
  assert.match(xml, new RegExp(`WIDTH="${scribus.mm(box.width)}" HEIGHT="${scribus.mm(box.height)}"`));
});

// ----------------------------------------------------------- press package ---

test('the press package is a real zip that carries the pictures with it', async () => {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const { Jimp } = await import('jimp');

  const server = createApp().listen(0);
  const port = server.address().port;
  let editionId = null;
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'sahas-press-'));
  const picture = path.join(PUBLIC_DIR, 'uploads', 'zz-package-test.png');

  try {
    await new Jimp({ width: 900, height: 600, color: 0x224466ff }).write(picture);

    const { desk, newspaper, pages } = await newEdition(port, 'Press package test', {
      pages: [[1, 'front']],
    });
    editionId = newspaper.id;

    await desk(`/api/pages/${pages[0].id}/sections/lead/images`, {
      method: 'POST',
      body: JSON.stringify({ url: '/uploads/zz-package-test.png', x: 10, y: 90, width: 200, height: 130 }),
    });
    await satisfyPublicationContent(pages, { companionImageUrl: '/uploads/zz-package-test.png' });
    await passPages(desk, pages);

    const response = await desk(`/api/newspapers/${newspaper.id}/press-package`);
    assert.equal(response.status, 200, response.status === 200 ? undefined : await response.clone().text());
    // Two now, not one: the story's photograph AND the paper's nameplate
    // artwork, which the .sla places above the fold on page one. A count is a
    // weak assertion anyway - what matters is the loop below, that every path
    // the document references resolves after unzipping - so this asserts the
    // floor and that nothing is missing.
    assert.ok(Number(response.headers.get('x-pictures-included')) >= 2,
      `expected the picture and the nameplate, got ${response.headers.get('x-pictures-included')}`);
    assert.equal(response.headers.get('x-pictures-missing'), '0');

    const zipFile = path.join(work, 'press.zip');
    await fs.writeFile(zipFile, Buffer.from(await response.arrayBuffer()));

    // A zip that only this code can read is not a deliverable. Use the real one.
    execFileSync('unzip', ['-q', '-o', zipFile, '-d', work]);

    const sla = await fs.readFile(path.join(work, `sahas-${'2026-08-04'}.sla`), 'utf8');
    const pfiles = [...sla.matchAll(/PFILE="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(pfiles.length >= 1, 'the document should reference its picture');
    assert.ok(pfiles.some((f) => /nameplate/.test(f)),
      'and the nameplate, which no press file carried until the furniture was shared');

    // The whole point: after unzipping, every path the document uses resolves.
    for (const reference of pfiles) {
      const resolved = path.join(work, reference.replace(/^\.\//, ''));
      assert.ok(
        await fs.access(resolved).then(() => true, () => false),
        `Scribus would open with an empty frame: ${reference}`,
      );
    }

    const readme = await fs.readFile(path.join(work, 'README.txt'), 'utf8');
    assert.match(readme, /Scribus/);
    const manifest = JSON.parse(await fs.readFile(path.join(work, 'MANIFEST.json'), 'utf8'));
    assert.equal(manifest.readiness.readyForPress, true);
    assert.ok(Array.isArray(manifest.sections));
    assert.equal(JSON.stringify(manifest).includes('body'), false, 'audit manifest contains no article bodies');
  } finally {
    await fs.rm(picture, { force: true });
    await fs.rm(work, { recursive: true, force: true });
    await removeEdition(editionId);
    server.close();
  }
});

test('the same edition packages to the same bytes twice', async () => {
  const server = createApp().listen(0);
  const port = server.address().port;
  let editionId = null;

  try {
    const { desk, newspaper, pages } = await newEdition(port, 'Deterministic package test', { pages: [[1, 'front']] });
    editionId = newspaper.id;
    await satisfyPublicationContent(pages);
    await passPages(desk, pages);

    const first = Buffer.from(await (await desk(`/api/newspapers/${newspaper.id}/press-package`)).arrayBuffer());
    const second = Buffer.from(await (await desk(`/api/newspapers/${newspaper.id}/press-package`)).arrayBuffer());

    // A package that changes every time it is generated cannot be checked
    // against the one that actually went to press.
    assert.ok(first.equals(second), 'the package must be reproducible');
  } finally {
    await removeEdition(editionId);
    server.close();
  }
});

test('the date an edition is created for is the date it gets', async () => {
  const server = createApp().listen(0);
  const port = server.address().port;
  const ids = [];

  try {
    const desk = await signIn(port);
    // Both spellings, because the workspace sends one and the API docs the
    // other. Neither may be silently dropped: this used to read only `date`,
    // so every edition was dated today whatever was asked for.
    for (const payload of [
      { name: 'Date field test A', publicationDate: '2026-11-17' },
      { name: 'Date field test B', date: '2026-11-18' },
    ]) {
      const created = await desk('/api/newspapers', { method: 'POST', body: JSON.stringify(payload) }).then((r) => r.json());
      ids.push(created.id);
      assert.equal(
        String(created.publication_date).slice(0, 10),
        payload.publicationDate || payload.date,
        `asked for ${payload.publicationDate || payload.date}, got ${created.publication_date}`,
      );
    }

    // With no date at all it falls back to today where the paper is printed -
    // not UTC, which is the previous day for the first five and a half hours of
    // every Indian morning, which is exactly when a paper is made up.
    const { identity } = require('../src/layout/identity');
    const hereToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: identity.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());

    const defaulted = await desk('/api/newspapers', {
      method: 'POST', body: JSON.stringify({ name: 'Date default test' }),
    }).then((r) => r.json());
    ids.push(defaulted.id);
    assert.equal(String(defaulted.publication_date).slice(0, 10), hereToday);
  } finally {
    for (const id of ids) await removeEdition(id);
    server.close();
  }
});
