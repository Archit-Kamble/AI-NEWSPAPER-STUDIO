# OMClaude.md — instructions for Om's Claude

**You are reading the right file.** Om is joining an existing project. He is not
a programmer, so he cannot check your work by reading code — everything in here
is written so that *you* can do the work correctly without him having to. When
something is ambiguous, ask him a short question in plain words, never in
jargon, and never ask him to read code to answer it.

Archit works on the same repository with his own Claude. The two of you must
never edit the same branch. The rules for that are in **"Branches, and staying
out of each other's way"** below, and they are not optional.

---

## 1. What this project is, in sixty seconds

SAHAS is a complete newspaper production system, built for a real customer
(**SAHAS VARTA**, a Marathi daily) who will run it every day to make up, print
and publish an actual newspaper. Reporter → editor → page designer → print PDF →
press → e-paper.

It is **not** a website builder or a CMS. Every decision assumes real ink on
real newsprint.

Two files are the constitution and you must read both before you touch anything:

| file | what it is |
|---|---|
| `VISION.md` | what is being built and why. Read first. |
| `CLAUDE.md` | how the code is built, and hundreds of hard-won rules. Where the two disagree, VISION.md wins. |

`CLAUDE.md` is very long. You do **not** have to read all of it at once, but you
must read these sections before your first change, because they govern your
work directly:

- "Copying a reference paper's page — a TEMPLATE plus a RECIPE"
- "Measured EXACTLY: no grid, the scan's own rectangles"
- "The gap between two lines is the SCAN's, not the compositor's"
- "One package, through three checks"
- "Engineering rules" and "Definition of done" (at the very end)
- "Housekeeping every session"

Also read `docs/REFERENCE-PAGES.md`. It is the standing record of how a copied
page is judged, and you will be adding to it.

---

## 2. Om's job: copy the Sakal theme

Archit's side has copied the **Lokmat** broadsheet: twelve pages, each one
measured off a 300 ppi scan and turned into a layout the software can set real
news into. Om's job is the **same thing for Sakal**.

**What "copying a theme" means here, exactly.** You are not copying Sakal's
words, photographs, logo or masthead — those belong to Sakal and never enter
this repository. You are measuring and reproducing:

- where each block sits on the page (rectangles, in the scan's own pixels)
- how wide its columns are, and the gap between them
- what size and weight each piece of type is set at, and its line spacing
- which of our own typefaces best matches each role
- the rules, tints, panels and picture boxes that make up the page furniture

The result is two pieces of ordinary catalogue data: a **template** (where the
frames are) and a **recipe** (how each frame is dressed). Both come out of one
spec file. Nothing else in the product needs to change.

**Done, for one page**, means all three of these pass — see §7:

1. our page breaks its lines where the printed page breaks them (or the
   remaining differences are named and explained);
2. the design still holds when different news is poured into it;
3. the press PDF prints what the screen shows.

---

## 3. One-time setup

Run these in order. If a step fails, stop and tell Om exactly which step and
what the error said — do not improvise around a broken setup, because every
later measurement would be wrong.

```bash
# 1. Get the code
git clone https://github.com/Archit-Kamble/AI-NEWSPAPER-STUDIO.git
cd AI-NEWSPAPER-STUDIO

# 2. Install dependencies (Node 22 or newer; this machine uses v24)
npm install

# 3. Python tools used for measuring scans
python3 -c "import PIL, fontTools" || pip3 install pillow fonttools

# 4. Command-line tools for reading a PDF scan
#    pdfimages and pdftoppm come from poppler-utils
sudo apt-get install -y poppler-utils

# 5. PostgreSQL must be running, and a database created for this project.
#    Ask Archit for the database name/user he uses, or create your own.
#    Then copy the environment file and fill in the DB_ values:
cp .env.example .env
#    Edit .env: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, SESSION_SECRET.
#    You do NOT need any AI provider keys for this work (see §9).

# 6. Create the tables
psql -d "$DB_NAME" -f schema.sql

# 7. Check it boots
node server.js
#    then in another terminal:
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/health    # expect 200

# 8. Check the tests pass BEFORE you change anything
npm test                 # expect around 1246 passing, 0 failing
```

If `npm test` is not green on a fresh clone, that is not your fault and not
something to work around — report it in `ARCHITClaude.md` (§10) and stop.

**`schema.sql` is never run automatically.** If you ever add a database column,
it must go into `schema.sql` *and* be applied by hand with `psql`. See the
"Schema changes that need applying" section of `CLAUDE.md`.

---

## 4. Branches, and staying out of each other's way

This is the single most important operational rule. Two Claudes editing one
branch will destroy each other's work.

```
main                      the shared, tested trunk. NEVER commit to it directly.
lokmat-reference-pages    Archit's branch. NEVER touch it, not even to read-fix a typo.
sakal/<what-you-are-doing>  YOUR branches. Always.
```

**Your branch names must start with `sakal/`** so that anyone can see at a
glance whose work it is. For example `sakal/front-page`, `sakal/city-page`,
`sakal/measuring-tools`.

### Every working session, in this order

```bash
# START of a session — always, before any edit:
git checkout main
git pull                        # get Archit's latest work
git checkout -b sakal/front-page    # or: git checkout sakal/front-page (if it exists)
git merge main                  # bring his latest into your branch

# ... do the work, committing in small steps ...

# END of a session — always:
npm test                        # must be green
git push -u origin sakal/front-page
```

**Push at least once a day, even if the work is unfinished**, and say so in the
commit message ("work in progress"). Archit cannot see what is only on Om's
laptop. Pushing is how he reviews; pulling is how you get his fixes.

### Rules that keep the two sides apart

- **Never** `git push --force` anything. If a push is rejected, pull, merge,
  and push again — and if the merge has conflicts you do not fully understand,
  stop and write it in `ARCHITClaude.md`.
- **Never** commit directly to `main` or to `lokmat-reference-pages`.
- When your page is finished and green, **do not merge it to main yourself** —
  push your branch and write in `ARCHITClaude.md` that it is ready. Archit's
  side merges.
- If you need a change to a *shared* file (anything under
  `public/editor/compose/`, `src/services/`, `src/layout/templates.js`,
  `src/layout/design-recipes.js`, `schema.sql`), **say so in
  `ARCHITClaude.md` before you make it**. Those files are where the two sides
  collide. Your own spec files under `src/layout/measured-pages/` are yours
  alone and need no announcement.

---

## 5. Getting the Sakal scans

Om supplies a Sakal e-paper PDF (one edition, whichever city edition he wants
copied). Then:

```bash
mkdir -p ~/scans/sakal
pdfimages -j "/path/to/Sakal_<edition>_<date>.pdf" ~/scans/sakal/p
ls -la ~/scans/sakal/          # p-000.jpg, p-001.jpg, ... one per page
python3 -c "from PIL import Image; im=Image.open('$HOME/scans/sakal/p-000.jpg'); print(im.size)"
```

**Check what you actually have before measuring anything.** Our Lokmat pages
are single JPEGs at 2800×4440 (300 ppi) carrying no text layer, so every number
is read off pixels. A Sakal PDF may be different — it may carry real fonts and
vectors, which is *better* (you can read exact numbers). Report which it is.

Two traps already paid for on the Lokmat side:

- **A PDF from an e-paper "clip" viewer is not the printed page.** It wraps each
  story in a logo above and a "Powered by" line below that were never on the
  newsprint, so its spacing is fiction. Use a full-page scan.
- The scan's page order may not match the printed page order (our page one was
  PDF page 3). Confirm by looking at each image.

**The scans are never committed.** Keep them outside the repository, as above.

---

## 6. Measuring one page, step by step

Work on **one page at a time**, and within that page, **one story package at a
time** (a package is a headline, deck, byline, photograph, caption, sidebars and
body columns — everything a real story has). A page that passes as twelve
separate blocks can still read as the wrong page; a package that passes is real
progress.

### 6.1 Measure the scan

All of these take the scan's path **without** the `.jpg`:

```bash
cd ~/ai-newspaper-studio     # wherever the repo is

# Page size, ink extent, and the long horizontal rules:
python3 scripts/reference-layout/measure.py ~/scans/sakal/p-000

# Where the photographs are (continuous tone, found automatically):
python3 scripts/reference-layout/photos.py ~/scans/sakal/p-000

# Type size, weight and the implied em, for boxes you name as label|x0,y0,x1,y1 :
python3 scripts/reference-layout/typesize.py ~/scans/sakal/p-000 "lead-head|120,480,900,600"

# Grounds and ink colours in a box:
python3 scripts/reference-layout/colours.py ~/scans/sakal/p-000
```

Record every number. You are going to put them into a spec file, and a number
you guessed will be wrong in a way no test can catch.

### 6.2 Write the spec

Create `src/layout/measured-pages/sakal-front.js`. **Copy the shape of
`src/layout/measured-pages/broadsheet-front.js`** — read it first; it is the
worked example, and `kit.js` beside it holds the shared pieces (body style,
head styles, bylines, insets) so you are not inventing them.

A spec states, in **scan pixels**:

- `scan: { x0, x1, y0, y1, top }` — the scan's matter box, and where blocks
  start on our page;
- `blocks: [{ key, box, story, priority, style, pictures, panels }]` — every
  block as a rectangle.

and every type size in **editor pixels** (our page is 2 px per millimetre), got
by matching a face to the scan rather than by scaling a guess.

**A block's own words are never in a spec.** Panels carry a placeholder.

### 6.3 Register it — one line

Open `src/layout/measured-pages/index.js` and add your key to the `sakal` list:

```js
  sakal: ['sakal-front'],
```

That is the whole registration. The template and the recipe both follow from it.
(It used to be two separate lists in two files; that trap was removed the day
this handout was written.)

### 6.4 Put it on a real page and look at it

```bash
# Start the server if it is not running
node server.js &

# Make a throwaway edition. The date MUST be in 2099 - that is how the
# codebase tells a fixture from a real newspaper, and the scripts refuse
# any other date.
#   (Ask Archit for the exact "start an edition" step for your setup, or
#    use the app: log in, "+ New Edition", set the date to a 2099 date.)

# Put your measured page onto page 1 of that edition:
node scripts/apply-design-recipe.js <editionId> 1=sakal-front

# Fill it with deterministic Marathi copy - no AI, no cost, same words
# every run so two screenshots can be compared:
node scripts/fill-edition-copy.js <editionId>

# Photograph the sheet itself (not the editor's chrome):
node scripts/reference-layout/shoot.js <editionId> 1 /tmp/sakal-p1.png full 4.33
```

Then **look at the picture**. Every single fault on the Lokmat side was found by
looking at a rendered page, never by reading code.

### 6.5 Compare it against the scan

```bash
python3 scripts/reference-layout/compare.py \
    ~/scans/sakal/p-000.jpg sakal-front /tmp/sakal-p1.png /tmp/cmp-p1
```

It writes four things: a side-by-side, an overlay (reference ink red, ours
green, both black), a blink GIF, and `-trace.html` — a tracing layer with an
opacity slider you can open in a browser. Use `--region <block-key>` to look at
one block closely.

**One transform for the whole page, always.** Never stretch a single block or
region to make it agree: that can make any two pages agree and proves nothing.
If our page is a different shape from the scan, the tool prints the anisotropy
and that is a *declared difference*, written into `docs/REFERENCE-PAGES.md`.

---

## 7. The three checks that mean "done"

Looking at it is how you find faults. These three are how you know a page is
finished. Run all three for each package, and record the numbers.

```bash
# 1. Does it break where the printed page breaks?
#    Needs a local file of the reference's own lines - see below.
node scripts/reference-layout/divergence.mjs <editionId> 1 <your-lines-file.js>

# 2. Does the design hold with DIFFERENT news in it?
node scripts/reference-layout/fresh-copy.mjs <editionId> 1 <blockKey>

# 3. Does the press file print what the screen shows?
node scripts/reference-layout/export-check.mjs \
     <editionId> 1 /tmp/sakal-p1.png /tmp/plate-p1 4.33
```

**Check 1** needs you to transcribe the reference's own lines into a small file
(one array per column, one string per printed line). That file contains Sakal's
words, so it is **local calibration only and never committed** — keep it in
`tmp-visual-pass/runs/reference/`, which is already ignored by git. The tool
reports the *first* line that differs and whether the reference's line would fit
our measure, which tells "our face is wider" apart from "our breaker chose
differently". Fix the earliest difference first: one displaced word moves every
line after it.

**Check 2** proves the layout is a layout and not a photograph of one. Anything
that will not fit must be *reported*, never silently shrunk.

**Check 3** prints two numbers: an exact ink overlap and a tolerance figure.
**Judge it on the tolerance figure.** At 220 dpi, half a pixel of positioning
halves an exact overlap on a line that is in exactly the right place. And the
plate is rendered in CMYK, where 93% black comes out as RGB 50,46,47 — so only
the *geometry* of the ink can be compared between screen and plate, never how
dark it is.

Aim for what the Lokmat lead package achieved: most lines agreeing, remaining
differences named with a cause, and 97%+ of the ink agreeing within half a page
pixel.

---

## 8. Rules you must not break

These are condensed from `CLAUDE.md`. Each one was learned by breaking it.

1. **Never rewrite a working module.** Small, incremental changes; small commits.
2. **Never guess the database schema** — read `schema.sql`.
3. **One catalogue, never two.** If a list of things exists, do not make a second
   copy of it somewhere else. This project has been bitten three times.
4. **Never put a backtick inside a JavaScript template literal**, including in a
   comment. `node --check` passes it; the browser fails to load the whole
   application. This has happened five times. Put explanation in a `//` comment
   *above* the function instead.
5. **A control that does nothing is worse than no control.** If you add a
   setting, make sure something actually reads it — screen *and* press file.
6. **A fixture must be cleaned up, including when the script crashes.** Any test
   or script that creates an edition must delete it in a `finally`.
7. **2099 dates only** for anything disposable. Real editions are never touched.
8. **Never lower `line_height` to "tidy" it.** Marathi ink is taller than its
   line box; there are measured floors, and cropping a matra is a printed fault.
9. **Stop the dev server by its port, never by name:**
   ```bash
   pid=$(ss -ltnpH "sport = :3000" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2); kill "$pid"
   ```
   `pkill -f "node server.js"` kills your own shell; the process shows in `ps` as
   `MainThread`, not `node`.
10. **Definition of done:** the app boots, `npm test` is green, no route
    regressed, no duplicated logic, and the docs were updated in the same commit
    as the change.

---

## 9. Money, keys, and what you must never do

- **This work needs no AI API calls at all.** Measuring a scan, writing a spec,
  filling a page with `fill-edition-copy.js` and running the three checks are
  all free and deterministic. If you think you need an AI call, you have
  misunderstood the task — ask first.
- **Never print, echo, or paste the contents of `.env` or any API key**, not
  even partially, not even into a commit message or a log. Check only whether a
  key exists (true/false).
- **Never commit** Sakal's words, headlines, photographs or logo; the scans; the
  transcribed line files; `.env`; or anything under `public/uploads/`.
  `.gitignore` already covers the usual places — keep it that way.
- **Never run a destructive database command** (`DROP`, `DELETE FROM` without a
  narrow `WHERE`, `TRUNCATE`) on the shared database. If tidying is needed,
  say so in `ARCHITClaude.md`.

---

## 10. Reporting progress — `ARCHITClaude.md`

`ARCHITClaude.md` in the repository root is the shared logbook between the two
sides. **Append an entry there at the end of every working session**, commit it
on your branch, and push. Archit's Claude reads it and replies in the same file.

The template and the rules for it are at the top of that file. Keep entries
short, factual, and numerical — "the lead block's body agrees for 18 of 26
lines, first difference at line 19, cause not yet known" is useful; "made good
progress on the front page" is not.

**Raise a `BLOCKED:` entry the moment you are stuck for more than about half an
hour.** Nobody minds a question; a week of quietly wrong measurements is
expensive.

**Mark anything big with `FINDING:`.** Archit works with another assistant
(Astra) on the architecture, and important discoveries get shared there. A
finding is something that changes how the work should be done — a measurement
that contradicts an assumption, a rule in the compositor that turns out to be
wrong, a trap that will bite the next person.

---

## 11. Traps already paid for — do not rediscover these

Every one of these cost hours on the Lokmat side:

- **A comparison that looks fine can hide a real error.** Check the *numbers*,
  not the impression. Two pages can look identical while the plate sets a
  headline 13 px out of place.
- **A test that reimplements the thing it tests can only pass by luck.** Call
  the real function.
- **A test that fails sometimes is not automatically "flaky"** — one such
  failure turned out to be the product legitimately changing behaviour, and
  another was a leaked fixture from an earlier run.
- **Screenshot the sheet, not the workspace.** An element screenshot inside the
  editor captures sticky chrome over the page and loses whatever the scrolling
  host hid. `shoot.js` already does this correctly — use it.
- **Judge tints on the full-resolution PNG.** A downscaled JPEG washes a light
  ground out to white and you will "fix" a colour that was already right.
- **A picture placed at the top of a block sits in the headline's band** and
  squeezes the headline into a narrow corridor beside it. In a printed page the
  photograph is usually *under* the headline.
- **An object literal keeps the LAST duplicate key.** A catalogue entry written
  twice silently uses the stale one, with no error anywhere.

---

## 12. A sensible first week

1. **Day 1** — setup (§3), `npm test` green, read `VISION.md` and the
   `CLAUDE.md` sections listed in §1. Open the Lokmat spec
   `src/layout/measured-pages/broadsheet-front.js` and read it until you
   understand what every field means. Write your first `ARCHITClaude.md` entry
   saying setup is done and what you understood.
2. **Day 2** — get the Sakal scans, check what they actually are (§5), and
   report the page size, resolution, and whether they carry text.
3. **Day 3–4** — measure the front page's **lead package only** and write
   `sakal-front.js` with just those blocks. Render it, compare it, look at it.
4. **Day 5** — run the three checks on that one package, write the numbers into
   `docs/REFERENCE-PAGES.md` under a new Sakal heading, and push.

Then repeat, one package at a time, outward to the whole page, then the next
page. **Do not** start twelve pages at once — the Lokmat side did a version of
that and had to measure everything a second time.

---

## 13. When you are unsure

Ask Om a short question in plain language. If the answer needs Archit (anything
about shared files, the database, merging, or whether a difference matters),
write it in `ARCHITClaude.md` as a `QUESTION:` entry and carry on with something
else. Never guess about:

- whether a difference from the scan is acceptable,
- whether to change a shared file,
- whether to merge anything into `main`,
- anything involving money, keys, or deleting data.
