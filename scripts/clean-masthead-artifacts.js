const path = require('path');
const target = path.join(__dirname, '..', 'public', 'assets', 'masthead', 'sahas-nameplate.png');

(async () => {
  const { Jimp } = await import('jimp'); const image = await Jimp.read(target);
  const { data, width, height } = image.bitmap; const seen = new Set(); const key = (x, y) => `${x}:${y}`;
  const coloured = (x, y) => {
    if (x < 0 || x >= width || y < height - 14 || y >= height) return false;
    const i = (y * width + x) * 4;
    return data[i + 3] > 0 && Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 40;
  };
  const islands = [];
  for (let y = height - 14; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (seen.has(key(x, y)) || !coloured(x, y)) continue;
    const points = [[x, y]]; seen.add(key(x, y));
    for (let i = 0; i < points.length; i += 1) { const [px, py] = points[i]; for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (!seen.has(key(px + dx, py + dy)) && coloured(px + dx, py + dy)) { seen.add(key(px + dx, py + dy)); points.push([px + dx, py + dy]); } }
    if (points.length <= 30) islands.push(points);
  }
  for (const points of islands) for (const [x, y] of points) { const i = (y * width + x) * 4; data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 0; }
  await image.write(target); console.log(`Removed ${islands.length} isolated nameplate artefact islands.`);
})().catch((error) => { console.error(error.message); process.exit(1); });
