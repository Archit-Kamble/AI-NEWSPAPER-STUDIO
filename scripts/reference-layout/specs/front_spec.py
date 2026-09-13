KEY = 'broadsheet-front'; NAME = 'Broadsheet front (reference)'
DESC = 'A five-column opening package with the corner advert, a market rail and news shorts, a four-column picture lead, a right-hand pair, two reports, a separator-led feature with its chart, and a display advert.'
SCAN = 'p-002.jpg'
X0, X1 = 57, 2744
Y0, Y1, EY0 = 485, 4295, 144
BLOCKS = [
  ('package', (57, 485, 2004, 1168), dict(story='LEAD', p=4)),
  ('corner-advert', (2058, 485, 2744, 1166), dict(type='advert')),
  ('rail-markets', (58, 1200, 407, 1913), dict(type='briefs', story='BRIEF', p=2)),
  ('rail-shorts', (58, 1945, 407, 2905), dict(type='briefs', story='BRIEF', p=2)),
  ('lead', (446, 1200, 2013, 2905), dict(story='LEAD', p=5)),
  ('right-top', (2057, 1200, 2744, 2185), dict(story='SECONDARY', p=4)),
  ('right-foot', (2057, 2219, 2744, 3412), dict(story='SECONDARY', p=3)),
  ('report-left', (57, 2934, 1190, 3416), dict(story='STANDARD', p=3)),
  ('report-right', (1225, 2933, 2015, 3416), dict(story='STANDARD', p=3)),
  ('feature-strip', (56, 3451, 2010, 4295), dict(story='ANALYSIS', p=3)),
  ('foot-advert', (2063, 3451, 2744, 4292), dict(type='advert')),
]
PHOTOS = {
  'package': [('front-package.jpg', (1224, 608, 1552, 1168))],
  'rail-shorts': [('front-shorts.jpg', (58, 2099, 407, 2508))],
  'lead': [('front-lead1.jpg', (835, 1688, 2012, 1960)), ('front-lead2.jpg', (1611, 2152, 2011, 2424))],
  'right-foot': [('front-rightfoot.jpg', (2440, 2400, 2744, 2600))],
  'feature-strip': [('front-feature.jpg', (448, 3760, 792, 4296))],
}
PANELS = {
  'package': [('sidebar', (835, 605, 1190, 1160), dict(n=6)), ('sidebar', (1593, 607, 2004, 1156), dict(marker='number', n=3))],
  'lead': [('sidebar', (858, 2172, 1156, 2833), dict(tint='#f4e4dc', n=6)), ('sidebar', (1223, 2149, 1572, 2871), dict(marker='number', n=3)), ('sidebar', (1611, 2445, 2008, 2868), dict(n=5))],
  'feature-strip': [('chart', (835, 3763, 1180, 4293), dict(card={'chartType': 'stat', 'unit': '%', 'items': [{'label': 'इथे मजकूर लिहा १', 'value': 74}, {'label': 'इथे मजकूर लिहा २', 'value': 69}, {'label': 'इथे मजकूर लिहा ३', 'value': 48}]})), ('sidebar', (1222, 3758, 1563, 4291), dict(n=6)), ('sidebar', (1610, 3758, 2011, 4295), dict(n=6))],
}
CLEAR = {'right-foot': 8, 'package': 10, 'lead': 6}
STYLE = {
  'package': dict(face='khand-light', head=86, cols=5),
  'corner-advert': dict(advert=True),
  'rail-markets': dict(face='khand', head=40, body=24, pitch=32, cols=1),
  'rail-shorts': dict(face='khand', head=48 * 0.81, body=24, pitch=33, cols=1, kicker='शॉर्ट्स', headlineStyle='kicker-label', accent='#fb9f0b'),
  'lead': dict(face='khand', head=125, deck=53, deckFace='khand-light', cols=4),
  'right-top': dict(face='khand', head=75, cols=2),
  'right-foot': dict(face='khand-light', head=64, cols=2),
  'report-left': dict(face='khand-light', head=77, deck=40, cols=3),
  'report-right': dict(face='khand-light', head=61, deck=40, cols=2),
  'feature-strip': dict(face='khand-light', head=86, cols=4, headlineStyle='kicker-chip-rule', accent='#e42424', rule='#fb9f0b', align='center', kicker='जरूर वाचा'),
  'foot-advert': dict(advert=True),
}
