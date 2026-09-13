KEY = 'broadsheet-local-sport'; NAME = 'Broadsheet local sport and notices (reference)'
DESC = 'Three sport stories over a column of public notices, a sport report, a scorecard rail and a result box.'
SCAN = 'p-007.jpg'
k = 2.8
def B(x0, y0, x1, y1): return (round(x0 * k), round(y0 * k), round(x1 * k), round(y1 * k))
X0, X1 = 56, 2744
Y0, Y1, EY0 = 238, 4326, 56
BLOCKS = [
  ('sport-left', B(20, 85, 270, 510), dict(story='STANDARD', p=3)),
  ('sport-lead', B(280, 85, 670, 575), dict(story='LEAD', p=5)),
  ('sport-right', B(680, 85, 980, 575), dict(story='SECONDARY', p=4)),
  ('notice-left', B(20, 520, 255, 1235), dict(type='advert')),
  ('notice-mid', B(260, 585, 495, 1235), dict(type='advert')),
  ('sport-report', B(505, 585, 850, 850), dict(story='STANDARD', p=3)),
  ('scorecard', B(855, 585, 980, 850), dict(type='briefs', story='BRIEF', p=2)),
  ('notice-right', B(505, 855, 850, 1235), dict(type='advert')),
  ('sport-brief', B(855, 855, 980, 1300), dict(story='BRIEF', p=2)),
  ('notice-foot', B(20, 1240, 495, 1545), dict(type='advert')),
  ('notice-foot-right', B(505, 1240, 850, 1545), dict(type='advert')),
  ('result-box', B(855, 1305, 980, 1545), dict(type='briefs', story='BRIEF', p=2)),
]
PHOTOS = 'auto'
PANELS = {}
CLEAR = {'sport-left': 8, 'sport-lead': 6, 'sport-right': 8, 'sport-report': 8}
STYLE = {
  'sport-left': dict(face='khand-light', head=70, deck=40, cols=2),
  'sport-lead': dict(face='khand', head=120, deck=46, deckFace='khand-light', cols=3),
  'sport-right': dict(face='khand-light', head=77, deck=40, cols=2),
  'notice-left': dict(advert=True), 'notice-mid': dict(advert=True), 'notice-right': dict(advert=True),
  'notice-foot': dict(advert=True), 'notice-foot-right': dict(advert=True),
  'sport-report': dict(face='khand', head=77, deck=40, cols=3),
  'scorecard': dict(face='khand', head=48, body=24, pitch=33, cols=1),
  'sport-brief': dict(face='khand-light', head=64, cols=1),
  'result-box': dict(face='khand', head=48, body=24, pitch=33, cols=1, ground='#f4e4dc', radius=0),
}
