# Codex handoff for Claude

This file exists so Claude can inspect Codex's work commit by commit and keep
only the parts that are useful. Do not assume a later commit is better merely
because it is later. The user's direct visual judgment is the acceptance gate.

## Branch policy requested by the user

- New Codex tasks must be developed on their own `codex/*` branch.
- Codex must commit the completed task but must **not merge it**.
- Claude will decide whether to merge, cherry-pick individual commits, or
  discard the branch when Claude usage becomes available again.
- The original public-reader task is isolated on `codex/epaper-public-reader`.
- Its follow-up, current-editor publication and public-radio selection, is
  isolated on `codex/epaper-selection-current-publish` and has not been merged.

## Current Codex task: public e-paper

Claude should review the single commit on `codex/epaper-public-reader` and
merge/cherry-pick/discard it; Codex has not merged it into `main`.

What the branch adds:

- a press-PDF-derived immutable release pipeline in
  `src/services/epaperPublication.service.js`;
- published-only reader/JSON/PNG/PDF routes and newest-first archive;
- high-resolution 1080 px story PNGs using the existing real masthead;
- mobile page navigation, touch swipe, searchable transcripts and system/direct
  share actions in `public/epaper-reader.js`/`public/epaper.css`;
- an E-paper admin screen immediately below Settings with search/view/PDF and
  safe removal of the public derivative;
- a three-step workspace Publish dialog (press pass → final PDF → release);
- production/unit coverage in `tests/epaper.test.js` and
  `tests/production.test.js`.

Architectural decisions worth retaining if the UI is restyled:

- the final PDF, not live editor HTML, is the public visual authority;
- publish swaps a fully built directory before changing public state;
- archive metadata comes from the frozen manifest, not mutable newsroom fields;
- e-paper page/story assets are intercepted before `express.static`, so a
  guessed path cannot bypass publish/unpublish;
- “Delete public copy” unpublishes and removes only generated derivatives; it
  does not delete the edition or final-PDF record;
- adverts, standing features and Smart Cards are intentionally excluded from
  clickable story cards in this task.

Live proof used fixture edition 37673 temporarily and restored it to
`finalised`; no story/layout data was changed and temporary PDF/PNG derivatives
were removed. Screenshots are under `/tmp/sahas-epaper-verification/`. Focused
e-paper/publication/production tests are 14/14 and the final full suite is
870/870; consult `PROJECT_STATUS.md` for the live-proof details.

## Follow-up: publish the current editor and select one public issue

The user needs to publish the current newspaper before Scribus/CMYK PDF is
available, while retaining the strict press-final path. The follow-up branch
adds a distinct **current editor web proof** release route:

- `POST /api/newspapers/:id/publish-current` freezes the live page geometry
  through local Chrome; no PDF and no press-readiness pass are required.
- It keeps `newspapers.status` unchanged. In particular, a draft remains a
  draft and is never misrepresented as press-final.
- E-paper state is now dedicated: `epaper_released_at`, `epaper_selected` and
  `epaper_source`, with a partial unique index allowing exactly one public
  selection. `schema.sql` includes guarded migration/backfill and the local
  database was migrated non-destructively.
- The owner E-paper dashboard is a searchable list. A radio button selects the
  single issue at safe canonical `/epaper`; owner previews/list are desk-only.
  The public URL has no edition ID or write capability. Private release assets
  are available only to a signed-in desk preview.
- A current-date release selects itself by default; otherwise an owner can
  change selection via `POST /api/newspapers/:id/epaper/select`.
- Delete removes only frozen derivatives and e-paper metadata, preserving the
  newsroom / press status and any uploaded final PDF.

Focused tests are now 15/15. A real no-write Chrome render of the user’s four
page edition 13742 created 1320×2120 page PNGs successfully; nothing was
published or altered in that edition during that proof. The user then asked to
release it despite empty blocks: it is now a live selected `editor_snapshot`
(4 pages / 33 story cards), with the edition itself still `draft`. The Node
server was restarted on the follow-up branch and `/epaper` returned 200.

## Follow-up correction: exact editor canvas capture

The first current-editor snapshot was rejected visually: it was an HTML
approximation rather than the newspaper the editor showed. The child branch
`codex/epaper-exact-canvas` replaces it with the real
`public/editor/canvas/canvas.js` renderer in its already-existing print view.
Chrome receives a random one-use, two-minute local route with the persisted
single-page payload, renders the ordinary canvas modules, then captures the
result at 2×. The route cannot enumerate editions, carries no session or write
capability, and is consumed on first read. Do not replace this with a parallel
HTML reflow implementation.

The user’s selected edition 13742 has been republished through this exact path.
Its resulting public 1320×2120 PNG was visually compared with the editor
canvas and matches its masthead, sections, image transforms, newspaper rules,
type and footer.

## Follow-up: simple Publish plus optional e-paper PDF

The branch `codex/epaper-publish-workflow` contains this separate unmerged
commit. It corrects the workflow split the user called out:

- The workspace Publish dialog is now one confirmation that releases the
  current exact editor canvas. It contains no Scribus upload, CMYK PDF,
  sign-off or press-readiness control. Empty blocks are valid and the edition
  status is never changed.
- E-paper management, not Publish, has a **Publish from a finished PDF** form
  with an edition selector. `POST /api/newspapers/:id/epaper/pdf` validates the
  page count, rasterises the PDF, creates the normal immutable page/story
  release and keeps the current radio-selection lifecycle.
- The uploaded web PDF has a new explicit `epaper_pdf` file type and frozen
  source `uploaded_pdf`; it is not saved as `print_pdf`, requires no press
  gate, and cannot accidentally make a draft claim press-final status.
  `schema.sql` alters the check constraint and the local database migration
  was run with the existing `DB_*` connection values.
- Current editor and PDF releases share the same normalized persisted
  editorial-block rectangles. No PDF-only mapper was added; one saved geometry
  source drives reader hotspots and social-card crops. This is exact when the
  uploaded PDF is exported from that same layout. A page-count mismatch returns
  a conflict and removes the failed temporary upload.

Focused e-paper/publication/production testing passed 17/17, including the
new draft PDF release test which confirms unchanged status, `uploaded_pdf`,
the public download and exact frozen/live hotspot equality.

## Follow-up: repair exact current-canvas hotspot scale

`codex/epaper-hotspot-alignment` is a separate unmerged child branch. The
private e-paper edition 13542 exposed a real mismatch: saved block rectangles
were correct, but the capture canvas was silently re-scaled to editor Fit by a
ResizeObserver after `epaper-canvas-capture.js` had cleared the first transform.
The page PNG painted at 0.927× while its red click map and story crop remained
at true page coordinates. The fix is deliberately tiny and at the correct
boundary: the one-use capture HTML applies
`.newspaper-canvas { transform:none!important }`, preventing any later editor
Fit transform. A browser proof reads the lead's exact stored 137/144/229/248
rectangle on a 660×1060 capture surface. Do not compensate by modifying
manifest percentages or adding a second crop map.

## Follow-up: manual released e-paper map editor

`codex/epaper-map-editor` is a separate unmerged branch. It is the deliberate
answer to the remaining uploaded-PDF case: a PDF made outside the editor can
have correct pages but story rectangles different from the saved editor layout.

- Every released issue now has **Map blocks** in desk E-paper management.
  It shows the actual released page raster with selectable overlay blocks;
  operators drag/move, resize from all four corners, enter X/Y/width/height,
  add titled manual blocks and delete wrong blocks.
- `PATCH /api/newspapers/:id/epaper/map` writes only the frozen release
  manifest. Existing released story text cannot be altered through this route.
  Save recrops/rebuilds that page's 1080 px branded PNG cards and atomically
  swaps the release directory; it never touches live `page_sections`.
- The map has a revision guard, so a stale second browser window gets a conflict
  instead of overwriting a newer map. This applies to both `uploaded_pdf` and
  `editor_snapshot` releases, but is desk-only and does not change safe public
  `/epaper` URL behavior.
- The optional PDF publisher replaces its Edition dropdown with date plus
  searchable results; owner/archive search supports English forms such as
  `15 Aug 2099` for Marathi-date editions. Reader sharing controls are compact
  icon-led groups, and double-clicking a news block downloads its PNG directly.

Focused `epaper` + `epaperPublication` tests pass 9/9, including a real
uploaded-PDF fixture that adds a manual block, writes its story PNG and proves
the live layout's hotspots are untouched.

The final small reader follow-up on the same branch removes the “All editions”
header button and adds an explicit lion crop from the real masthead. It also
makes the limits of social handoff explicit: Send and Facebook share links can
open their services directly, while Status/Story/Post must hand a PNG to the
installed app through the OS share sheet; desktop downloads the PNG and opens
the relevant web app. A browser cannot target/publish to a user’s private
Status or Story directly. Focused reader tests pass 6/6.

## Codex-era commits after the imported Claude history

The imported handoff and `PROJECT_STATUS.md` indicate that the audit/fill work
below was performed after Claude's earlier prompt-1060 implementation. Inspect
each diff directly before retaining it.

| Commit | What it changed | Handoff judgment |
|---|---|---|
| `fd928c5` | Preserved Auto/NULL columns through AI composition. | Narrow consistency fix; tests passed. Likely useful. |
| `4a7d09e` | Centred the date in the Scribus press footer. | Narrow print fix; likely useful. |
| `870dd0b` | Prevented carry-over from overwriting an occupied target or crossing editions. | Safety fix; likely useful. |
| `ace5b28` | Kept verified source evidence on bulk current-news proposals. | Auditability fix; likely useful. |
| `af468cc` | Enforced the controlled newspaper colour palette at save/read boundaries. | Safety/consistency fix; likely useful. |
| `2202e25` | Made the editor/API agree on the measured 1 px minimum block inset. | User later remained unhappy with composition, but the inset itself was measured against page gutters. Re-evaluate visually before keeping. |
| `e634286` | Refreshed page separator rules after a live Box/None change. | Narrow UI consistency fix; likely useful. |
| `e00f678` | Documentation-only closeout for the group audit. | Keep only if its underlying commits are kept. |
| `52c9556` | Made Fill Remaining settle overset/underfill against exact image geometry and restored a browser-test fixture after Smart Card checks. | Exact-fit direction is useful, but re-run live blocks before keeping. |
| `08b2c45` | Restored Claude's earlier composition baseline after a bad experiment. | Baseline/revert bookkeeping, not a feature. |
| `5ac8aa0` | Restored the desk-selected baseline for the next diagnosis. | Baseline/revert bookkeeping, not a feature. |
| `73acb16` | Added a closed-loop 95% body/headline fill path, exact Auto-column fallback, and bounded headline alternatives. | Large behavior change. Unit proofs passed, but the user later reported serious visual regressions. Review carefully and cherry-pick only if live proof agrees. |
| `b592afc` | Standardised default body type at 6.4 editor px (about 9 pt) and tied AI acceptance to a composition fingerprint. | The default-size catalogue is independently useful. The fingerprint safety check is incomplete in workflow terms: a failed/in-flight save can still lead to a proposal that cannot be accepted. Do not keep the acceptance UX unchanged without fixing the save barrier. |
| `160c798` | Changed headline/deck fit to judge the complete multi-line shape and keep the deck subordinate. | The user initially said the three proof bodies were good and asked for headline/deck correction; later complaints continued. Reassess screenshots and exact shapes before retaining. |
| `f7eb009` | Removed the temporary body `contenteditable`, redirected double-click to Quill below, and changed display/body baseline transitions. | **Do not keep the body-edit interaction.** The user explicitly rejected it because it merely moved the problem and still redirects away from the body. The baseline tests may be separable, but the commit should not be retained wholesale. |

## Known unresolved regression at the handoff

`f7eb009` does not satisfy direct body editing. It keeps the exact preview
unchanged but focuses the lower Quill “Body Copy” surface. The user requires
editing at the body itself, without a second browser-flow renderer and without
scrolling/redirection.

AI proposal acceptance can also report:

> The block's type, columns or pictures changed while this was being written.

The guard protects against genuinely stale geometry, but the surrounding save
barrier is not reliable enough: `autosave.flush()` returns while another save
is in flight and also resolves after a failed save, so the writer can measure a
persisted row that is older than the visible draft. Preserve the safety rule,
but repair the save/AI transaction before treating every mismatch as a user
change.

## User-owned uncommitted work that Codex preserved

These files were already dirty/untracked and were deliberately not included in
the composition commits: `.env.example`, `package.json`, `package-lock.json`,
`public/editor/layout/image-geometry.js`, `src/services/ai/index.js`,
`src/services/cutout.service.js`, `src/services/segment.service.js`,
`tests/imageGeometry.test.js`, `tests/sectionImage.test.js`,
`src/services/ai/providers/groq.js`, `src/utils/`,
`tests/groqProvider.test.js`, and `tests/browser/sweep.tmp.js`.

`CLAUDE_USER_PROMPTS.md` and `AGENTS.md` were supplied/recovered context files,
not Codex-authored product changes.
