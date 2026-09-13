KEY = 'broadsheet-opinion'; NAME = 'Broadsheet opinion (reference)'
DESC = 'The editorial column, two signed articles across the measure, a column, a commentary and a cartoon.'
SCAN = 'p-005.jpg'
k = 2.8
def B(x0, y0, x1, y1): return (round(x0 * k), round(y0 * k), round(x1 * k), round(y1 * k))
X0, X1 = 56, 2744
Y0, Y1, EY0 = 238, 4326, 56
BLOCKS = [
  ('editorial', B(20, 85, 270, 890), dict(story='OPINION', p=5)),
  ('opinion-lead', B(280, 85, 980, 515), dict(story='OPINION', p=4)),
  ('opinion-two', B(280, 522, 980, 890), dict(story='OPINION', p=4)),
  ('column', B(20, 900, 730, 1180), dict(story='ANALYSIS', p=3)),
  ('commentary', B(740, 900, 980, 1300), dict(story='OPINION', p=3)),
  ('opinion-three', B(20, 1185, 730, 1545), dict(story='OPINION', p=3)),
  ('cartoon', B(740, 1305, 980, 1545), dict(story='PHOTO_FEATURE', p=2)),
]
PHOTOS = 'auto'
PANELS = {
  'opinion-lead': [('sidebar', B(285, 195, 460, 245), dict(tint='#fce4cc', n=2))],
  'opinion-two': [('sidebar', B(285, 590, 460, 650), dict(tint='#fce4cc', n=2))],
  'opinion-three': [('sidebar', B(20, 1310, 200, 1370), dict(tint='#fce4cc', n=2))],
}
CLEAR = {'opinion-lead': 8, 'column': 8, 'commentary': 6, 'opinion-three': 6}
STYLE = {
  'editorial': dict(face='khand-light', head=64, cols=2, headlineStyle='kicker-accent', accent='#e42424', kicker='संपादकीय'),
  'opinion-lead': dict(face='khand', head=88, deck=46, align='center', cols=4),
  'opinion-two': dict(face='khand-light', head=88, deck=46, cols=4, headlineStyle='kicker-accent', accent='#e42424', kicker='कामगारनामा'),
  'column': dict(face='khand', head=64, cols=4, headlineStyle='kicker-accent', accent='#e42424', kicker='जगभर'),
  'commentary': dict(face='khand', head=56, cols=1, headlineStyle='kicker-accent', accent='#e42424', kicker='जनमन'),
  'opinion-three': dict(face='khand-light', head=88, deck=46, cols=4, headlineStyle='kicker-accent', accent='#e42424', kicker='सज्जनशक्ती'),
  'cartoon': dict(face='khand', head=48, cols=1, headlineStyle='kicker-accent', accent='#e42424', kicker='तिरकस आणि चौकस'),
}
