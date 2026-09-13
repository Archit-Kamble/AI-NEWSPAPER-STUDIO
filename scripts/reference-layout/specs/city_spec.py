KEY = 'broadsheet-city'; NAME = 'Broadsheet city front (reference)'
DESC = 'A quick-update rail, a four-column picture lead with sidebars, a picture-topped right story, a banner report, a half-page advert and three reports.'
SCAN = 'p-001.jpg'
X0, X1 = 50, 2750
Y0, Y1, EY0 = 340, 4340, 56
BLOCKS = [
  ('rail-update', (50, 340, 400, 1210), dict(type='briefs', story='BRIEF', p=2)),
  ('rail-two', (50, 1220, 400, 1725), dict(story='BRIEF', p=2)),
  ('lead', (437, 340, 1975, 1750), dict(story='LEAD', p=5)),
  ('right-top', (2000, 340, 2750, 2200), dict(story='SECONDARY', p=4)),
  ('banner-report', (50, 1775, 1975, 2200), dict(story='SECONDARY', p=4)),
  ('half-advert', (50, 2225, 1390, 4340), dict(type='advert')),
  ('report-wide', (1450, 2225, 2750, 3262), dict(story='SECONDARY', p=4)),
  ('report-narrow', (1450, 3275, 1975, 4340), dict(story='STANDARD', p=3)),
  ('report-picture', (2000, 3275, 2750, 4340), dict(story='STANDARD', p=3)),
]
PHOTOS = 'auto'
PANELS = {
  'lead': [('sidebar', (1225, 725, 1600, 1190), dict(n=4)), ('sidebar', (1612, 725, 1975, 1365), dict(n=6)), ('sidebar', (1225, 1400, 1975, 1680), dict(n=3))],
  'report-wide': [('sidebar', (2000, 2435, 2362, 3250), dict(marker='number', n=3)), ('quote', (2375, 2435, 2750, 3250), dict(n=3))],
}
CLEAR = {'right-top': 0}
STYLE = {
  'rail-update': dict(face='khand', head=48 * 0.81, body=24, pitch=33, cols=1, kicker='अपडेट', headlineStyle='kicker-label', accent='#fb9f0b'),
  'rail-two': dict(face='khand', head=48 * 0.81, body=24, pitch=33, cols=1),
  'lead': dict(face='khand', head=125, deck=46, deckFace='khand-light', cols=4),
  'right-top': dict(face='khand-light', head=88, cols=2),
  'banner-report': dict(face='khand', head=77, cols=5),
  'half-advert': dict(advert=True),
  'report-wide': dict(face='khand-light', head=88, cols=3),
  'report-narrow': dict(face='khand-light', head=64, cols=2),
  'report-picture': dict(face='khand-light', head=77, cols=2),
}
