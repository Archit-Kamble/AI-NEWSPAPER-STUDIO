#!/usr/bin/env python3
"""Compares a rendered page against its reference scan through ONE declared
page transform - never by stretching each region to fit.

  python3 scripts/reference-layout/compare.py <scan.jpg> <spec-key> <render.png> <out-prefix>
          [--dpr 4.33] [--region block-key|x0,y0,x1,y1] [--pad 30]

The transform is the spec's own (src/layout/measured-pages/<spec-key>.js via
scan.js's scaler): editor x = 20 + (scan x - x0) * sx, editor y = top +
(scan y - y0) * sy. The render is mapped into SCAN pixels once, as a whole
page, and the anisotropy sy/sx is printed - a page whose sheet is not the
scan's shape is squashed by exactly that much, and it is a declared
difference, not something a comparison may quietly absorb.

Writes, for the whole page or one region:
  <out>-side.png    reference | ours
  <out>-overlay.png reference ink in red, ours in green, both in black -
                    a doubled rule is a position error, a drifting row of
                    type is a leading error
  <out>-blink.gif   the two alternating
  <out>-trace.html  the tracing layer: ours over the reference, an opacity
                    slider and a blink toggle (self-contained, open locally)
"""
import argparse, base64, io, json, subprocess
from pathlib import Path
from PIL import Image, ImageChops, ImageOps

REPO = Path(__file__).resolve().parents[2]


def spec_of(key):
    js = f"""
    const {{ buildMeasuredPage, scaler }} = require('./src/layout/measured-pages/scan');
    const spec = require('./src/layout/measured-pages/{key}');
    const bottom = spec.scan.bottom || 1008;
    const top = spec.scan.uniform
      ? bottom - (spec.scan.y1 - spec.scan.y0) * (620 / (spec.scan.x1 - spec.scan.x0))
      : spec.scan.top;
    const {{ sx, sy }} = scaler(spec.scan, top);
    console.log(JSON.stringify({{ scan: spec.scan, top, bottom, sx, sy,
      blocks: Object.fromEntries(spec.blocks.map((b) => [b.key, b.box])) }}));
    """
    out = subprocess.run(['node', '-e', js], cwd=REPO, capture_output=True, text=True, check=True)
    return json.loads(out.stdout.strip().splitlines()[-1])


def ours_in_scan_space(render, t, dpr):
    """The whole render mapped into the scan's pixel frame by the declared transform."""
    s = t['scan']
    left, top, right, bottom = 20, t['top'], 640, t['bottom']
    crop = render.crop((round(left * dpr), round(top * dpr), round(right * dpr), round(bottom * dpr)))
    return crop.resize((s['x1'] - s['x0'], s['y1'] - s['y0']), Image.LANCZOS)


def png_b64(img):
    buf = io.BytesIO()
    img.save(buf, 'PNG')
    return base64.b64encode(buf.getvalue()).decode()


def trace_html(ref, ours, title):
    w, h = ref.size
    return f"""<!doctype html><meta charset="utf-8"><title>{title}</title>
<style>body{{margin:0;font:14px system-ui;background:#eee}} header{{position:sticky;top:0;background:#fff;padding:8px 12px;display:flex;gap:16px;align-items:center;z-index:2;border-bottom:1px solid #ccc}}
.stage{{position:relative;width:{w}px;height:{h}px;margin:12px}} .stage img{{position:absolute;left:0;top:0;width:{w}px;height:{h}px}}
#ours{{opacity:.5}}</style>
<header><b>{title}</b>
<label>ours opacity <input id="op" type="range" min="0" max="100" value="50"></label>
<label><input id="blink" type="checkbox"> blink</label>
<label>zoom <input id="zoom" type="range" min="25" max="200" value="100"></label></header>
<div class="stage" id="stage"><img src="data:image/png;base64,{png_b64(ref)}"><img id="ours" src="data:image/png;base64,{png_b64(ours)}"></div>
<script>
const ours=document.getElementById('ours'), op=document.getElementById('op'), st=document.getElementById('stage');
op.oninput=()=>ours.style.opacity=op.value/100;
let t=null; document.getElementById('blink').onchange=(e)=>{{clearInterval(t); if(e.target.checked) t=setInterval(()=>ours.style.opacity=ours.style.opacity==='0'?'1':'0',500); else ours.style.opacity=op.value/100;}};
document.getElementById('zoom').oninput=(e)=>{{st.style.transform='scale('+e.target.value/100+')';st.style.transformOrigin='0 0';}};
</script>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('scan'); ap.add_argument('spec'); ap.add_argument('render'); ap.add_argument('out')
    ap.add_argument('--dpr', type=float, default=4.33)
    ap.add_argument('--region')
    ap.add_argument('--pad', type=int, default=30)
    a = ap.parse_args()

    t = spec_of(a.spec)
    s = t['scan']
    print(f"transform: editor x = 20 + (scan x - {s['x0']}) * {t['sx']:.5f};  editor y = {t['top']:.2f} + (scan y - {s['y0']}) * {t['sy']:.5f}")
    print(f"anisotropy sy/sx = {t['sy'] / t['sx']:.4f}  ({(t['sy'] / t['sx'] - 1) * 100:+.1f}% vertical)")
    print(f"scan px per editor px: x {1 / t['sx']:.3f}, y {1 / t['sy']:.3f}  (shoot with --dpr {1 / t['sx']:.2f})")

    scan = Image.open(a.scan).convert('RGB').crop((s['x0'], s['y0'], s['x1'], s['y1']))
    ours = ours_in_scan_space(Image.open(a.render).convert('RGB'), t, a.dpr)

    if a.region:
        if a.region in t['blocks']:
            x0, y0, x1, y1 = t['blocks'][a.region]
        else:
            x0, y0, x1, y1 = map(int, a.region.split(','))
        box = (max(0, x0 - s['x0'] - a.pad), max(0, y0 - s['y0'] - a.pad),
               min(scan.size[0], x1 - s['x0'] + a.pad), min(scan.size[1], y1 - s['y0'] + a.pad))
        scan, ours = scan.crop(box), ours.crop(box)

    side = Image.new('RGB', (scan.size[0] * 2 + 12, scan.size[1]), (220, 0, 0))
    side.paste(scan, (0, 0)); side.paste(ours, (scan.size[0] + 12, 0))
    side.save(f'{a.out}-side.png')
    r, o = ImageOps.grayscale(scan), ImageOps.grayscale(ours)
    Image.merge('RGB', (o, r, ImageChops.darker(r, o))).save(f'{a.out}-overlay.png')
    scan.save(f'{a.out}-blink.gif', save_all=True, append_images=[ours], duration=600, loop=0)
    Path(f'{a.out}-trace.html').write_text(trace_html(scan, ours, f"{a.spec} {a.region or 'page'}"))
    print('wrote', f'{a.out}-side.png', f'{a.out}-overlay.png', f'{a.out}-blink.gif', f'{a.out}-trace.html')


if __name__ == '__main__':
    main()
