# A MEASURED REFERENCE PAGE -> a template on the reference's own grid, a recipe,
# and local photo crops. See CLAUDE.md, "Copying a reference paper's page".
#
#   REFERENCE_SCANS=<dir of p-NNN.jpg> python3 scripts/reference-layout/gen.py front_spec
#   python3 scripts/reference-layout/write.py broadsheet-front
#
# A spec (specs/*.py) holds rectangles in SCAN pixels, measured type sizes in
# scan ems, and the colours sampled with colours.py - never the reference's
# words or pictures. Crops go to public/uploads/reference-lokmat/, which is
# gitignored: a reference paper's photographs are for local calibration only.
import sys, json, importlib, os
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'specs'))
SCANS = os.environ.get('REFERENCE_SCANS', '.')
OUT = os.environ.get('REFERENCE_OUT', '.')
from PIL import Image
S = importlib.import_module(sys.argv[1])
SX = 620 / (S.X1 - S.X0); SY = (1008 - S.EY0) / (S.Y1 - S.Y0)
def ex(x): return 20 + (x - S.X0) * SX
def ey(y): return S.EY0 + (y - S.Y0) * SY
HEAD_RATIO = {'khand': 0.67, 'khand-light': 0.65, 'mukta': 0.64, 'sans': 0.625}
def em(scan_em, face): return round(scan_em * 0.625 / HEAD_RATIO[face] * SY * 2) / 2
L = [20, 110, 200, 290, 379, 469, 559]; Rt = [101, 191, 281, 370, 460, 550, 640]
blocks = []
for key, (x0, y0, x1, y1), o in S.BLOCKS:
    col = min(range(7), key=lambda i: abs(L[i] - ex(x0)))
    last = min(range(7), key=lambda i: abs(Rt[i] - ex(x1)))
    blocks.append(dict(key=key, col=col, span=last - col + 1, x=L[col], r=Rt[last], y=ey(y0), o=o))
for b in blocks:
    b['y'] = max(S.EY0, S.EY0 + round((b['y'] - S.EY0) / 8) * 8)
# Two neighbours that round onto one shared column: the right-hand block starts
# after the left-hand block's last column (a 3.5-column advert is the case).
raw = {key: box for key, box, o in S.BLOCKS}
for b in blocks:
    for a in blocks:
        if a is b: continue
        rb, ra = raw[b['key']], raw[a['key']]
        vertical = ra[1] < rb[3] - 20 and rb[1] < ra[3] - 20
        if vertical and rb[0] > ra[0] and b['col'] <= a['col'] + a['span'] - 1:
            last = b['col'] + b['span'] - 1
            b['col'] = a['col'] + a['span']
            b['span'] = max(1, last - b['col'] + 1)
            b['x'] = L[b['col']]; b['r'] = Rt[b['col'] + b['span'] - 1]
for b in blocks:
    below = [a for a in blocks if a is not b and a['x'] < b['r'] and b['x'] < a['r'] and a['y'] > b['y']]
    b['b'] = min(a['y'] for a in below) - 8 if below else 1008
by = {b['key']: b for b in blocks}
def rel(key, box, clear=0):
    b = by[key]; x0, y0, x1, y1 = box
    X, Y = ex(x0) - b['x'], ey(y0) - b['y']; W, H = ex(x1) - ex(x0), ey(y1) - ey(y0)
    w, h = b['r'] - b['x'], b['b'] - b['y']
    X = max(0, min(X, w - 4)); Y = max(0, min(Y, h - 4))
    if clear and Y < 80: Y += clear; H -= clear
    return dict(x=round(X), y=round(Y), width=max(8, round(min(W, w - X))), height=max(8, round(min(H, h - Y))))
# PHOTOS = 'auto': every photograph detected on the scan (photos.py) goes to the
# editorial block containing its centre; adverts draw their own artwork.
if S.PHOTOS == 'auto':
    found = json.load(open(os.path.join(SCANS, S.SCAN.replace('.jpg', '-photos.json'))))
    auto = {}
    for i, (px0, py0, px1, py1, _) in enumerate(found):
        cx, cy = (px0 + px1) / 2, (py0 + py1) / 2
        for key, (x0, y0, x1, y1), o in S.BLOCKS:
            if o.get('type') == 'advert': continue
            if x0 <= cx <= x1 and y0 <= cy <= y1:
                auto.setdefault(key, []).append((f"{S.KEY}-{key}-{i}.jpg", (max(px0, x0), max(py0, y0), min(px1, x1), min(py1, y1))))
                break
    S.PHOTOS = auto
for key, items in S.PHOTOS.items():
    for f, box in items:
        Image.open(os.path.join(SCANS, S.SCAN)).convert('RGB').crop(box).save(os.path.join(REPO, 'public/uploads/reference-lokmat', f), quality=92)
recipe = {}
for key, st in S.STYLE.items():
    if st.get('advert'):
        recipe[key] = dict(advert=True); continue
    face = st['face']
    style = dict(displayFamily=face, fontFamily='sans', headlineFontPx=em(st['head'], face), headlineLocked=True,
                 bodyFontPx=round(st.get('body', 25.6) * SY * 10) / 10,
                 lineHeight=max(1.305, round(st.get('pitch', 34) / st.get('body', 25.6), 3)),
                 columnCount=by[key]['span'] if st.get('cols') is None else st['cols'], textAlign='justify')
    if 'deck' in st:
        style.update(subheadingFontPx=em(st['deck'], st.get('deckFace', face)), subheadingLocked=True)
    for src, dst in (('headlineStyle', 'headlineStyle'), ('accent', 'accentColor'), ('rule', 'borderInk'), ('align', 'headlineAlign'), ('ground', 'backgroundColor'), ('radius', 'borderRadiusPx'), ('border', 'borderStyle'), ('headInk', 'headlineInk')):
        if src in st: style[dst] = st[src]
    clear = S.CLEAR.get(key, 0)
    pics = [dict(file='reference-lokmat/' + f, **rel(key, box, clear)) for f, box in S.PHOTOS.get(key, [])]
    pans = []
    for kind, box, extra in S.PANELS.get(key, []):
        entry = dict(kind=kind, **rel(key, box, S.CLEAR.get(key, 0)))
        for k in ('tint', 'marker', 'card'):
            if k in extra: entry[k] = extra[k]
        entry['titlePx'] = round(extra.get('titleEm', 38) * SY * 10) / 10
        entry['linePx'] = round(25.6 * SY * 10) / 10
        entry['n'] = extra.get('n', 3)
        pans.append(entry)
    recipe[key] = dict(style=style, pictures=pics, panels=pans, kicker=st.get('kicker'))
json.dump(dict(key=S.KEY, name=S.NAME, desc=S.DESC, blocks=blocks, recipe=recipe), open(os.path.join(OUT, S.KEY + '-gen.json'), 'w'), ensure_ascii=False, indent=1)
for b in blocks: print(b['key'].ljust(16), b['col'], b['span'], round(b['y']), b['b'] - round(b['y']))
