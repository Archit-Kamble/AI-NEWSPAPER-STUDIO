KEY = 'broadsheet-state'; NAME = 'Broadsheet state (reference)'
DESC = 'A long rail of briefs, a picture-led top story beside a narrow column, a drugs-campaign lead with a tinted panel, a right story with a quote, four reports and a separator-led feature.'
SCAN = 'p-003.jpg'
k = 2.8
def B(x0, y0, x1, y1): return (round(x0 * k), round(y0 * k), round(x1 * k), round(y1 * k))
X0, X1 = 56, 2744
Y0, Y1, EY0 = 238, 4326, 56
BLOCKS = [
  ('rail-one', B(20, 85, 150, 440), dict(type='briefs', story='BRIEF', p=2)),
  ('rail-two', B(20, 450, 150, 605), dict(story='BRIEF', p=2)),
  ('rail-three', B(20, 612, 150, 968), dict(story='BRIEF', p=2)),
  ('rail-four', B(20, 975, 150, 1190), dict(story='BRIEF', p=2)),
  ('rail-five', B(20, 1195, 150, 1545), dict(story='BRIEF', p=2)),
  ('top-story', B(150, 85, 840, 445), dict(story='LEAD', p=4)),
  ('top-side', B(840, 85, 980, 445), dict(story='BRIEF', p=2)),
  ('lead', B(150, 450, 700, 925), dict(story='LEAD', p=5)),
  ('right', B(710, 450, 980, 925), dict(story='SECONDARY', p=4)),
  ('report-one', B(150, 932, 405, 1180), dict(story='STANDARD', p=3)),
  ('report-two', B(410, 932, 545, 1180), dict(story='BRIEF', p=2)),
  ('report-picture', B(545, 932, 840, 1180), dict(story='PHOTO_FEATURE', p=3)),
  ('report-side', B(840, 932, 980, 1180), dict(story='BRIEF', p=2)),
  ('feature-strip', B(150, 1190, 700, 1545), dict(story='ANALYSIS', p=3)),
  ('right-foot', B(710, 1190, 980, 1545), dict(story='STANDARD', p=3)),
]
PHOTOS = 'auto'
PANELS = {
  'lead': [('sidebar', B(283, 800, 540, 925), dict(tint='#f4e4dc', n=3)), ('sidebar', B(545, 585, 700, 925), dict(n=6))],
  'right': [('quote', B(710, 790, 840, 900), dict(n=3))],
  'feature-strip': [('sidebar', B(415, 1270, 545, 1545), dict(marker='number', n=3)), ('sidebar', B(550, 1270, 700, 1545), dict(n=5))],
}
CLEAR = {'top-story': 6, 'lead': 6, 'right': 6}
STYLE = {
  'rail-one': dict(face='khand', head=48 * 0.81, body=24, pitch=33, cols=1, kicker='अपडेट', headlineStyle='kicker-label', accent='#fb9f0b'),
  'rail-two': dict(face='khand', head=48 * 0.81, body=24, pitch=33, cols=1),
  'rail-three': dict(face='khand', head=48 * 0.81, body=24, pitch=33, cols=1),
  'rail-four': dict(face='khand', head=48 * 0.81, body=24, pitch=33, cols=1),
  'rail-five': dict(face='khand', head=48 * 0.81, body=24, pitch=33, cols=1),
  'top-story': dict(face='khand-light', head=80, cols=5),
  'top-side': dict(face='khand', head=48, body=24, pitch=33, cols=1),
  'lead': dict(face='khand', head=102, deck=46, deckFace='khand-light', cols=4),
  'right': dict(face='khand-light', head=99, cols=2),
  'report-one': dict(face='khand-light', head=77, cols=2),
  'report-two': dict(face='khand-light', head=64, cols=1),
  'report-picture': dict(face='khand-light', head=64, cols=2),
  'report-side': dict(face='khand-light', head=64, cols=1),
  'feature-strip': dict(face='khand-light', head=80, cols=4, headlineStyle='kicker-chip-rule', accent='#e42424', rule='#fb9f0b', align='center', kicker='जरूर वाचा'),
  'right-foot': dict(face='khand-light', head=77, cols=2),
}
