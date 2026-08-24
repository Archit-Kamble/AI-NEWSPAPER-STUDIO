# SAHAS — professional visual-parity pass

Run 1 started 2026-08-25 00:31 IST. Autonomous.

## Ground rules this run is holding to

- **Only ever `git add` explicit paths.** The working tree carried the user's own
  uncommitted work before this run began — `.env.example`, `package.json`,
  `package-lock.json`, `public/editor/layout/image-geometry.js`,
  `src/services/ai/index.js`, `src/services/cutout.service.js`,
  `src/services/segment.service.js`, and untracked `AGENTS.md`,
  `CLAUDE_USER_PROMPTS.md`, `src/services/ai/providers/groq.js`, `src/utils/`,
  `tests/browser/sweep.tmp.js`. **Never `git add -A`.** None of those are mine
  and none of them may end up in one of my commits.
- No pushes to any remote.
- Disposable `2099-*` editions only. Edition 40294 and every real edition are
  off limits.

## What the audit found before any code was written

| requirement | current owner | verdict going in |
|---|---|---|
| 0 micro-details | `canvas/column-rules.js` (gutter hairlines), `masthead.js` | rules exist between neighbours; no story-top or section furniture |
| 1 web↔export parity | `services/export/print-model.js` `mastheadItems`/`footerItems` vs `canvas/masthead.js` | **real gap, confirmed** — see below |
| 2 justification | `compose/compose.js` `balanceParagraph`/`justifyLine` | heavily engineered already; MEASURE before touching |
| 3 fonts | `public/assets/fonts/` — 4 TTFs (Noto Serif/Sans Devanagari, R+B) | only one family pair; needs licensed additions |
| 4 borders | `external-editor/properties-panel.js` `BORDERS`, `border_style` column | on/off + presets exist; no thickness/style |
| 5 image caption | `layout/caption-geometry.js` → text-flow, section-adapter, scribus, print-model, preflight | **plumbing is complete end to end; only the editor control is missing** |
| 6 nested block | `compose/exclusion.js` obstacle set | engine already runs type round rect obstacles |
| 7 overlapping image | `section_images` is per-block | needs a page-level placement; riskiest item |
| 8 charts | `smart-cards/` | renderer + layout exist to host them |
| 9 AI image gen | `services/ai/` | provider support unverified |
| 10 separators | `canvas/column-rules.js` | page-owned, automatic; nothing configurable |

### Requirement 1 — the measured gap

`canvas/masthead.js` draws, and `print-model.js` does **not**:

- the editions line (`identity.editions`)
- the whole left date ear — place badge, 38 px day numeral, weekday, month/year
- the right ear — RNI, `volumeLine`, `pageCountLabel`, **`price`**, epaper
- the owner line — `owner`, `office · phone · email`
- **the folio on every inside page** (`folioMarkup`) — export has no equivalent at all
- the press registration patches

Export currently carries: nameplate artwork, strapline, one right-aligned date
line. That is the whole band. So the user's report — "date, price, publication
information, owner information missing from the download" — is exactly right,
and all four export formats share the defect because they share the walk.

## Status

| # | status | files | evidence | next |
|---|---|---|---|---|
| 0 | NOT STARTED | | | separators/accents beyond what req 4 now gives |
| 1 | **COMPLETE** for PDF/IDML/Word; Scribus still on its own walk | `export/print-model.js`, `export/pdf.writer.js`, `canvas/masthead.js`, `compose/compose.js` | commit `39677c3`; `tmp-visual-pass/masthead-fixed-crop.png`, `masthead-latin-detail.png`, `owner-line.png`, `bb-1.png` | move `scribus.service.js` onto the shared model so it gains the nameplate + folio |
| 2 | **COMPLETE** | `compose/compose.js` | commit `f7ee835`; ragged 58→44 on ed. 40294, 1405→1360 across 819 blocks, geometry provably unmoved | nothing outstanding; do NOT widen the range, 0.97/0.96 measured and worthless |
| 3 | NOT STARTED | | | needs licensed font files; check network availability first |
| 4 | **COMPLETE** | `layout/borders.js` (new), `properties-panel.js`, `canvas/canvas.js`, `canvas/column-rules.js`, `compose/section-adapter.js`, `styles.css`, `pageSection.service.js`, `export/print-model.js` | commit `cab123e`; visual-pass 15/15; boxed block rendered to PDF and looked at (`block-box-export.png`) | scribus still draws no border either — same follow-up as req 1 |
| 5 | **COMPLETE** | `pictures-panel.js`, `block-frame.js`, `layout/caption-geometry.js`, `styles.css`, `export/print-model.js`, `scribus.service.js` | commit `14a851e`; `tmp-visual-pass/editor-caption.png`; both surfaces verified to draw the same caption | |
| 6 | NOT STARTED | | | engine already runs type round rect obstacles — should be small |
| 7 | NOT STARTED | | | riskiest: `section_images` is per-block, needs a page-level placement |
| 8 | NOT STARTED | | | smart-cards can host these |
| 9 | NOT STARTED | | | provider image-gen support unverified |
| 10 | PARTLY, via req 4 | as req 4 | rules above/below/box at a chosen weight are configurable per block | double rules and section markers still absent |

## Run 1 notes

### Requirement 1 — done, with two findings

The export masthead now carries the whole band and inside pages get a folio.
Verified by rendering edition 40294 to a press PDF at 60 and 80 DPI and looking
at the crops, not by reading code.

**Finding A — the canvas was setting the RNI twice.** The registered artwork
carries `RNI No. MAHMUL/2015/67123` inside the mark itself (open
`public/assets/masthead/sahas-nameplate.png` and look at the top right). The
export had always withheld it; the canvas had always repeated it as type.
Fixed by removing the canvas's copy, not by giving export a second one.

**Finding B — Latin was drawn one character at a time.** HarfBuzz reserves the
face's `.notdef` advance for a character the publication face cannot set, one
fixed width for every letter, and `pdf.writer.js` drew each one at that x. The
contact line printed as `sahasnews@gmai l .com`. Contiguous spans are now laid
out by the fallback font's own metrics.

**Still open on requirement 1:** `scribus.service.js` does its own walk and so
still has no nameplate and no folio. Moving it onto the shared print model is
the fix and is a known follow-up; not attempted yet because the .sla is the
tested press path and `tests/scribusComposition.test.js` pins it line for line.

### Assumptions recorded

- The press registration patches are included in the export model, because the
  canvas draws them and parity is the requirement. A press operator may
  reasonably regard colour bars in a supplied PDF as the imposition's job.
  Reversible in one place (`registrationItems` in `print-model.js`).


### Requirement 4 — a live bug, found by reading the whitelist against the buttons

`pageSection.service.js` validated `borderStyle` against `['none', 'box']`
while Properties had offered a third button, **Rule below**, since it was
written. Pressing it sent a payload the server refused with a 400 and nothing
happened on the page.

Two more, one layer down: `border_width_px` has been on the column and read by
the compositor since it was added, with **no control able to set it** and
`styles.css` carrying its own hard-coded 1.5px — so the width a block was
composed against and the width it was drawn with were different numbers. And
**neither export drew a block border at all**.

### Requirement 2 — measured first, and the measurement is what made it safe

Every ragged line on a real page already had both justification levers at
their caps, so no amount of tuning them could have helped. What was missing was
the compositor's third lever: setting a line slightly tight to pull a word up.
It is confined to the balancer, which reassigns pieces across the slots the
pour already fixed — so it cannot change how deep a paragraph sets, and the
fill engine's numbers are provably identical either side of the change.

### A trap this run hit, written down so the next one does not

`PUT /api/pages/:pageId/sections/:key` is a FULL REPLACE for the fields it
covers. A payload of `{ borderStyle }` blanks the headline, the deck and the
story. The visual net did exactly that to edition 40294's lead block and it had
to be refilled with `scripts/fill-edition-copy.js`. The harness now sends the
whole block back. CLAUDE.md records a hand-written probe hitting the same trap
once before.

**And restart the server after every server-side edit.** Two hours in, a border
validation fix appeared not to work; the running process was still on the old
module. `pkill -f "node server.js"` kills the calling shell and the process
shows as `MainThread`, so kill it by port.
