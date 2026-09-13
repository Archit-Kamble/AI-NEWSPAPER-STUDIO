KEY = 'broadsheet-miscellany'; NAME = 'Broadsheet miscellany (reference)'
DESC = 'A ruled profile feature, a national lead with sidebars, a world brief, cabinet and court reports, recruitment adverts, a strip advert, a world report and a separator-led feature.'
SCAN = 'p-008.jpg'
k = 2.8
def B(x0, y0, x1, y1): return (round(x0 * k), round(y0 * k), round(x1 * k), round(y1 * k))
X0, X1 = 56, 2744
Y0, Y1, EY0 = 238, 4326, 56
BLOCKS = [
  ('profile-feature', B(20, 85, 355, 858), dict(story='PHOTO_FEATURE', p=4)),
  ('lead', B(365, 85, 735, 395), dict(story='LEAD', p=5)),
  ('world-brief', B(740, 85, 980, 395), dict(story='BRIEF', p=2)),
  ('cabinet-report', B(365, 402, 700, 560), dict(story='STANDARD', p=3)),
  ('tender-advert', B(735, 402, 980, 560), dict(type='advert')),
  ('court-report', B(365, 567, 500, 1000), dict(story='BRIEF', p=2)),
  ('recruit-advert-left', B(505, 567, 730, 1100), dict(type='advert')),
  ('recruit-advert-right', B(735, 567, 980, 1100), dict(type='advert')),
  ('strip-advert', B(20, 865, 355, 1000), dict(type='advert')),
  ('world-report', B(20, 1005, 500, 1235), dict(story='STANDARD', p=3)),
  ('bank-advert', B(505, 1108, 980, 1545), dict(type='advert')),
  ('feature-strip', B(20, 1240, 500, 1545), dict(story='ANALYSIS', p=3)),
]
PHOTOS = 'auto'
PANELS = {
  'profile-feature': [('sidebar', B(20, 460, 355, 850), dict(tint='#fce4cc', n=10))],
  'lead': [('sidebar', B(545, 210, 640, 390), dict(n=5)), ('sidebar', B(645, 210, 735, 390), dict(n=5))],
  'world-report': [('sidebar', B(283, 1040, 500, 1235), dict(n=6))],
  'feature-strip': [('sidebar', B(185, 1350, 305, 1545), dict(marker='number', n=3)), ('sidebar', B(320, 1350, 500, 1545), dict(n=5))],
}
CLEAR = {'profile-feature': 10, 'lead': 6}
STYLE = {
  'profile-feature': dict(face='khand', head=56, cols=2, border='box', rule='#b06a08', headlineStyle='kicker-accent', accent='#e42424', kicker='रत्नमाला'),
  'lead': dict(face='khand', head=96, deck=40, deckFace='khand-light', cols=3),
  'world-brief': dict(face='khand-light', head=64, cols=2),
  'cabinet-report': dict(face='khand-light', head=77, cols=3),
  'tender-advert': dict(advert=True), 'recruit-advert-left': dict(advert=True), 'recruit-advert-right': dict(advert=True),
  'strip-advert': dict(advert=True), 'bank-advert': dict(advert=True),
  'court-report': dict(face='khand-light', head=64, cols=1),
  'world-report': dict(face='khand-light', head=64, cols=3),
  'feature-strip': dict(face='khand-light', head=96, cols=3, headlineStyle='kicker-chip-rule', accent='#e42424', rule='#fb9f0b', align='center', kicker='जरूर वाचा'),
}
