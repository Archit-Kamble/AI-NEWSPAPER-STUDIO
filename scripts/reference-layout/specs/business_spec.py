KEY = 'broadsheet-business'; NAME = 'Broadsheet business and entertainment (reference)'
DESC = 'A charted money lead with a tinted panel, a digital-payments story with its own chart, three reports, an entertainment panel, a reversed poster story and three jump stories.'
SCAN = 'p-009.jpg'
k = 2.8
def B(x0, y0, x1, y1): return (round(x0 * k), round(y0 * k), round(x1 * k), round(y1 * k))
X0, X1 = 56, 2744
Y0, Y1, EY0 = 238, 4326, 56
R = lambda *v: [{'label': f'इथे मजकूर लिहा {i + 1}', 'value': x} for i, x in enumerate(v)]
BLOCKS = [
  ('lead', B(20, 85, 700, 495), dict(story='LEAD', p=5)),
  ('right-chart', B(710, 85, 980, 790), dict(story='DATA', p=4)),
  ('brief', B(20, 505, 150, 790), dict(story='BRIEF', p=2)),
  ('report', B(150, 505, 570, 790), dict(story='SECONDARY', p=3)),
  ('report-side', B(575, 505, 700, 790), dict(story='BRIEF', p=2)),
  ('film-panel', B(20, 800, 400, 1300), dict(story='PHOTO_FEATURE', p=3)),
  ('poster-story', B(410, 800, 560, 1545), dict(story='PHOTO_FEATURE', p=3)),
  ('film-story', B(20, 1305, 400, 1545), dict(story='STANDARD', p=3)),
  ('jump-one', B(590, 800, 980, 1080), dict(story='STANDARD', p=3)),
  ('jump-two', B(590, 1085, 980, 1375), dict(story='STANDARD', p=3)),
  ('jump-three', B(590, 1380, 980, 1545), dict(story='STANDARD', p=3)),
]
PHOTOS = 'auto'
PANELS = {
  'lead': [('chart', B(150, 215, 410, 295), dict(card={'chartType': 'bar', 'unit': '', 'items': R(2877, 2814, 2701, 2596)})), ('chart', B(150, 300, 410, 480), dict(card={'chartType': 'line', 'unit': '', 'items': R(113, 196, 184, 197, 132, 128)})), ('sidebar', B(420, 210, 545, 480), dict(tint='#f4e4dc', n=6)), ('sidebar', B(550, 210, 700, 480), dict(n=8))],
  'right-chart': [('chart', B(710, 235, 980, 370), dict(card={'chartType': 'line', 'unit': '', 'items': R(2320, 2272, 2366, 2451)})), ('sidebar', B(710, 630, 845, 790), dict(marker='number', n=3)), ('sidebar', B(850, 630, 980, 790), dict(n=4))],
  'report': [('sidebar', B(420, 555, 570, 790), dict(n=6))],
}
CLEAR = {'lead': 6, 'right-chart': 6, 'report': 6, 'film-story': 6}
STYLE = {
  'lead': dict(face='khand', head=102, deck=40, deckFace='khand-light', cols=4),
  'right-chart': dict(face='khand-light', head=77, deck=40, cols=2),
  'brief': dict(face='khand', head=56, cols=1),
  'report': dict(face='khand', head=77, cols=3),
  'report-side': dict(face='khand', head=56, cols=1),
  'film-panel': dict(face='khand', head=77, cols=1, ground='#f2dce4', radius=0, headlineStyle='kicker-accent', accent='#e42424', kicker='मनोरंजन'),
  'poster-story': dict(face='khand', head=77, cols=1, headlineStyle='reverse', accent='#3f4a56'),
  'film-story': dict(face='khand-light', head=77, cols=2),
  'jump-one': dict(face='khand-light', head=64, cols=3),
  'jump-two': dict(face='khand-light', head=64, cols=3),
  'jump-three': dict(face='khand-light', head=64, cols=3),
}
