# SAHAS newspaper-design roadmap

This roadmap extracts reusable editorial grammar from leading newspapers. It
does **not** propose copying another paper's masthead, font, branded feature,
illustration style or exact page composition. SAHAS should be recognisable as
SAHAS VARTA.

## What the research says

Across award-winning international papers and the Marathi dailies Lokmat,
Sakal, Pudhari, Saamana, Divya Marathi, Maharashtra Times, Loksatta and Tarun
Bharat, the strongest pages share the same discipline:

- one unmistakable entry point per story;
- scale communicates importance before colour or decoration;
- rules, labels and light screens communicate editorial meaning;
- ordinary reporting stays mostly open and black on white;
- analysis, opinion, service information and features look different because
  they perform different jobs;
- photographs are fewer, larger and always carry a caption and credit;
- charts, market figures and public-service data carry a source and reference
  time;
- recurring structures create reader familiarity across editions.

Useful references:

- [Society for News Design — World's Best-Designed winners](https://snd.org/the-new-york-times-die-zeit-and-reuters-named-worlds-best-designed-in-digital-and-print-news-design-competitions/)
- [The Guardian design system](https://guardian.github.io/theguardian.design/)
- [The Guardian's print redesign principles](https://www.theguardian.com/info/ng-interactive/2018/jul/24/working-report)
- [Washington Post design system](https://build.washingtonpost.com/)
- [Lokmat e-paper](https://epaper.lokmat.com/home.php)
- [Sakal e-paper](https://awsepaper.esakal.com/smartepaper/ui/home.aspx)
- [Pudhari e-paper](https://epaper.pudhari.news/)
- [Saamana e-paper](https://epaper.saamana.com/)
- [Divya Marathi e-paper](https://epaperdivyamarathi.bhaskar.com/)
- [Maharashtra Times e-paper](https://epaper.timesgroup.com/maharashtratimes/)
- [Loksatta e-paper](https://epaper.loksatta.com/)
- [Tarun Bharat e-paper](https://epaper.tarunbharat.com/)

## Delivered in this branch

The first layer is a one-click library of 37 original SAHAS block designs:

- Core news: clean, hairline finish, section opener, double finish, left/right
  rail and open panel.
- News hierarchy: lead accent, reversed lead, headline/deck screens and urgent
  update.
- Editorial: analysis, opinion, formal editorial, context, correction and open
  quotation.
- Feature pages: blue feature, culture, sport, Sunday, profile and tribute.
- Service/data: market data, civic notice and district briefs.
- International newsroom: ruled splash, open headline rule, compact section
  tab, city-desk package, stepped commentary, interview, world desk, data
  brief, photo dispatch and weekend essay.

The headline vocabulary itself now includes paint-only rules beneath a
headline or complete display, an accent-word-and-rule treatment, a compact
kicker tab, and light stepped bands following each composed headline line.
Each device reads final compositor geometry and therefore cannot change a line
break or move a block.

Seven structured inserts can now be added inside a story: FT-style key number,
numbered explainer, timeline, Q&A, attributed reaction, related/agenda, and a
Marathi follow-up rail labelled काल / आज / पुढे.
Each is editable, draggable and resizable through the existing panel workflow;
the story flows around its rectangle, and the shared browser, PDF, IDML and
Scribus paths consume the same line solve. Chart and table panel chrome was
also unified so those two no longer show a browser-only box.

The library is deliberately a preset over existing validated fields. It adds
no schema, coordinates or alternate renderer. Applying a design creates one
ordinary draft patch and every existing output path renders it.

## Highest-value next additions

### 1. Remaining structured editorial packages

Add reusable content structures, independent of their visual treatment:

- comparison (before/after, proposal/reality, year/year);
- portrait reaction cluster with two to four attributed quotes;
- correction/clarification with original edition and page reference.

These should use structured data, like Smart Cards, rather than parsing visual
markup back into meaning.

### 2. More semantic story types

Extend the existing story-type catalogue with `BREAKING`, `EXPLAINER`,
`INTERVIEW`, `PROFILE`, `OBITUARY`, `CORRECTION` and `SERVICE_ALERT`. A label
must describe real editorial meaning; selecting a red treatment alone must not
turn a story into breaking news.

### 3. Photo packages

Support print-aware choices for dominant photograph, portrait, panoramic
photograph, diptych and photo essay. Require caption and credit before press
sign-off. Never manufacture empty image placeholders in the layout.

### 4. Local service journalism

Add structured Satara-focused cards for:

- agricultural market-yard prices;
- water/electricity interruption;
- road closure and traffic diversion;
- event calendar;
- sports scorecard;
- election/result tally;
- verified emergency and government contacts.

Every factual card needs provider, fetched-at time, reference date and a stale
or unavailable state. The AI may explain verified data but must never invent it.

### 5. Notice and commercial formats

Build structured presets for legal notice, recruitment notice, financial
results and obituary/tribute advertisements alongside the existing tender and
advert cards. Preserve both dense monochrome classified and branded display
forms.

### 6. Production quality gates

Add preflight checks for missing image credit, unsourced chart/table, stale
market/weather data, ambiguous sponsored content, missing correction reference,
unsafe process-colour contrast and a design that becomes unclear in grayscale.

## Delivery rule

Each addition must be delivered in this order:

1. structured meaning;
2. one shared layout solver;
3. browser rendering;
4. neutral print model;
5. PDF/IDML/Scribus parity;
6. narrow/wide/tall and grayscale tests;
7. editor acceptance through the existing draft/autosave workflow.

No design may silently change saved coordinates, margins, font sizes, image
placement or copy. A design that consumes more measure must prove the current
story still fits before it is applied.
