const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');
const VIDEO = process.argv[2];
const OUT = process.argv[3];

// Chrome will not load a file:// video into an about:blank document, so the
// recording is served over loopback for the length of this script.
const server = http.createServer((req, res) => {
  const stat = fs.statSync(VIDEO);
  const range = req.headers.range;
  if (range) {
    const [s, e] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(s, 10);
    const end = e ? parseInt(e, 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'video/webm',
    });
    fs.createReadStream(VIDEO, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes' });
    fs.createReadStream(VIDEO).pipe(res);
  }
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await p.setContent(`<body style="margin:0;background:#000">
    <video id="v" src="http://127.0.0.1:${port}/rec.webm" preload="auto" style="width:100%;display:block"></video></body>`);
  await p.waitForFunction(() => { const v = document.getElementById('v'); return v && v.readyState >= 2 && isFinite(v.duration) && v.duration > 0; }, { timeout: 90000 });
  const info = await p.evaluate(() => { const v = document.getElementById('v'); return { d: v.duration, w: v.videoWidth, h: v.videoHeight }; });
  console.log(`duration ${info.d.toFixed(1)}s, native ${info.w}x${info.h}`);
  const N = Number(process.env.FRAMES || 24);
  for (let i = 0; i < N; i++) {
    const t = (info.d * (i + 0.5)) / N;
    await p.evaluate((time) => new Promise((res, rej) => {
      const v = document.getElementById('v');
      const done = () => { v.removeEventListener('seeked', done); res(); };
      v.addEventListener('seeked', done);
      v.currentTime = time;
      setTimeout(res, 5000);
    }), t);
    await p.waitForTimeout(150);
    await p.locator('#v').screenshot({ path: path.join(OUT, `f${String(i).padStart(2, '0')}-${t.toFixed(0)}s.png`) });
  }
  await b.close();
  server.close();
  console.log('frames written');
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
