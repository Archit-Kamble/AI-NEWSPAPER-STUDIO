KEY = 'broadsheet-jacket'; NAME = 'Broadsheet jacket (reference)'
DESC = 'A page wrapped in adverts: a rail advert, a lead with a numbered panel, a shorts rail, two stacked display adverts, a tall advert and a weather column.'
SCAN = 'p-000.jpg'
k = 2.8
def B(x0, y0, x1, y1): return (round(x0 * k), round(y0 * k), round(x1 * k), round(y1 * k))
X0, X1 = 56, 2744
Y0, Y1, EY0 = 476, 4326, 56
BLOCKS = [
  ('rail-advert', B(20, 170, 150, 580), dict(type='advert')),
  ('top-brief', B(160, 170, 490, 300), dict(story='BRIEF', p=3)),
  ('lead', B(160, 305, 490, 932), dict(story='LEAD', p=5)),
  ('rail-shorts', B(20, 588, 150, 932), dict(type='briefs', story='BRIEF', p=2)),
  ('advert-top', B(500, 170, 980, 860), dict(type='advert')),
  ('advert-foot', B(500, 865, 980, 1545), dict(type='advert')),
  ('advert-left', B(20, 945, 262, 1545), dict(type='advert')),
  ('weather-column', B(272, 945, 490, 1545), dict(story='BRIEF', p=2)),
]
PHOTOS = 'auto'
PANELS = {'lead': [('sidebar', B(283, 440, 490, 650), dict(marker='number', n=5))]}
CLEAR = {'lead': 6}
STYLE = {
  'rail-advert': dict(advert=True), 'advert-top': dict(advert=True), 'advert-foot': dict(advert=True), 'advert-left': dict(advert=True),
  'top-brief': dict(face='khand-light', head=56, cols=2),
  'lead': dict(face='khand', head=102, deck=46, deckFace='khand-light', cols=2),
  'rail-shorts': dict(face='khand', head=48 * 0.81, body=24, pitch=33, cols=1, kicker='शॉर्ट्स', headlineStyle='kicker-label', accent='#fb9f0b'),
  'weather-column': dict(face='khand', head=56, cols=1),
}
