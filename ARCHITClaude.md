# ARCHITClaude.md — the logbook between the two sides

Two people are building this newspaper with two Claudes: **Archit** (the Lokmat
reference pages, the compositor, the product) and **Om** (the Sakal reference
pages). Neither can see the other's screen. This file is how they stay in step.

**Both sides append here. Nobody edits anybody else's entry.** Add yours at the
top of the log, under the newest one. Commit it on your own branch and push;
the other side reads it after `git pull`.

---

## How to write an entry

Newest first. One entry per working session, even a short one. Keep it factual
and numerical — a number can be checked, an impression cannot.

```
### YYYY-MM-DD — <your name> — <branch you were on>

DONE:     what actually works now, with numbers.
NUMBERS:  test counts, agreement percentages, anything measured.
NEXT:     what you will do next session.
QUESTION: anything you need the other side to answer. (omit if none)
BLOCKED:  what is stopping you, and for how long. (omit if none)
FINDING:  something that changes how the work should be done. (omit if none)
SHARED:   files outside your own area that you changed. (omit if none)
```

Four of those tags exist because they need someone else to act:

| tag | who acts | how fast |
|---|---|---|
| `QUESTION:` | the other side | next session |
| `BLOCKED:` | the other side, **immediately** — raise it after half an hour stuck, not after a week | same day |
| `FINDING:` | Archit relays it to Astra (the architecture assistant) if it is big | as it comes |
| `SHARED:` | the other side pulls before continuing, to avoid a collision | before their next edit |

**`SHARED:` matters most.** These are the files where the two of you can collide:

```
public/editor/compose/**        the compositor - the heart of the product
public/editor/layout/**         the shared catalogues
src/services/**                 everything server-side
src/layout/templates.js         the template catalogue
src/layout/design-recipes.js    the recipe catalogue
src/layout/measured-pages/index.js   the one list of measured pages
src/layout/measured-pages/kit.js     the shared spec pieces
schema.sql                      the database
CLAUDE.md, VISION.md            the constitution
```

Your own spec files (`src/layout/measured-pages/sakal-*.js`,
`src/layout/measured-pages/broadsheet-*.js`) are yours alone — no announcement
needed.

**Announce a shared-file change BEFORE making it**, not after. A `SHARED:` entry
written after the fact is a collision report, not a warning.

---

## Standing agreements

1. `main` is the trunk. Nobody commits to it directly; Archit's side merges into
   it when a branch is green.
2. Branch names: Om's start with `sakal/`, Archit's with `lokmat/` (the existing
   `lokmat-reference-pages` keeps its name).
3. Push at least once a day, finished or not. Unpushed work is invisible work.
4. `npm test` must be green before any push. If it is not, push anyway on your
   own branch and write `BLOCKED:` — do not sit on a broken tree alone.
5. Never `git push --force`. Never touch the other side's branch.
6. A page is "done" only when all three checks in `OMClaude.md` §7 pass and its
   numbers are written into `docs/REFERENCE-PAGES.md`.

---

## The log

### 2026-09-20 (later) — Archit's Claude — lokmat-reference-pages

DONE:     Worked through a review of the reconstruction pass. Four checks were
          claiming more than they measured, and each correction changed a
          verdict.

          A panel that could not hold its copy said NOTHING - it sets until the
          box is full and stops, and the words it did not set are on no page at
          all. The panel compositor reports what it dropped now, the Space
          panel names it and quotes the first words that went, and preflight
          fails the page for it. "It fits" was a line count, so fresh-copy now
          requires every character set, no display overset, locked sizes
          untouched and legal panel placement - and tests the combinations
          separately. One score for a region is a photograph score, so the
          export check scores every band, panel, rule and picture separately in
          both directions, and refuses a page-size mismatch instead of resizing
          it away. And a mixed-face panel is bracketed run by run.

          Then the front feature's chart, which was bare percentages where the
          reference has three columns with leaders to a figure and a caption.
          New `column` chart kind, drawn from one solve by the canvas and the
          plate.

NUMBERS:  49 panels on the fixture edition were silently dropping copy (the
          calibrated lead package: none). Fresh copy on that package: 3 of 7
          variants pass, and the failures are real. Lead package region scores
          run from 100% on the headline to 45% on the byline panel behind one
          97.8% aggregate. Chart panel canvas-vs-plate 79.4% -> 92.1% within a
          pixel. npm test 1255/1255; 21 browser nets green.

NEXT:     A measured page cannot state a card's type size, so a chart's caption
          is the solver's ceiling rather than the scan's own. The photograph
          replacement crops heads out of a portrait - the frame survives and
          the picture does not; that needs a focal point, not a rectangle. Then
          the whole front page at reading size, and the other eleven.

FINDING:  A SUB-PIXEL RULE IS AS THIN AS THE BROWSER WILL DRAW IT. The canvas
          drew a measured 0.5px (0.25mm) panel rule at 1.87x the plate's
          weight. Four ways of asking were measured at dpr 4.33 - a border, a
          span of that height, a span with a border-top, a background gradient
          sized to it - and ALL FOUR painted 1.87x, the gradient painting
          nothing at a fractional offset. Chrome snaps a sub-pixel rule to
          about one CSS pixel; no technique fixes it, and the one that looked
          cleanest silently stopped drawing the rule in print view. Declared
          rather than hacked. Worth sharing: it bounds what "the canvas and the
          plate agree" can ever mean for fine rules, and any future reference
          page will hit it.

FINDING:  An exact-pixel ink comparison is the wrong instrument for small
          Devanagari, and a single aggregate over a block is a photograph score
          with a rounding error in it. Both now report differently. A number
          that sounds like accuracy ("97.8%") was measuring canvas-to-plate
          proximity over one region, not resemblance to the reference at all.

SHARED:   public/editor/layout/inset-panels.js (panelLayout returns `overflow`),
          public/editor/compose/shaper.js (new `measureTextPx`),
          public/editor/canvas/section-thumb.js,
          public/editor/external-editor/layout-panel.js,
          public/editor/smart-cards/layout.js + smart-cards.js (the `column`
          chart kind), src/services/export/smart-card-lines.js,
          src/services/preflight.service.js (new `panel-overset` check).

### 2026-09-20 — Archit's Claude — main

DONE:     Git and GitHub aligned for two people. `main` now carries all the
          work (it was 73 commits behind, and GitHub's default branch was an
          old `newsroom-workflow`, which is why the repo looked stale to
          anybody visiting it — the default is now `main` and the stale branch
          is deleted). `codex/smart-card-design-variants` was fully contained
          in the current work, so it was fast-forwarded into `main` and the
          branch deleted. `lokmat-reference-pages` is pushed and visible.
          Push and pull both verified against GitHub.

          The front page's `lead` package went through all three acceptance
          checks. Four setting rules the reference needed: greedy line breaking
          (`page_sections.line_breaking`, NULL = balanced as before), a hard
          hyphen as a break opportunity, a panel's own bold face
          (`boldFamily`), and a byline that follows the display type
          (`followDisplay`). The press file was also setting every headline out
          of place — `compose.js` states a baseline as the face's box ascent
          from the band's top, while the browser centres that box in the line
          box, so display type printed 3.08px (13px at 220 dpi) from where the
          desk approved it. The rule now lives in `render.js`
          (`paintedBaseline()`); body copy, drop caps and list markers are
          unchanged to the decimal.

          `docs/REFERENCE-PAGES.md` created — the standing record of how a
          copied page is judged and what still differs on each one.

NUMBERS:  `npm test` 1246/1246. All 21 browser nets green (workspace 224/224,
          editor-parity 92/92, visual-pass 47/47). Lead package ink agreement
          canvas vs press 66.0% → 77.9% exact, 89% → 97.8% within half a page
          pixel. Body column one agrees to line 20 of 33 (was 4).

NEXT:     The front feature strip is a bar chart in the reference and large
          percentages in ours. The other eleven Lokmat pages have not been
          through the three checks as packages.

SHARED:   `public/editor/compose/render.js` (new export `paintedBaseline`),
          `public/editor/compose/compose.js` (`lineBreaking`),
          `public/editor/layout/inset-panels.js` (`boldFamily`,
          `followDisplay`, hyphen breaks), `src/services/export/print-model.js`,
          `src/services/pageSection.service.js`,
          `src/repositories/page.repository.js`, `schema.sql`
          (`page_sections.line_breaking` — apply it by hand),
          `src/layout/measured-pages/index.js` (new).

FINDING:  The measured-page list used to be hand-copied into BOTH
          `templates.js` and `design-recipes.js`. A page added to one and not
          the other gets a layout with no dressing, or a dressing no layout can
          reach, and nothing errors — it is silent until somebody opens the
          page. That is now one list in `measured-pages/index.js`, fixed before
          a second person started adding pages. Worth remembering as a class:
          in this codebase, a catalogue written twice has drifted every single
          time.

FINDING:  An exact-pixel comparison is the wrong instrument for small
          Devanagari type. At 220 dpi a 6px body sets strokes two or three
          pixels wide, so half a pixel of sub-pixel positioning halves an exact
          overlap on a line that is in exactly the right place — a correct page
          scored 66%. Judge on a tolerance figure. And a CMYK plate cannot be
          compared to an sRGB canvas by darkness at all (poppler renders 93%
          black as RGB 50,46,47), only by where the ink is.

---

<!-- Newest entries go directly above this line. -->
