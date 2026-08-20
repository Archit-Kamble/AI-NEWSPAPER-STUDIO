# Codex handoff for Claude

This file exists so Claude can inspect Codex's work commit by commit and keep
only the parts that are useful. Do not assume a later commit is better merely
because it is later. The user's direct visual judgment is the acceptance gate.

## Branch policy requested by the user

- New Codex tasks must be developed on their own `codex/*` branch.
- Codex must commit the completed task but must **not merge it**.
- Claude will decide whether to merge, cherry-pick individual commits, or
  discard the branch when Claude usage becomes available again.
- The current e-paper task is isolated on `codex/epaper-public-reader`.

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
