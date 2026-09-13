# gen json -> templates.js entry (replacing or inserting) + design-recipes.js entry
import sys, json, os
R = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')) + '/'
OUT = os.environ.get('REFERENCE_OUT', '.')
g = json.load(open(os.path.join(OUT, sys.argv[1] + '-gen.json')))
key = g['key']
def v(x): return json.dumps(x, ensure_ascii=False).replace('"', "'")
lines = []
for b in g['blocks']:
    o = b['o']
    opt = "{ type: 'advert', story: 'ADVERTISEMENT', priority: 1 }" if o.get('type') == 'advert' else \
        "{ " + (f"type: '{o['type']}', " if 'type' in o else '') + f"story: '{o['story']}', priority: {o['p']}" + " }"
    y = round(b['y'])
    lines.append(f"      frame('{b['key']}', {b['col']}, {b['span']}, {y}, {b['b'] - y}, {opt}),")
entry = f"""  '{key}': {{
    key: '{key}',
    name: '{g['name']}',
    grid: REFERENCE_GRID,
    description: '{g['desc']}',
    // MEASURED off the reference scan onto its own seven-column grid, tops on
    // the baseline and closed to the one 8 px gap. Generated, so literals.
    sections: [
{chr(10).join(lines)}
    ],
  }},

"""
p = R + 'src/layout/templates.js'; s = open(p).read()
marker = f"  '{key}': {{\n"
start = s.index(marker)
nxt = s.find("\n  '", start + len(marker))
# the end of this entry is the next top-level key or the rest comment / features
cands = [i for i in (s.find("\n  '", start + len(marker)), s.find("\n  // THE REST OF THE REFERENCE PAPER", start), s.find("\n  // NO TEMPLATE SHIPS", start), s.find("\n  features: {", start)) if i != -1]
stop = min(cands) + 1
s = s[:start] + entry + s[stop:]
open(p, 'w').write(s)
# recipe
p = R + 'src/layout/design-recipes.js'; s = open(p).read()
if all(e.get('advert') for e in g['recipe'].values()):
    print('written', key, '(template only; an all-advert page keeps its recipe)'); raise SystemExit(0)
assert f"  '{key}': {{\n" in s, f'no multi-line recipe entry for {key}'
out = [f"  // MEASURED off the reference scan: sizes from each head's shirorekha, body at",
       f"  // the reference's own em and pitch, its colours, its picture and panel boxes.",
       f"  '{key}': {{"]
ads = ['gold', 'insurance', 'family', 'ayurveda', 'masala', 'oil', 'travel', 'tour', 'pharma', 'bank', 'college', 'exam', 'notice', 'tender', 'power', 'strip', 'whole']
ai = 0
for k, e in g['recipe'].items():
    if e.get('advert'):
        out.append(f"    '{k}': ADS.{ads[ai % len(ads)]},"); ai += 1; continue
    st = "{ " + ", ".join(f"{a}: {v(b)}" for a, b in e['style'].items()) + " }"
    pics = ", ".join("{ " + f"file: '{q['file']}', x: {q['x']}, y: {q['y']}, width: {q['width']}, height: {q['height']}" + " }" for q in e['pictures'])
    def pan(q):
        extra = ''.join(f"{a}: {v(q[a])}, " for a in ('tint', 'marker', 'card') if a in q)
        body = '' if q['kind'] == 'chart' else f", title: PLACEHOLDER, lines: points({max(1, q['n'])})"
        return "{ " + f"kind: '{q['kind']}', {extra}x: {q['x']}, y: {q['y']}, width: {q['width']}, height: {q['height']}, titlePx: {q['titlePx']}, linePx: {q['linePx']}{body}" + " }"
    pans = ", ".join(pan(q) for q in e['panels'])
    kick = f"\n      fixtureKicker: '{e['kicker']}'," if e.get('kicker') else ''
    out.append(f"    '{k}': {{\n      style: {st},{kick}\n      pictures: [{pics}],\n      panels: [{pans}],\n    }},")
out.append("  },\n\n")
block = "\n".join(out)
mstart = s.find(f"  '{key}': {{\n")
# include a preceding MEASURED comment if present
prev = s.rfind("  // MEASURED off the reference", 0, mstart)
if prev != -1 and s[prev:mstart].count("\n") <= 3: mstart = prev
cands = [s.find(f"\n  '{x}': {{", s.find(f"  '{key}': {{", mstart) + 10) for x in ['broadsheet-front', 'broadsheet-sport', 'broadsheet-jacket', 'broadsheet-city', 'broadsheet-state', 'broadsheet-local', 'broadsheet-opinion', 'broadsheet-advertorial', 'broadsheet-local-sport', 'broadsheet-miscellany', 'broadsheet-business', 'broadsheet-world'] if x != key]
cands += [s.find("\n  // MEASURED off the reference", s.find(f"  '{key}': {{", mstart) + 10), s.find("\n};", mstart)]
assert s.count(f"\n  '{key}': {{") == 1, 'duplicate recipe entry'
stop = min(i for i in cands if i != -1) + 1
s = s[:mstart] + block + s[stop:]
open(p, 'w').write(s)
print('written', key)
