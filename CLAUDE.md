# SAHAS — AI Newspaper Production System

> **Read [`VISION.md`](VISION.md) first.** It is the project's constitution — it defines the
> product, the production workflow, and the design and AI philosophy. Where this document and
> `VISION.md` disagree, `VISION.md` wins. This file describes *how the code is built*;
> `VISION.md` describes *what we are building and why*, and the workflow is the product.

## What this is, and isn't

SAHAS is a complete AI-assisted **newspaper production system**, built for a real customer (**SAHAS VARTA**) who will run it daily. It is NOT a CMS, a blog platform, a page builder, or a generic template editor.

Every architectural decision assumes this software prints and distributes real newspapers. Never build demo architecture, temporary hacks, or optimize only for speed — optimize for long-term maintainability.

## Production pipeline this system supports

```
Reporter → Editor → Chief Editor → Page Designer → AI Optimization → Scribus → CMYK PDF → Printing Press → E-Paper → Archive
```

## Tech stack

- Frontend: HTML/CSS/vanilla JS (no framework, no bundler — `<script type="module">` + dynamic `import()`)
- Backend: Node.js + Express, session-based auth
- Database: PostgreSQL
- Future: OpenAI/Claude/Gemini for AI assist, Scribus for print export

## Target architecture (aspirational — see "Current reality" below)

```
Route → Controller → Service → Repository → PostgreSQL
```

- Repositories: SQL only.
- Services: business rules.
- Controllers: HTTP logic only, no business logic in routes.
- No JSON blobs for a whole newspaper — normalize everything: `Newspaper → Page → Editorial Block (page_section) → Story (news_item) → Images`.
- AI assists, never owns data, and never overwrites user content without confirmation.
- Coordinates: editor works in **pixels**, print will use **millimetres** — never mix these silently; conversion must be explicit.

## Current reality (read this before touching code)

`server.js` is the entry point. The layering migration now covers every resource that touches the database; seven resources are mounted from real route modules:

```
app.use("/api/auth",       src/routes/auth.routes.js)
app.use("/api/news",       requireSignIn, src/routes/news.routes.js)
app.use("/api/newspapers", deskWrites,    src/routes/newspaper.routes.js)
app.use("/api/features",   deskWrites,    src/routes/feature.routes.js)
app.use("/api",            deskWrites,    src/routes/page.routes.js)
app.use("/api/reporters",  requireAdmin,  src/routes/reporter.routes.js)
app.use("/api/settings",   requireAdmin,  src/routes/settings.routes.js)
```

Those go Route → Controller (`src/controllers/*.controller.js`) → Service (`src/services/*.service.js`) → Repository (`src/repositories/*.repository.js`) → PostgreSQL, which is the target shape. All still-inline `server.js` routes are stateless lookups with no database access at all — `/api/templates`, `/api/geometry`, `/api/identity`, `/api/ai/status`, `/api/health` — plus `/api/uploads/images` (multer only, no business logic) and public `/epaper` routes (delegating straight to `newspaperController` because they sit outside the `/api/newspapers` mount path). There is no more `src/db.js` — it held only `authenticateUser`, a duplicate of `user.repository.js` plus a bcrypt check; that logic now lives in `auth.service.js` and the file was deleted rather than kept as a second copy.

**Section production actions are addressed by `sectionKey` (e.g. `"lead"`), not a numeric id** — `write`, `fill`, `carry-over`, `reunite`, `fit` and `rate` all live in `pageSection.controller.js`/`pageSection.service.js` alongside the numeric-id section CRUD (`update`/`create`/`remove`/`move`), because `pageSection.service.js` already addressed sections by key internally (`saveSection(pageId, sectionKey, ...)`) — there was no real domain boundary to justify a separate controller. Page-level actions (`colour`, `state`) live in `page.controller.js` instead, next to `create`/`list`/`update`, matching how they're addressed (by `pageId` alone).

**`deskWrites` leaves every GET unauthenticated — it only guards writes.** Every GET route moved onto a `deskWrites`-mounted router that used to carry an explicit `requireDesk` inline (`preflight`, `worklist`, `status`, `history`, `scribus`, `press-package`, and now `fit` (GET) and `rate`) must repeat that `requireDesk` at the route level, or desk-only production data goes silently public. This has already bitten this migration twice — check `src/middleware/auth.js` before wiring any GET route into an existing router, don't assume the router-level middleware covers it.

**Owner administration is not a `deskWrites` route.** `/api/reporters` and
`/api/settings` are mounted behind `requireAdmin`, including their reads. A
reporter account's active state is checked against PostgreSQL on every protected
request: blocking an account therefore revokes an already-open session as well
as preventing a later login.

When continuing the migration, take one resource at a time, verify boot + `npm test` after each, small commits.

`src/services/` is substantial and live: `auth`, `editionStart`, `editionFeatures`, `worklist`, `fit`, `jump`, `preflight`, `pressPackage`, `scribus`, `epaper`, `signoff`, `storyWriter`, `sectionImage`, `backgroundRemoval`, `cutout`, `segment`, `districtEdition`, plus `src/services/ai/` and `src/services/information/` (verified current-event context — see below).

Still 0-byte scaffolding: `src/middleware/auth.middleware.js`, `src/middleware/error.middleware.js`, and all five `src/layout/layout.*.js`. Auth actually runs through `src/middleware/auth.js` (`requireSignIn`, `requireDesk`, `deskWrites`), not the `.middleware.js` file beside it — check which one before editing.

### Frontend load path

`public/index.html` loads `/app.js`, which dynamically imports, in order:
`editor/publication.js` → `admin/reporter-browser.js` (stub) → `admin/template-selector.js` (stub) → `admin.js` (login, reporter dashboard, admin dashboard).

The workspace itself is **not** loaded by `app.js` — `editor/publication.js` pulls in `editor/workspace.js`, which is the real workspace and imports the `editor/canvas/`, `editor/external-editor/`, `editor/layout/`, `editor/history/`, `editor/status/` and `editor/autosave/` folders. There is no `admin/newspaper-workspace.js` or `admin/page-editor.js` any more; do not go looking for them.

### Starting an edition

`POST /api/newspapers/start` is how a day's paper begins, and it is **idempotent per date**: one paper per publication date, so pressing the button twice opens the existing edition rather than making a second one. (Before this existed the database reached 116 editions, most of them empty, and editors could not find the one holding their work.)

Starting an edition also:

- builds the **page ladder** from the page count (`src/layout/ladder.js`) — page one is the front, page two is city news, the last page is the back page, and there is exactly one features page. Never four front pages.
- **carries the booked adverts forward** from the previous edition (`src/services/editionStart.service.js`), and never carries news. An advert is booked for a run of days; a story is not.
- **fills the standing daily features** for the edition's own date.

Asking for more pages adds them at their proper rung. Asking for fewer never removes a page — there may be work on it.

### Publishing the public e-paper

The newsroom edition is mutable; a released web issue is not. E-paper release
is deliberately separate from an edition's editorial/press `status`: a current
editor proof must never make a draft look press-final. `newspapers` therefore
carries `epaper_released_at`, `epaper_selected`, and `epaper_source`, with a
partial unique index enforcing exactly one selected public issue.

There are two release paths, both writing the same immutable manifest and
page/story PNGs under `public/uploads/epaper/:id/` atomically:

- `POST /api/newspapers/:id/publish` is **press-final**. It requires central
  press readiness and the accepted CMYK PDF, then rasterises that PDF at 180
  DPI. The final PDF is the visual authority and remains the whole-paper
  download.
- `POST /api/newspapers/:id/publish-current` is a clearly labelled **current
  editor web proof**. It requires neither Scribus nor PDF/sign-off, renders the
  exact current canvas in its existing print-view mode with local Chrome
  (`EPAPER_CHROME_BIN` overrides `/usr/bin/google-chrome`), and never changes
  the edition's press status. It must never reconstruct stories through a
  second text-layout implementation: page furniture, typography, flow around
  images, Smart Cards, rules and marks are all the same browser canvas the
  desk approved.

  Chrome receives a one-use random local capture URL containing one frozen
  page payload. It expires in two minutes and carries no session or write
  permission; it is not a public reader route. This is how the normal canvas
  can be captured without making raw editor APIs public.

The workspace **Publish** button means only the second route. It is one
confirmation and must not show or gate on Scribus, CMYK PDF, press readiness
or page sign-off; empty blocks are valid for a web release. The press-final
route remains available to press production elsewhere, but it is not the
editor's daily public-publish action.

`POST /api/newspapers/:id/epaper/pdf` is the optional finished-PDF web release
route exposed from the desk-only E-paper management screen. It needs an
edition-matching page count but not press readiness. Its upload is stored as
`publication_files.file_type = 'epaper_pdf'`, not `print_pdf`, so it cannot
misrepresent an unapproved web PDF as a CMYK press artifact or change the
edition's press status. The frozen source is `uploaded_pdf`, and the public
download route reads that exact e-paper PDF. The old publication-files check
constraint must include `epaper_pdf`; the guarded migration is in
`schema.sql` and must be applied manually because the schema never runs at
boot.

Later newsroom edits cannot alter either release. Story cards are 1080 px PNG
crops with the real masthead composed above them. Only editorial news blocks
are clickable; adverts, features and Smart Cards are deliberately outside this
release pass.

**There is one initial e-paper mapping source, plus an explicit released-map
adjustment.** `epaper.buildEdition()` derives every populated editorial block's
percentage rectangle from its saved page geometry. Exact-canvas releases freeze
that geometry unchanged. A finished PDF exported from that same layout also
starts from it, and the page-count check prevents attaching a different edition
by accident.

An externally designed uploaded PDF can legitimately need different story
rectangles. The desk-only **Map blocks** tool is the sole exception: it edits
the immutable release's own manifest, not `page_sections`, by moving/resizing
or adding/deleting overlays in page X/Y/width/height coordinates. On save,
`PATCH /api/newspapers/:id/epaper/map` validates a complete page map,
regenerates that page's branded story PNGs and atomically swaps the release
directory. Existing frozen story text is retained; manual blocks must have a
title. A `mapRevision` prevents two open map editors from silently overwriting
one another. Never infer a second map automatically from PDF text or silently
alter a live layout — this explicit operator adjustment is the durable boundary.

For the exact current-canvas path, that rule also bans **editor Fit scale**.
`renderCanvas()` has a ResizeObserver that can reapply its normal fit-to-dock
transform after initial render. In the e-paper capture viewport this is 0.927
(660 px minus Fit's 48 px padding), which creates an image/map mismatch even
when all stored block coordinates are correct. The capture stylesheet owns
`.newspaper-canvas { transform:none!important }`; do not weaken it. This makes
the screenshot's 660×1060 CSS page and every `page_sections` rectangle the same
coordinate plane (the PNG is simply 2×). `tests/epaper.test.js` protects the
rule.

The owner E-paper screen (`/api/epapers`, desk-only) is a searchable release
list with a radio button. Its checked row is the only public release. The safe
share link is always the canonical, ID-free `GET /epaper`; it has no session,
token or write authority. Owner previews use `GET /epaper/preview/:id` and
remain desk-only. A current-date release is selected by default (or the first
release when none is selected); other releases remain private until the owner
chooses their radio button. “Current day” follows the newsroom’s newest
publication date, rather than trusting the host machine clock (important for
planned/test editions).

Its optional PDF publisher uses a date picker plus searchable edition results,
not an opaque Edition dropdown. Search indexes Marathi and English dates and
normalises Devanagari digits (`15 Aug 2099` therefore finds `१५ ऑगस्ट २०९९`).
Every release row has **Map blocks**, including private releases, because map
adjustment is a desk action and never exposed to the public reader.

Public access is gated in three places:

- `GET /epaper` loads only the frozen manifest of the selected radio issue;
- an ID route can load a release publicly only when it is that same selected
  issue; owner previews are separately desk-gated;
- generated `/uploads/epaper/:id/*.png` files are intercepted before general
  static serving and checked against the selection plus the manifest's asset
  list (a signed-in desk may read a private release for preview);
- the whole-paper download uses `GET /epaper/:id/pdf`, which performs the same
  status check instead of exposing the raw upload URL in public markup.

The public reader header intentionally carries the real SAHAS nameplate plus a
cropped lion mark and does **not** carry an “All editions” navigation control.
Sharing is constrained by the receiving platforms: WhatsApp Send and Facebook
web share can open their own URLs directly; a website cannot post into WhatsApp
Status, Instagram Story/Post or Facebook Story, nor select an app inside the
OS share sheet. Those buttons must use `navigator.share()` with the generated
PNG when available, then offer the honest desktop fallback: download the PNG
and open the destination’s web app. Never report that a story/status was
published merely because the handoff succeeded.

`DELETE /api/newspapers/:id/epaper` means **remove the public copy**, not delete
the newsroom edition: it hides the issue first, removes only generated
derivatives, leaves the final-PDF record intact and leaves the editorial/press
status untouched. Release rows come from frozen manifests and are sorted by
their publication/republish time, newest first.

### Type sizes are derived, and fractional

`typeScaleFor()` in `src/layout/geometry.js` sets a block's default type from its size, and the headline may never take more than half the block's usable height at two lines. A rule with a cliff in it (the old "cap at 18px below 160px tall") gives a full-width banner a headline that consumes the whole block, leaving a character budget of **zero** — a hole nothing can be written into. `tests/layout.test.js` holds this: no article block in any layout may be born unable to carry a sentence.

`headline_font_px`, `subheading_font_px` and `body_font_px` are `NUMERIC(5,1)`, not integers — a printer sets type in half points. They therefore arrive over the wire as strings, like the page's mm dimensions; every reader coerces with `Number()`.

### The block is set like a newspaper, not like a web page

A desk screenshot of a 190×264 lead showed roughly a third of the block standing empty while the Space panel called it balanced. None of it was the copy's fault — it was typography defaults inherited from the web. Each of these is now measured against real practice, and the numbers are on that one block:

| | was | is | why |
|---|---|---|---|
| `margin_px` | 12 (= **6 mm** at 2 px/mm) | **1** | The block's inset is not the gutter and never was — see "The gutter is the page's, not the block's" below. |
| `paragraph_spacing_px` | 8 (a blank line) | **0 + a 1 em first-line indent** | No printed newspaper spends a whole row of a column on a blank line. Measured: 0.7 of 5.83 body lines, 12% of the block, standing empty. |
| `text_align` | `left` | **`justify`** | A narrow measure with a ragged right reads as unfinished against a column rule. |
| deck length | `min(140, cols × 2)` | **measured, one line** | `cols` is the **body's** characters per line, and a deck is not set in body type — so it asked for two body lines' worth of characters in larger type: **three deck lines, 18% of the block**, which is the "second headline" the desk reported. |

Together on that block: the story's room went from 137 px / 5.83 lines to **184 px / 9.73 lines — 67% more**.

**`line_height` is NOT part of this, and must not be "tidied" downward.** It looks generous at 1.45. It is not. The serif face's worst-case ink box was measured exhaustively in the browser across every consonant, every vowel sign and every virama conjunct: **1.475 em** — ascent 0.905 (the candrabindu), descent 0.570 (stacks like `ड़्रु`). The face's own design box is 1.555 em. 1.45 is already at the edge of cropping Marathi, and `MIN_LINE_HEIGHT` in `text-flow.js` is a floor for exactly that reason. `tests/newspaperTypography.test.js` holds it.

**The paragraph indent is set in two places on purpose, and they are one rule.** `compose.js`'s `firstLineIndentPx` puts it in the exact geometry (so the composed line's own `x` carries it); `.section-body p + p` in `styles.css` puts it in the canvas's CSS markup. Both, or the canvas and the composed page mark a paragraph differently — the `object-fit: cover` vs `contain` drift, again. The opening paragraph is never indented; that is a compositor's rule, not a preference.

The migration is in `schema.sql` beside the columns, and its backfill is **guarded**: it moves only rows still carrying the exact old default, so a value a desk actually chose is never overwritten. `schema.sql` is not applied at boot — it has to be run.

### The gutter is the PAGE's, not the block's

The row above used to read `margin_px` **4** — "a ~4 mm gutter, shared, 2 mm each
side" — and the destination was right while the arithmetic was wrong, because
**two blocks do not touch**. The page grid already leaves 3 mm between them
(`geometry.js`, `gridGutterMm`) and the templates leave 4 mm above and below, so
the block's own inset was added to a gutter that already existed. Measured across
every neighbouring pair on a real front page:

| | grid | + inset | printed on the customer's own page |
|---|---|---|---|
| across | 3 mm | **7 mm** | 3.8 mm |
| down | 4 mm | **8 mm** | ~5 mm |

A 7 mm gutter is what makes a made-up page read as a web layout — the columns
stop being columns and become panels floating on white. The inset is therefore
not the gutter and is not asked to be one: it is the hair of air that keeps type
off its own frame's edge, **0.5 mm (1 px)**, the smallest step this page has.
Across → 4 mm, down → 5 mm, which is the printed page.

One pixel is also the enforced minimum. The Typography control and save service
accept 1–60, never 0: the compositor has always required a positive inset, so a
zero formerly shown in the control was silently rendered through its old 12 px
fallback. `section-model.js` normalises an imported zero to 1 before any view
uses it.

It can only ever GIVE a block room, so nothing can overset on it: swept over all
4603 sections carrying copy, `BODY_OVERSET` went **15 → 13**. `UNDERFILLED` rises
(3611 → 3666) and that is the honest reading — the same words in a wider measure
fill a smaller share of it, and the writer fills the rest.

A boxed block is unchanged in kind: `BOX_INSET_PX` is added on top of this
(`section-adapter.js`), so its type still sets ~3 mm inside its own rule.

### How the copy is SET — the compositor's own work

The desk's report was *"uneven gap … not touching right side properly"*. Measuring the block it came from found the cause: **four of thirteen lines had silently given up on justification** — 17%, 36%, 29% and 17% short of their own measure, sitting among lines that were flush. A right edge that is sometimes straight is worse than one that is never straight; the reader sees a mistake rather than a style.

Four things had to change, and all four are ordinary newspaper compositing:

**1. Lines are broken for the whole paragraph, not greedily** (`balanceParagraph` in `compose.js`). Greedy filling — take words until the next will not fit — is optimal for *line count* and terrible for evenness: it spends all the slack on whichever line happens to meet a long word. Once a paragraph is poured its lines' real measures are known (they come from the geometry and the pictures, not the text), so the pieces are re-assigned across those same slots to minimise total badness, TeX's cubed-slack cost. **The line count never changes, so no geometry moves.**

The cost function knows what the justifier can actually close (`slackCost`): slack the justifier will absorb is nearly free, slack it *cannot* absorb costs 100×. Without that the breaker cheerfully chose lines nothing could fix — measured across a real page, every remaining ragged line had both justification levers pinned at their caps.

**2. A paragraph never closes on a single word** (`lastLineCost`). A widow is not a matter of degree, so it is a flat `WIDOW_PENALTY`, not a cubed deficit — cubing made it vanish next to the few thousandths of ordinary slack it was competing with, and the solver traded a good last line for a slightly better one above it.

**3. Justification has two levers and never surrenders** (`justifyLine`). Word spaces open first, to `MAX_EXTRA_WORD_SPACE_EM` (0.55); the glyphs themselves take the remainder, to `MAX_GLYPH_STRETCH` (1.03) — InDesign's own newspaper range. **Letter-spacing is deliberately not a lever**: tracking a Devanagari word pulls its shirorekha apart. Glyph scaling scales the head stroke with everything else, which is why it is the safe second lever here.

**4. A column too narrow to justify is set flush left** (`JUSTIFY_MIN_EM`, 13). A Latin column needs ~40 characters before justification stops producing rivers; Marathi sets ~2.5 characters to the em, so ~16 em. Below that a line holds two or three words and there is nowhere to put the slack — which is why captions, sidebars and tight columns are set flush left in every printed newspaper. Measured across 1200 real blocks the column measures cluster at 11 em (55% of them), 15, 20 and 26. **The decision is per BLOCK, never per line** — a block justified or not depending on how wide each line happened to be is exactly the inconsistent edge this removes.

Measured across a filled page: **30 ragged lines → 21, worst 17% → 12%, median 6% → 4%.** Across 1200 real blocks: 8 ragged lines total, all on one synthetic repeated-token fixture.

### The shaper is not optional, and Node refuses to compose without it

`composeBlock()` promises the same numbers in Node and in the browser. It did
not keep that promise: without HarfBuzz the engine falls back to summing raw
hmtx advances, which **overstates a Devanagari conjunct by up to 80%**
(`shaper.js` carries the per-word measurements). Measured across 600 real
article blocks, composing each one both ways: **29.7% set in a different
number of lines**, the mean fill ratio moved 3.7 points, three blocks reported
an overset that does not exist, and the worst single block read **93.8% full
one way and 58.7% the other** — same copy, same frame.

- **In Node the fallback is never legitimate** — `harfbuzzjs` is a local
  package and the fonts are local files — so `composeBlock()` **throws
  `EXACT_SHAPER_NOT_READY`** there. Every Node entry point must
  `await Promise.all([ensureFontsLoaded(), ensureShaperReady()])`.
- **In the browser it is a real momentary state** before the WASM and the four
  faces download, so there it is a `SHAPING_NOT_READY` warning.

This gap had already been found and hand-fixed once in `tests/compose.test.js`
and had come back in a script and a test, which is why the refusal is in the
engine and not in its callers. `tests/exactShaping.test.js` holds it.

### The headline is written to a COUNT — it fills its measure

A sub-editor sizes a headline to the column. One that stops two-fifths short on
every line reads as unfinished, and it is the same fault as a headline that
eats half the block — a desk reported both at once and they have one cause.

**`src/layout/geometry.js` has always chosen a block's headline size assuming
TWO lines** (`HEADLINE_LINES = 2`); the engine allowed **four**. So the sizing
and the setting disagreed: `typeScaleFor()` picked 24px for a 268×248 lead on a
two-line basis and the engine set **three lines at 54%, 53% and 53% of their
measure, taking 50% of the block**. Holding the budget is what makes the fit
happen — over budget is a failure, so the size steps down until it sets in two,
and the size it lands on is the one whose working lines fill without leaving a
one-word closing widow.
That block now sets at 22px: **97% and 48%, taking 33%**, and hands 40px of a
240px block back to the story.

Two caps, and both are **preferences that yield to overset**, in this order:

| | |
|---|---|
| `HEADLINE_MAX_LINES` (2) | preferred; a narrow one-column block that cannot set its words in two at any legible size gets its third and fourth |
| `MAX_DISPLAY_SHARE` (0.5) | kicker + headline + deck together, measured **absolutely from `content.top`** |

**A per-flow share measured from a running `y` is a share of what is LEFT, and
it compounds** — that is how a headline inside its own 50% and a deck inside its
own 70% took half the block between them.

**Overset is always worse.** `fitDisplayFlow()` runs its passes in order of what
it would like, ending with what it will settle for; every relaxation gives up
something worth less than a word pushed off the page. Removing that last pass
took `DECK_OVERSET` across the database from 1 block to 7.

Measured across 655 real article blocks: three-line headlines **134 → 0**, mean
headline fill **68.4% → 71.6%**, mean display share **21.3% → 18.4%**, blocks
spending over 40% of themselves on display type **67 → 13**. `headline_max_lines`
on the row still wins, so a splash can be given three.

**Holding the line budget is not the same as filling the measure**, and the desk
reported the second one next: a headline set in two lines at 85% and 52% of
their measures. Every working line must reach the 95% bar. A closing line may
be shorter, as ordinary newspaper setting requires, but it must carry at least
two words and 30% of its measure — never a stranded one-word widow.

The first implementation measured only the longest line. That made the three
visual verification blocks report 99.6%, 98.1% and 96.8% even though two really
set as **49% / 100%** and **48% / 98%**. A max cannot distinguish those from a
professional descending head. `headlineBandFit()` is now the shared metric:
the minimum working-line fill plus the legal-close rule. `fitDisplayFlow()`
searches downward in 0.5 px steps as well as upward because line breaks are
discontinuous — half a pixel can move a whole Marathi word and repair the
shape. It keeps the largest passing size nearest the requested hierarchy rung.

The deck has its own related rule: it prefers **one line**, yields to more only
when one line is physically impossible at legible size, and may not exceed 65%
of the headline's **resolved** size. Capping it against the requested headline
size is wrong after auto-fit; that is how the deck became almost as large as
the headline and read as a second headline.

Three rules, each arrived at by measuring the alternative:

- **All or nothing** (`HEADLINE_FILL_TARGET`, 0.95). "Any improvement" was tried
  and is wrong in a way that is obvious once seen: one short word on a full-width
  block cannot fill 296px of measure at any legible size, so it inflated 30px →
  37px to go from 19% to 24% — a quarter larger, still five-sixths empty, and the
  story a line shorter for it. A headline whose words cannot fill is set at the
  size the design gave it.
- **The smallest size that fills, not the largest that fits.** Every pixel of
  display type is a pixel off the top of the story.
- **`HEADLINE_GROWTH_CAP` (1.25) is a HIERARCHY bound**, not a typographic one.
  A page reads as one page because the bigger block shouts louder, and
  `byMeasure = width/11` is the rung. Measured over 5084 blocks and 429 pages:
  In the original 92%-target sweep, 1.25 took headlines at/over 92% filled from
  1089 to 2787 for four more pages
  where a smaller block out-shouts the biggest; 1.4 costs nine times that for one
  sixth more; 1.6 breaks two pages in three. The table is beside the constant.

**And it never costs a word.** Growth is a preference like the others: the check
is made after the pour — the only thing that can say whether the copy still
fits — and the block is composed once more with the growth withheld. One level
of recursion by construction (`headlineGrowth: false` cannot re-enter). 9 blocks
in 5084 hit it; `BODY_OVERSET` is unchanged either way.

**But the desk is told**, because on a block already full to the foot this is a
choice between a straight right edge and a sentence, and that is an editorial
decision the software may not take on its own. `HEADLINE_COULD_FILL` names the
size it would have used and the exact number of characters that would have to
go. A decision nobody was told about is one nobody can make — which is why a
block that simply took the room it had says nothing at all.

Across all 5084 blocks in that original sweep: longest-line fill **73.6% →
76.6%**, headlines at or over its 92% bar **1089 → 2787**, display share 20.0%
→ 20.6%. The production acceptance bar is now 95% for both headline and body.

**A model's character count is a search range, never headline geometry.** The
first writing brief uses `measuredHeadlineLimit()` as a conservative bound, but
real Marathi word shapes of the same character count can be materially narrower
or wider. A live 268×248 lead proved why the bound cannot also be the repair
ceiling: alternatives constrained to its 38-character bound left the headline
only **82.47%** full. The repair asks for eight semantically equivalent
alternatives spread across 75–160% of that estimate, then shapes every one with
the exact compositor and accepts only a non-overset result at or above 95%. On
the same block the real provider supplied a 56-character legal alternative that
composed at **97.32%** in one repair call. Current-news repairs receive the same
delimited verified-facts block as the original brief; changing line breaks must
never become permission to add a fact.

### Every control names the object it acts on

`text_align` is the **body's** alignment and always was, and `setDisplayFlow()`
read no alignment at all — it placed every headline, kicker and deck line at the
start of its measure and left it there. So a sub-editor selecting the headline
and pressing "centre" re-set the story underneath it. The control was not subtly
wrong; it was aimed at the wrong object, with no error and nothing on screen to
notice. The same shape, worse, for bold/italic/underline: that toolbar is
Quill's, and Quill owns exactly one document — the body.

| the desk selects | size | alignment | marks |
|---|---|---|---|
| Headline | `headline_font_px` | `headline_align` | `display-marks.js` |
| Subheading | `subheading_font_px` | `subheading_align` | `display-marks.js` |
| Body | `body_font_px` | `text_align` | Quill |

- **`ALIGN_FIELD` in `typography-panel.js` is the one map** from selected object
  to field, shared by the writing toolbar and the Typography panel, and resolved
  at **click time** — the selection can change without either being rebuilt.
- **The kicker follows the headline** deliberately. It is the headline's own
  overline; a control of its own could only knock the two out of step.
- `headline_align`/`subheading_align` are **NULL** when the desk has never said,
  so the engine's own display default answers and no existing row changes.
- **Display type is never justified on its last line**, and `JUSTIFY_MIN_EM` is
  deliberately NOT applied to it — that rule is about rivers in a narrow column
  of small type.
- **A display line carries `at`**, so `render.js` re-applies a mark to a headline
  broken across two lines exactly as it does to a body line, and
  `scribus.service.js` emits real runs. The press file used to flatten every
  display band to one plain run: the browser printed the bold word and the paper
  did not.
- **The headline and subheading fields are `contenteditable`, not `<input>`.** An
  `<input>` holds a string, so every keystroke there overwrote whatever had been
  marked on the page above — one surface silently destroying the other's work.
  `fieldHtml()`/`fieldValue()` are the one round trip.
- **`document.execCommand` cannot apply these marks.** A headline field is
  already set in the paper's bold display face, so `execCommand('bold')` reads
  the selection as bold and takes bold OFF — `<span style="font-weight:normal">`,
  which `sanitise()` then unwraps, so pressing bold stored nothing. Ranges are
  wrapped by hand instead.
- **Lists are disabled for a display object**, not left looking live. A headline
  set as a bullet is not a headline and no display flow could carry one.
- **The marks toolbar is bound at the `document`, not to `#edQuillToolbar`.** The
  toolbar is rewritten on every render, so an element-bound listener is on a
  detached node from the next repaint — the `#edSpaceGroup` trap, again, and
  found the same way: by pressing the button and watching nothing happen.

`tests/browser/editor-controls.browser.js` is the net, and it is the only way
this class of bug can be caught: press each control with each object selected
and check WHICH field moved.

### A readout says what every other surface says

`properties-panel.js` printed `view.status` raw. That column is NULL until a
desk explicitly sets one, so the Properties panel reported **"empty" on a block
with a headline, a story and a photograph in it** — while the badge on the
canvas beside it, the chip in the Block Editor and the worklist all said
`editing`, because those three go through `statusOf()`. One derived answer, one
second copy of it, and the second copy was the one directly under the desk's
eye. It reads `statusOf(view, hasImages)` now. A readout is not a lesser thing
than a control: it is what a desk checks the control against.

### The paper does not track Devanagari, so it does not offer to

`letter_spacing_px` is the third instance of the fault that took `drop_cap`
BOOLEAN and `list_style`, and the worst of the three, because this one was
half-wired rather than unwired. `compose.js` **measures** with it — on a 190 px
block three lines become four at 1 px of tracking — and `render.js`, the PDF,
the IDML, the `.docx` and the `.sla` all set the type **untracked**. So the
block was broken against a measure the ink never reached: every line falls
`(clusters − 1) × spacing` short, 29% of the measure at 2 px, on screen and on
the plate alike. The only surface that ever drew it was the Typography panel's
own **preview paragraph** — the exact tell the other two had.

**Painting it is not the fix, and that is why the control is gone rather than
plumbed through.** CSS `letter-spacing` adds a gap after *every* cluster,
including the last and across word gaps; `measurePieceWidth()` adds it only
*between* the clusters of a word. Emitting the number would replace one
disagreement with another. And tracking is wrong for this script in the first
place — `compose.js` already says so where it refuses letter-spacing as a
justification lever: it pulls a Devanagari word's shirorekha apart, which is
why glyph scaling is the second lever there instead.

The column, `section-model.js` and the compositor's own support all stay, so
nothing stored changes and there is no migration; it is one line to put back if
a desk ever needs tracking for a Latin advert. No row carries a non-zero value
today — swept: **0 of 2527**.

### The page is RULED, and the space is specified baseline to baseline

Two things a printed newspaper has that a page of white gaps does not.

**Column rules are page furniture** (`public/editor/canvas/column-rules.js`),
like the nameplate and the folio — never a border on a block. Three reasons,
and all three are the difference between a rule and a line:

- A rule belongs exactly **halfway between** the two stories it separates. On
  one block's own edge it sits 2 mm from that story and 5 mm from the other,
  and the eye reads it as belonging to the near one.
- **A block cannot draw outside itself.** `.newspaper-section` is
  `overflow: hidden` and must be — overset copy may not spill onto the next
  story — so a pseudo-element offset into the gutter is clipped away entirely.
- A rule exists because two stories **meet**. It is a fact about the pair.

So the layout is read, the gutters between neighbours are found, and a hairline
runs the length over which two blocks actually face each other. Gutters come
from `geometry.js` through a custom property on the canvas — never a second copy
in the stylesheet. One ink, one weight, both axes: a `#c9c9c9` vertical and a
`#111` horizontal were two inks, and a newspaper has one (grey screens to a
broken dotted line on newsprint, or to nothing). An advert or any block with its
own box is skipped — its box IS the separator, and a hairline 3 px outside it is
two rules where a printer draws one.

**Space between flows is BASELINE TO BASELINE, in the line of the flow below.**
`y = previousBand.bottom + share × max(fontPx)` — a gap measured from the
previous flow's *box* and scaled by the *display* size — compounds twice: a
display band's box is a full line box tall and the ink sits in the upper part
of it, so the box bottom is already further below the ink on a 26 px headline
than on a 13 px one, and then a share of that same size is added on top.
Measured across one real front page:

| | | spread |
|---|---|---|
| headline → deck | 1.30, 1.44, 1.60, 1.68 body-lines | 29% |
| display → body | 1.33, 1.37, 1.54, 1.61, 1.75 | 31% |

A compositor does not specify space that way. `BASELINE_GAP` states it as a
compositor does, and `baselineAfter()` takes the larger of the specified gap and
the clearance the two faces physically need from their own metrics, so type can
never collide whatever the numbers ask for. Across all 11 813 sections: **1.35
under every headline, 1.50 under every deck, 1.55 where there is no deck.**

`setDisplayFlow()` places itself from a target baseline rather than a box top,
and it has to — the size is not settled until it runs (`fitDisplayFlow` tries
several), and where a line box starts to put its baseline in a given place
depends on the size it is finally set at.

The target is resolved **inside each size attempt**, for the same reason. A
deck requested at 15 px can resolve to 7.7 px to hold its one-line role; using
15 px to calculate its gap and then painting 7.7 px type leaves a false band of
air. The current candidate supplies its own resolved size and line box to
`baselineAfter()`. The body follows the same rule and may let its line box
overlap the display line box's unused slack: the face-metric clearance prevents
ink collision, while forcing box-bottom-after-box-bottom would reintroduce a
gap based on the larger line above.

This is also the Devanagari safety rule. The clearance uses the publication
faces' real design ascent/descent and the body leading is floored at the face's
full 1.555 em design box, so matras, velantis and deep conjuncts cannot collide.
It is deliberately not varied word by word: changing the baseline because one
line happens to carry a tall mark makes the column's rhythm dance. The face
box protects every line and the resolved type below defines the steady rhythm.

**A boxed block sets its type inside the box, not against it**
(`BOX_INSET_PX`). The box is ink; a printed panel insets its type 3–4 mm.

**Two spaces mid-line are set as one** (`setSpaces()` in `graphemes.js`).
Nobody types them: the paragraph policy merges two authored paragraphs by
substituting each interior newline with a space — which is exactly what keeps
the text the same length, and so keeps `line.at` valid — so `घेतला.\n\nशाळा`
became `घेतला.  शाळा`. The stored copy is never edited to fix it; it is SET as
one space, at the two places setting happens: the width it is measured at and
the ink it is painted with (browser and press file both). The collapse returns
its own index table so a mark that starts or ends at a collapsed space lands on
the same words.

### A picture may not leave a column too narrow to set in

A photograph placed so that the strip of measure beside it is under one word
wide leaves a block that keeps its depth, keeps its copy, and prints **none of
it**. `NO_LEGAL_MEASURE` reports that, but reporting is not preventing — and
neither of the two blocks in this database that hit it was dragged there. **A
new picture defaults to half the block's width at its left edge**, and on a
190px block set in 16px type that is already the fault: the 81px left beside a
95px picture is under the 96px one word needs.

`public/editor/layout/corridor-snap.js` holds the rule, and it is the ordinary
newspaper one — a picture is placed on the grid, so what is left beside it is
a whole column or nothing at all:

- flush to an edge of the measure, leaving one column of type;
- inset by at least `MIN_CORRIDOR_EM`;
- **spanning the measure — and then at the top of the copy or the foot**, never
  floating mid-column. Widening a picture to the measure *alone* can make
  matters worse: measured on the real block, the full-measure repair left 15px
  of copy above and 15px below where one line needs 25px, so it still set
  nothing. The two halves of that repair are one move.

**The trigger is `leavesNoLegalColumn()`, not "some corridor is narrow".** A
dead corridor on one side of a picture is not a fault when the other side is a
whole column — that is an ordinary page. Only a placement that makes the block
unprintable is moved, so this never fights a desk over a legal-but-unusual
picture. Verified live both ways: dropped inside the unprintable window it
snaps flush and the copy comes back; dropped anywhere printable it stays
exactly where it was put.

Enforced in **two** places, because they are two different ways in: the
editor's drag (`block-frame.js`, on the drop, not on every pointermove — the
trigger costs a composition) and `sectionImage.service.js`'s `add`/`update`,
so a direct API caller cannot make the layout the UI refuses to. It never
changes a picture's height, and changes its width only in the span case.

It repairs a placement being **made**; it never rewrites stored rows. An
edition already carrying a bad placement keeps it until someone acts — but the
desk is *offered* the repair rather than only told about it: `placementRepair()`
in `layout-panel.js` works out which picture is in the way and exactly where it
goes, and the warning carries a button that goes through the ordinary picture
patch. The offer is checked against the engine before it is drawn, so a button
that would not fix the block is never shown. Silently moving pictures in saved
pages is still not this system's to do; a person presses it.

`#edSpaceGroup` belongs to the **dock**, not the settings rail. Binding a
listener to it from `renderToolsRail()` binds to an element render has not
written yet — the control draws perfectly and does nothing.

### A picture may not stand where the headline goes, and it fills its frame

Four rules, all arrived at by placing real photographs — a portrait, a Marathi
districts map, a night street scene — into real block geometries and looking at
the result. Every one of them reads as fine in the numbers.

**Display type starts where the picture ENDS.** `setDisplayFlow()` advanced `y`
by a whole `bandHeight` whenever a band had no legal gap, so a headline under a
top picture landed on the first multiple of its own line box below the block's
top — 17px of unasked-for white on a 190×264 second lead, 10px on a 150×240,
4px on a 150×264: the same gesture, three answers. It now steps an eighth of a
band. **The body deliberately keeps its whole-row step** (`pourBody`'s cursor):
a body column has a baseline rhythm to hold against its neighbours, and
resuming off-grid under a picture is what breaks it. Display type at the head of
a block has nothing above it to keep.

**A headline is never broken in two across a photograph.** Half above and half
below reads as two stories — the same fault as a headline split sideways, which
the widest-gap rule already refuses. The flow begins again underneath instead.
Like every other preference here it yields to overset: `fitDisplayFlow`'s last
pass sets `mayStraddle`, so a block with room above a picture and none below
still sets its words.

**A picture dropped into an EMPTY article block lands below the headline it is
about to get.** `copyStartsAt()` composes the block's *current* display type,
and on an empty block that is nothing — so the picture landed exactly where the
headline was going and **halved its measure**. Measured across every article
block in the database carrying a picture and a headline: where the picture
leaves the headline its full measure it fills **95.0%** and not one runs past
two lines; where the picture narrows it, mean fill is **59.4%**, 52% are under
the bar and **46 of 96** run to three or four lines. 82 of those 96 leave the
headline under half its own measure.

The reservation is in **LINES, not characters**. `headline-reserve.js`'s
character limits are a rough bound on what a model may *write* and say so
themselves; as a *position* they are far too short, because a headline is set in
display type — on a 229×480 column the 32-character stand-in set one line at
16.5px and reserved 40px while the real 48-character headline needed 79px. Two
lines is `HEADLINE_LINES`, the number `typeScaleFor()` has always SIZED a
block's headline for. Reserve too much and the body simply pours into the slack
above the picture, which is an ordinary page; reserve too little and there is no
good answer left.

**A picture fills its frame.** The default frame's proportions had nothing to do
with the photograph's (`width/2 × height/3`) and `fit_mode` defaults to
`contain`, so 11 of 16 placements showed the paper through the frame, the worst
54% of it. The default frame now follows the source's own shape when the browser
has measured it, and where it still cannot match the picture is **cropped**
(`fitMode: 'cover'`) rather than letterboxed. **A cut-out is the exception and
is never cropped** — its frame is the subject's own bounds and its mask
describes that whole subject, so a cropped cut-out leaves the copy wrapping a
silhouette the reader cannot see. `backgroundRemoval.service.js` sets `contain`
when it replaces the picture.

All of this changes NEW placements only; no stored row is touched.

### The dateline is read from the ROW, like every other field

`composeBlock()` promises the same numbers to everyone who asks. The dateline
was the one field `section-adapter.js` read from the `view` alone while every
other field went through `pick(section, view, …)` and fell back to the row.

The page canvas builds its view with `flowViewFromSection()`, which carries
`location` and `author` — so the page set the dateline and found room for it.
`preflight.service.js`, `worklist.service.js`, `copyFit.service.js`'s
`viewFor()` and the placement repair all compose a **stored row with an empty
view**, and measured a block **one whole body line shorter than the one that
prints**: 11 lines against 12 on a 150×176, and a block the settle loop called
100% set really setting 90%. Anything that composes a persisted section must get
the same answer the canvas does; `tests/pictureBlocks.test.js` holds it.

### An empty story is empty, not the story that was there before

`pick()` walks the view then the row and treats `''` as *"the desk has not
said"*. That is right for a font family or an alignment. **It is wrong for the
words**, and the difference is not academic: a sub-editor puts the caret in the
story, presses Ctrl+A and Delete, and the draft's body goes 490 characters to 0
and saves — while the Block Editor's own page goes on setting all thirteen
lines of the copy that has just been deleted, permanently. The canvas was right
only by luck: it composes against the store's row, which autosave had already
replaced, whereas the Block Editor holds its own copy of the row and that copy
goes stale.

`pickText()` is the same lookup with one rule changed — **absent means absent,
empty means empty** — and it is used for `body`, `kicker`, `headline`,
`subheading`, and for the dateline's `location` and `author`. A view that does
not carry the key at all still reads the row, which is what every server-side
caller relies on (`composeSection(row, {})` in preflight, worklist and
copyFit), so nothing that composes a stored row changes.

The dateline was one field further on and had to be found separately: with the
body fixed, taking a reporter's story that carries no location left the canvas
setting `■ reporter` and the Block Editor `■ पाटण, reporter` — a different
dateline, a different measure, and a different number of lines on the two
surfaces.

Found by driving **Take from Reporter**, which no net covered. A story with no
body set the dateline alone on the canvas and the *previous* story in the
editor.

### The engine's own findings must be rendered, and only the real ones

`composeBlock()` returns `violations` and `warnings` on every composition.
`layoutWarnings()` read **neither** and built its own three messages from
metrics — so on a block whose picture leaves no column wide enough to set type
in, the desk was shown *"Content overflows the block… Trim the body"* and,
under it, *"Block is empty."* Two messages, contradicting each other, neither
true, and the advice cannot work. Where a fault has a specific diagnosis, the
generic one must stand down.

Two rules that came out of it:

- **A warning about copy must not fire on a block that carries none.**
  `NO_LEGAL_MEASURE` fired on 51 real blocks and **49 were full-bleed adverts
  and photo blocks** — the finished advert, not a fault. `BLOCK_KINDS` now
  records whether a kind is *meant* to carry copy and the warning is gated on
  it (51 → 2, both real). A warning that is usually wrong is a warning nobody
  reads.
- **`SET_FLUSH_LEFT` is not a fault and is deliberately not in the list.** It
  fires on 4077 of 11153 blocks because that is how a narrow newspaper column
  is set. Putting it in the fault list would bury everything else.

`SHORT_CLOSE` is a diagnostic, **not** a defect: across 805 justified closing
lines, 105 close under a third of their measure and **not one is a widow** —
they hold two to five words, all far longer than the 1 em indent, which is the
rule that actually governs a last line. A paragraph closing on two or three
words is how every printed newspaper sets.

### A paragraph is set in LINES, not written in sentences

Every style guide tells a reporter to write two- or three-sentence paragraphs,
and that advice is right. But the advice is about SENTENCES and what a reader
sees is LINES, and they are not the same thing — the same two-sentence
paragraph sets as eight lines in an 11 em city column and as one and a half
across a full-width lead. Measured on 80 real multi-paragraph blocks before
any code was written: **88.4% of authored paragraphs set in three lines or
fewer, and 51.1% set in ONE.** A one-line paragraph is not a paragraph; it is
a caption with an indent in front of it, and because a paragraph's closing
line is ragged *by design* (it is never justified), a column of them is a
column in which every line is a ragged closing line.

`public/editor/compose/paragraph-policy.js` states the rule in the unit the
reader sees. Two ceilings, because they catch different blocks:

| | | catches |
|---|---|---|
| `MIN_PARAGRAPH_LINES` | 3 | a break the block is too shallow to carry — set as one paragraph |
| `MAX_PARAGRAPH_LINES` | 10 | a narrow column running away |
| `MAX_PARAGRAPH_SENTENCES` | 3 | a WIDE one. The front page's 268×264 lead set **eight whole sentences as ten lines** — inside the line ceiling, and still a wall of type |

A paragraph splits only at a sentence end — **the compositor may choose where a
paragraph starts, never where a sentence does** — and never into pieces the
merger would immediately take back.

**Two passes, and the second is exact.** A paragraph's depth is not knowable
before the pour, so `composeBlock()` pours once with every authored break,
reads the real depths in equivalent lines, applies the policy, and pours
again. Estimating depth from a character count is the mistake this codebase
has already measured its way out of. Two and not more: merging only deepens a
paragraph, splitting only shallows one. `mayNeedPolicy()` keeps the second
pour off ordinary single-paragraph blocks with a regex and no measurement.

**The stored copy is never edited.** `body` keeps every blank line the reporter
typed. Offsets stay exact because the paragraphs *tile* the text: a merged
paragraph substitutes its interior newlines with spaces — same length, same
offsets, and the space lands at the end of a piece where it is trimmed before
any ink is measured. That is what keeps `line.at` valid, and `render.js`
re-applies the sub-editor's bold and italic marks through `line.at`.

Measured across 600 real article blocks: one-line paragraphs **149 → 1**,
paragraphs over ten lines **83 → 0**, deepest paragraph **27 → 8**. The cost
is 70 more interior lines that cannot fully close — and **every one of them
has both justification levers already pinned at their caps**, worst at 85% of
its measure, half of them the (indented, so narrower) first line of one of the
new paragraphs.

**A paragraph break costs room, and the budget charges for it.** The
paragraph's last line ends where the copy ends rather than where the next word
will not fit, so the rest of that measure is gone. `capacityChars()` poured
one continuous run and could not see it — a 200×300 block quoting its floor
overflowed the moment the compositor split a paragraph. It now pours in
paragraphs at the policy's own cadence, and indents each one. That makes the
calibration samples' sentence length load-bearing: `WIDEST_PER_CHAR` reached a
full stop every 27 characters and was measuring its own punctuation, dropping
the quoted floor 25% on a 190×264 lead. **All three samples probe character
WIDTH and nothing else — keep their sentences at an ordinary length.**

The Space panel says what the compositor did (`Paragraphs — 2 set, 1 written`)
whenever the two differ, so "I typed four and the page shows two" has an
answer on screen. `tests/paragraphPolicy.test.js` holds the rule.

### The last fraction of a column is closed with the LEADING

Copy is written in whole **sentences**, so a writer can only ever get within about a line of the foot: one more sentence overflows, and trimming takes it straight back out. That granularity is why a block kept stopping at 86% however many times it was asked for more words — and no amount of prompting fixes it, because nothing can be written into a gap smaller than a line.

A compositor opens the leading a point or two and lets the copy fill the column. InDesign calls it vertical justification; every printed page uses it. `compose.js` does it after the pour, **bounded twice over**: at most one band's worth of residual is absorbed (`MAX_ABSORBED_BANDS`), and no single line gap opens by more than 12% (`MAX_LEADING_STRETCH`). Anything bigger is a genuine hole and stays one, for the writer to fill with words.

`whitespace.occupancy.leadingAbsorbedLines` records what it took, and `emptyEquivalentLines` is reduced by it — room the leading took is no longer room a writer could fill. Measured on a real block: **86% set → 97.5%**. Across a filled 34-block page: **28 blocks at exactly 100%, 31 of 34 at or above 95%**.

`scripts/fill-edition-copy.js` was rewritten to match: it used to assemble copy against `bodyCharRange.min` (the guaranteed-safe *floor*) and stop one sentence before even that, leaving 41 of 43 blocks under 95% — so every screenshot taken to judge the layout was judging a page nobody had filled. It now composes after every sentence and keeps the last one that fits.

### Every device is on ONE ROW, on the editor

The desk's report, and it was true: *"I have not seen buttons or things you
modified — make sure to add every functionality a button which is small and on
editor like bold, italic, underline."* Every device this product had built was
reachable, and every one of them only by scrolling a narrow settings rail or
opening a tab. **A control a desk cannot FIND is a control that does not
exist** — the same finding as "a control that cannot act is not offered", one
step earlier.

`public/editor/external-editor/device-bar.js` is that row, beside the
bold/italic/underline a desk already knows: Border, Tint, Columns, Body face,
Head face, Drop cap, Bullets, Numbers, Insert, Separator, Chart, Caption, AI
picture.

- **Labelled, not iconographic.** Bold and italic can be marks because every
  desk knows them; `▣ ▤ ▥` for border/ground/columns are three things a person
  has to learn, and a tooltip is not something anybody reads while working —
  this codebase has already been bitten by exactly that (`#edStorySize`
  retargeting silently).
- **It is NOT a second implementation of anything.** Every button ends in the
  same `onPatch(patch, source)` the panels call, and everything it offers comes
  from the shared catalogues, so the bar and the settings rail are two views of
  one decision and pressing either moves the other.
- **Bound ONCE, at the document.** `renderExternalEditor()` runs on every
  repaint, so binding per render added a listener each time — and because
  pressing an open menu TOGGLES it, an even number of listeners opened and
  closed it in the same click. It drew perfectly and did nothing, which is the
  exact fault the bar exists to remove. The handlers are refreshed on every
  render; the listener is added once.

`tests/browser/device-bar.browser.js` presses all thirteen and checks which
thing moved.

### A picture laid across two stories can now be PLACED

`moveOverlay()` has existed since overlays did, and nothing in the product
could ever CREATE one: every overlay on every page had been put there by a
fixture. So the device was real, the compositor set each block clear of it, all
four exports drew it — and a desk had no way to make one. Insert → *Picture
across blocks* opens a file picker and lays it straddling the selected block's
own bottom edge, which is what an overlay is FOR.

### A panel is read from the DRAFT, like every other field

`insetPanelsMarkup()` and `obstaclesOf()` read the ROW alone. A panel a desk
had just added therefore drew nothing and displaced no copy until the edition
was reloaded — so the block on screen and the block that would print were two
different blocks for as long as the desk was looking at it. This hit the
existing Properties control as much as the new button. Both resolve
`view.insetPanels ?? section.inset_panels` now, and `insetPanels` travels with
the draft. It is the dateline lesson in the other direction.

### Terminology — there is no external editor

The SAHAS Layout Desk is one editor with two views of the same block:

| say | not |
|---|---|
| Newspaper Layout / newspaper canvas | — |
| **Block Editor** | External Editor |
| Story, Image, AI, Layout | tabs, panels, dock |
| Page, Section, Template | — |

`public/editor/external-editor/` still holds the Block Editor. The folder keeps its name because eleven modules import it and renaming it buys nothing but risk — the name a *desk reads* is what mattered. Do not reintroduce "External Editor" in anything a person sees.

The Block Editor is **not** a second application: no iframe, no separate state, no popup, no separate save. One store → one selected block → one draft → newspaper canvas + Block Editor → save → database.

### One page scroll

The document scrolls: toolbar → newspaper → Block Editor → end of page. **Never** put `height: 100vh` + `overflow-y: auto` on the workspace, the Block Editor or the dock — that is a viewport-tall scroller inside a scrolling document, and a desk cannot tell which scrollbar it has hold of. The Block Editor is long; that is fine.

Two bounded exceptions, both sidebars rather than page scrollers: the settings rail (capped to the page's height) and the Story Explorer drawer.

A sticky **grid item** is confined to its whole grid, not its row. `.workspace-tools` was sticky and therefore parked itself over the Block Editor once the two shared a grid. If you make anything in `.workspace-top` sticky again, check it against the row below.

### The Newspaper Workspace — three places on one screen

The Newspaper Workspace is the heart of SAHAS. Never redirect away from it; everything happens inside this one screen (`renderShell` in `public/editor/workspace.js`).

It is one CSS grid (`.workspace-top`) with three areas, and a panel belongs to an area **by what it is for**:

| area | selector | holds |
|---|---|---|
| beside the page, left | `#workspaceToolsPanel` | how the block is **set** — Typography (open), Story details, History, the small page layout |
| the page, right | `.workspace-canvas-host` | the sheet, the page/layout toolbar, zoom, minimap |
| the desk, left 70% | `.ext-write-col` | where the story is **written** — the copy and its pictures, one panel |
| the desk, right 30% | `.ext-assist-col` | what **helps** write it — Generate with AI, Space left, Smart cards |

Two rules this layout exists to keep, both learned the hard way:

- **Nothing may push the writing surface below the fold.** The settings rail is capped to the page's height (`--page-area-h`, published by `measureToolbar()`) and scrolls inside itself; left to its own content it was the taller column and set the height of the whole top of the screen.
- **A narrow window reorders, it does not just stack.** Under 1024px the areas become page → desk → settings. That is why all four are children of one grid — CSS can only reorder siblings.

`renderExternalEditor()` writes **two** hosts in one call: the settings rail and the dock. The rail must never be left showing a block that is no longer open.

**Template definitions live in exactly one place: `src/layout/templates.js`**, served to the client via `GET /api/templates`. Each template has a `key`, `name`, and `sections[]` with `{key, x, y, width, height}` in px (base canvas: 660×1060, matching `newspapers.page_width_px`/`page_height_px`). Do **not** hardcode a second copy of template names/section keys anywhere in frontend JS — a prior drifted duplicate (`admin.js`'s old `newspaperTemplates` object, with invented keys like `side`/`bottom1` that didn't exist in the DB) silently broke every section save except `lead`. It was removed; `newspaper-workspace.js` and `page-editor.js` now fetch `/api/templates` and render from real persisted `page.sections` (which already carry position + content, returned by `GET /api/newspapers/:id/pages`).

When adding a new template, add it to `src/layout/templates.js` only — both the picker UI and the canvas pick it up automatically through `/api/templates` and `page.sections`.

### Catalogs the server and the browser share

Three things are defined once in `public/editor/layout/` and imported by **both** sides — the server reaches them with a dynamic `import()`, exactly as `worklist`, `fit`, `jump`, `preflight` and the AI brief all reach the character grid:

- `text-flow.js` — the character grid. One cell = one body character wide × one line tall. **No longer the measurement authority** — see "The composition engine" below. It survives as the fast planner and as the fallback for the moment before the publication font has loaded.
- `block-kinds.js` — what each `block_type` is and what work it wants (article, briefs, photo, advert, feature). The worklist and the block's own heading must say the same thing; `tests/edition.test.js` asserts it.
- `picture-style.js` — how a placed picture is drawn. The page canvas and the editor read the one rule, or the same photograph looks like two different pictures.

`public/editor/smart-cards/smart-cards.js` is the fourth: one renderer for the structured daily features, drawn by the page canvas, the editor's block page and the proposal preview.

### Smart Cards — structured, never flattened

`page_sections.smart_card_key` + `smart_card_data` (JSONB) hold **what is in a block now**. `feature_key` holds **what the layout reserved the block for** and is read-only to the desk — never use it as the card key.

A card's data is what is stored and what draws. `smartCardText()` renders it to body copy as well, because everything that *measures* a block reads body text (the grid, the worklist, preflight, the fit action) — but the text is a rendering of the data, never its source. A sudoku parsed back out of nine lines of `७ · · ३` cannot carry its solution or its difficulty, and cannot tell a blank square from a printed dot.

Adding a card: give the builder in `src/features/` a `card` payload beside its `items`, and add a renderer to `smart-cards.js`. Both, or the card falls through to prose — which is the deliberate behaviour for anything unrecognised, so a feature can never vanish off the page.

`public/editor/layout/feature-table.js` is the **fallback only**, for rows saved before this existed.

### What the AI may do, and what it costs

Everything the AI produces is a **proposal**. It enters the same editable draft as typed copy, marked `needs_review`, and nothing reaches the database until the desk accepts and autosave carries it. Reporter copy is never overwritten — `fillRemaining` carries it on, word for word, at the front.

**Who writes:** `AI_PROVIDER=gemini`, `AI_FALLBACK_PROVIDER=sarvam,anthropic`. Gemini writes because a full-page lead needs room; Sarvam covers, and its Marathi is still why it is there. `DEFAULT_PROVIDER` in `src/services/ai/index.js` is the **only** hard-coded provider name and decides nothing except what happens when `.env` is silent. Never name a provider anywhere else.

Fallback is for a provider that is **down**, never for copy somebody dislikes — quality is the desk's judgement.

**Reasoning is counted inside the output budget on both providers.** This is the trap that has cost the most time, and it is measured, not assumed:

| | budget variable | what it means |
|---|---|---|
| Gemini | `GEMINI_MAX_OUTPUT_TOKENS` (8192) | room for the **article**; the tier's thinking budget is **added** on top, capped at the model's 65536 |
| Sarvam | `SARVAM_MAX_OUTPUT_TOKENS` (16384) | the whole allowance, thinking included; the account's real ceiling is *learned* from the 400 the API returns |

On Gemini, `maxOutputTokens: 200` with `thinkingBudget: 4096` came back `MAX_TOKENS` with **six tokens of answer**. That is why the two are budgeted separately and summed. `thinkingBudget: 0` is rejected outright by `gemini-3.6-flash`, so the cheap tier asks for a little thinking rather than none.

Tiers **ask for** thinking: Basic 1024, Plus 4096, Ultra 12288. The desk's dropdown opens on **Basic** — quick and cheap, and the sub-editor raises it for the lead.

`thinkingBudget` is a **request, not a ceiling**, and this is measured against the real account rather than assumed. Four calls to `gemini-3.6-flash`:

| asked | spent thinking |
|---|---|
| 1024 | 722 |
| 1024 | **7191** |
| 4096 | 4130 |
| 12288 | 5792 |

So the tier does not reliably cap the thinking, and it is not a cost control. What protects the copy is that the wire allowance is the **sum** — the article's room plus the thinking's — so an overrun eats slack rather than the article. Do not build anything that assumes the answer has exactly `GEMINI_MAX_OUTPUT_TOKENS` available, and do not quote the tiers as a spending limit.

**What went wrong is classified, and the classification decides the retry.** `src/services/ai/conditions.js` holds the vocabulary; each adapter maps its own API onto it, and nothing above works from an error string:

| condition | retry the same provider? |
|---|---|
| `outputExhausted` | **yes**, exactly once — a different request can fix it |
| `quotaExhausted`, `auth`, `rateLimit`, `unavailable`, `timeout`, `badShape`, `empty` | no — straight to the understudy |

A used-up daily quota and a busy minute are both HTTP 429 and are not the same situation; asking again is latency the desk waits through and, on a metered account, a second charge. When the understudy does write, the desk is told **why** in one sentence — "Google Gemini's quota is used up for now. Sarvam AI wrote this instead." Status codes and raw JSON bodies never reach a sub-editor; the providers' own words stay in `attempts`.

- **An exhausted budget gets exactly one retry**, one tier down with twice the room. Never a loop — every attempt is billed. What the desk is finally shown names the two things a sub-editor can do, never an environment variable.
- **"Write this block" never predicts a length, and never pays to cut.** The model is asked for a **reservoir** — more copy than the block will print — and the exact compositor chooses the prefix that fits. Overflow is repaired by a free deterministic trim; only a genuine hole costs a paid call, at most one. See "The compositor is the controller" below for the whole loop and the measurements behind it.
- **The old "reservation is a proof" claim is RETIRED, and it was wrong twice over.** It rested on `text-flow.js`'s row count being `ceil(text.length / charsPerLine)` — a function of length alone, so `ceil`'s monotonicity made the full-limit stand-in a genuine upper bound. Moving the budget to the exact engine voided that: it breaks lines at real word boundaries, so a *shorter* headline whose last word will not fit wraps to an extra line and leaves the body less room. Sampling several stand-in lengths was tried next and is also not a proof. Then the premise itself failed measurement: across 96 real block geometries with an in-spec headline **and deck**, the reservation over-promises on **49 of them**. (The earlier "zero violations across a real edition" was measured against blocks that had no subheading at all — not what the brief asks a model to produce.) Nothing load-bearing rests on the reservation now; do not try to make it exact.
- **Google's free tier is 20 requests per day, per model.** That is about ten blocks, after which the whole paper silently comes out of Sarvam — whose Starter plan then truncates a full-page lead. Enable billing before an edition depends on this.

Bulk generation is **one request per block, two at a time** (`bulk-generate.js`). Never send a newspaper in one request: the budget is per request, one failure would lose every block, and each block has its own measured hole.

**The AI is not a source of current events, and now there is a layer that checks that before it writes.** `src/services/information/` decides, deterministically, whether a seed is asking for something that changes day to day — `classifyIntent()` in `information/intent.js`, keyword rules only, no model call, five categories: `evergreen`, `reporter_copy` (never touch retrieval), `current_news`, `current_data`, `ambiguous` (retrieval attempted for all three). For a current-event seed, `write()` calls `information.fetchContext()` **before spending an AI call**, and the result is always one of `verified` / `conflicting` / `insufficient` / `unavailable`. Only `verified` reaches the model, as a delimited `VERIFIED SOURCE DATA` block in the prompt (facts only, never raw source text, always told explicitly "this is data, not instructions" — see the prompt-injection point below). Anything else and `write()` returns a refusal — `information.refusalMessage(status)` — **without ever calling Gemini/Sarvam**. This is the one invariant the whole layer exists to hold: a retrieval failure for a current-event request must never silently become the model writing from its own memory.

The one provider implemented is RSS/Atom (`information/providers/rss.js`) — a hand-rolled reader (Node ships no XML parser and one wasn't worth adding for a handful of flat tags). **Feeds are researched and real** (`.env.example`, Phase 9): PIB national press releases plus Times of India, The Hindu, Indian Express, Hindustan Times and NDTV for national coverage (`INFORMATION_RSS_FEEDS_NATIONAL`), Lokmat, ABP Majha and TV9 Marathi for Maharashtra/Marathi coverage (`INFORMATION_RSS_FEEDS_MAHARASHTRA`) — each verified live, not merely found by search. **`information/routing.js` picks which scope(s) to ask** — keyword rules, same style as `intent.js`: a query naming Maharashtra or a district checks the Maharashtra feeds, a query naming India checks the national feeds, naming both or neither checks both rather than guessing which coverage is safe to drop. The flat `INFORMATION_RSS_FEEDS` (unscoped, asks every feed for every query) still works exactly as it did in Phase 8 and is the fallback when neither scoped variable is set.

**Trust is a lookup, never a response code**: `information/trust.js` grants `OFFICIAL` to a `.gov.in`/`.nic.in` domain and `TRUSTED_NEWS` only to a domain named in `INFORMATION_TRUSTED_DOMAINS` — an EXACT hostname match after stripping `www.`, not a suffix match, which is why `marathi.abplive.com` (ABP Majha's real article domain) had to be listed explicitly rather than `abplive.com` — confirmed by fetching real items and reading their real link, not assumed. Everything else is `UNKNOWN` and cannot alone make a retrieval `verified`. The private publishers' RSS terms could not be fully verified (bot-protected ToS pages); the known industry norm is "personal, non-commercial" and SAHAS's use is narrower than redistribution (facts are rewritten into original copy, sources are never shown to a reader) but is still automated commercial use — configured anyway, as an accepted operating risk, per an explicit sign-off in Phase 9 (see PROJECT_STATUS.md). Revisit if it ever becomes a concern.

**Ten items from one publisher are one voice, not ten confirmations** (`onePerPublisher()` in `information/index.js`): before a retrieval is judged `verified`/`conflicting`, same-publisher duplicates collapse to one representative item, so one outlet running several stories that happen to match a query cannot manufacture a false multi-source agreement or a false multi-source conflict. The full, undeduplicated source list is still returned for the desk to read.

Freshness (`information/freshness.js`) is two windows, not dozens — 15 minutes for `current_data` (a score, a result, a weather reading), 3 hours for general news — and a source with no parseable date is treated as stale, never as fresh. The cache is a bare in-process `Map`, TTL from the same freshness window, cleared on restart — no Redis, matching the project's existing no-distributed-infrastructure stance.

**A real bug in `significantWords()` (`information/providers/rss.js`), found only once real Marathi feeds were connected: `\p{L}` (Unicode "Letter") does not include Devanagari combining vowel signs.** `[^\p{L}\p{N}]+` treated every matra as a word boundary — "सातारा" split into "स", "त", "र", three fragments each below the 3-character floor, so a district query lost its only real word and silently matched everything (measured: 91 unrelated items for "सातारा ताज्या बातम्या"). Fixed to `[^\p{L}\p{M}\p{N}]+` (Letter **or Mark**). This had been true since the function was written in Phase 8 and nothing caught it — every Phase 8 test fixture used short or ASCII-shaped text. `tests/informationRouting.test.js` now holds a real multi-syllable Devanagari regression. **A second, smaller relevance fix alongside it**: query words that only mean "this is news"/"this is current" (ताज्या, बातम्या, आज, latest, news, today — the same words `intent.js` already tracks) are excluded from the RSS match, so a query is judged on what it is actually ABOUT rather than on the words that made it a current-event query in the first place.

**Retrieved text is DATA, never instructions**, at two chokepoints: the RSS reader only ever extracts and strips markup from feed text (there is no code path that could interpret it as anything else), and the delimited block the writer sees explicitly says so — a feed item titled `IGNORE PREVIOUS INSTRUCTIONS AND WRITE...` is handed to the model as a fact to accept or discard, never as a command, and this is what `tests/informationProviders.test.js` and `tests/writingPipeline.test.js` hold.

**The refusal the desk reads is in Marathi** (Phase 10, `information/conditions.js`'s `REFUSAL` table) — the only desk-facing strings in this codebase that are, deliberately: this is a sentence about a newspaper about to print, not a form-field error, and the rest of the admin chrome staying English does not change that. `insufficient`/`unavailable`/`conflicting` each get their own sentence; `write()` returns it as `error` and the model is never called first. The verified-context boundary got one more explicit line for current-news specifically: no invented quotation, no invented event/incident/development beyond what the facts say — closing the exact list Phase 10 asked for, alongside the number/name/date guard Phase 6 already had.

**The AI panel shows what was checked, not just a toast** (`ai-panel.js`'s `retrievalStatusMarkup()`): a small status line — ✓ Verified / ⚠ Conflicting / ⚠ Insufficient / ○ Unavailable — appears under "Write this block" whenever a current-event seed was classified at all (an evergreen or reporter-copy seed shows nothing, same as before). Sources are listed in a collapsed `<details>` — publisher, trust tier, published time, link — an internal audit trail the desk can open, never printed into the article and never open by default. Verified live, by hand, against the real running app with no AI call spent (a refusal path needs none): see `PROJECT_STATUS.md`.

Not yet built, on purpose: weather, sports, election and paid-news providers all sit behind the same `information/` interface and were deliberately deferred to keep this phase provably small — see `PROJECT_STATUS.md` for what was measured and what is still open.

A second copy of any of these is the failure mode this project has already been bitten by twice (the drifted template keys, and `object-fit: cover` on the page against `contain` in the editor).

### The composition engine — one answer, in `public/editor/compose/`

`composeBlock()` takes a frame, its copy, its type and its photographs and returns **one** object saying exactly where every line sits. It touches no DOM, no canvas and no layout engine, so it produces the same numbers in Node and in the browser. "The editor renders the same as the page" is therefore not a property kept true by tests — both surfaces draw the same list of positioned lines, and neither breaks a line at all.

| module | what it owns |
|---|---|
| `font-metrics.js` | a small hand-rolled TrueType reader (`head`/`hhea`/`hmtx`/`cmap`) over the real publication TTFs |
| `graphemes.js` | UAX #29 clusters via `Intl.Segmenter`. Text is only ever cut at an akshara boundary |
| `intervals.js` | the scanline representation, and corridor viability |
| `exclusion.js` | a photograph as an exclusion envelope: closing, hole filling, stand-off dilation |
| `compose.js` | the solver → CompositionResult |
| `render.js` | that result as absolutely positioned spans |
| `section-adapter.js` | the one translation from a persisted row or a live draft into a composition |

**A constant cannot measure Marathi, and the reason it went unnoticed is that its average was nearly right.** `AVG_CHAR_WIDTH_RATIO = 0.4` overstates real Marathi width by 7.8% across a 419-codepoint sample. Per *line* it is out by ±18–22%: a matra-heavy line sets 18% narrower than it believed, a plain-consonant line 18% wider, Devanagari digits 22% wider. Both errors sit in the same block and cancel in the total, which is the signature of the whole family of complaints — a block reporting itself full while visibly short of its own bottom edge, and copy escaping a frame the budget said had room. A Devanagari vowel sign takes **no advance width**: in `NotoSerifDevanagari-Regular.ttf` क is 711 and म 556, but े ं ु ् are all 0. Do not tune the constant again.

**What is exact and what is not.** Advances are the font's own numbers. GSUB/GPOS are *not* modelled, so a substituted conjunct measures slightly wide — the safe direction, deliberately. Never "fix" that by scaling the result down.

**The character budget is a range, not a scalar, and this is settled.** The same block holds 30–46% more or fewer characters depending only on what is written into it, because conjunct-heavy Marathi hides zero-width codepoints inside one akshara. Clusters were measured as a candidate stabler unit and are **worse** (68–87%). An attempt to keep one safe scalar needed a 15% discount, which would have underfilled every block on the page to protect a single outlier. So `capacity` quotes the geometry (`fullMeasureEquivalents`, which does not vary at all) plus `bodyCharRange.min/max`, and the guarantee lives where it can be kept: **overflow is detected exactly, after the copy exists**, which is what the existing bounded shortening repairs against. Quote `bodyCharRange.min` when you must not be wrong.

**Font readiness is real.** Measurement before `ensureFontsLoaded()` resolves falls back to the old grid and sets `fontReady: false` with a `FONT_NOT_READY` warning. A page composed against a fallback font and then repainted is two different pages, and only one of them was approved. `workspace.js` awaits the fonts before the first paint, beside the identity, for that reason.

**Whitespace is classified, not counted.** A ragged right end is how type is set and is never a hole; a gap a photograph made unusable was never counted as usable in the first place. `largestHoleLines` is the one number the desk and the writer act on, and `HOLE_LINES` (4) matches `storyWriter.service.js` deliberately.

### The desk's own workflow: a byline, a part list, and the empty blocks

**The paper signs its own copy.** `DEFAULT_BYLINE` (`text-flow.js`) is
**साहस वार्ता**, and it is written onto the block's own `reporter_name` when copy
is written into it — by the AI writer, and by `fill-edition-copy.js`. It is
deliberately NOT a rule inside `datelineText()`: as a stored value the desk can
see it in Story details and change or clear it, and a block that should carry no
byline at all (a caption panel, a filler) is still a block with an empty
reporter and still prints nothing. A rule could not have said that.

**"Write a headline" / "Write a subheading" are part of the brief, not a
display toggle.** Turning one off changes what the block is *measured* as
(`planningFit`), because reserving rows for display type nobody will ever set is
the mirror image of the fault `planningFit` was written to fix — the model is
asked for a fraction of what the block holds and it prints half empty. The
schema still **requires** both fields (a model told to omit a key answers less
reliably than one told to fill it), so the brief asks for them and `write()`
drops what the desk did not want, which is also the only way the drop is
guaranteed rather than hoped for.

**"Write empty blocks" now includes a block with no headline.** It used to skip
one, on the reasoning that a model asked to fill 800 characters from nothing
invents all of them. That was true when it was written and is not any more:
`newsSeed()` briefs such a block with *today's news for the ground this paper
covers* — the block's own location, else its category, else the paper's place of
publication — and every seed names the day in Marathi, which is exactly what
`information/intent.js` classifies as `current_news`. So `write()` fetches and
verifies real sources **before spending a call** and returns a Marathi refusal if
it cannot. An empty block is written from today's checked news or it is not
written at all, and the desk is told which blocks came from the wire. The bulk
coordinator must retain `result.retrieval`: each successful current-news row
shows the same collapsed publisher/trust/date/link evidence as a single-block
proposal before the desk accepts it. A `block_type: feature` frame is standing
furniture even when a legacy row has no `feature_key`; bulk prose skips it.

### Two blocks, one story — shift-click the second

`jump.service.js`'s `carryOver()` has always taken an explicit
`{ toPageId, toSectionKey }` and **had never once been given one**: the only
continuation a desk could ask for was "find the first empty block on a LATER
page", which is the page-turn idiom. The commoner arrangement by far is a big
story running into a second leg **on the same page**, and there was no way to
say which block.

Shift-click is that way — no second selection model, no mode to enter and leave,
and the gesture every layout tool already uses to mean "and this one too".

**A same-page continuation is not a jump, so it sets no jump line and no second
headline.** The two lines exist because a reader has to turn a page; a story
carrying on in the next leg needs neither, and every printed page runs stories
across two or three legs without saying so. A repeated headline halfway down a
page reads as a second story rather than the same one. The landing block is
therefore also *measured* without one — reserving rows for a headline that is
never set would refuse continuations that fit.

`reunite()` puts it back either way: stripping an absent pick-up line is a
no-op, so one expression covers both.

An explicit landing is still a destructive write, so the service — not only
the Shift-click UI — proves it is an empty editorial block in the same edition
before splitting the source. Existing headline/deck/body copy, a booked story,
a feature, an advert or another continuation all refuse the move. A placed
picture is allowed because an empty landing may already carry its photograph;
its exclusion is included when the landing capacity is measured.

### A wide block sets in COLUMNS

`measureColumns()` has always been able to work a column count out from a
block's width, and was **never once asked to**: `column_count` was
`NOT NULL DEFAULT 1`, so every row in the table carried an explicit 1 and the
whole inference half of that function was unreachable. The front page's anchor
is 268 px — **134 mm** — and was set as one column of type, 48 characters to the
line. No newspaper prints a 134 mm measure.

NULL means "the desk has not said" now, exactly as `headline_align` does, and it
is the ordinary state. Two numbers decide, and both are measured:

- **`TARGET_COLUMN_PX` (120)** — 59 mm, taken off the customer's own printed
  page (1920 px across 330 mm, five columns of 358 px with 22 px gutters). The
  count is whichever whole number comes nearest.
- **`MIN_COLUMN_EM` (10)** — the floor, and the block that proves it is needed
  is the 190 px second lead: one column is already 11.8 em and 27 characters,
  and split in two it becomes 5.4 em and the pour sets **nothing**. Two columns
  nothing can be written into is worse than one that is a shade wide. It sits
  just under `JUSTIFY_MIN_EM` (13) on purpose — a column under 13 em is set
  flush left, which is how every paper sets a narrow one; a column under 10 em
  cannot hold a Marathi word and a half.

Measured across all 4653 sections carrying copy — lines over 50 characters
**580 → 19**, lines in the printed 20–35 band **911 → 1797**, and `OVERSET`
unchanged at 10, so the split costs no copy.

**`0` is the wire's word for AUTO.** Every presentational column is written with
`COALESCE` (a payload that does not mention a field leaves it alone), which on
its own makes "hand this decision back to the engine" impossible to express. 0
is not a legal column count, so it can never collide with a real one:
`section-model.js` sends it, `page.repository.js` turns it into NULL. And
`draftFromSection`'s `|| 1` had to go — it turned every NULL straight back into
an explicit single column.

**Server-side composition must preserve that NULL too.** The AI writer and
copy-fit service both hand their live overrides to `section-adapter.js`; they
must omit `columnCount` and let the adapter read `section.column_count`. A local
`Number(section.column_count) || 1` makes an Auto 268 px block compose as one
column for the AI while the canvas composes it as two. Explicit 1 still wins —
the adapter is the one place that distinguishes an instruction from Auto.

**Properties → Columns is the one control**, offering Auto and 1–4, with a note
saying what Auto would actually do in this block's own numbers. It used to be a
number input in Typography, which could not say "auto" at all — so a desk who
once touched it could never hand the decision back.

### The paper's colours are a palette, never a picker

SAHAS VARTA is printed from four plates, so every colour that reaches a page has
to be one the press can separate. `public/editor/layout/inks.js` is the one
catalogue — the browser draws its controls from it, and `scribus.service.js`
reaches it through the same dynamic `import()` the character grid does, so a
colour can never mean one thing on screen and another on the plate.

The palette is also a **server boundary**, not trust placed in those controls.
`pageSection.service.js` rejects a foreign tint/accent or treatment before the
row is written, and `section-model.js` sanitises persisted values on read for
older/imported editions. This is security as well as press correctness: a block
ground is interpolated into the canvas's style attribute, so arbitrary stored
text may never reach that renderer.

| | | control |
|---|---|---|
| `INKS` | a colour on selected **words**, stored as `data-sahas-ink` | the marks toolbar |
| `TINTS` | a light ground behind a whole **block**, `page_sections.background_color` | Properties → Ground |
| `headline_style: 'reverse'` | white type out of a solid panel | Properties → Headline treatment |

- **Black and White carry no hex, deliberately.** Black is the absence of an ink
  (choosing it *clears*); White is the paper, stored as NULL, so a block nobody
  tinted can be told from one a desk set to white. `background_color` is the one
  presentational column NOT written with `COALESCE` — otherwise clearing a tint
  would be impossible.
- **A colour that has been through the DOM comes back `rgb(200, 16, 46)`.** A
  browser normalises every inline colour, so both forms have to resolve to the
  same ink. Quill's colour attributor is a **style** attributor that reads its
  value back off the element — a whitelist of hexes rejected what Quill itself
  produced, so Quill painted the words red in its own DOM and recorded **nothing
  in the Delta**, and `copyFromFrame()` (which walks the Delta, deliberately)
  stored plain text. The whitelist is open; `sanitiseInk()` at the one door to
  storage is what keeps a foreign colour off the page.
- **An absent attribute is not a value of zero.** `sanitiseSize(null)` returned
  **6** — `Number(null)` is 0, `Number.isFinite(0)` is true, and the clamp took
  it to the minimum — so `sanitise()` kept every stray `<span>` as a size mark
  and set the words inside it in 3 pt type. Latent until a second span attribute
  existed; found because an inked headline stored as
  `<span data-sahas-size="6" data-sahas-ink="…">`.
- **The reverse panel is DRAWN, never composed.** It is ink laid behind type
  that has already been placed, so no line moves. It spans the block's whole
  measure (a panel that stopped at the shortest line would read as a
  highlighter) and takes `REVERSE_BLEED` past the band's own box. A desk's own
  ink mark inside a reversed headline still wins, in the browser and in the
  press file alike.
- **A tint is a VALUE, so it lives in the element's own style** — which means
  `refreshSection()`, the single-block repaint used for every keystroke, has to
  set it too. It did not: the tint stored correctly, drew correctly on a reload,
  and never appeared while a desk was choosing it. Two paint paths, one updated.
- **In the press file the ground goes down first, then the panel, then the
  type.** A `.sla` paints in document order; `tests/inkAndGround.test.js` holds
  that order, because a ground emitted after the type would paint over the
  story.

### An EMPTY block has to show what it is waiting for

`composeBlock()` of an unwritten article block returns nothing — no lines, so
no bands — and `bandOf()` then hands the headline and deck hit frames a
zero-height box. The Block Editor's page was therefore a **blank white
rectangle**: no caret, no prompt, and the headline and the deck could not be
reached ON THE PAGE at all, because a 0×0 frame cannot be clicked. A double
click anywhere landed in the body, the only frame left. That is the "the editor
is not editable" report, and it was the block a desk opens most — the one that
has not been written yet. The canvas at least said `LEAD` / `EMPTY`; the editor
said nothing, which is also the "different things are showing" half.

A block whose flow is empty is composed a **second time with that flow's own
label standing in for it** (`promptComposition()` in `block-frame.js`). That
gives real band geometry — where the words will sit and at what size — used for
two things: the hit frame gets a real box, and the label is drawn in it.

- The prompts are **Block Editor chrome**. They are drawn in
  `#edFramePlaceholders`, never in `edCanonicalContent`, so they cannot reach
  the newspaper canvas, the composition, or anything that saves.
- **A headline and a story are named whenever they are missing** — an article
  block is never published without a headline. **A deck is offered only while
  the block is unwritten**, because a deck is optional (the AI panel has a
  toggle for it) and a permanent ghost on every deck-less block is noise —
  literally so: made permanent, it drew grey display type over the first line
  of a story that was already set.
- **But a prompt is what makes a flow REACHABLE, and that cost a subheading.**
  A flow with no prompt has no band, a frame with no band is placed
  `display: none`, and an object that is not on the page cannot be clicked or
  typed into at all. Measured, by doing it: type a headline on the page, then
  double-click where the deck goes. Committing the headline made the block
  "written", withdrew the deck's prompt, hid its frame mid-gesture — and the
  double click fell **through** to the body frame underneath. The subheading
  the desk then typed was appended to the **story**, and stored that way:
  `subheading` NULL, its words the last sentence of the copy, and nothing on
  screen to say so.
- So the flow the desk is **addressing** is prompted whether or not the block
  is unwritten: the one being edited, and the one selected — including by
  clicking into the Subheading field below the page, which selects that object
  like every other route. The prompt is what gives it real band geometry to be
  present at; the label is still withheld from a flow being typed into.
- Only the display flows stand in. Pouring a stand-in **body** would move
  `bodyTop` and fill the frame with lines that are not the block's.
- **`bodyTop` follows the prompt only while the BODY is unwritten.** The prompt
  composition reserves room for display type that is not set, so its `bodyTop`
  sits below where real copy starts — taking it on a block that has a story but
  no headline yet pushed the body's hit frame down past its own first lines,
  and those lines stopped being clickable.

### An object is selected on POINTER-DOWN, like every layout tool

A `click` is only dispatched on the element that received both the mousedown
and the mouseup; if they differ the browser dispatches it on their common
ancestor instead. **On this page they differ routinely**, because pressing on
one flow blurs the flow before it, and that commit re-composes the block and
moves every frame under the pointer. Measured on the deck, pressed while the
headline was open:

```
pointerdown: edSubheadingFrame
mousedown:   edSubheadingFrame
mouseup:     edFramePage      <- the frame moved 32px out from under it
click:       edFramePage
```

So the deck's own handler never ran, the page's background handler ran instead
and selected the **block**, and a desk pressing the subheading got no
subheading — while a *double* click, needing both presses to land on the same
element, could miss entirely and fall through to the body.

`bindTextFrames()` therefore selects on `pointerdown` and stops the press from
reaching the page's own handler. **Click to select, click again to edit** — and
a double click still works, because a double click is two clicks: the first
selects the object, the second finds it already selected and opens it. The
worst case is now a stray *selection* rather than typing into the wrong object.

`armed` is the frames' own memory of the last press, deliberately **not**
`state.selectedPart`: selection travels out to the workspace and back through
`refreshFrame()`, and it has not returned by the time the second press arrives.

**Clicking a block that is already open selects the block itself**
(`selectSection()` in `workspace.js`). It used to return early and do nothing,
which left a desk stuck: Properties shows Border, Ground, Columns, Drop cap and
Headline treatment only while the whole block is the selected object, and every
one of those is a decision made *after* the story is written — so once the caret
had been in the body the only way back was the Escape key.

### A mark may not begin or end inside an akshara

The compositor has always cut copy at cluster boundaries; a sub-editor marking
words on the page had no such rule. `bodyOffsetAt()` maps a pointer position to
a character offset by proportion — `line.at + text.length × fraction` — which is
plain code-unit arithmetic and lands between a consonant and its matra about as
often as not. Bolding a dragged phrase produced `द<strong>िली`, and the browser
drew the orphaned matra on a **dotted circle**. It is visible in a screenshot
and it is stored that way.

`graphemes.js`'s `snapToCluster(text, offset, bias)` is the rule, next to the
`clusters()` it is built on. A caret snaps to the nearer boundary; a selection
grows **outward** — start back, end forward — so a drag never loses a character
the desk had covered and never marks half of one. Measured: 15 drags across a
real block at fifteen different fractions, **zero** split aksharas.

### The selection chip is outside the page

`.frame-selection-label` sat at the selected frame's own top-left corner, which
on the body frame is exactly where the story's first words are — so selecting
the body covered the opening of the story it was naming. The page is
`overflow: hidden` (overset copy may not spill onto the next block), so a label
placed above a frame at the top of the page would simply be clipped away. It
lives beside the page now, in `.block-frame`, positioned against the page's own
box, and it also carries the direct-body-edit state that used to be a *second*
chip drawn inside the body frame at its top right — on top of a justified
column, whose lines reach exactly that edge.

### The drop cap is a property of the FRAME, not a mark on a run

A sub-editor's instinct is to select the first character and press a larger
size, and until this existed that was the only thing the editor could do. The
result is not a drop cap: a size mark makes the **one row** it lands on three
and a half times taller and leaves the opening letter on a stilt with a band of
white under it. Photographed on a real block.

A drop cap is a rectangle at the top of the first column that type may not
enter — which is exactly what a photograph is, and this engine has run type
round those since it was written. So `dropCapOf()` contributes one more
interval to the obstacle set and **nothing else in `fillRow`, `viableIntervals`
or the balancer changes at all**.

- **Stated in LINES** (`page_sections.drop_cap_lines`, 0 = none), because that
  is how a compositor specifies it and how it stays right at any body size.
  Properties → Drop cap offers None / 2 / 3 / 4.
- **Taken in CLUSTERS.** A Marathi initial is an akshara — क्ष is one letter,
  not three — and slicing by code unit would set a bare consonant in 40 px type
  and leave its matra behind in the copy.
- **Sized by its INK, not its design box.** Measured in the browser against the
  publication serif at 200 px: an ordinary akshara's `actualBoundingBoxAscent`
  is **0.625 em** (क म ग ट पा रा ना हा सु ल क्ष सा), rising to 0.895–0.905 only
  where an above-base matra is present. The face's design box is 1.555 em, so
  sizing the cap by the box drew a letter a little over half the depth it had
  reserved, sitting in its own hole. The cap's head stroke is set on the first
  line's head stroke and its baseline on the last line it spans.
- `FACE_BOX_ASCENT_EM`/`FACE_BOX_DESCENT_EM` (0.930/0.625) are what the
  **browser** lays the face out with — `fontBoundingBoxAscent`/`Descent`, which
  is what decides where a baseline lands inside a line box. Deliberately
  separate from `faceAscent()`/`faceDescent()`, which are this engine's own
  measured ink extremes and are not the numbers CSS uses.
- **The pour skips the cap's own clusters and the paragraph's offset gains
  exactly the same number**, so `line.at` — and every bold and italic a
  sub-editor set — is unchanged to the character.
- The gutter is half a **body** em: it is the copy that has to clear the
  letter, so the gap reads the same whether the cap is two lines deep or four.
- **A cap may not be taken out of the DATELINE, so a block that carries one is
  refused a cap.** The dateline is furniture prepended to the copy
  (`section-adapter`'s `prefix + withMarks.text`), so `dropCapOf()` took ITS
  clusters: the cap was the dateline's own U+25A0, three lines deep, drawn as a
  **solid black box** where the story's first letter should be. Photographed on
  a real 268×296 anchor, and true since drop caps were built — most article
  blocks carry a location and a byline, so most blocks a desk gave a drop cap
  printed a black box. Setting the cap on the first letter AFTER the dateline
  is worse: the cap would show a letter belonging to a word that begins further
  down the line, met by the reader before the dateline it follows. A drop cap
  is the story's first ink and on this paper the dateline already is; the two
  cannot both open the block. The desk is told (`DROP_CAP_AFTER_DATELINE`) —
  a control that silently does nothing is the fault this project has already
  fixed twice.

It replaces a `drop_cap` BOOLEAN that persisted, had a Typography checkbox, and
reached nothing but a CSS class on that panel's own **preview** paragraph — the
composed block never set a drop cap at all. `tests/dropCap.test.js` holds it,
including that a block which has not asked for one composes byte for byte as
before.

### A size mark is offered in POINTS, against the block's own body

The marks toolbar offered 12, 14, 18, 22 and 28. Those are browser-CSS numbers
in a **block-pixel** field — `rich-text.js`'s `sanitiseSize` stores an absolute
number of block pixels, and a block's running body is **6.4** of them (9 pt at
2 px/mm). So the smallest "emphasis" on offer was 1.9× the copy and the largest
4.4×. Photographed: a 22 px run inside 7 px type opens its own row to three and
a half times the leading and leaves a hole above and below — which is not
emphasis, it is the drop cap's own fault happening in the middle of a paragraph.

Four derived buttons came next — 0.85, 1.2, 1.45 and 1.8 of the block's own
body, labelled in points — and the unit was right while the *shape* was not.
The desk's report: *"I select a text and try to change the font but I can
change only those option sizes above; it also should have drop down."* A
caption at 7 pt, a standfirst at 11, a pull quote at 18 are not ratios of
anything; they are sizes, and four of them is not a size control.

**`publication-type.js`'s `TYPE_LADDER_PT` is now the one list of sizes this
product offers**, and both controls read it: half-point steps through reading
sizes (the columns are `NUMERIC(5,1)` for the same reason), opening out as the
type gets bigger. It starts at **6.5 pt**, the smallest type preflight passes a
page with. `typeLadder(currentPx)` folds a block's own off-ladder size in, in
order, so a block the auto-fit has set to 20.5 px can still say what it is set
at rather than being rounded to a neighbour.

- The **selection's** size is `#edQuillSizeSelect` in the marks toolbar; the
  **object's** is `#edStorySize` above the page. Each carries a visible chip
  naming what it acts on — `SELECTION`, and `BLOCK` / `BODY` / `HEADLINE` /
  `SUBHEADING`. A tooltip is not something a person reads while working, and
  that is precisely how a desk came to report *"double click on editor the font
  size changing automatically"*: `#edStorySize` retargets with the selection, so
  double-clicking a headline moved it from 6.4 to 24 — editor block pixels — and
  nothing on screen said the control now meant a different object.
- **A `<select>` is not a button, so `holdSelection()` cannot be used on it**:
  the `preventDefault` that keeps the caret in place is also what stops a
  dropdown opening. `display-marks.js` remembers the marked range on the press
  (and on focus, for the keyboard route) and puts it back when the choice
  lands; `restoreSelection()` falls back to the live selection inside the
  aimed-at field when nothing was remembered.
- **`quill.getFormat()` with no arguments must never be called.** Its default
  first argument is `this.getSelection(true)`, and the `true` means *focus the
  editor and then tell me* — so merely reading the toolbar's state pulled the
  caret into the body on every render, and returned null (crashing on `.index`)
  whenever the hidden editor could not take it. Ask for the range first.
- **`SIZE_MIN` is 4 block px (5.7 pt), not 6.** 6 px is 8.5 pt — within a hair
  of the 9 pt body — so the smallest emphasis this product could store was
  0.94× the copy, and the old toolbar's own smallest step was silently clamped
  away. What the picker *offers* still starts at 6.5 pt; this is only the bound
  on bad data, and it can never have lowered a stored value.

Storage is unchanged — still an absolute size in block pixels — so no existing
mark moves.

### The caret and the selection are DRAWN, on the page that prints

The desk's report was *"body inside editor is not editable"*, and separately
*"I select a text … it working but not properly"*. Neither could be reproduced
by reading code: a double click really does focus Quill, a drag really does
call `setSelection()`, and typing really does reach the copy. It took driving
the running app and photographing the page to see what was actually true —
**the composed page drew no caret and no selection at all.** Measured: a drag
across one composed line reported `{index: 0, length: 12}` in Quill, and the
screenshot showed no highlight anywhere. A desk was being asked to mark words
it could not see and to type at a cursor that was not there.

`public/editor/external-editor/body-caret.js` draws both, and it estimates
nothing: a composed line is a real element carrying real text, so a DOM `Range`
over its own text nodes gives the exact painted position of any character —
after `word-spacing` and after the `scaleX` a stretched line carries, because a
client rect is measured after both. `render.js` emits **`data-at`** on each
body line (the compositor's own source offset) and the caret module reads it;
Quill's index space is the *authored* body, so the two differ by exactly the
dateline's length — the one constant `bodyOffsetAt()` already subtracts going
the other way, stated once and used in both directions.

- The band is laid **over** the glyphs and multiplied, not painted behind
  them: the composed layer is the page's only ink, so a solid band above would
  hide the words being marked and one below would be behind the sheet.
- **An unwritten block composes to no lines**, so there is nothing to measure a
  caret against — and writing a block from nothing is the commonest job there
  is. The caret waits at the head of the body frame instead.
- **The gestures are the ones every editor has**: a click moves the caret, a
  drag selects, a second double click takes the word, a third takes the
  paragraph, and Escape leaves the story the way it already left a headline.

### The writing box does not vanish

`.is-canonical-body-editor` used to collapse `#edWritingSurface` to
`height: 0; opacity: 0`, so a double click on the story made the one thing on
screen labelled "Body copy" disappear and the column jump ~340 px. The desk's
report was exactly that: *"after double clicking on body some time it shows
body copy some time not"* — and, reasonably, that the body was not editable,
because the visible editor had gone and the page drew no caret to replace it.

The page draws a real caret now, so the box no longer has to hide to keep the
desk's eye on the composition. It stays where it is, quieted rather than
removed, and its label says which of the story's two views has the caret. One
story, two views, neither of them appearing and disappearing mid-sentence.

### A pointer lands on the letter it is pointing at

The desk's next report: *"just like we easily select text, that is not smooth
at all — if I want to select one character in a word it is very difficult"*.

`bodyOffsetAt()` mapped the pointer by **proportion** —
`line.at + text.length × ((x − line.x) / line.measure)` — which is only correct
if every character is the same width. Devanagari is nothing like it: in the
publication serif क is 711 units, म is 556, and **every vowel sign is zero**,
because a matra carries no advance of its own. Measured on one real composed
line, pointing at the centre of each akshara in turn: the old mapping named the
right one **1 time in 10**, worst miss **12 characters**, mean 6.1.

`offsetAtPoint()` in `body-caret.js` asks the painted line instead — it walks
its aksharas, measures each one's real box with a DOM `Range`, and returns the
boundary the pointer is nearest, choosing the near edge inside a letter so the
caret goes before or after it as the desk aimed. Same points: **10 of 10**,
worst miss **0**. A single akshara can be picked out with a drag across it.

**And the band is painted while the pointer is still down.** The selection used
to be computed only on `pointerup`, so a desk dragging across a phrase saw
nothing at all until they let go and then had to judge whether they had got it —
the other half of "not smooth". Every editor paints as the pointer moves.

### A display flow opens in the type the compositor RESOLVED

*"I tested सौरऊर्जा प्रकल्पाचे भूमिपूजन — after double clicking this headline in
editor it changes."* It did, and the photographs show the last word simply
gone: `सौरऊर्जा प्रकल्पाचे`.

One number. `headline_font_px` on that 229×480 block is **21**; the block
**sets at 20**, because `fitDisplayFlow()` searches for the size that fills the
measure inside the line budget. `beginInlineTextEdit()` styled the editable
frame from the *requested* size, so the text ran 5% wide of its own measure —
and on a headline that already fills its line, 5% is one whole word pushed onto
a second line, which `.frame-headline`'s own `overflow: hidden` then cut off.
Nothing was lost from the copy; it could not be seen, which is worse.

`setInlineTypography()` takes four things from the composition instead of from
the row: the **face** (`line.family` and `line.weight`, exactly what
`render.js` paints — it was the one thing the frame did not take, so a headline
or a deck opened for editing in whatever the page CSS gave it and the desk
reported that the two change face on a double click), the **size and line box**
off the band's own resolved lines, the **measure** (the band's box is its *ink* extent — on a centred headline that is
narrower than the measure, and typing into an ink-tight box re-wraps on the
first keystroke), and the **alignment**, which was hard-coded to `left` so a
centred headline jumped to the left edge as it opened. While open the frame may
grow rather than clip: a desk writing a longer headline has to see the words,
and blur commits and re-fits it.

### A larger run needs its ascent ABOVE the baseline, not just its own box

A row carrying a `data-sahas-size` run grew to `size × lineHeight` — the larger
run's full design box, which sounds sufficient. Measured by setting one word at
18 pt inside 9 pt copy and photographing it: the big word's ink still climbed
**0.7 block px into the line above**, close enough on newsprint to touch its
descenders.

A row's baseline is not in the middle of the row. The line is painted as one
span set in the **body** size with `line-height` equal to the row's height, so
the browser centres the body's own strut in it and puts the baseline at
`(height − strut)/2 + bodyPx × FACE_BOX_ASCENT_EM`. Growing the row therefore
lifts the baseline by only **half** of what was added, while the larger run
needs its whole ascent above it. Hence the factor of two in `rowHeightFor()`:

```
height ≥ bandHeight + 2 × FACE_BOX_ASCENT_EM × (size − bodyPx)
```

which puts the baseline at exactly `FACE_BOX_ASCENT_EM × size` — the run's own
box ascent — and leaves its descent satisfied at every size at or above the
body's. It is exactly `bandHeight` when the run **is** body size, so a block
carrying no size mark composes byte for byte as before. Measured after: ink
overlap **3 px → 0**, with 5 px of clearance below.

### A size mark is not painted in the plain-text source box

`data-sahas-size` stores an absolute number of **block** pixels — a 14 pt mark
is 9.9 of them against a 6.4 px body, half again as large. The Quill box below
the page is set at a comfortable reading size instead (15 px and up, so a desk
can type into it), and a 9.9 px run inside 15 px type renders **smaller** than
the copy around it. So making a word bigger on the page made it visibly shrink
in the box underneath — the desk's report, exactly.

One CSS rule (`font-size: inherit` inside `.ql-editor`) takes it off. The mark
still travels in the Delta, still stores and still prints: **that box is the
story's plain-text source, not a second rendering of it**, and the page above
is where type is judged.

### "Optimize with these details" acts on ONE object, and says which

It was a stub that built a request preview and told the desk nothing was
connected. It goes to the same server-side writer "Write this block" uses — so
nothing new is briefed, billed or measured differently — and a select beside it
names what the answer is applied to: **Whole block / Headline only /
Subheading only / Body only**.

- **Only the chosen fields are applied.** `scopedProposal()` keeps them and
  discards the rest unread. The model is still asked for a whole block, because
  that is the one brief this writer has and asking for less changes what the
  block is *measured* as (`planningFit`).
- **The result is composed HERE, through the exact compositor, against the
  block as it stands** (`localFit()`). The server's own fit measured a whole
  new block — a new headline, deck and body together — and a headline-only
  change has to be judged against the body that is *staying*. It costs no
  provider call, and it is the same local composition Accept already runs to
  reject a stale proposal.
- **The confirmation names only what it is about to overwrite.** Asking about
  "the headline, subheading and body" when one line is changing trains a desk
  to dismiss the question without reading it.

Verified against the real provider: scope *Headline only* on a filled block
rewrote the headline, reported "Fits. 100% of the block's lines are set", and
left the body byte for byte (469 → 469 characters) and the deck untouched.

`tests/browser/body-editing.browser.js` is the net for all of this — it presses
the gestures and checks the two things a screenshot would: where the caret is,
and what is highlighted.

### A picture's landing place is SETTLED, not computed once

`copyStartsAt()` returned the block's current `bodyTop`. But where the copy
starts is not a fixed property of the block: putting a picture there can push
`bodyTop` down, because the headline above is re-fitted with the picture in the
frame and may take a line it did not need before. Measured on a real 190×264
second lead — the headline set **one** line ending at y=26, so the picture
landed at y=27, and with it there the headline re-fitted to **two** lines
ending at y=49, its second line set in the 89 px corridor beside the picture.
Half a measure is a caption, not a headline; it is the exact fault that
function exists to prevent, arriving by the back door.

So the answer is settled rather than computed once: place, compose, and if the
copy now starts lower, move down to meet it. Bounded at three passes like every
other budget in this engine — it converges in one or two, because each pass can
only push the display type down by whole lines.

### Leaving the body is leaving it, by whatever route

`beginCanonicalBodyEdit()` collapses `#edWritingSurface` to nothing — that is
what puts the caret on the page instead of in a second editor below it. The
frame click handlers ended that state when the desk clicked another object on
the page, but **nothing ended it when they moved to the headline FIELD under
the page**, or Tabbed into it, or picked the object in Typography. The writing
surface then stayed invisible and unclickable with no way back to it short of
double-clicking the body again.

The rule now lives in `refreshFrame()`, next to the one that already ends it
when another BLOCK is selected: selection is the one place that knows about
every route, so `selectedPart !== "body"` ends the direct body edit there.

### A control that cannot act is not offered

`image-geometry.js` resolves a cut-out's fit to `contain` whatever the row
says — cover or stretch would crop into the silhouette, which is the one thing
a cut-out exists to prevent. The Fit control still offered all three and marked
the press active, so the UI claimed an effect the page then ignored. Cover and
Stretch are now **disabled on a cut-out**, with a title saying why — the same
rule the Columns control already follows for a count the block cannot hold.

`tests/browser/editor-parity.browser.js` is the net for all of the above. It
presses every control the Block Editor offers for text and for pictures, and
after each one it checks two things: the control did what it says, and the
newspaper canvas and the Block Editor page still show **exactly** the same
composed block. Both, or a control that quietly writes to one surface passes.
It also asserts WHICH object a mark landed on — comparing the body's marks
rather than its line breaks, since a larger headline legitimately re-flows the
copy under it.

```bash
node tests/browser/editor-parity.browser.js            # defaults to 40294 / anchor
node tests/browser/editor-parity.browser.js 40294 brief-two
```

### The story has one input and one exact live preview

The body must not become a temporary `contenteditable` rectangle on double
click. That was tried: it could paint the right face, size and leading, but it
could not reproduce the compositor's columns, paragraph balancing or arbitrary
picture/cut-out runaround. The block therefore changed appearance while it had
focus and changed back on blur — exactly the two-layout failure the canonical
renderer was built to remove.

Quill remains the body's **one editable document**. A body double click selects
the body, brings that writing surface to the nearest visible position, focuses
the actual module-level Quill instance and places a real selection if Quill has
none. The exact canonical page is never hidden or replaced. Quill's existing
`text-change` path updates the shared draft and recomposes that page on every
keystroke, so the desk can see the real columns, image exclusion, line endings
and overflow state before focus leaves the editor.

This is an honest separation of jobs, not two renderers: Quill owns input,
selection, marks, paragraphs and undo; `composeBlock()` owns what prints. A web
`contenteditable` cannot become a second page-layout engine merely by being
positioned over the right rectangle. Headline/deck remain semantic inline
overlays because each is one short flow; their complete source is committed
through the existing fields and then recomposed.

### Nothing on the page is ruled unless a person ruled it

`border_style` always defaulted to `'none'` on the column, and `templates.js`
then shipped `border: 'box'` on **every** advert, every briefs block and all
four standing features — so a made-up page came out of the press view ruled into
panels nobody had chosen, and **there was no control anywhere in the product to
take one off**. 2548 of 11 903 rows.

The template's job is to say where a frame is and what it is for. How it is
ruled is a design decision and belongs to the desk, per block: **Properties →
Border** in the Block Editor (`properties-panel.js`, `BORDERS`), which is now
the only place in the product that sets the field. The migration is unguarded
and that IS the guard — no control existed, so every `'box'` in the table came
from the template default rather than from a decision. A future migration would
have to be guarded in the ordinary way.

Two things already follow from the field and are why it is one control and not
a stylesheet rule: a box costs the block room (`BOX_INSET_PX` — a printed panel
sets its type 3–4 mm inside its own rule) and the page draws no hairline in the
gutter beside a boxed block (`column-rules.js` — its box IS the separator).
That page-owned rule layer must refresh from the live draft **and** the fresh
page returned by autosave; refreshing only the block leaves a double rule until
reload, while rebuilding from the initial page puts it back as soon as save
lands.

### The page reserves its own furniture

**The nameplate is set for both answers, and the corner is one of them.**
`geometry.js`'s `regionsFor` owns the footer band **and** page one's top-left
corner (`header.earWidthPx`). While the corner FRAME is on the page the corner
belongs to the page, not to the block in it — a corner block someone made
narrower still leaves the region alone, which is the fix for the front page
whose title once stretched across a corner it did not own. But a paper that
does not sell the corner prints its nameplate across the whole measure, and
that answer did not exist: the reservation was unconditional, so removing the
corner left a white hole and a small name beside it.

So three things changed together, and they are one rule:

- **`mastheadMarkup` reserves the ear only when the corner frame exists.** No
  frame, no ear — the plate takes the measure. Measured on a real front page:
  **247×46 px → 426×80 px**, 73% bigger in both directions.
- **Removing the corner is allowed.** The `STRUCTURAL_FRAME_PROTECTED` 409 is
  retired; the fault it guarded against was in the nameplate and was fixed
  there. `POST /api/pages/:id/repair-structural-frames` puts the corner back
  for a desk who wants it again.
- **The workspace no longer repairs on load.** It used to ask for the repair on
  every open, unconditionally. That silently undid the desk's decision: remove
  the corner, reopen the edition, and the frame is back and the name small
  again. **This is the "the left block is not working correctly" report.** An
  automatic repair that reverses an editorial choice is not a repair.

It is the FRAME that decides and never the frame's contents — an unsold corner
still prints blank while its frame is there, because a desk fills it the
morning it is sold and the page may not re-make itself under them.

**The nameplate is width-bound, so every pixel of ear is a pixel off the name.**
At 5.33:1 the plate can only get taller by getting wider, so the ears are set as
narrow as their own type needs (90/110 → 64/88) and the editor's name — which
was set **twice**, in the right ear and again in the owner line below — is set
once. The duplicate is also what wrapped the ear onto two lines.

**A fixed band with `overflow: hidden` clips ink, not just overflow.** The
masthead's clipping edge sat exactly on the strapline's first line box, and
Devanagari's ink box is taller than its line box (1.475 em against 1.45), so
every matra above the shirorekha was sliced off — the desk photographed it. Two
pixels of leading is the whole fix. **Any fixed furniture band that sets
Devanagari needs that pixel or two; the line box is not the ink box.**

**The date is centred by a GRID, not by `space-between`.** The foot's ears are
never the same width — `दैनिक साहस वार्ता` against `पृष्ठ १` — so
`space-between` centred the date between its neighbours rather than on the
page's centre line. `1fr auto 1fr` puts it on the centre line whatever the ears
say, on the page foot and the inside-page folio alike, and a verso page reorders
its ears rather than reversing the box so the middle column stays the middle.
The Scribus footer makes the same promise explicitly: its three frames are
aligned left / centre / right. Putting the date in the middle third but leaving
that frame left-aligned begins it one-third across the page; it does not centre
it.

**The AI disclosure is standing furniture, in the imprint band, in Marathi**
(`identity.js`'s `aiDisclosure`). It says both halves of what is true here — the
copy is drafted with AI, and a person on the desk passed it before it printed —
because saying only the first misdescribes a workflow in which nothing reaches
the page unaccepted. It needed the band to grow from four lines to five
(`imprintHeightPx` 32 → 40): the band was exactly full, and a band that clips
would have swallowed a disclosure silently, which for a disclosure is the one
failure that matters. `scribus.service.js` emits it too — a press file that
dropped it would print a paper that does not carry it.


The page foot carries the paper, the date and the page number, and nothing else. The Act printline belongs to the page-two imprint, which already prints it; setting it on every page duplicated a legal statement and read as an unwanted rule.

### Looking at the page without spending AI calls

`node scripts/fill-edition-copy.js <editionId>` writes deterministic Marathi copy into a disposable `2099-*` edition, sized to each block's own measured capacity, and refuses any other date. Composition work has to be looked at to be believed, and driving a real edition through the AI writer costs money, is rate limited, and gives different copy every run so two screenshots cannot be compared.

### The professional-quality pass — what it added, and what it costs

Nine catalogues are now shared by the browser and the server, and the reason is
always the same one: a second copy drifts. `text-flow.js` (the character grid),
`block-kinds.js`, `picture-style.js`, `smart-cards.js`, `caption-geometry.js`,
and four added by this pass:

| | |
|---|---|
| `layout/typefaces.js` | which face, and which file. Replaced **three** copies — `font-metrics.js`, `shaper.js` and `pdf.writer.js` each had their own, and two of them had already drifted. |
| `layout/borders.js` | how a block is ruled, in a printer's point ladder |
| `layout/inset-panels.js` | the चौकट set inside a story |
| `layout/page-overlays.js` | a picture laid on the page, across blocks |

**The export carries the whole nameplate now, and a folio.** `print-model.js`
used to emit the plate artwork, the strapline and a date; the canvas draws the
editions line, the place, the weekday, the volume, the page count, the cover
price, the e-paper address, the owner, the office, the telephone and the email.
Inside pages had no folio at all. All four formats gained it together because
they share the walk. `scribus.service.js` keeps its own block walk (see
"Scribus shares the FURNITURE" below) but now renders the shared neutral items
for the nameplate, the folio, the rules, the block borders, the initial letter,
the inset panels and the page overlays.

**The RNI is set once, and the artwork is what sets it.** Open
`public/assets/masthead/sahas-nameplate.png` and look at the top right: the
registered mark carries the number. The canvas was setting it again as type.

**Latin inside a Devanagari run is one span, laid out by the fallback font.**
HarfBuzz reserves the face's `.notdef` advance for a character the publication
face cannot set — one fixed width for every letter — and the PDF writer drew
each at that x, so the contact line printed as `sahasnews@gmai l .com`. A
contiguous span is now one string, and it runs on across punctuation the face
*does* have when that punctuation sits inside the foreign word, which is what
closes the gap in the middle of a URL.

### The justifier has three levers, not two

`justifyLine()` could only ever ADD space. Measured on a real four-page
edition: **58 of 444 interior lines fell short of their measure, and every one
of them already had both expanding levers pinned at their caps.** No further
stretching could close them, because the word that would have filled them was
on the next line and nothing could pull it up.

Pulling it up means setting the line it comes from very slightly tight —
InDesign's minimum word spacing and minimum glyph scaling. `MIN_GLYPH_SCALE`
(0.98) and `MAX_SQUEEZE_WORD_SPACE_EM` (0.10) are deliberately weaker than the
expansion range: condensed type shows more than expanded type at the same
percentage, so a tight line is the compositor's last resort and not its habit.

**Ragged interior lines 58 → 44 on the edition, 1405 → 1360 across 819 blocks.**

**Why it is safe, and this is the whole argument:** it lives in the BALANCER,
which reassigns pieces across the slots the *pour* already fixed. The slot
count never changes, so nothing here can change how deep a paragraph sets, move
any geometry, or alter what the fill engine thinks a block holds — measured and
identical on both sides: interior line count 3026, mean fill 32.18%, overset.

Three things it got wrong first, all found by measurement rather than reading:

- Compression was offered on blocks set FLUSH LEFT, where nothing would ever
  close the overhang. `willJustify` is resolved before the pour now.
- A squeezed line's `width` did not say it had been squeezed, so it claimed to
  reach past its column and the overflow guarantee failed on a line that drew
  perfectly. The compressing path folds the squeeze into `line.width`; **the
  expanding path deliberately does not and must not start** — there it
  understates the drawn width, which is the safe direction.
- Counting the breaker's PIECES instead of the justifier's SPACES promised room
  that could not be delivered. Dropping the word-space term fixed it and threw
  away 98% of the gain (210 lines → 4), so the breaker counts spaces exactly,
  from a prefix sum built once per paragraph.

**Do not widen the range.** 0.97 gives 1189 and 0.96 gives 1190 against 0.98's
1195 on the same sweep — six lines in three thousand for another percent of
visible condensation.

### A block is ruled by a decision, in points

`border_style` had a third button ("Rule below") the server refused with a 400,
`border_width_px` was stored and read by the compositor with **no control able
to set it** and a hard-coded 1.5px in the stylesheet, and **neither export drew
a block border at all**. All three are closed. A rule is specified in POINTS —
hairline, 1, 2, 4 — because that is how a printer specifies one. A double rule
is drawn as **two lines**, never as one thicker one: the eye reads two thin
lines as a boundary and one thick line as emphasis.

The page's own gutter hairline now yields **per edge**: a block set to "Rule
below" already draws that line, and a second one 3px under it is two rules
where a printer draws one.

There is deliberately **no corner radius**. Every rule on a printed page meets
its neighbour square.

### A photograph is captioned, and set smaller than the story

`section_images.caption` has existed since the schema was written and every
part of the chain was built — `caption-geometry.js` reserves its box, the
canvas drew it, preflight measured it, the exports printed it — and **no field
anywhere in the product could put a word into it.** The Pictures panel has it
now.

Two faults found doing it: the Block Editor did not draw the caption while the
canvas did, and the face was named in three places with two of them
disagreeing. And the size was backwards — 7.5px against a 6.4px body is 10.5pt
under 9pt copy, so the caption was the largest small type on the block. It is
**8 pt in the sans face**, which is what a printed daily sets.

### Information graphics — five kinds, and one primitive underneath

This used to say there could only ever be two, because "a pie needs bezier arcs
and a line chart a polyline" and adding those to the PDF, the IDML and the
`.sla` was three separate pieces of geometry work. **The premise was wrong, and
pleasantly so: an arc turned into SEGMENTS is a polygon**, and so is a line
chart, and so is a dot.

So there is one new neutral item — **`poly`**, a point list with an ink and an
optional stroke — and each writer gained one small branch that draws straight
lines. `arcPoints()` in `smart-cards/layout.js` does the segmentation **once**,
so the wheel on screen and the wheel on the plate are the same polygon rather
than two roundings of one arc; at 300 dpi a 32-segment quarter turn is under a
third of a pixel from the true arc. **A pie is printed in TINTS of the one
accent** (`sliceInk()`, also in the solver) because a newspaper has four plates
and a colour a desk mixed in a browser is an ink no press can lay down.

Three faults found by rendering the charts and looking at them, none visible in
the code: the legend stacked UNDER the wheel and was clipped (`.smart-chart`
sets `flex-direction: column` and both rules are one class deep); the legend
was measured on its label alone and read `सातारा — ८४२ ि`; and a line chart's
end labels ran off both edges while its middle ones collided, because
`solveFont()` fitted the plot's HEIGHT and never asked whether two labels touch.
Width is a fit condition too, and the type comes down until it holds.

Scribus named every chart colour `SahasRed`, so a pie's four tinted legend
swatches all printed at full strength. It registers the colours a document
actually uses now (`colourFor()`), the way `idml.writer.js` already did.

The bars run ACROSS. A Marathi category label is long — छत्रपती संभाजीनगर — and
a vertical bar chart has to set those sideways or abbreviate them.

`smartCardLines()` gained a `kind`: an entry is a line of type unless it says
`{ kind: 'bar' }`, which the print model draws as a `fill` and Scribus as the
same polygon it already lays a block's ground down with.

### A panel inside a block, and a picture across two

**`page_sections.inset_panels`** is the चौकट — a fact box or pull quote set
inside a story. **`pages.overlay_images`** is a photograph laid on the PAGE,
crossing block boundaries.

Both cost the engine exactly one more entry in the obstacle set and **nothing
else changes** — `fillRow`, `viableIntervals` and the balancer already run type
round rectangles, because that is what a photograph is to them. There is no
panel-specific or overlay-specific arithmetic anywhere in the compositor and
there must not be.

**An overlay cannot be a block's picture.** `.newspaper-section` is
`overflow: hidden` and must stay so, so a picture belonging to one block can
never be seen outside it. A photograph spanning two stories is a fact about the
PAGE, exactly as a column rule is a fact about a pair of blocks. Every block
its rectangle touches gains it in that block's own coordinates; blocks it does
not touch get nothing.

**It does not snap to the column grid, deliberately.** A block snaps because a
page reads as a page when its columns line up; crossing that grid is the entire
reason a desk places one of these.

**A Smart Card is given a CLEAR RECTANGLE, because it cannot flow round one.**
Running copy meets an obstacle a scanline at a time; a card is solved as a
GRID, so a sudoku's nine columns and a chart's bars are placed against the
frame as a whole and there is no scanline for anything to narrow. An overlay
laid across a card block therefore left the card's geometry untouched and
simply COVERED it, while the prose either side set clear correctly. The
composition now states the rectangles it set the type clear of
(`composition.obstacles`) and `smartCardFrameFromComposition()` takes the
largest sub-rectangle meeting none of them — per obstacle, the four boxes that
avoid it, biggest wins, which with one overlay is exact. It can only ever
SHRINK the frame, so a block with nothing over it composes byte for byte as
before and `offsetX`/`offsetY` are zero. Every surface that DRAWS a card adds
those two; a surface that only measures one ignores them. An inset panel inside
a card block is fixed by the same change, because it is in the same list.

### A generated picture is proposed, never placed

`POST /api/pages/:pageId/sections/:sectionKey/images/propose` returns
CANDIDATES. Where a photograph sits decides how the copy sets around it, so a
machine that both invents the picture and decides where it goes has decided how
the story reads.

Candidates are stored as ordinary media assets, so the placement path, the
corridor snap, the cut-out service and the exports work on them without knowing
where they came from. **Two, not one — a choice of one is not a choice.**

**The success path is UNVERIFIED against a live provider.** This newsroom's key
returns 429 (no image quota on the free tier) and Imagen 404s on the project.
The refusal path is exercised end to end and the editor carries on. Enable
billing before an edition depends on it.

### Auto columns have a floor as well as a ceiling

`measureColumns()` picks the count nearest `TARGET_COLUMN_PX`, and when that
count oversets the copy `composeSection()` walks it DOWN until every word
prints. That walk had nowhere to stop: on a 620 px banner whose copy oversets
at 2, 3, 4 and 5 columns it went to **one**, and set a 310 mm line — the exact
fault `section-adapter.js`'s own header condemns on the 268 px anchor ("no
newspaper prints a 134 mm measure"), arriving by the back door.

**`MAX_COLUMN_EM` (30) is the floor, and it is in EMS** for the same reason
`MIN_COLUMN_EM` is: that is the unit legibility is in. Written in pixels first,
it broke `copyFit.test.js`'s cut-out fixture — a 268 px block set in **12 px**
type, which is 22 em and a perfectly printable measure that legitimately falls
back to one column around its silhouette. The 620 px banner is 97 em in one
column because its type is 6.4 px. Same pixel width, opposite verdicts needed.

30 is pinned from both sides by numbers already in that file: the printed
target is 18.75 em at the running body size, and the condemned 134 mm measure
is 41.5 em.

**What was tried and reverted:** also returning the least-overset arrangement
when nothing in range prints every word. It lets copy LENGTH change the block's
design — the mirror image of the rule the fallback already holds ("copy that
merely ends short never makes the columns jump around"). The block keeps its
preferred count and reports the overset, which the desk trims.

### The display face is a second field, never the body's

`DISPLAY_TYPOGRAPHY` hard-codes the paper's sans for kicker, headline and deck,
and the comment above it says why: composing a headline in whatever family the
BODY was reserved room in reserves room for the wrong glyphs. That stands.

But it meant the two faces the catalogue marks `role: 'display'` — Khand, a
condensed cut, and Rozha One — could only ever be applied to body copy, which
is the one thing neither is for. **`page_sections.display_family`** is the
explicit second field the display flows read. NULL is the paper's own sans, so
nothing composes differently until a desk chooses. The weights stay the
stylesheet's.

### A page that does not print in colour does not print in colour

`pages.prints_colour` is the press forme. The canvas greys a photograph on a
mono page (`filter: grayscale(1)`) so a desk sees what the press will do; **the
export ignored the column entirely.** A colour separation on a forme that has
none.

The picture is separated to K alone on a mono page, at **Rec. 709 luma** rather
than the naive `max()` the colour path uses — that weighting is right when
converting a picture and wrong when separating an ink. The embedded-image cache
is keyed on the forme as well as the filename: the same photograph on a colour
page and a mono one is two different embedded images.

The page-level overlay obeys the same forme. Its selector was missing, so a
mono page previewed its block pictures grey and its overlay in colour.

### A mono forme has no colour plates, and nothing on it may ask for one

`pages.prints_colour` was carried on IMAGE items alone. The photographs were
separated to K and **everything else was emitted as its own CMYK** — a chart's
accent bars, a pie's tinted slices, a reversed headline's panel, a block's
tinted ground, a word a sub-editor inked. So a page with no colour plates asked
the press for four. It is the same fault that was found and fixed for the
pictures and left standing for the ink beside them, and the canvas agreed with
neither: `mono-forme` greyed the PHOTOGRAPHS only, so a desk previewed red
headlines on a page that prints black.

`separateToK()` in `print-model.js` applies it once, per page, so the PDF, the
IDML and the `.sla` cannot disagree. **Two rules, different on purpose:**

- **Type goes to 100% K.** A red headline on a mono forme prints BLACK; set as
  a screen it would be a broken dotted line on newsprint — the same reason
  `column-rules.js` refuses to draw a grey hairline.
- **A fill, a rule and a poly take their own tonal value**, at Rec. 709 luma. A
  chart whose four slices all went solid black would not be a chart, and a tint
  that went solid black would not be a tint. These are areas, and an area is
  the one thing a screen can hold. Verified: a three-slice pie on the mono
  forme prints in three distinguishable greys.

**Knockout type stays knocked out** (`MONO_KNOCKOUT_ABOVE`). A reversed
headline is WHITE type out of a solid panel, and "every inked run goes to 100%
K" would have set it black on a dark grey panel — an invisible headline on the
one block a page shouts with. Caught before it shipped by asking what the rule
did to the ink it was *not* written for.

The canvas greys the whole sheet in print view now, and the mono warning counts
blocks carrying colour as well as photographs — a page with no pictures still
has ink on it.

### The export draws the column rules

`columnRulesFor()` is the one function that decides where a hairline goes — a
rule belongs halfway between the two stories it separates and exists because
two blocks MEET. **No export drew them**; `columnRules` appeared nowhere in the
export folder, so every download had its stories separated by white space.
`print-model.js` reads that same function rather than deciding again.

### Scribus shares the FURNITURE, not the block walk

The `.sla` is the artifact that reaches a plate and it was the last export with
no nameplate, no column rules and no block borders. `print-model.js` exports
`pageFurniture()` and `blockRules()` as its neutral items and
`scribus.service.js`'s `furnitureFrames()` renders those four kinds.

**The block walk is deliberately untouched.** It is the tested path,
`scribusComposition.test.js` pins it line for line, and moving it is a rewrite
rather than a fix.

**And that is exactly how it came to draw neither the inset panel nor the page
overlay** — a fact box reserved and not drawn is a white hole, and an overlay
absent from the `.sla` leaves the two blocks under it set clear of a photograph
that is not there. Both come from `print-model.js` now, as
`blockDecorations(section, composition)` and `pageOverlayItems(page)`, through
the `furnitureFrames()` that was already there. Neither is a second walk.

**`composition.dropCap` was drawn by NOBODY.** The pour deliberately skips the
cap's own clusters — they are set separately so `line.at`, and every mark a
sub-editor made, stays valid to the character — so `bodyLines` genuinely does
not contain them, and every export renders only `bodyLines`. Composed live, a
block opening `शहरातील` set its cap to `श` and its first body line to
`हरातील`: on screen a drop cap, **on the plate a story missing its opening
letter**. The compositor now states the cap's own `baseline` (the last body
line it spans); the browser never needed it said out loud because CSS derives
it from `line-height`, which is why it never was. Found by listing which
`composition.*` fields each renderer reads — `render.js` reads eight, the two
export walks read four.

Two things that only showed up when it was tried:

- A furniture picture **cannot go through `imageFrame()`** — that takes a
  `resolvePlacedImage()` transform and converts from editor pixels, while the
  nameplate has no crop and is already in millimetres. It gets a plain frame
  with `SCALETYPE="1" RATIO="1"`, Scribus's documented scale-to-frame keeping
  the aspect, which is the rule this artwork already has everywhere else: it
  may be sized and never stretched. Computing `LOCALSCX/Y` instead would invent
  a second scale this environment cannot render and check.
- **The press PACKAGE has to carry what the document references.** It did not,
  so Scribus would have opened with an empty frame — `tests/press.test.js` says
  so in those words. It carries the nameplate and any page-level overlay now.

### Every Smart Card is SET, and set the way a printed paper sets it

A pass over all nine cards, each one drawn at real newspaper size and
photographed. Every finding below was measured in the running browser, not read
out of the code.

| card | was | is |
|---|---|---|
| सुविचार | solved as ONE ATOMIC LINE — 8 px type beside an inline mark, half the block white | a wrapped, centred pull quote at **24–28 px**, its mark as a head, the credit under a short rule |
| दिनविशेष | wordmark took **0.37** of the block before an entry was set | 0.16, entries centred on the card's own axis |
| पंचांग / राशीभविष्य | unruled | a **double rule** in the paper's accent — heavy outside, hairline inside |
| सुडोकू | "सुडोकू सोडवा — …" | "**आजचे सुडोकू सोडवा** — प्रत्येक ओळ, स्तंभ व ३×३ चौकटीत १ ते ९ अंक भरा · काठिण्य : …" |
| हवामान | four small lines centred in a cell the height of the whole block | a **forecast panel**: place, condition, कमाल/किमान as display figures, rain, source |
| शेअर / सोने | $/troy ounce, one repeated verb, no direction | **₹ per १० ग्रॅम and per किलो**, grouped निर्देशांक / सराफा, ▲▼ with the move, an honest derivation note |
| निविदा | the fields, none of the bands | the **printed प्रकटपत्र**: issuer over office, email opposite address, number opposite place-and-date, subject over title, justified indented copy, परिशिष्ट with its group heads, signature block, jimaka note |
| जाहिरात | did not exist | a display advert — see below |

**The solver's inset must BE the rendered inset.** Three cards carried an `em`
padding in the stylesheet that `layoutSmartCard()` could not see, and every one
of them reported `FITS` while the browser drew past the block:

- `.smart-card-table td`'s `0.15em 0.3em` — at the 24 px पंचांग solved to, that
  is 14.4 px of horizontal padding the value column never had. Measured: the
  solver put every value on one line, the browser wrapped दिनमान and pushed
  शके off the bottom. The inset is now computed by the solver and written
  inline by the renderer and the export walk.
- `.smart-card-tender` draws a 0.8 px rule and insets 2 px inside it — 5.6 px
  the notice's copy did not have. Every paragraph ran past the rule.
- `.smart-card-tender-copy` was `display: grid` with a default `auto` track.
  Every composed line is `white-space: nowrap` (it was wrapped by the solver
  and must never be re-broken), so its **min-content width is the whole line**
  and an auto track sizes to it. Measured in the DOM: container 382 px, line
  box **401 px**. `grid-template-columns: minmax(0, 1fr)` is the fix, and
  `.smart-card-list` had the same shape.

**A rate table's row is ONE line.** The move was set as the percentage stacked
over the change in the instrument's own unit; measured in the DOM that column
rendered **40 px inside a 29 px row** and bled through the rule into the row
below, on every row. The absolute move now joins the percentage on the same
line when the column can hold both, and is dropped when it cannot — which is
what a narrow column does in print. The card went from 9 px to 11 px for it.

**A close of zero is not a price.** `Number.isFinite` let one through: the FX
feed returned `INR=X` close **0** for the newest session — its way of saying
"not settled yet" — and the card went out reading सोने **₹०** and **−१००.००%**.
Nothing that table prints can legitimately close at or below zero.

**दिनविशेष held 24 dates**, so the box was empty on ~93% of the year. The table
now covers ~19% of days. It is still a CURATED lookup — a model will cheerfully
produce a plausible date for a real event — so the added entries want a desk's
eye before an edition leans on them.

### The sudoku's rules never reached the plate

`smart-card-lines.js` emitted the eighty-one numerals and **not one grid rule**:
the browser drew them as CSS borders on the `<td>`s, so they existed on screen
and in no export at all. Measured on a real card, the whole walk emitted
`bar=1` — the heading rule — for a puzzle the canvas draws with twenty. A
sudoku without its grid is loose digits on white paper, and unsolvable.

Ten verticals and ten horizontals now, in the stylesheet's own two weights
(hairline between cells, heavier on the 3×3 boundaries and the frame), and the
numerals are placed from the grid's own centred origin — they were being set
from x=0 while the canvas centred the table, so they were horizontally offset
in every export as well.

**Swept across all nine cards afterwards**, canvas against export walk:
**0 texts missing from any export**, images 1:1 on every card, and every card
that draws a rule emits one — sudoku 1 → 21 bars, पंचांग 17 → 25, निविदा 5 →
17.

### A card is judged on the PAGE, not in a box of its own size

Every card in the styling pass was drawn one at a time, in a host the size of
the block it asks for, and measured for overflow. That net is real and it
passes. It also cannot see the two faults a real features page showed the
moment one was made up and photographed — both of them about a card meeting a
frame the catalogue did not choose.

**The twelve signs are set in as many columns as the frame will carry.**
`layoutRashi` had a two-way rule — one column, or two once the frame reached
180 px — written for the tall narrow box this card usually gets. On a real
620×320 features block that makes each of six rows **53 px** deep, and a row
that shallow rejects every candidate above **7.5 px**: 10.6 pt of reading
matter across a 150 mm card, with half the block's width spent on nothing.

The frame decides now, which is the argument `measureColumns()` already makes
for body copy. Every column count whose column can still set a name beside a
reading is tried, and the one resolving the **largest type** wins. On that
block: 2 columns of six at 7.5 px → **4 columns of three at 9.0 px**, all
twelve signs, which is the strip a printed paper runs.

Ties go to fewest empty cells, then to the **deepest rows** — and that last
key is what decides the all-OVERSET case, where every candidate lands on the
ladder's floor and nothing else separates them. Without it a 260×400 frame
took one column of twelve, worse by any measure than the two the old fixed
rule gave.

**A दिनविशेष entry is newspaper type, not a poster.** `solveFont()` takes the
largest candidate that fits — right for the सुविचार pull quote, whose whole
job is display, and wrong for a list. On a real 307×200 block it reached the
ladder's **32 px** top: 45 pt, beside 9 pt columns. The entry has a ceiling as
well as a floor now, stated against the paper's own running body
(`publication-type.js`, imported rather than restated): `MAX_ENTRY_OF_BODY`
2.5, so 16 px.

**And the room the ceiling gives back is spent on AIR, not on letters** — the
gaps between entries open, bounded at one line — which is the rule `compose.js`
already follows when it closes the last fraction of a column with the leading.

The wordmark came down with it (`heightShare`/`widthShare` 0.16/0.62 →
0.13/0.46). It named the box in a 150 px nameplate over a 16 px entry; a
printed standing box sets its own name a rung above its entries, not an octave.

**The layout fault had a data fault under it.** `dinvishesh.js` was a list of
day names — "प्रजासत्ताक दिन", and nothing else — so the box carried one short
line and a hand's width of white whatever size the block was, which is *why*
the layout inflated it. What a Marathi daily carries is the **dated**
anniversary, so `on(year, what)` sets one with the year in Devanagari numerals
and 21 dates gained theirs. The curation rule at the top of that file is
unchanged and matters more here than anywhere: a wrong year is a falsehood
printed over the masthead, so every line is one a person has checked, and a
desk must still read the table against its own reference before an edition
leans on it.

**A card block carries no headline, and both halves of that are deliberate.**
`smart-card-panel.js`'s accept blanks headline/subheading/body — a card draws
its own head (the sudoku's instruction band, पंचांग's artwork) and a second one
above it reads as two stories. And `section-thumb.js`'s
`smartCardComposition()` composes the block with those three fields emptied, so
the card is solved against the **whole** content box rather than against what
is left under a display band. Forcing the other state proves it: a PUT storing
a headline *and* a card leaves the headline in the row and draws 0
`.section-headline` spans beside 1 `.smart-card`. Nothing is stranded, because
accept clears the field — but a net asking "does the card overlap its
headline?" has no subject, which is what `workspace.browser.js`'s last failing
check turned out to be. It asks the invariant that holds instead: no display
band over the card, and the card's top is the composition's own content top.

`scripts`-free way to look at this: build a features page carrying every card
at a real block size and screenshot the **canvas**, not the card. The isolated
net measures overflow; only the page shows type that fits and is still wrong.

### Each card is the SHAPE a printed paper gives it

The catalogue's block sizes were a guess made card by card; laid out as a real
features spread they were wrong as a set. Every one below is what a Marathi
daily actually gives that box, and each one changed the card as well as its
frame.

| | block | and the card |
|---|---|---|
| सुविचार | **307×72** strip | ONE line, credit running on at the end |
| दिनविशेष | **190×150** box | one-line nameplate over centred bullets, ruled |
| पंचांग | **148×232** | unchanged; it was only ever too tall |
| हवामान | **148×210** | unchanged |
| राशिभविष्य | **307×620** leg | twelve boxes, nameplate across the waist |
| शेअर / सोने | **307×620** leg | the month's line under the rate table |

**राशिभविष्य's nameplate sits in the MIDDLE.** `cardArtworkFor()` gained a
third placement beside `top` and `inline`: `middle` hands the card its whole
frame *and* the band's rectangle, and the card leaves the gap itself — only the
card knows where its rows fall. `layoutRashi` takes the band out before it
measures, puts it on a row boundary halfway down, and states
`bandHeight`/`bandAfterRow` in its geometry. Both surfaces read those two
numbers: the canvas splices an extra grid track, the export walk offsets every
row below it. **The signs are placed EXPLICITLY** — `grid-auto-flow: column`
would have poured the seventh sign into the band.

**The market panel draws the month.** A rate table says whether today moved; it
cannot say whether the month did, and a printed panel always carries both.
`market.js` widened its window to 45 calendar days (a trading month is about
22 sessions, and weekends are not sessions) and carries the benchmark's closes
on the card. The solver normalises them into its own plot box and emits a
**`poly`** — the same neutral item a pie already uses — so the browser's
`<svg>` and the plate draw one point list rather than two roundings of a curve.
One line, not four: an index and a metal do not share an axis.

**The chart takes the room that is left, and only so much of it.** `solveFont()`
stops at the largest type that fits, which on a whole leg finished the panel at
55% of its own depth. A printed panel does not answer that by inflating its
rate table; it draws a bigger chart. Given the *whole* residual the plot went
past twice its own width and turned a 0.9% month into a mountain range, so
`MAX_TREND_PLOT_OF_WIDTH` (0.55) bounds it and what is left over becomes air
above and below the panel (`topOffset`), never a hole at its foot.

**A सुविचार is a strip, and a strip carries its credit on the line.** Stacked
under a centred rule the credit costs the whole second band — measured, that
held a 620×72 strip's quote down to 12 px. The credit is measured *into* the
line now and the rule goes; the quote's own drawn width is stated so the plate
sets the credit after it without re-measuring. The side inset is bounded by the
type rather than being a flat 6% of the block (37 px each side on a wide strip,
which cost a whole size step). And **a strip is only a strip while it can be
read**: below `STRIP_MIN_FONT_PX` (9 px) the wrapped pull quote takes over,
because one line at 5.5 px is not a strip, it is an accident.

### A weight the solver did not measure is a second geometry

Three selectors carried `font-weight: 600` — the almanac's value cell, the
सुविचार credit, the दिनविशेष list — and `layout.js` measures all three at 400.
The browser renders 600 out of the 700 face: measured on the almanac's राहुकाळ
value, **86.8 px drawn against 80.7 px measured**, 7.6% and exactly enough to
wrap a line the solver had set flush. The credit also carried
`letter-spacing: 0.01em`, which is the tracking this product refuses everywhere
else and which on a strip pushes the credit past a measure placed from the
solver's own number. All three are gone, and the cell's own 0.5 px rule is
charged for like its padding.

**And the browser net had been measuring every card in Arial.**
`smart-cards.browser.js` draws each card in a detached host appended to
`<body>`, which inherits the admin chrome's font — not `.newspaper-canvas`,
where `styles.css` sets the publication face. So its overflow numbers were
never the page's, in either direction: it failed पंचांग for an overflow the
real page did not have. The host wears `.newspaper-canvas` now. This is the
same lesson as the section above it, one layer out: a card measured outside the
page is measured in the wrong font.

### Sixty minutes is not a time a newspaper prints

`panchang.js` floored the hours and rounded the remainder independently, so a
day of 10 h 59.6 m printed **"१० तास ६० मिनिटे"**. The total is rounded once
now and then split, and a whole number of hours drops the minutes entirely —
"११ तास", which is how an almanac says it.

### The nameplate is a COLUMN of the card, or a heading over it

`cardArtworkFor()` has three placements and each one answers a different
question about the mark:

| | | |
|---|---|---|
| `top` | पंचांग | the mark stands over the box it names |
| `middle` | राशिभविष्य | the mark crosses the column's waist |
| `inline` | सुविचार, दिनविशेष | the mark is a **column of** the card |

**सुविचार is mark, thought, name — one rule of type.** On a strip a centred
head above the line is a second band the strip has not got, so the mark opens
the line and the quote and its credit run on after it.

**दिनविशेष is two columns**: the wordmark in one, the day's entries as centred
bullets in the other, each centred in its half. And it is the paper's own
nameplate face — `dinvishesh-title-v2.png` was a 4.16:1 banner in a different
hand from पंचांग's and राशिभविष्य's marks; `denvishash.png` is 1380×752, the
same artwork family as `panchangwithoutBG.png`, so the three standing boxes are
set by one hand.

**A card whose mark stands inside it is ruled round the whole frame**
(`borderBox`). For a `top` nameplate the mark sits over the box and the rule
follows the box; for an `inline` one a rule round the *content* alone would cut
the card in half. The solver states which rectangle, and both surfaces read it.

### Every card is ruled, in one of the paper's two inks

`CARD_BORDER` (`export/smart-card-lines.js`, mirrored by `.smart-card-<key>` in
`styles.css`) — the accent for a standing feature of the paper (सुविचार,
दिनविशेष, पंचांग, राशिभविष्य, हवामान, बाजार, सुडोकू), black for a commercial
block (जाहिरात, निविदा), because an advertisement and a प्रकटपत्र are not the
paper speaking. पंचांग and राशिभविष्य keep the **double** band — heavy outside,
hairline inside — which is what tells an almanac from an ordinary ruled box.

This is not a second geometry: a border is ink at the frame's own edge, and
both surfaces already have the frame.

### A rate panel does not explain its own table in prose

The **"मागील सत्र"** paragraph restated in figures what the ▲▼ column already
said, and it is gone — **at the source**, not merely unrendered: `market.js` no
longer composes the sentence, `smartCardText()` no longer emits it, and nothing
measures a block against text the card does not draw.

**The month's line carries its own scale.** A chart without one is a
decoration: the line alone says the month wobbled, not between what and what,
or over which days. The **high and the low label the y axis** — the two figures
a reader can check against the rate table directly above — and the **first and
last session date label the x axis**, with the session count and the month's
own change between them. Both are measured, so the plot is given the room that
is left rather than the labels being laid over the line.

**The writers take a poly's points as `[x, y]` PAIRS**
(`scribus.service.js`'s `polyFrame` destructures them); the solver states them
as `{x, y}` because that is what the browser's `<svg>` consumes. One conversion,
at the boundary — getting this wrong throws *"object is not iterable"* out of
the Scribus walk, which is how it was found.

### A card is only as tall as its own content

Three blocks were carrying air the card then had to do something with, and each
did something different and wrong:

- **हवामान** solved to the same 9 px type at 160 as at 210, and the panel
  centred its content in the difference — the desk's "too much gap between
  सातारा and स्रोत". Now **148×168**.
- **पंचांग**'s five rows left 27 px of slack *inside the almanac's own double
  ring*, which read as a sixth, empty row. Same type at 205 as at 232, slack
  6.7 px. Now **148×205**.
- **The market panel** finished at 55% of a whole leg — answered by the chart
  taking the room, bounded (above).

**And राशिभविष्य's signs are centred in their rows.** A row is the block
divided by the row count, and a sign carrying two lines of reading rather than
three leaves the difference as slack. Pinned to the top, all of it collected at
the *foot* of each cell — which is what put a hand's width of white immediately
above the nameplate band, since the band follows the third row's own trailing
space.

### The export walk had a second, unreachable copy of itself

465 lines: `chart`, `sudoku`, `rashi`, `panchang`, `suvichar`, `dinvishesh`,
`havaman`, `market`, `tender` — the whole branch chain again, left behind when
the live set above it was rewritten. It was a strict subset (it never gained an
`advert` branch), and nothing could reach it because every branch above ends in
`return out`. Deleted, with the canvas-against-export sweep of all nine cards
unchanged afterwards. A second copy of a card's geometry is precisely the drift
this file exists to prevent, and one sitting where no test can execute it is the
worst kind.

### Judge a card in PRINT VIEW, and the room left over is SPREAD

`#printViewBtn` takes the editor's chrome off the sheet. It is the only honest
way to look at a card, and everything in this section was invisible until the
page was photographed through it.

**A card's leftover room never stacks.** Three goes at the market panel, each
wrong in a different way and the third wrong in the way a reader notices first:

| | |
|---|---|
| whole residual → the chart | a 0.9% month drawn as a mountain range |
| chart capped, rest **centred** | ~55 px of white between the panel's own top rule and its title — a hole at the *head* of the box |
| chart capped, rest **spread** | ✓ |

A compositor opens the **leading**. The chart takes what it can carry
(`MAX_TREND_PLOT_OF_WIDTH`), and the rest opens the gaps *between* the bands
evenly — title to table, table to chart, chart to source — up to
`MAX_BAND_GAP_GROWTH` of the card's own gap. Anything still left sits at the
**foot**, where a printed panel can carry it; never at the head. On a real
307×620 leg: **93% of the block set**, gap 6 → 24, plot 56 → 220.

**The band gaps are the solver's, written inline.** `styles.css` carried a hard
`margin: 0 0 6px` under the market title — the one gap it happened to know
about — so any room the panel had left could only pile up somewhere the solver
had not accounted for.

**Two rows had to fill their own box too.** पंचांग's five rows never added up
to exactly the box they were given, and the remainder showed as a **sixth,
empty row inside the almanac's own double band**. A printed table spends that
on its rows, bounded at half a line. Slack 14.5 px → **0**.

### A ruled card sets its type inside its own rule

`CARD_BORDERS` now lives in `layout.js` — the module both sides import — rather
than in the export walk, because the **solver** has to know about a rule: type
may not be set under it. Without the clearance the market panel's chart caption
and its y-axis figures began at x=0 of the content box and the card's own
hairline was drawn straight through them.

The clearance is the rule's own depth plus a hair (2 px, 4 px for the double
band), not a round number — on a 148 px almanac a generous inset costs the value
column a whole size step.

### A mark that is half margin draws half the size it reserves

`denvishash.png` was 1380×752 with the word occupying **70% of the width and
50% of the height** — against 88–98% for the other three marks, measured with
an alpha scan at a threshold above the file's own faint watermark. So the box
`heightShare` reserved was twice the depth of the letters in it and the
nameplate drew small and adrift in a band of nothing. The asset is cropped to
its own ink (989×399) and `aspect` is the real one.

**Check a new mark's ink share before tuning its shares.** Two rounds of
adjusting `heightShare` could not have fixed this, because the number was not
the problem.

### दिनविशेष is two ROWS, and सुविचार's mark opens the line

Set as two *columns* the wordmark took a third of the box's **width** from the
entries, and on a 190 px box that is the measure the reading matter needed. The
standing name goes across the head with the day's entries as centred bullets
beneath — which is what पंचांग already does, and now in the same hand. The block
widened to 268 to give that mark measure enough to read as a nameplate.

सुविचार keeps its `inline` mark, sized against the **line of type it opens**
rather than against the strip: at `heightShare` 0.74 it stood half again as tall
as the words and read as a logo pasted beside them.

### Two things called `.smart-card-artwork`, and one of them moved every nameplate

The generate panel's artwork fieldset (`smart-card-panel.js`) and the card
renderer's registered nameplate image carried the **same class name**, and the
panel's rule was `margin-top: 8px`. So every `top`-placed mark on every card —
पंचांग, राशिभविष्य, दिनविशेष — and the सुविचार strip's lead-in mark drew **8 px
below where the solver placed it**. Measured in the DOM: inline style
`top: 23.11px`, `offsetTop` 31.

That is two desk reports at once — "दिनविशेष word touching down line", and the
सुविचार mark sitting under its own line instead of beside it. Both were read as
spacing faults and neither was: **a class name collision is a layout bug that
looks like a taste problem.** The panel's fieldset is
`.smart-card-artwork-field` now.

Chasing it is also why the fix was found: the artwork's stated `top` and its
measured `offsetTop` disagreed, which no amount of adjusting `heightShare`
could have explained.

### One ring per card, the same on all four sides

Several cards drew a heavy rule of their own along the top — and the weather
and market panels along the bottom too, 0.7–0.8 px — and then gained the card
ring (0.6 px) on top of it. In print view that reads as a band above and below
with hairlines down the sides, which is the desk's *"all 4 side border lines
should be same"*. The ring from `CARD_BORDERS` is each card's only rule now;
पंचांग and राशिभविष्य keep the almanac's double band, which is a ring inside a
ring and even on every side. The export walk lost its matching top/bottom bars
for सुविचार and हवामान in the same pass.

### The rule is the BLOCK's edge, and the type sets inside it

The pass above left one ring per card and put it in the wrong place, which is
the desk's next four reports at once — *"many words touching the border in
share market"*, *"in rashi bhavishya images/logos touching border"*,
*"panchang did not have … outer border for block, same for havaman"*, and
*"prakatpatra and advertise block's having two borders and right and bottom
borders are overlapping"*.

**One rectangle cannot be both the edge of the card and the edge of its type.**
`cardArtworkFor()` subtracted the clearance from the CONTENT box and the ring
was then drawn round that same rectangle, so the clearance moved the *ink*
inward and bought the words nothing. Measured on the page in print view:

| | ring at | first thing inside it |
|---|---|---|
| market | 2,2 301×394 | every band at `l2 t2 r2` — flush against it |
| sudoku | 2,2 301×298 | grid `b1`, heading `t2` |
| राशिभविष्य | 4,4 297×374 (2.8 px band) | sign artwork at x=7 — 0.2 px off the inner hairline |
| पंचांग | 4,60 140×142 | a rule round the TABLE, and the block itself unruled |

The ring takes the frame now (`borderBox` is `0,0,width,height` for every ruled
card) and `pad = max(frame.padding, clearance)` stands the type clear of it —
`ink + CARD_RULE_AIR_PX`, so a heavier rule or the almanac's double band buys
its own room. Measured after: every card 2.3–4.8 px inside its own rule, and
पंचांग's double band now rings the block, which is the "inner border for box
**and** outer border for block" that was asked for.

**And the ring is drawn from the one catalogue.** `styles.css` carried a
hand-kept mirror of `CARD_BORDERS` — its own comment said so — and the mirror
had already drifted: `.smart-card-tender` and `.smart-card-advert` each
declared a `border` of their own *as well*, so both drew two rules 2 px apart,
coinciding on the right and the bottom where the card clips. `cardRuleFor()` is
the lookup; `smartCardMarkup()` writes one `.smart-card-rule` inline and
`smart-card-lines.js` lays the same ink down for the plate. `weightPx` lives
there too — a display advert and a प्रकटपत्र are ruled a shade heavier, in
black, because an advertisement is not the paper speaking; it is still one rule,
the same on all four sides.

### सुविचार is one line, and the mark travels with it

Three faults, all of them visible in one photograph of a 618×70 strip: the mark
at `x=0` hard against the rule with the first word 77 px away, the row centred
in what was *left* rather than in the strip, and 70 px of block holding a
23.8 px line.

- **The block is one line tall and the width of the page** — `620×32`, the line
  plus the rule and a hair of air. It asked for a 307 px leg 72 px deep.
- **`stripRowWidthPx`** is the row's own drawn width, so `layoutSmartCard()`
  sets mark, gap and row down as ONE centred group. The content box is then cut
  to that row, and the line inside it is `flex: 0 0 auto; white-space: nowrap` —
  a resolved line never re-wraps, and `flex-shrink: 1` had let the browser break
  it into two lines of type in a box with room for one (measured: quote-text 8 px
  above the card and 10 px below).
- **The side inset was being spent twice** — the solver took it off the measure
  and the renderer wrote it again as the blockquote's own padding, inside a box
  already cut to the row. A wrapped pull quote still insets; a strip does not
  need to, because the centring IS its air.
- **A lead-in mark's footprint is not known until the line is**, so there is one
  bounded correction pass: solve, take the mark's real box from the resolved
  line, solve again against the measure that actually leaves. Where the two do
  not land on the same size in one pass **the mark yields, never the words** —
  without that clamp the row was cut to the room left over and its nowrap line
  ran 7 px past a card that clips.

### One rule per card, and a HEAD RULE where a nameplate stands

पंचांग and राशिभविष्य carried a double band — heavy outside, hairline inside —
on the argument that it is what tells an almanac from an ordinary ruled box.
Beside seven single-ruled cards on a made-up page it reads as a mistake rather
than as a style, and the desk said so plainly. `double` is **gone** from
`CARD_BORDERS` and from both renderers; `weightPx` is the only thing that
varies, and a commercial block's heavier black rule is still one rule on four
equal sides.

What marks a standing box instead is what a printed almanac actually does:
**`layout.headRule` — the hairline that closes a nameplate or a subtitle off
from the box under it.** It is stated by the solver in the card's own
coordinates, so `smartCardMarkup()` and `smart-card-lines.js` draw it in the
same place, and it costs nothing: a `top` nameplate already leaves `gap` under
itself and `solveSubtitle()` already reserves `GAP_PX`, so the rule goes in room
the card has. पंचांग and दिनविशेष get it under the mark, हवामान under
`सातारा · हवामान अंदाज`.

**राशिभविष्य's band is ruled on BOTH sides.** Every sign draws its own *bottom*
rule, so the row above the band closed with one and the row below it opened with
nothing. `.is-after-band` is the matching top rule, and the export walk — which
drew neither that nor the column's opening rule — now emits both.

### A drawn mark is aligned by its SHIROREKHA, not by its box

Setting the सुविचार mark to the line box put equal boxes on one line and the
**words on two**: the wordmark is a drawn, ornamented thing with a lotus above
the letters and a flourish below, so its word rides low inside its own
rectangle. The desk's report was exactly that — *"suvichar word/image is in
style so it is still not align with next words"*.

An alpha scan of the file finds the head stroke as the densest band of ink —
rows 272–314 of 664, **1208 px across at its peak against ~500 for the
letters** — so its top edge is at **0.4096** of the image's height, and that is
`headStrokeAt` in the artwork catalogue. The mark is then laid on the *type's*
own head stroke: `lineTop + baseline − fontPx × SHIROREKHA_EM`, with the
baseline where the browser puts it inside the line box
(`(L − F(A+D))/2 + F·A`). Those three numbers are **imported from
`compose.js`**, never restated — it is the rule `composeBlock()` already sets a
drop cap by, and the drop cap's comment says so in the same words.

The strip's block grew 32 → **36** for it: aligned by the head stroke rather
than centred, the mark's flourish hangs below the line, and at 32 its box began
on the card's own rule.

### A centred entry's lines still need the space between them

`.smart-card-list.is-centred .smart-card-line` is `display: inline` so a
दिनविशेष entry sets as a centred paragraph. Each solved line is its own span,
and laid inline they abut with **no whitespace at all** — so a two-line entry
printed `…कंपनीला राजाज्ञामिळाली`, two words welded into one, on the page and
on the plate alike. Photographed on a 268 px card.

### सुविचार's mark is the WORD, and it opens the line at the left

Two more findings on the same strip, and both were about the artwork rather
than the type.

**The file was three-quarters ornament.** `SuvicharwithoutBG.png` carried a
lotus above the letters on the left and a rising sun above them on the right,
with the word beneath both — so a mark drawn at the line's own height spent
most of that height on decoration and set the WORD at a fraction of the type
beside it. Both are **separate blobs of ink**, so this is not a crop but a
component split: the word's own connected mass (194 743 px of the file's ink)
is kept and everything not touching it dropped. `suvichar-word.png` is
1239×504 where the ornamented original was 1300×664, so at one drawn height
the letters are a quarter larger, and `headStrokeAt` moved 0.4096 → **0.2599**.

**A lead-in mark opens the line, so it stands at the LEFT.** Centred with the
row it drifted right as the block widened — the desk's *"suvichar word should
be always closer to left side/starting"*, and the gap they read as growing is
the white the centring opened before it. `left = artwork.x`, and
`.smart-card-quote.is-strip` is `justify-content: flex-start`.

### An advertisement has SHAPES, and they are one solver

`src/features/advert.js` structured an advertiser's copy and this product could
set it exactly one way. A district daily prints several: the trader's panel
with a photograph, the शुभेच्छा greeting inside a decorated चौकट, the strip
across the foot of a page, the poster where a supplied photograph IS the
advert, and the small all-type classified.

**`public/editor/smart-cards/advert-styles.js` is a catalogue, not five
layouts.** `layoutAdvert()` solves ONE set of type bands — the advertiser's
name, the line that shouts, the standfirst, the detail, the offer, the contact
— and reads five parameters to place them:

| | |
|---|---|
| `art` | `band` / `medallion` / `full` / `side` / `none` |
| `align` | `left` for a trader's panel and a strip, `centre` for the rest |
| `frame` | `none`, `double` (the चौकट, one rule inside the card's ring), `rule` (a classified's two) |
| `offer` | `reverse` out of the accent, between `rule`s, or `plain` |
| `reversed` | white type out of a poster's solid panel |

Each row also names **the block that shape asks for**, and
`smartCardBlockSize('advert', data)` returns it — a strip is 620×176 and a
classified 148×176, and giving both the trader panel's 268×300 would make the
desk resize every advert by hand.

- **A poster is a picture with words on it, not words with a picture behind.**
  Given the whole box the type filled it and the reversed panel covered all but
  a strip of the photograph — the one thing a desk chooses that shape for.
  `ADVERT_POSTER_TYPE_SHARE` (0.52) is the words' half.
- **The picker shows the thing, not its name.** Each tile is a real
  composition of one demo advert at the block that shape asks for, drawn by the
  same renderer the page uses and scaled down — so a style added to the
  catalogue appears in the picker with no second piece of work, and a demo
  cannot show a shape the page would not print. One advertiser's copy across
  all five, because the point is to compare shapes.
- **The style is validated at the builder, never trusted from the browser.**
  It reaches the card's stored data and from there the renderer's own class
  names. `resolveStyle()` reaches the shared catalogue by dynamic import, the
  way this project already reaches the character grid and the ink palette from
  Node.
- **`.smart-card-advert` named two elements** — the card's own wrapper
  (`smart-card-${key}`) and the renderer's root div — so every selector matched
  both. That is the `.smart-card-artwork` collision that moved every nameplate
  on every card, caught this time by a net that counted what it had drawn. The
  root is `.smart-card-advert-body`.
- **And the press walk was drawing a second panel rule.** The advert branch
  laid a 1.2 px box down inside the card's own ring and the notice branch a
  0.8 px one, so both printed the double border the canvas had already lost.
  `tests/advertStyles.test.js` holds it as the general rule: no two hairlines
  within 2 px of each other.

**The canvas-against-export sweep had been vacuous.** It filtered the export
walk's items on `kind === 'text'` — and a text item in that list carries **no
`kind` at all** — so "0 texts missing" was counting nothing against nothing.
Filtered properly (`!item.kind && item.text`), and collecting the canvas's real
text nodes rather than its childless elements, all nine cards and all five
advert shapes do agree; but the earlier runs proved nothing.

### A lead-in mark is set to the LINE it opens

`cardArtworkFor()` reserves a mark's box before the card is solved, so it can
only work from shares of the frame. सुविचार's strip knows better once its line
height is resolved: `markHeightPx` hands back the resolved line box, the mark
is scaled to it and centred **in the content box** — the same box the quote is
centred in — so the two tops land on one line. That is the format the desk
asked for: mark, thought, credit, one rule of type.

Centring it in the *frame* instead was measured wrong by 8 px, which is how the
class collision above was finally cornered.

### A band's two ends are LEFT and RIGHT

`.smart-card-tender-band span:first-child` had no explicit alignment and
inherited a centre from the notice, so a wrapped email address sat adrift under
its own `Email ID :` label. And the band was split down the middle when the two
ends do not want equal room: a Latin email address is **one unbreakable run**
and a पत्ता wraps happily, so the email now keeps what it needs up to
`EMAIL_MAX_SHARE` of the band and the address takes the rest over two lines.

### दिनविशेष's entries are centred, not stretched

Opening the row gap to fill the box put the first entry hard against the top
rule and the last against the bottom. The gap opens a little
(`MAX_ENTRY_ROW_GAP_RATIO`, 0.6 of a line) and what is left **centres the
stack** — `align-content: center` on the canvas, `geometry.topOffset` in the
export walk, so the two cannot centre differently.

### A Smart Card brings its own block

`layout.js`'s **`SMART_CARD_BLOCK_SIZE`** states the frame a printed paper gives
each card, in block pixels: पंचांग and बाजार a tall single column, सुविचार a
shallow strip, सुडोकू **square** because the puzzle is, निविदा a whole leg of a
page. Generating a card creates that block and writes the card straight into
it, so a desk never has to find, size and empty a frame before they can see
what the card looks like. "The block that is open" remains available — replacing
a card already on the page is an ordinary thing to do.

The page's own grid still has the last word: a new block snaps to the column
grid and is clamped to the room actually left on the page. What the catalogue
guarantees is that the card **sets** in what it gets — a 148×300 request that
lands as 151×264 still composes `FITS`, and `tests/smartCardBlocks.test.js`
holds that for every card in the catalogue.

### A display advertisement is the advertiser's words, set by the newspaper

`src/features/advert.js` takes the copy an advert desk actually receives — an
email, a WhatsApp paragraph, a line scribbled by the advertiser — and structures
it into the parts a display advert has. It **never writes a claim the
advertiser did not make**: no invented price, discount, date, guarantee,
address or telephone number. An advertisement is a statement by the advertiser
printed over this paper's masthead, and a made-up figure in one is not a typo.

The artwork is a separate decision and optional. A supplied picture always
beats a generated one — a desk holding the advertiser's own artwork is not
asking a model to imagine it. A generated illustration goes through the one
image service this project has (`newsImage.service.js`) with an **advert**
brief rather than a news-photograph one, sized to the block's own aspect so it
fits the hole rather than being cropped into it, and it forbids text in the
image: generated Devanagari is unreadable and the advertiser's words are the
compositor's to set. It is marked **AI** on the card itself, because a reader
cannot tell and the desk must never lose track of which pictures this paper
made. A refused illustration leaves an ordinary text advert and says so.

### `tests/browser/smart-cards.browser.js`

`npm test` can ask `layoutSmartCard()` whether a card fits, and it does. What it
cannot see is the browser drawing something wider or taller than the answer it
was given — which is what every fault above had in common. This net draws each
card at the block it asks for and measures the DOM: it must fit, and nothing
inside it may cross its own edges (one pixel of tolerance for border rounding,
not more). Then it drives the half a desk presses — generate, accept, and the
card arrives as a new block with its data already in it.

```bash
node tests/browser/smart-cards.browser.js            # defaults to 49291
```

### What a Smart Card entry carries

`smartCardLines()` gave every entry the card's own body line height, which was
invisible while every card set all its entries at one size. A stat row does not
— its figures are 2.2× its captions — so a 26.4 px numeral in an 18.8 px box
printed through the row below. The box is the entry's own size × the card's
leading ratio, so an entry at the card's body size is unchanged.

Entries carry **`ink` and `bold`** too. Without them a chart printed in a
different ink from the one on screen: accent-red figures came out black.

**A subtitle may not outrank the card it labels** (`MAX_SUBTITLE_OF_BODY`,
1.5). The height share alone does not settle it — a one-line subtitle at 28 px
is well inside 28% of a 275 px card whose figures resolved to 26.4 px. The
card's own size is not known until its body is solved, so it is one bounded
second pass.

### An inset panel is a printed चौकट

It carries a **tint** (the palette's, checked at the service because the module
is a plain script in the browser and cannot import the ESM ink catalogue) and a
**marker** — plain, bulleted or numbered in Devanagari numerals. Both are
devices the Lokmat reference block uses.

**Inside a panel the marker is set INTO the line**, because a panel has no
second measure to break against. In RUNNING COPY it hangs - see "A list in
running copy" below. Both read one vocabulary (`markerText()` in
`inset-panels.js`): `page_sections.list_style` and a panel's `marker` are the
same three choices and must not drift into two catalogues.

**The panel has a third kind: `crosshead`** - the ruled sub-head between two
parts of a long story, and the one device the Lokmat reference block had that
this product could not make. It is a panel and NOT a second kind of paragraph
on purpose: a real mid-flow cross-head means `pourBody()` carrying a paragraph
set in a different face at a different size, which reaches `fillRow()`,
`maxSizeIn()`, `rowHeightFor()`, the balancer and `justifyLine()` - the
composition-engine redesign this project's own rule says to stop before. A
full-measure panel a whole number of bands deep already closes the copy above
it and resumes it on the grid below, which is what a cross-head IS. It carries
one rule, above, and **no ground**: a white rectangle behind it would punch a
hole in any page overlay it sat over. `INSET_PANEL_STYLES` is the one table of
edges/face/ground, and the `.section-inset-*` rules in `styles.css` are the
browser's half of it.

**An ornament is its own rules, so it is never EMPTY.** `panelOf()` refuses a
panel carrying neither a title nor a line — right for a fact box, and it threw
away every **plain** separator, which is the vocabulary's first entry and the
one a printed paper sets most often: two rules and nothing between them. The
draft stored it, the menu lit its own "Remove the separator", and the page, the
Block Editor, the compositor's obstacle set and all four exports drew nothing.
The panel that adds one had tried to dodge this by standing a single space in
for the missing mark, and `clean()` trims, so the space died on the way in. The
**kind** decides, exactly as it already did for a chart two lines above. Found
by pressing the button and looking: `orn:plain` drew 0, `orn:diamond` drew 1.

### A list in running copy

`page_sections.list_style` had been a column since the schema was written, the
Typography control had always set it, and **no renderer read it once** - a
sub-editor could choose Numbering, watch it persist, reload the edition and
find plain prose. The only thing it reached was a CSS class on that panel's own
*preview* paragraph. It is the fault `drop_cap` BOOLEAN had before it became
`drop_cap_lines`, and it was found the same way: by grepping for the column and
seeing nothing read it. **`list_style` was the only such column left** - the
whole of `page_sections` was swept afterwards.

An item is one authored **paragraph**, and it **HANGS**: the marker stands in
its own column and EVERY line of the item is set past it, which is what makes
the markers line up down the page and the copy line up with them.

The engine learns nothing new. The hanging indent is the first-line indent the
pour has always applied, asked for on every row instead of one (`fillRow`'s
`leadPx`), and the marker is drawn beside the copy exactly as the drop cap is -
its own box, its own baseline, **no place in `lines`**, and therefore no effect
on `line.at`, on a sub-editor's marks, or on the caret that reads them. Not one
character of the stored copy is touched.

Three things measurement caught that reading would not have:

- **The markers did not move when the leading was opened.** Vertical
  justification shifts every line down by a growing amount and a marker is not
  in `bodyLines`, so item two's number stood 2.4 px above its own first line
  and item three's 4.8 px above. Anything hung beside a line must be in that
  pass.
- **The paragraph policy had to stand down** (`setsList`). Three short items in
  an 11 em column is exactly the shape it merges as prose, and it is right to
  for prose - but merging two ITEMS prints three undertakings as two, which
  changes what the paper says.
- **The bullet is U+25AA, never U+2022.** Measured: `serif/400` and `sans/700`
  both lack a real bullet, so it reaches the press file as a `.notdef` box. And
  the press writer's filled-square rule was hard-coded to U+25A0 (the
  dateline's), so U+25AA came out as `?` - photographed in a rendered press
  PDF, with the numbered list beside it setting its numerals perfectly.
  `FILLED_SQUARES` in `pdf.writer.js` draws both, each at its own share of the
  type.

`LIST_MAX_HANG_EM` (3) bounds the marker column in ems for the reason
`MIN_COLUMN_EM` is: "१००." hung on a narrow column would take a fifth of it
away from the words. `tests/runningList.test.js` holds all of it.

### Schema changes that need applying

`schema.sql` is not run at boot. These were applied to the dev database by hand
and any other environment needs them:

```sql
ALTER TABLE page_sections ALTER COLUMN text_align       TYPE VARCHAR(16);
ALTER TABLE page_sections ALTER COLUMN headline_align   TYPE VARCHAR(16);
ALTER TABLE page_sections ALTER COLUMN subheading_align TYPE VARCHAR(16);
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS inset_panels JSONB;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS overlay_images JSONB;
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS display_family VARCHAR(40);
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS show_dateline BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE newspapers    ADD COLUMN IF NOT EXISTS body_family VARCHAR(40);
ALTER TABLE newspapers    ADD COLUMN IF NOT EXISTS display_family VARCHAR(40);
ALTER TABLE newspapers    ADD COLUMN IF NOT EXISTS column_rules BOOLEAN NOT NULL DEFAULT FALSE;
```

### A device must be removable, and the way out lives beside the way in

Every device on the bar can be taken off, and its removal is in its own menu.
Border/Tint/Columns/Drop cap always could — their "off" is a value in their own
list (None, White, Auto, None). Four could not: a panel, a separator and a chart
are things that exist or do not, so each menu carries an explicit **Remove**,
and it is *disabled rather than hidden* when there is nothing to remove — so a
desk can see the way out before needing it.

This is worth stating as a rule because the failure is silent: a control that
only ever adds looks like it works.

### A chart asks three questions before it draws

Pressing a chart type used to write a seed card — the same four districts, the
whole block, always red. `chart-dialog.js` is the fix and the order is the one a
desk works in:

1. **which chart** — bars, pie, line, dots, figures
2. **how much room** — the whole block, or a panel of a chosen share inside it
3. **what is in it** — readings typed or pasted, plus the ink

Step 2 is what did not exist: a Smart Card takes the *whole* of a block's body,
so a chart beside copy was impossible. A chart panel (`inset_panels` with
`kind: 'chart'` and a `card` payload) is the same card solved against a smaller
rectangle, and it costs the compositor exactly one more obstacle — the argument
the fact box, the pull quote and the cross-head already rest on.

**A chart's ink is one of the paper's four**, resolved once by `chartInk()` and
carried out in the solved geometry (`geometry.ink`, and `item.ink` per pie
slice). Every renderer reads it from there rather than importing the constant —
`smart-card-lines.js` had `ACCENT` hard-coded at four sites, which would have
printed a blue chart red the moment the ink became a choice. Slices are tints of
that one ink, never a rainbow: a press has four plates.

### `panelsFromDom()` must carry what is not on the form

Properties rebuilds every panel from its inputs and sends the whole list. A
chart panel has no title and no lines to rebuild from, so without an explicit
`card: was?.card` the chart is dropped and `panelOf()` then rejects the panel as
empty — the chart vanishes when a desk edits a *different* panel on the block.

### A drop cap works on a block that has a dateline

It used to refuse: the dateline is prepended to the copy, so `dropCapOf()` took
its U+25A0 and drew a solid black square three lines deep. Refusing was honest
but meant the control did nothing on every block where a desk had filled in the
story's place — which is most of them.

A printed Marathi paper does not choose between the two. It sets the dateline on
its own line and opens the story under it with the initial letter, and that is
what `pourBody()` does now: one extra paragraph start at `datelineLength`, and
the cap is taken from — and set under — the story that follows.

**Vowel signs change the size of the cap, and this was measured.** A sign above
the head stroke (ी, े, ौ, ं) rises above where the cap was placed and lands
outside the copy area; a sign below the baseline (ु, ू, ृ, ्) hangs into the line
under the cap. So an above-sign shrinks the cap (its baseline may not move — it
is the baseline of the last line it spans), and a below-sign extends the
obstacle, rounded up to a whole band so the copy stays on the grid. An ordinary
consonant reserves exactly what it always did, so no stored block recomposes.

### Ruling a block may not re-set its copy

`BOX_INSET_PX` is a **floor**, not an addition. Added to the block's own margin —
which is what it did — ruling a block narrowed the measure by 11 px, rebroke
every line, and could push a fitting block into overset for no typographic
reason. The default margin is 12 px (6 mm) and a box wants its type about 3 mm
inside the rule, so the room was already there twice over. A block set tight
(margin 1–2) still gets pushed clear, because there the box's need really is the
larger number.

### A toolbar row costs the page 34 px, and the page has none to give

The paper's faces and the column-rules switch were put on a **third**
`.canvas-toolbar-row`. That pushed the writing surface below the fold at a
1512x950 window — the workspace net measured a picture handle at y=1015, past
the viewport, where `elementFromPoint` returns null and the handle simply
stopped being clickable. Undo then had nothing to undo, which is how the fault
presented: as a broken history stack, three layers away from its cause.

CLAUDE.md already stated the rule ("Nothing may push the writing surface below
the fold") and this broke it anyway, because a toolbar row does not *look* like
it is taking anything. **New edition-level controls go on an existing row.**

**And the device bar scrolls, it does not wrap.** Wrapping made its height a
function of its own contents, and its contents change while a desk works — the
two face buttons say which face is in force, so "Serif" becoming "Mukta" can
push a group onto a second row and move the whole editor under the cursor.
`showMenu()` was already subtracting `bar.scrollLeft`, which only means
anything on a bar that scrolls; it had simply never had enough buttons to
reach the edge.

### Justification is TWO NUMBERS ON THE LINE, and every writer must read them

`compose.js` justifies with two levers (`justifyLine`): extra space at each
word gap, and up to 3% of horizontal glyph stretch for the remainder. They come
out on the composed line as `wordSpacingPx` and `glyphScaleX`.

**`render.js` applied both and nothing else did.** So the canvas was justified
and the press PDF, the IDML and Scribus all set the same copy flush left.
Measured on one real block: 4 px of variation in the right edge on screen,
**111 px** on the plate. That is the two-surface fault this codebase guards
hardest against, sitting on the single most visible property of newspaper body
copy, and it survived a `46/46` browser net because the net never rendered a
plate.

- **In the PDF the word space is a POSITION, not `Tw`.** PDF's word-spacing
  operator applies only to single-byte code 32, and these fonts are CID-keyed
  `/Identity-H`, where it does nothing at all. `drawRun()` already places every
  glyph at its own x, so the space is folded into that x.
- **The stretch is `Tz`**, which scales the glyph's outline as well as its
  advance — the right lever for Devanagari, where the shirorekha must stretch
  *with* the letter. A `TJ` displacement is itself scaled by `Tz`, so the number
  written has to be divided by it, and `Tz` must be set back to 100 at the end
  of the block because the text state survives `ET`.
- **Negative is legal.** A line the breaker set TIGHT carries a negative word
  space and a scale below 1. A writer that handles only the expanding case
  draws those lines overhanging their column.
- **In IDML it is `Justification="FullyJustified"`**, not our numbers: one
  composed line is one story in one frame whose width *is* the measure, so
  InDesign reaches the same result with rules a designer can still adjust.
  `FullyJustified` and not `LeftJustified` because every line here is the last
  line of its own one-line paragraph.

### A line's badness includes how hard it has to be stretched

`slackCost()` charged for slack against the *measure*, which says how much
space there is to absorb and nothing about whether absorbing it will look like
anything. 17 px across eight word gaps is invisible; the same 17 px across two
opens both gaps to three times a normal word space.

Measured across 1751 justified lines of two real editions: **28.2% were at the
0.55 em word-space cap while 18.2% needed no extra space at all.** The solver
had no reason to even that out — both are closable, and `(slack/measure)^3` for
a closable line is on the order of 0.002.

`STRAIN_WEIGHT` (0.12) charges cubed for the fraction of a line's own closing
budget it spends. The sweep is in the code beside the constant; 0.12 is the
knee, and the count of *visibly* short lines (more than 4% short) is 130 at
every weight tried, so it costs a reader nothing.

### A display size is a REQUEST until the desk locks it

`fitDisplayFlow()` shrinks a headline that will not set in its band and grows
one that leaves its measure short. So `headline_font_px` is what was asked for,
not what prints — and a desk that typed 34 and saw 27 had a control that
appeared to do nothing.

`headline_locked` / `subheading_locked` make the desk's number win.
`section-adapter.js` had always read those two columns and `fitDisplayFlow()`
had always had the `locked` branch; **the columns did not exist**, so the
branch was unreachable and the lock was a mechanism nobody could switch on.

The bar's read-out shows the size the page is **set in** — light and italic
when the compositor is fitting, bold when the desk's number is held — and
stepping locks, because a desk reaching for the size is asking for that size.

### Justify, and JUSTIFY ALL LINES

`justify` closes a line with two bounded levers — word spaces to
`MAX_EXTRA_WORD_SPACE_EM` (0.55), then glyph scaling to `MAX_GLYPH_STRETCH`
(1.03) — and accepts whatever slack is left rather than opening a river. It
also stands down entirely below `JUSTIFY_MIN_EM` (13 em). That is the right
default, and on **55% of this paper's blocks it is indistinguishable from flush
left**, because that is where the column measures cluster. Measured on an 80 px
column: `justify` leaves **11 of 11** interior lines ragged, worst 71.2% — the
same numbers as `left`, to the pixel. That is the desk's "justify still not
working".

`justify-all` is the fourth alignment and does what a printed Marathi daily
does: **every line but a paragraph's last reaches both edges**, and the word
gaps differ visibly from line to line to make it so. Same column: **0 of 11**
short, spaces 0.21–1.34 em.

- **`FORCE_MAX_EXTRA_WORD_SPACE_EM` is 3 em, and it is a real ceiling.** Wider
  than three aksharas a gap stops reading as a word space and starts reading as
  a column break. Across 1751 justified lines of two real editions the widest
  slack any line had to close was 2.1 em per space.
- **Glyph scaling is NOT raised.** Word spaces are invisible until they are very
  wide; condensed or expanded Devanagari is visible immediately, and 1.03 is
  already InDesign's newspaper range. The reference block's lines vary in their
  spaces, not in their letterforms.
- **`JUSTIFY_MIN_EM` is `justify`'s rule and deliberately not this one's.** A
  desk asking for every line to reach both edges has already made the trade
  that rule exists to refuse.
- **Two exceptions, both physical.** A paragraph's last line is never
  stretched. And a line with no word space in it — a one-word corridor beside a
  picture — cannot be justified by anybody: there is nothing to distribute, and
  stretching one word to the measure is distortion, not justification.

`text_align`, `headline_align` and `subheading_align` were `VARCHAR(10)`;
`justify-all` is eleven characters, so the migration widening them to
`VARCHAR(16)` is in `schema.sql` and must be run. Alignment is now checked
against a closed set at the service, for the reason the palette is: it is
interpolated into a style attribute by the Typography panel's preview.

**`ALIGN_BARS` in `story-editor.js` must carry every value `ALIGNMENTS` does.**
It is a second list of the same keys, and adding the fourth value made it
return `undefined` and throw — taking out the whole writing toolbar, not one
icon. It falls back to left now. The two justification icons differ where the
settings differ: `justify` shows a short last bar, `justify-all` a square one.

### The paper's own face is written down, and it changes MORE THAN ONCE

`setHouseStyle()` wrote the new face `WHERE font_family IS NULL`. That restyles
every block the first time and **nothing ever after**, because that same write
leaves no row NULL — so the paper's own column said one face while every block
was still set in the previous one. Measured on edition 40294: **45 blocks, then
0**. That is "changing the whole paper's font family works sometime, sometime
not": it works exactly once per edition.

A block still carrying the paper's **previous** house face never chose it —
this function put it there — so it moves with the paper. A block a sub-editor
deliberately set to something else carries neither NULL nor the old house face
and is left alone. That is the guarded backfill `schema.sql` already uses for a
changed column default: move only the rows still carrying the exact old value.
Verified: 45 → 44 (one block set by hand keeps its face) → 44, and choosing the
face already in force is a no-op rather than a rewrite of every row.

### Column rules are asked for, not assumed

`columnRulesFor()` draws nothing unless `newspapers.column_rules` is on, and it
is off for every existing edition. The gate is inside that one function so the
canvas and the press model cannot disagree about whether a page is ruled.

A column rule *is* what a printed paper does — but "what most papers do" is a
default a **desk** chooses, and furniture a desk cannot remove is furniture the
desk is fighting.

### The paper's own type is written down, not cascaded

`PATCH /api/newspapers/:id/house-style` sets `body_family`/`display_family` and
writes them onto the edition's blocks — **only** where the block has not chosen a
face itself (`font_family IS NULL`), so a deliberate per-block choice survives.

Written down rather than resolved at read time because a fallback would have to
be threaded through the thirty-odd services that compose a stored row, and any
one that forgot would measure a block in one face and print it in another.

### What the software says, a desk can read

`showNotice()` wrote into `#edNotice` and nothing else. That strip is the last
child of the Block Editor header's flex row — after the kind chip, the block
size and the status badge — carrying `margin-left: auto`, `white-space: nowrap`
and `overflow: hidden`. Measured in the running app at 1512×950: **width 0**.
And it sits ~600 px below the toolbar whose buttons produce most of these
messages.

So every answer this product gives was said into nothing:

| pressed | said | seen |
|---|---|---|
| Make it fit | "Set tighter — body 6.4px to 5.9px — and it fits." | — |
| Carry over | "There is no empty block on a later page to carry this into." | — |
| + Block | "Block added, but this page has no free space…" | — |
| − Block | "Deleted block-2." | — |

That is the whole of the desk's report that the toolbar buttons "are not
working good": **they worked, and the software's answer was invisible.** Not one
of those four is a failure; three are the software refusing or qualifying for a
good reason, which is exactly the class of message that must be read.

`#deskNotice` is a viewport-anchored box created on demand by `showNotice()`.
The Block Editor's own strip is still written — it is that header's status line
— but nothing depends on it being legible any more. The dwell is proportional
to the sentence (`3500 + 45 ms per character`, capped at 12 s): four seconds is
fine for "Saved" and is not long enough to read a refusal.

### The block names itself once it carries copy

`.section-chrome` is the block's kind icon, its key (`LEAD`, `MASTHEAD-ADVERT`)
and its status pill. On an **empty** block that is the only thing saying what
the frame is waiting for and it has to be there. On a **written** block it is a
second title laid over the real one — the composed layer is absolutely
positioned, so the chrome sits on top of the headline the desk just set.

`.filled` (section-thumb.js) is the block's own answer to "is there anything in
this" — headline, body, an image url or a placed picture — so this needs no
second definition of the same question. The label, the kind icon and the status
pill fade on a filled block and return on hover or while it is selected.

**`.section-flags` is deliberately not in that list.** The reporter, AI,
overflow and unsaved marks are not a label — they are the block saying that
something is wrong with it or that it is not what it looks like, and a warning
that hides itself once there is copy to warn about is no warning.

### Three controls may not appear under the pointer

`.section-hover-toolbar` — Story, Image, Clear — is absolutely positioned at a
block's bottom-right and appeared on plain `:hover`. So three controls
materialised **under the pointer of a desk moving it onto a block to select
it.** Measured in the running app: pressing Image scrolled the window 1014 px
to the picture panel; Clear wiped the block's headline, deck, story and picture
with no question asked.

That is the report *"some time clicking on editor redirecting to other places in
webpage … it ruin the user exprience"*, and it is not a scroll bug — it is a
button nobody meant to press.

- **Selection is the gate.** The toolbar draws on `.newspaper-section.active`
  only. The buttons are in exactly the same place, one click later, and cannot
  be hit by accident. (The class is `active`, not `selected` —
  `sectionClassName()` in `section-thumb.js`.)
- **`focusGroup()` scrolls `block: "nearest"`, not `"center"`.** Centre moves
  the viewport even when the target is already on screen.
- **Image says where it is taking them.** It is the one control on the canvas
  whose whole effect is to move the desk somewhere else; unexplained, that reads
  as the software losing their place.
- **Clear asks, and then says so.** `deleteBlock` has asked the same question
  about the same content since it was written; there was no reason for the two
  to differ except that nobody had pressed this one by accident yet. Undo still
  has it either way — this is about the desk knowing it happened, which is the
  half undo cannot supply.

### A new block is set in the paper's own faces

`setHouseStyle()` writes `body_family`/`display_family` **onto the blocks**, and
the file records why: resolving a fallback at read time would have to be
threaded through the thirty-odd services that compose a stored row, and any one
that forgot would measure a block in one face and print it in another. That
write can only reach the blocks that **exist when it runs** — so every block
added afterwards was born carrying NULL, which the compositor answers with its
own serif/sans default.

Measured on a real edition set in Mukta/Khand: press **+ Block** and the new
block sets its story in Sahas Serif and its headline in the sans, on a page
where nothing else does. This is the other half of *"changing whole paper font
family works sometime, sometime not"* — the first half was the once-per-edition
`WHERE font_family IS NULL`, fixed earlier; this is the same fault arriving from
the other direction.

`HOUSE_FACE_SQL` reads it as a sub-select on the page inside the INSERT, so all
four creation paths — a new page, a layout change, a template repair and a
hand-drawn block — get it with no extra round trip and none of them able to
forget. NULL stays NULL when the paper has chosen nothing, so no existing row
changes.

**The house faces reach every surface.** Verified rather than assumed: 40
written blocks composed and matched against `print-model.js`'s own walk —
**0 headline mismatches**, 3 body mismatches and all three are Smart Cards
(rashi, panchang, suvichar), which are drawn as cards rather than prose and are
meant to be. Export run families on that edition: serif 981 (body), khand 62
(display), sans 39 (furniture). The e-paper's 36 hotspots match `page_sections`
geometry to **0 off by more than 0.05%** of the page.

### Insert leaves the desk able to write in what it added

Insert put a fact box on the page reading `इथे मजकूर लिहा` and stopped. The
panel's own fields have always existed — Properties lists every panel on the
block with a heading, its lines, its marker, its ground and its rectangle — but
`bodyMarkupFor()` only draws them while the **whole block** is the selected
object, and Insert is pressed with the story or the headline selected. So the
desk got a panel they could see and could not reach: *"Insert button in ediotor
is use less as it add a block which we cannot edit"*.

`focusAddedPanel()` selects the block (which is what makes the fields exist at
all) and puts the caret in the new panel's Heading. **It scrolls the RAIL, never
the window** — the settings rail is capped to the page's height and scrolls
inside itself, so `block: "nearest"` there moves that column and nothing else,
which matters given that a control throwing the viewport around is the fault
next door.

### The sold corner of page one had a server and no door

`masthead-advert` is the advert ear beside the nameplate, and the paper's own
title is set for **both** answers: while the ear frame is on the page the
nameplate leaves room for it, and with no frame it takes the whole measure —
247×46 px to 426×80 px, measured on a real front page.

Deleting the frame has been allowed since the `STRUCTURAL_FRAME_PROTECTED` 409
was retired, and `POST /api/pages/:id/repair-structural-frames` has existed to
put it back ever since — **reachable from nothing.** So a desk who did not sell
the corner one day could never have it again.

`#mastheadEarBtn` is that door. It shows on page one only, reads *Ad ear* /
*No ad ear* for the state it is in, and takes the ear off through `deleteBlock`
so a corner carrying artwork still asks before it goes. An action with a server
and no door is the same fault as a control that cannot act, one step further
along.

### A failure is recorded, and only the caller's failures are blamed on them

`server.js`'s catch-all answered **every** error with `400 Bad Request` and the
error's own `message`, and logged nothing at all. Three things wrong, all of
which cost a newsroom time on the one day it matters:

- a bug here, a dropped database connection or a missing font file was reported
  to the desk as *"you sent something wrong"*. A desk told that retypes the
  request, which cannot help.
- the raw internal message went to the browser. `relation "page_sections" does
  not exist` is not a sentence for a sub-editor and is not one for the public.
- **nothing was logged.** A failure left no trace anywhere.

Multer's errors are genuinely the caller's and keep their message and their
400. An error a service raises deliberately can say so with `status`. Everything
else is 500, a sentence a person can act on, and the real one in the log — one
line per failure including the 400s, so a run of malformed requests is visible
too.

**And the five unchecked page re-reads.** Make it fit, Carry over, Continue
into, Fill features and the composition apply all ended with
`fetch(...).then((r) => r.json())` followed by `pages.forEach`, and none looked
at the response. A 500 or a dropped session resolved to `{ error: "..." }` and
`.forEach` threw a TypeError inside an async click handler: nothing on screen,
nothing said, and the canvas left showing state that no longer matched the
database. The action had usually **succeeded** — only the re-read failed —
which is the worst version. `reloadPages()` is the one checked re-read and says
so when it cannot.

### `tests/browser/visual-pass.browser.js`

The net for all of the above: it drives the running app, presses the controls
this pass added, and checks the two surfaces that must never disagree.

**Its restore carries the WHOLE block, and that is not optional.**
`PUT /api/pages/:pageId/sections/:key` is a full replace for the fields it
covers, so a payload of `{ borderStyle }` blanks the headline, the deck and the
story. This net did exactly that to edition 40294's lead block on its first run
and it had to be refilled with `scripts/fill-edition-copy.js`.

```bash
node tests/browser/visual-pass.browser.js            # defaults to 40294 / lead
```

## Page model

```
Newspaper → Page → Editorial Block (page_section) → Story (news_item) → Images
```

Each editorial block (`page_sections` row) currently carries: headline, subheading, body, images (via a linked `news_item_id`), reporter, category, location, tags, font sizes, and `ai_notes`. A block can be filled either by writing directly into it or by linking a reporter's submitted story (`news_item_id`), which auto-fills the block's fields — this is deliberate (see Reporter Workflow below), not a duplication bug.

## Reporter workflow

Editors never search a dropdown of thousands of stories. The writing panel carries a "Take from Reporter" bar that opens the story picker drawer (`public/editor/story-picker.js`, `story-explorer.js`). Selecting a story auto-fills the editorial block; everything stays editable afterward.

The owner-facing Reporter desk (`public/admin/reporters.js`) is the account and
review surface: it searches reporter profiles by name, email, district or beat;
creates/edit reporter logins; shows a reporter's immutable filing history; and
approves or rejects copy with a stored note. A reporter's session owns both
`created_by` and the byline — never trust those values from a browser request.
Reporters can see and edit only their own copy, cannot review it, and cannot
change desk-approved copy. Blocking keeps the history but prevents all further
protected access.

General publication settings are one validated owner-only record
(`publication_settings`): identity, contact details, website, timezone and
default writing language. Its editable identity fields feed the canvas
masthead/folio furniture, e-paper metadata and Scribus output; therefore an
open edition picks them up on refresh without changing its stories or layout.
The registered nameplate artwork, RNI registration and legal printer's
declaration are deliberately not general text settings. Editing it never
retroactively rewrites an edition's content or geometry.

## Fitting copy to the hole

### Running body type is a publication style, not a rectangle function

The editor's physical scale is 2 px/mm. `public/editor/layout/publication-type.js`
owns the running-copy default for both browser and Node: **9 pt = 6.4 editor px**
at the database's one-decimal precision. `typeScaleFor()` may derive headline
hierarchy from the frame, but it must never derive body size from frame width —
a wider newspaper story gains columns, not larger prose. Every fallback must
read the shared catalogue; do not reintroduce a local 10/16 px default.

The schema migration changes the default only. Existing `body_font_px` values
may be explicit desk choices and are never mass-backfilled.

### An AI proposal belongs to one exact block snapshot

Saving before the request is necessary but not sufficient: type, columns or a
picture may change while the provider answers. Every write/fill response carries
the exact compositor fingerprint, and Accept re-composes the proposed words
against the current live draft and images. If the fingerprint differs, the
proposal is stale and must be refused; it is never accepted and then repaired.
This is the same compositor comparison, locally, and costs no provider call.
Body/display overset and an underfilled headline also disable acceptance. An
honest `SOURCE_LIMITED_UNDERFILL` remains reviewable — insufficient supplied
facts must not be padded with invented material merely to colour the bar green.

The AI panel's visible fit language must name the **exact compositor**. Its old
character-grid schematic is retained only for the explicitly unimplemented
"More AI actions" request preview; it is never a real write/fill decision.
`write` and `fill` both run the server-side exact settle loop after saving the
live draft, then accept only the exact fingerprint they were measured against.

### Direct exact-body editing is a bridge, not a second renderer

`block-frame.js` retains the exact `bodyLines` composition it paints. A body
double-click maps the page coordinate through the selected line's source offset
(`line.at`, after removing the dateline prefix) into the one Quill document; a
drag maps both endpoints into an authored Quill selection. The marks toolbar can
therefore change a character, word, phrase or paragraph directly where it
prints, while the exact composition remains the only visible body.

Do not make the canonical body `contenteditable`: browser flow cannot reproduce
the compositor's columns, balanced paragraphs or alpha-mask runaround. While
this direct body bridge is active, Quill's alternate surface is hidden and has a
body-target marker. Leaving for a display flow, picture or whole block blurs
Quill and removes that marker. A hidden Quill root may receive programmatic
focus during history refresh, which must not steal Arrow/Delete/Ctrl+Z from a
selected layout object; `workspace.js` treats Quill as typing only while that
marker is present.

Picture PATCH responses contain the entire image list. Picture mutations are
therefore serialized per workspace: parallel multi-select nudges otherwise risk
an older response replacing a newer sibling coordinate. Bulk nudge persists in
order and records one history step only after all selected pictures commit.

Copy never arrives the right length, and a sub-editor has exactly three moves. All three exist:

- **Cut it** — the worklist and preflight both say by how many characters.
- **Set it tighter** — `POST /api/pages/:pageId/sections/:sectionKey/fit` finds the smallest type change that makes it fit. `GET` on the same path answers what it *would* do without doing it, because changing a block's type is a design decision. It never goes below 6.5 pt (what preflight fails a page for) and never shrinks a headline to buy room for its own body unless the body alone cannot do it — a headline is the page's hierarchy.
- **Carry it over** — `jump.service.js`, with the two lines a reader follows.

`GET /api/newspapers/:id/worklist` answers "what is left?": every unfinished block in page order, with **the exact number of characters it holds**. That number is knowable before a word is written, and quoting it only after the copy has already run over is the thing this replaces. Never duplicate the measurement — the server imports `public/editor/layout/text-flow.js`, the one character grid, exactly as `editionFeatures`, `jump` and `preflight` do.

### The compositor is the controller — `copyFit.service.js`

**A character count is not the control variable, and neither is a pre-write reservation.** Both were tried, both are measured, both are settled:

- The **character budget is a range**, 30–46% wide (see above), so no scalar can answer "does this fit".
- The **pre-write reservation** reserves room for a headline and deck that do not exist yet, so it must assume the longest legal ones. Measured across 96 real block geometries with an in-spec headline *and* deck, it **over-promises on 49 of them** — it is not even a safe lower bound. And the same block's real capacity varies by a **factor of 1.5–3** depending only on how long the headline and deck turn out to be. An earlier measurement that showed it never over-promising was taken against blocks that had no subheading at all, which is not what the brief asks a model to produce.

So the loop runs the other way round. The AI supplies editorial material; **SAHAS decides what fits, where, how much is still fillable, and when fitting is finished.**

- **`measureFit()`** composes through the exact engine and reports the engine's own `fitState`, plus `displayOverset` (a headline or deck with no room for its own text is a block that does not fit, whatever the body did).
- **`isAcceptablyFilled(fit)` is the ONE authority on "is this block finished"**: nothing overset — body, headline, deck or kicker — and the block **at least 95% set** (`ACCEPTABLE_FILL_RATIO`), or with literally nothing fillable left. "Under one whole line empty" was the first attempt and is far too slack on a small block: 4.83 of 5.83 lines is under a line empty and only 83% set, which is exactly the "Layout looks balanced" a desk was shown at 87% while looking at an obviously short column. `isUnderfilled()` — the repair trigger — now chases the **same** bar rather than a share rule of its own, and `layout-panel.js`'s `WHITESPACE_THRESHOLD` is that bar too, so the panel and the writer cannot tell a desk two different stories. `MIN_FILLABLE_LINES` (0.25 — a quarter of a line is two or three words, the smallest thing a model can be asked to add) is *policy*: it decides whether a hole is worth a call, never whether the block fits. `ACCEPTANCE_EPSILON` is machine precision only; the old 0.01 quietly made 94% pass a stated 95% bar.
- **`trimToFit()`** cuts back to the longest prefix that fits, by binary search over the composed result, at the strongest boundary that still fills the block: **paragraph if that alone is already acceptable, otherwise sentence, and a word only as the emergency fallback** for a single sentence longer than the block. Deterministic, free, always converges.
- **`settleToFit()`** trims if long, then loops — bounded by `MAX_FILL_CALLS` (2) — asking only for **further paragraphs to APPEND**, never a rewrite. The second call is available only after the first answer has been composed and remains below 95%; this closes the measured case where one useful addition still stopped short. A worse answer is discarded, so a failed second attempt never costs the desk the copy it already had.

**A repair used to be accepted for having made the hole SMALLER.** That only proves the result got less bad: a block could go 55% full → 70% full and be returned as done. Acceptance is now the geometric condition, and when the bounded budget runs out without reaching it the result says **`SOURCE_LIMITED_UNDERFILL`** — the block still has room and the material available would not fill it. That is an honest production state (add source material, use a larger picture, choose a smaller block) and the AI panel shows it. **Never dress it up as `FITS`** — that is what puts a half-empty block on a printed page.

### Write for a RESERVOIR, not a target

`briefFor()` used to say *"That is the exact space left on the block"*. It was not true — the space left cannot be known until the headline and deck exist, which is after the brief. It is gone.

The model is now asked for **more copy than the block will print**, told so explicitly, and told to put the least important material last. Missing long is repaired by a free deterministic trim; missing short needs a paid call and may still miss. So the reservoir misses long on purpose.

**The reservoir is bounded by the block with the SHORTEST display type the brief permits** (`bestCaseCandidate()` in `headline-reserve.js`) — a brief headline and a deck at the bottom of its stated range — never by an empty block. An article block is never published without a headline and this brief requires a deck, so a body measured with neither is a block that will never exist: sizing the reservoir from it asked for up to **7×** what the finished block could hold. From the shortest legal display type: 2× at the median, 3× at p95, and it under-asks on 2 of 96 blocks, both by a single character. `RESERVOIR_CAP_CHARS` (6000) bounds it by what one response can carry.

`planningFit()` still computes the reservation, for exactly two narrow jobs: how long the headline may be, and whether this block has any room for copy at all. **Nothing load-bearing rests on it.** Do not spend effort improving its sampling.

`resizeNeeded()` and its own `HOLE_LINES` are **deleted**. It was a second, count-based answer to "does this fit", already unreachable from `write()`, kept alive only by its own test.

**A cut-out photograph needs no special case, deliberately.** Its exclusion comes from its real alpha mask (`compose/exclusion.js`, via `section-adapter.js`'s `obstacleFromImage` — `mask` is carried), so an irregular silhouette narrows the individual scanlines it actually crosses. Nothing models that; it only asks.

**"Fill remaining area with AI" repairs both directions through the same exact
settle controller as "Write this block".** Overset copy is cut first, for free.
If that sentence-boundary cut itself lands short of the 95% bar, up to two
bounded addition passes fill the newly opened hole and each result is composed
again around the same pictures. `trimmedOnly: true` still means the cut itself landed
at the foot and no provider was called. The explicit-fill path must never stop
at a coarse sentence cut and exchange an overflow for an underflow.

Auto columns and image exclusion travel together into this path. Do not restore
a local `Number(section.column_count) || 1`: on the 268 × 304 cut-out regression,
the old one-column override says the 299-character draft fits, while the real
Auto/two-column masked pour reports three characters overset. The shared settle
path ends with no overset and a 1.00 weighted fill ratio.

Auto's width-derived count is the professional first choice, not an immutable
guess. If that count oversets current copy around the real image scanlines,
`composeSection()` tries lower legal counts and uses the highest one that sets
every word. An explicit desk count is never changed, and merely short copy does
not make Auto jump. The Properties note reports the same resolved composition.

The user's "line matrix" is already inside `composeBlock()`: every baseline has
its own legal horizontal intervals after columns, rectangular pictures and
alpha-mask cut-outs are excluded. The API is not asked to reproduce that matrix
or predict glyph widths. It receives the matrix's measured result — exact fill
ratio, equivalent missing lines and resolved columns — supplies editorial
material, and the local HarfBuzz compositor pours it back through every interval.
That closed loop is the guarantee; a model's character estimate is only a
calibrated request size.

### How full is this block? In WEIGHTED USABLE GEOMETRY — `bodyFill()`

**`bodyLines.length` is a FRAGMENT count and was never a line count.** Around a cut-out standing clear of both edges, one physical row of type is two corridors; `pourBody()`'s `fillRow()` sets every legal gap on a row and pushes each as its own entry. Measured on a centre-standing silhouette: **9 entries for 6 physical rows**, each a half-measure fragment counted as a whole line. The old `bodyFill()` then divided that fragment count by a *width-derived* hole and called the quotient a percentage — two different units, so it could only be right by accident. On that block it read **44% full where the geometry says 29%**.

It did not stay in the read-out. `measureFit()` divided the character count by the same fragment tally to calibrate the repair target, so on a real cut-out block the rate came out **26% low** and that wrong rate was multiplied by the hole to decide what to ask the model for next.

`pourBody()` now returns an **occupancy** record, and it is the authority:

| field | what it is |
|---|---|
| `occupiedEquivalentLines` | every gap that received type, counted as `gap.measure / its own column's width` |
| `emptyEquivalentLines` | every legal gap that received nothing — the fillable hole, and `whitespace.largestHoleLines` |
| `intentionalEquivalentLines` | room a paragraph break asked for |
| `availableEquivalentLines` | occupied + empty |
| `renderedFragments` | `bodyLines.length`, diagnostic ONLY — never a line count, never a divisor |

A full-width row counts 1, a row a silhouette halves counts 0.5, two quarter corridors count 0.5 between them. **The image's shape participates on its own** — there is no image-specific arithmetic anywhere; it simply narrows the gaps it crosses. A gap that received type counts its whole **measure**, not the width its glyphs reached: a ragged right end is how type is set, never a hole.

**Paragraph air is `intentional`, not empty.** It used to land in `emptyGapWidth`, so the desk was offered "Fill remaining area with AI" for whitespace the stylesheet deliberately inserted.

`whitespace.bottomResidualLines` and `unexplainedLines` survive as **diagnostics only**. Taking the larger of the two was a category error: the first is a single scalar over the whole frame (it cannot see a hole in a column no line was last set in), the second could not tell paragraph air from missing copy.

`bodyFill()` keeps `linesUsed` / `holeLines` / `linesAvailable` as aliases so every surface reads one number — they are **fractional** now, because a row a picture halves really is half a line. `tests/bodyOccupancy.test.js` holds this across six shapes: no image, rect, centre-split cut-out, asymmetric cut-out, 90°-rotated cut-out and a two-column section. The existing tapered-cut-out fixture does **not** prove it — it sits flush against the block's left edge, so it narrows one corridor rather than splitting a row.

`compose.js`'s own `charsPerLine` (inside the `holed` check) divided `bodyCharRange.min` by `body.measures.length` — the count of calibration *gaps*, the same confusion. It divides by `fullMeasureEquivalents` now.

**`compose.js`'s `HOLE_LINES` (4) is not the fill bar and never was.** It belongs to the engine's own `fitState`, which is why a block with a 2-line hole reports `FITS` while `isAcceptablyFilled()` correctly says it is not finished. Do not merge the two: `fitState` is what preflight fails a page for, the 95% bar is what the writer works to.

**`write()` reports the block's own capacity, never `targetChars`.** `targetChars` is calibrated *from the draft*, so quoting it back as "the block holds N" is circular — that is what produced "124 of 203 · 79 left".

**The Space panel reserves a headline when the block has none.** An article block is never published without one, so measuring the body's room on a block that has none answers a question nobody asks — 639 characters with no headline against 187 once a real headline and deck are set, on the same block. While `headline` is empty on an `article` block the panel shows the same reservation the model is briefed against, labelled **"Room for copy (after a headline)"**.

**`layoutWarnings()` cannot use `metrics.fillRatio` for whitespace.** That ratio counts only the gaps *beside* pictures, never the room under the last line — the whitespace a desk actually complains about. Where there is a real composition, the warnings read `bodyFill()`.

## How this paper leaves the building — `src/services/export/`

Four destinations, **one composition**. `print-model.js` walks the edition once
and returns a list of placed items; every writer renders that list and decides
nothing about where anything goes. A block at 42.5 mm is at 42.5 mm in all
four, or one writer has a bug — there is no second layout engine in that folder
to disagree with. `tests/printModel.test.js` holds it by checking the shared
walk against the .sla that already goes to the plate, line for line and word
for word.

| `GET /api/newspapers/:id/export/:format` | | |
|---|---|---|
| `pdf` | `.pdf` | the **CMYK press file** — the artifact a press takes |
| `indesign` | `.idml` | an editable InDesign document |
| `scribus` | `.sla` | the Scribus project (`scribus.service.js`, unchanged) |
| `word` | `.docx` | the edition's **copy**, as a manuscript |

Desk-only, and deliberately **not** gated on press readiness — `/scribus` and
`/press-package` still are. Those two are the press path; these are the working
exports, wanted while the page is still being made up, which is the only day
they are any use.

**Units are converted once, in the model.** The editor works in pixels at
2 px/mm; the model is millimetres from the page's top-left and points for type,
and every writer converts from there to its own unit (PDF points, IDML points,
Word half-points and twips). Never silently — CLAUDE.md's own rule.

### The press PDF is drawn as GLYPHS, not as text

Devanagari cannot be printed by handing a PDF a Unicode string and a font: the
shaping is what turns क + ् + ष into क्ष, and **a PDF viewer does no shaping at
all**. HarfBuzz has already done it — the compositor's own shaper, the same one
that measured the line — so the file carries the glyph ids it produced, in a
CID-keyed font with `/Identity-H` encoding and `/CIDToGIDMap /Identity`, which
means the two-byte codes in the content stream **are** the shaper's glyph ids.
That is also why the press file cannot drift from the screen: same glyphs, same
advances.

- **Positions are exact, not left to the advance widths.** The line has already
  been justified — word spaces opened, glyphs stretched — so a PDF that
  re-advanced by `hmtx` alone would set a line that does not reach its measure.
  Every glyph's x comes from HarfBuzz and the `TJ` adjustment is whatever puts
  it there.
- **`/ActualText` on every run**, because drawing glyph ids makes a file that
  prints perfectly and cannot be searched. A per-glyph `/ToUnicode` table
  *cannot* describe Devanagari — shaping is many-to-many — and doing it that
  way first produced `शेतकऱ्यांसाठी` extracting as
  `शेशेतकऱ्यांयांयांसायांठीठी`, every cluster repeated once per glyph. `/ToUnicode`
  now carries only the glyphs that stand for exactly one cluster, as a fallback.
- **The publication faces carry no Latin, and no ■.** Measured: `serif/400` and
  `sans/700` both lack `■`, `•` and every Latin letter — and the dateline opens
  with a ■, the legal imprint is in English, and the RNI line is on page two of
  every edition. A glyph the shaper resolves to id 0 is drawn from one of PDF's
  **base-14** fonts instead (no embedding, present in every RIP), at the x
  HarfBuzz reserved for it, so the line does not move. The ■ is drawn as a
  filled rectangle, because that is what it is.
- **A text block is not nestable.** Both of the above draw operators a PDF text
  block may not contain; Ghostscript said so in as many words ("BT found inside
  a text block") the first time this ran over a real four-page edition, where
  the imprint's English finally exercised the path. The block is closed before
  either and opened again after.
- **Black is 100% K, not four-plate black.** Registration on small Devanagari
  counters is exactly where four-plate black shows as a fringe. Photographs are
  decoded and separated too — `/DeviceRGB` never appears in the file — with the
  ordinary naive conversion and **no ICC profile**, because this product has no
  colour-management pipeline and pretending otherwise in a press file is worse
  than being plain about it. A cut-out's alpha becomes an `/SMask`.

### The nameplate, which no export used to carry

Found by rendering a real four-page edition and looking at it: page one had a
hand's width of white where the paper's own name goes. `scribus.service.js` has
the same gap and always has — it emits the footer and the imprint and nothing
above the fold. It is drawn from the same two sources the canvas uses
(`regionsFor()`'s header region and `identityFor()`), leaves the ear when the
page has a corner block, keeps the registered artwork at its own proportions,
and does **not** repeat the RNI as type because the artwork already carries it.
The model has it; **Scribus still does not** — moving that service onto the
shared model is the obvious follow-up.

### Word is the COPY, deliberately, and says so

Word is a flow processor: it has no concept of a frame at 42.5 mm holding type
that runs round a photograph. A `.docx` of absolutely-positioned text boxes can
be made and opens as something nobody can edit — which defeats the only reason
to want Word. So it is the manuscript: every block's headline, deck, byline and
story in page order, read through the **same** rich-text reader the compositor
uses, so a word the desk set bold or coloured is bold and coloured there too.
`w:cs` and `w:szCs` are on every run: without them Word applies the Latin font
and size to Devanagari, which is what makes an Indic `.docx` open in the wrong
face at the wrong size.

The IDML and DOCX zips go through `pressPackage.service.js`'s own zip writer —
an entry may now name its own compression, which is how IDML's `mimetype` gets
to be stored and first, the rule it shares with ODF and EPUB.

### A Smart Card is walked once

`export/smart-card-lines.js` reads `layoutSmartCard()`'s resolved geometry and
returns neutral entries. It used to live inside `scribus.service.js`, which was
right while Scribus was the only destination; four walks of the same card is
the duplicated-catalog failure this project has been bitten by twice. Scribus
now places what that walk returns, and `tests/scribusComposition.test.js`
proves the .sla is unchanged.

## Scribus / PDF export (the pipeline below is the PRESS path)

```
Workspace → Save → Generate Scribus → Editor adjusts → Export CMYK PDF → Upload PDF → Archive
```

Don't redesign this workflow when it lands. `POST /api/newspapers/:id/final-files` already accepts a `.sla` Scribus project and/or a final CMYK PDF and marks the edition `finalised` — this is the upload/archive tail end of that pipeline, already working.

## Engineering rules

- **The overflow diagnosis started from desk-selected baseline `52c9556`.** Fix
  only proven boundaries from that line; do not broadly retune derived font
  sizes, replace the compositor or disturb irregular-image wrapping. Later
  commits are incremental verified fixes, not permission to reintroduce the
  abandoned broad redesign.
- Never rewrite a working module unless necessary; prefer incremental migration with small commits.
- Never guess schema — read `schema.sql`. It uses `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for additive migrations; follow that pattern for new columns.
- Before changing code, determine: what's live, what's legacy, what's dead. Delete only code confirmed dead (unreachable AND unimported, or actually empty *and* not a documented planned stub — see above).
- If this doc and the repository conflict, trust the repository, and say so explicitly rather than silently picking one.
- Keep modules small; avoid a God `admin.js`. When adding significant new admin UI, pull it into its own `public/admin/*.js` module rather than growing `admin.js` further.
- No duplicated endpoints, no duplicated SQL, no duplicated data catalogs (see the template-drift incident above — this is exactly the failure mode to avoid).

## Definition of done

A task is complete only when: it builds/boots (`node server.js` or `npm test`'s `createApp()`), no route regresses, existing functionality is preserved, there's no duplicate logic or dead code introduced, and architecture is improved or at least not worsened.

## Testing

`npm test` runs `tests/*.test.js` via `node --test` against a real Postgres instance (`.env` / `DB_*` vars) and a real `createApp()` — not mocks. After any feature change, confirm: app boots, the routes you touched work, DB queries succeed, `npm test` still passes green.

**`npm test` does not see the browser, and most of this product is the browser.** Every UI regression in this project was found by driving the running app, never by reading code. Log in as a desk user, open an edition, click a block, and look at a screenshot. A blank frame is a failure to launch.

`tests/pictureBlocks.test.js` is the same idea for a block that carries a
**photograph** — rectangle, cut-out, or none — and `tests/blockQuality.test.js`
for the block that carries only type. Both are deterministic and cost no AI
call. The cut-out path is real: `models/u2netp.onnx` is present, so
`backgroundRemoval` runs the **model**, not `cutout.service.js`'s flood fill,
and the PNGs it writes are 39–47% transparent.

`tests/browser/workspace.browser.js` is that net, and it lives **in the repository on purpose** — it used to live in a scratch directory, which was wiped, and a hundred checks went with it. Run it against the running app:

```bash
node tests/browser/workspace.browser.js          # defaults to edition 2099
node tests/browser/editor-controls.browser.js    # every control × every text object
node tests/browser/body-editing.browser.js       # the caret, the selection, the gestures
node tests/browser/story-picker.browser.js       # Take from Reporter, and clearing a story
node tests/browser/desk-actions.browser.js       # the toolbar's own actions, and what each SAID
node tests/browser/smart-cards.browser.js        # every card at its own size, and the block it brings
```

`story-picker.browser.js` covers the path an editor uses most and no net drove:
taking a reporter's filing into a block. It found the `pickText()` fault above,
and it ends by clearing the story with Ctrl+A and Delete — the version of that
fault a desk meets daily — checking both surfaces agree each time.

**A net that writes into a real block must put it back, and must do so when it
CRASHES too.** `editor-parity.browser.js` restores the block it borrows at the
end — but a run that died half way left the block carrying whatever it had just
set, and the next run then took that as the block's own value and restored it
faithfully. That is how five blocks of edition 40294 came to be carrying body
sizes nobody chose (7.0 and 8.0 px against the publication's 6.4). The restore
is reachable from the crash handler now.

**And a net must drive a state a desk is actually in.** The same net picked
"the first size option that is not the current one", which on the points ladder
is its 6.5 pt floor — that crosses `MIN_COLUMN_EM` on a 112 px block and made
Auto flip from one column to two mid-check, reported as a parity failure that
was really the harness's own doing. It nudges one rung now.

Both reset the block they drive first, so they can be run repeatedly. They need `playwright-core` and Chrome at `/usr/bin/google-chrome` (`CHROME_PATH` overrides).

**A browser test that crashes is worse than one that fails.** `workspace.browser.js` died at check 18 of 211 for months — its geometry section read `.section-content`, which the composed renderer does not emit — and everything after it silently never ran. Three real bugs were sitting behind it (a selected picture that never showed selected, a sideways scroll at 900px, a Smart Card check pointing at a removed element). If you change a renderer's DOM, run the net and read the LAST line, not the first failure.

The guide-drag section later exposed a second way for that net to stop early:
Chrome intermittently garbage-collected the promise returned by a
`page.evaluate()` that was awaiting a dynamic import while the canvas was being
re-rendered. Modules used on that hot path are loaded once and parked on
`window`; `evalRetry()` retries only the transient GC/execution-context errors,
once. The top-level crash handler prints the exact passed/ran tally before the
error and says that later checks did not run, so a partial run cannot resemble a
green one. After that hardening the whole net completed **222/222 three
consecutive times**, with no browser errors or crashes.

The dev database is full of test fixtures — 221 editions across 13 dates, named `साहस`, `ZZ …`, `8/3/2026 Edition`. Tests that create an edition must remove it in `t.after(...)`. `POST /api/newspapers` is **not** idempotent; only `POST /api/newspapers/start` is, and only that one is wired to a button.

### Housekeeping every session

- Read the `.md` files first (`VISION.md`, this file, `PROJECT_STATUS.md`) and **write the changes back into them** when the work lands. The drift warning that used to sit in "Current reality" is what happens when the code moves and the doc does not.
- Commit in small steps, so a bad change can be walked back.
- Stop the dev server before finishing, and **kill it by the port it holds**:

  ```bash
  pid=$(ss -ltnpH "sport = :3000" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
  kill "$pid"
  ```

  Two traps, both hit repeatedly. `pkill -f "node server.js"` matches the shell running it, exits 144 and kills the shell. And the server shows in `ps` with comm **`MainThread`**, not `node`, so `pgrep -x node` does not find it — the old server keeps the port, a relaunch silently fails to bind, and every check afterwards runs against stale code. Three wrong diagnoses in one session came from exactly that. Relaunch with `setsid nohup node server.js &` and verify the boot with `curl` before trusting anything.
