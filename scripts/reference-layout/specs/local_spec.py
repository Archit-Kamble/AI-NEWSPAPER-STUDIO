KEY = 'broadsheet-local'; NAME = 'Broadsheet local (reference)'
DESC = 'A narrow column, a three-column picture lead with sidebars, a short story beside a corner advert, a wide report, a report with a tinted box, a photo story, a half-page advert and a separator-led feature.'
SCAN = 'p-004.jpg'
k = 2.8
def B(x0, y0, x1, y1): return (round(x0 * k), round(y0 * k), round(x1 * k), round(y1 * k))
X0, X1 = 56, 2744
Y0, Y1, EY0 = 238, 4326, 56
BLOCKS = [
  ('left-column', B(20, 85, 150, 600), dict(story='STANDARD', p=3)),
  ('lead', B(150, 85, 560, 600), dict(story='LEAD', p=5)),
  ('short-story', B(560, 85, 720, 325), dict(story='BRIEF', p=2)),
  ('corner-advert', B(735, 85, 980, 325), dict(type='advert')),
  ('wide-report', B(560, 332, 980, 600), dict(story='SECONDARY', p=4)),
  ('report-panel', B(20, 612, 500, 920), dict(story='SECONDARY', p=4)),
  ('photo-story', B(20, 928, 265, 1170), dict(story='PHOTO_FEATURE', p=3)),
  ('report-small', B(270, 928, 500, 1170), dict(story='STANDARD', p=3)),
  ('half-advert', B(505, 612, 980, 1545), dict(type='advert')),
  ('feature-strip', B(20, 1180, 500, 1545), dict(story='ANALYSIS', p=3)),
]
PHOTOS = 'auto'
PANELS = {
  'lead': [('sidebar', B(410, 210, 560, 480), dict(n=6)), ('sidebar', B(410, 485, 560, 600), dict(n=3))],
  'report-panel': [('quote', B(283, 640, 480, 720), dict(n=2)), ('sidebar', B(283, 730, 480, 860), dict(tint='#f4e4dc', n=4))],
  'feature-strip': [('sidebar', B(283, 1330, 500, 1430), dict(n=3)), ('sidebar', B(283, 1440, 500, 1545), dict(n=3))],
}
CLEAR = {'lead': 6}
STYLE = {
  'left-column': dict(face='khand', head=64, cols=1),
  'lead': dict(face='khand', head=110, deck=46, deckFace='khand-light', cols=3),
  'short-story': dict(face='khand', head=56, cols=1),
  'corner-advert': dict(advert=True),
  'wide-report': dict(face='khand-light', head=77, cols=3),
  'report-panel': dict(face='khand-light', head=77, cols=3),
  'photo-story': dict(face='khand', head=48, cols=2),
  'report-small': dict(face='khand-light', head=64, cols=2),
  'half-advert': dict(advert=True),
  'feature-strip': dict(face='khand-light', head=80, cols=3, headlineStyle='kicker-chip-rule', accent='#e42424', rule='#fb9f0b', align='center', kicker='जरूर वाचा'),
}
