# Copying a printed page: what each measured page is, and what still differs

One entry per measured page in `src/layout/measured-pages/`. A page is not
finished because it looks close in a screenshot - it is finished when it has
been through all three checks below and the differences that remain are named
here with a cause, so the next pass starts from what is actually left rather
than from a fresh impression.

Nothing in this file is the reference's own words, pictures or artwork. It
records what was measured and where the two pages still part company.

## The three checks, and what each one can and cannot see

| | tool | what it proves |
|---|---|---|
| reference → canvas | `scripts/reference-layout/divergence.mjs` | the block's lines break where the printed page's break, and where they first do not - and whether that is our face or our breaker |
| fresh copy | `scripts/reference-layout/fresh-copy.mjs` | the design holds with OTHER news in it - short, typical and long - and anything that will not fit is REPORTED rather than silently shrunk |
| canvas → press | `scripts/reference-layout/export-check.mjs` | the plate prints the page the desk passed |

A comparison image (`compare.py`) is read beside the first of these; it can
show a difference but never explain one, which is why the divergence report
exists. **Judge the export check on its tolerance figure**, never on the exact
one: at 220 dpi a 6px Devanagari body sets strokes two or three pixels wide, so
half a pixel of sub-pixel positioning halves an exact-pixel overlap on a line
that is in exactly the right place. And the plate is rendered from DeviceCMYK,
where poppler puts 93% K at RGB 50,46,47 - so only the geometry of the ink can
be compared between the two surfaces, never how dark it is.

## Reference identity, and the one declared transform

All twelve pages are measured off one file: **Lokmat, Pune Main, 2 September
2026**, the e-paper PDF, whose pages carry no fonts, text or vectors - each is
one JPEG at 2800x4440 (300 ppi), extracted with `pdfimages -j`. So every number
below is read off pixels. The file and its crops are local calibration and are
never committed.

Each page's spec states its own scan box, and `scan.js` scales it onto this
page's matter box (x 20..640). The front page's transform, stated once:

```
editor x = 20 + (scan x - 57) x 0.23074
editor y = 144 + (scan y - 485) x 0.22671
```

**The two scales are not the same**, and that is declared rather than hidden:
`sy/sx` is 0.9825, so the page is set 1.7% shorter than the scan in proportion.
The cause is this paper's own nameplate band, which is deeper than the
reference's, so the matter starts lower and the same blocks have less height to
occupy. A spec may say `uniform: true` to scale by width alone and keep the
scan's proportions exactly, at the cost of leaving the foot short. Never scale
a single block or region to make it agree - a comparison that stretches one
region can make any two pages agree and proves nothing.

---

## broadsheet-front / the `lead` package

The first package taken through all three checks. It carries everything a story
package has - kicker-less locked headline, deck, byline, two photographs, a
caption, three sidebars and four columns of body - so what holds here holds for
most of the paper.

**Fixture**: edition 74362 (a 2099 date), page 1. Calibration copy is local
(`tmp-visual-pass/runs/reference/p1-content.js`); the reference's own lines for
the divergence report are in `p1-lines.js`, also local.

**Faces, each matched by measuring several samples rather than by eye**:

| role | face | evidence |
|---|---|---|
| body | `sans` (Noto Sans Devanagari) 400, 5.75px, pitch 1.24 | best of the regular faces swept over the body's own breaks |
| bold entries and datelines | `mukta-text` 700 | reproduces 8 of 8 of the reference's bold breaks; the sans at 700 reproduces 6 - it sets ~9% wide, which is a word a line |
| headline | `mukta-heavy` 28px, locked | measured against the scan's ink height and stroke |
| deck | `mukta-heavy` 11.4px, locked, `displayLineHeight` 1.33 | as above |

**Results, last run:**

| | |
|---|---|
| body column 1 | 20 of 33 lines agree, first divergence at line 21 |
| caption panel | 4 of 4 |
| scholarship panel | 19 of 19 set, first divergence at line 7 |
| numbered panel | 21 of 21 set, first divergence at line 8 |
| Jarange panel | 12 of 12 |
| fresh copy | design holds at short / typical / long; every overflow reported, nothing shrunk |
| canvas → press | 97.8% of the canvas ink within 2px (77.9% exact) |

**Content requirements** the design asks of whatever news goes in it, derived
from the compositor rather than stated: body up to ~1000 characters, headline 2
lines (up to ~62 characters at its locked size), deck 2 lines, caption ≤360,
scholarship ≤448, numbered ≤510, Jarange ≤377.

### What still differs, and why

| # | where | expected | actual | cause | next step |
|---|---|---|---|---|---|
| 1 | body line 21 | the reference breaks before `होते.` | we carry it up | the reference's own licensed face sets a shade wider than Noto Sans at the same size; the line fits our measure, so our breaker is right and the face is not theirs | none available - the face is not ours to license. Accept, and hold the line count |
| 2 | scholarship line 7, numbered line 8 | as printed | one word later | same as 1 | as 1 |
| 3 | front feature strip | a bar chart | our block shows the same figures as large percentages | the strip was measured as type, not reconstructed as a chart | rebuild it as a chart card - the figures are already in the block |
| 4 | masthead | - | this paper's own nameplate | deliberate: a registered nameplate is never copied | none; declared |
| 5 | whole page | the scan's proportions | 1.7% shorter vertically | our nameplate band is deeper (see the transform above) | declared. `uniform: true` is the alternative and costs a short foot |

---

## The remaining eleven pages

Measured and in the catalogue; none has yet been through all three checks as a
package. Take one story package at a time rather than a whole page: a package
carries every device on the page, and a page that passes as twelve separate
blocks can still read as the wrong page.
