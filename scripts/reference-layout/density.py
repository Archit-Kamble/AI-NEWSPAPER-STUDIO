#!/usr/bin/env python3
"""Region-by-region DENSITY of a reference scan against a render, through the
spec's one declared transform (see compare.py).

  python3 scripts/reference-layout/density.py <scan.jpg> <spec-key> <render.png> [--dpr 4.33] [--block key]

For every panel and picture of every block (or one block) it reports, on both
sides: rows of type found (by shirorekha: the dense horizontal stroke every
Devanagari line hangs from), the median pitch between them in scan pixels, and
where the last ink stops. A panel that sets fewer rows than the scan, or stops
short of it, has lost copy or set it looser - the numbers say which.

These are DIAGNOSTICS. They say where the page differs; they are never a
licence to stretch type or change the copy to make a number agree.
"""
import argparse, json, subprocess, statistics
from pathlib import Path
from PIL import Image, ImageOps

REPO = Path(__file__).resolve().parents[2]
from compare import spec_of, ours_in_scan_space  # noqa: E402


def regions_of(key, only):
    js = f"""
    const spec = require('./src/layout/measured-pages/{key}');
    const out = [];
    for (const b of spec.blocks) {{
      if ({json.dumps(only)} && b.key !== {json.dumps(only)}) continue;
      (b.panels || []).forEach((p, i) => out.push({{ id: b.key + '/' + (p.id || ('panel-' + i)), kind: p.kind, box: p.box }}));
      (b.pictures || []).forEach((p, i) => out.push({{ id: b.key + '/picture-' + i, kind: 'picture', box: p.box }}));
    }}
    console.log(JSON.stringify(out));
    """
    out = subprocess.run(['node', '-e', js], cwd=REPO, capture_output=True, text=True, check=True)
    return json.loads(out.stdout.strip().splitlines()[-1])


def rows(img):
    """Shirorekha rows: local peaks of ink across a row, well above the median."""
    g = ImageOps.grayscale(img)
    w, h = g.size
    if w < 8 or h < 8:
        return [], None
    px = g.load()
    ink = [sum(1 for x in range(w) if px[x, y] < 120) / w for y in range(h)]
    floor = max(0.18, statistics.median(ink) * 2.2)
    peaks = []
    for y in range(1, h - 1):
        if ink[y] >= floor and ink[y] >= ink[y - 1] and ink[y] >= ink[y + 1]:
            if peaks and y - peaks[-1] < 12:
                if ink[y] > ink[peaks[-1]]:
                    peaks[-1] = y
            else:
                peaks.append(y)
    last = max((y for y in range(h) if ink[y] > 0.01), default=None)
    return peaks, last


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('scan'); ap.add_argument('spec'); ap.add_argument('render')
    ap.add_argument('--dpr', type=float, default=4.33)
    ap.add_argument('--block')
    a = ap.parse_args()
    t = spec_of(a.spec)
    s = t['scan']
    scan = Image.open(a.scan).convert('RGB').crop((s['x0'], s['y0'], s['x1'], s['y1']))
    ours = ours_in_scan_space(Image.open(a.render).convert('RGB'), t, a.dpr)
    print(f"{'region':34} {'kind':8} {'rows ref/ours':>14} {'pitch ref/ours':>16} {'ink ends ref/ours':>18}")
    for r in regions_of(a.spec, a.block):
        x0, y0, x1, y1 = r['box']
        box = (x0 - s['x0'], y0 - s['y0'], x1 - s['x0'], y1 - s['y0'])
        pr, lr = rows(scan.crop(box))
        po, lo = rows(ours.crop(box))
        def pitch(p):
            d = [b - a for a, b in zip(p, p[1:])]
            return f"{statistics.median(d):.1f}" if d else '-'
        flag = '  <<' if (len(pr) != len(po) or (lr is not None and lo is not None and abs(lr - lo) > 20)) else ''
        print(f"{r['id'][:34]:34} {r['kind'][:8]:8} {len(pr):>6}/{len(po):<7} {pitch(pr):>7}/{pitch(po):<8} {str(lr):>8}/{str(lo):<9}{flag}")


if __name__ == '__main__':
    main()
