KEY = 'broadsheet-world'; NAME = 'Broadsheet national and world (reference)'
DESC = 'A four-item rail, a picture-led Q&A top story, a lead with a photo pair and sidebars, a right story with a numbered box, two reports, a strip, an advert and a separator-led feature.'
SCAN = 'p-011.jpg'
k = 2.8
def B(x0, y0, x1, y1): return (round(x0 * k), round(y0 * k), round(x1 * k), round(y1 * k))
X0, X1 = 56, 2744
Y0, Y1, EY0 = 238, 4326, 56
BLOCKS = [
  ('rail-one', B(20, 85, 150, 435), dict(type='briefs', story='BRIEF', p=2)),
  ('rail-two', B(20, 440, 150, 800), dict(story='BRIEF', p=2)),
  ('rail-three', B(20, 805, 150, 1000), dict(story='BRIEF', p=2)),
  ('rail-four', B(20, 1005, 150, 1215), dict(story='BRIEF', p=2)),
  ('top-story', B(150, 85, 980, 318), dict(story='SECONDARY', p=4)),
  ('lead', B(150, 322, 660, 810), dict(story='LEAD', p=5)),
  ('right', B(670, 322, 980, 810), dict(story='SECONDARY', p=4)),
  ('report-panel', B(150, 815, 400, 1215), dict(story='STANDARD', p=3)),
  ('report-narrow', B(410, 815, 570, 1215), dict(story='STANDARD', p=3)),
  ('strip', B(580, 815, 980, 960), dict(story='BRIEF', p=2)),
  ('advert', B(590, 967, 980, 1545), dict(type='advert')),
  ('feature-strip', B(20, 1222, 580, 1545), dict(story='ANALYSIS', p=3)),
]
PHOTOS = 'auto'
PANELS = {
  'top-story': [('sidebar', B(545, 120, 760, 318), dict(n=8)), ('sidebar', B(765, 120, 980, 318), dict(n=8))],
  'lead': [('sidebar', B(545, 440, 660, 800), dict(n=10))],
  'right': [('sidebar', B(850, 520, 980, 650), dict(marker='number', n=3))],
  'report-panel': [('sidebar', B(283, 905, 400, 1150), dict(tint='#f4e4dc', n=8))],
  'feature-strip': [('sidebar', B(300, 1330, 450, 1545), dict(n=6)), ('sidebar', B(460, 1330, 580, 1545), dict(marker='number', n=3))],
}
CLEAR = {'top-story': 6, 'lead': 6, 'right': 6, 'feature-strip': 6}
STYLE = {
  'rail-one': dict(face='khand', head=48 * 0.81, body=24, pitch=33, cols=1, kicker='फॅक्ट चेक', headlineStyle='kicker-label', accent='#0b8bd3'),
  'rail-two': dict(face='khand', head=48 * 0.81, body=24, pitch=33, cols=1, kicker='सोशल व्हायरल', headlineStyle='kicker-label', accent='#0b8bd3'),
  'rail-three': dict(face='khand', head=48 * 0.81, body=24, pitch=33, cols=1, kicker='ट्रेंडिंग', headlineStyle='kicker-label', accent='#0b8bd3'),
  'rail-four': dict(face='khand', head=48 * 0.81, body=24, pitch=33, cols=1),
  'top-story': dict(face='khand-light', head=70, cols=5),
  'lead': dict(face='khand', head=102, deck=46, deckFace='khand-light', cols=4),
  'right': dict(face='khand-light', head=88, deck=40, cols=2),
  'report-panel': dict(face='khand', head=77, deck=40, cols=2),
  'report-narrow': dict(face='khand-light', head=77, cols=2),
  'strip': dict(face='khand', head=48, cols=3),
  'advert': dict(advert=True),
  'feature-strip': dict(face='khand-light', head=96, cols=4, headlineStyle='kicker-chip-rule', accent='#e42424', rule='#fb9f0b', align='center', kicker='जरूर वाचा'),
}
