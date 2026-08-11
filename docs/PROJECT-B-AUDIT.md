# Project B — composition-quality baseline audit

Date: 2026-08-12  
Starting HEAD: `0bd3ba4` (`PROJECT A: re-verification pass`)  
Worktree at start: clean

This audit was completed before Project B implementation. It separates page
legality from page quality: the reproduced edition passes preflight with zero
findings, but every page contains composition failures visible to a newspaper
editor.

## Reproduction

The running application was used, not a static HTML fixture:

```bash
node scripts/build-test-edition.js
node scripts/screenshot-test-edition.js 9785 /tmp/sahas-project-b-visual.P6Bnez
node scripts/screenshot-test-edition.js 9785 /tmp/sahas-project-b-visual.P6Bnez --print-view
```

- Edition: `9785`, dated `2099-05-01`
- Pages: `18642`, `18643`, `18644`, `18645`
- Carry-over: page 1 `lead` kept 200 characters; 311 landed in page 2
  `right-bottom`
- Preflight: `0 errors / 0 warnings / 0 notes`
- Unit/integration baseline: `npm test` — 374/374 passing
- Editing and print screenshots were opened and inspected for all four pages.

The committed screenshot script scrolls the page canvas underneath the sticky
workspace toolbar. The toolbar consequently covers roughly the top tenth of its
own output, including print-view captures. Clean diagnostic captures were made
by hiding that toolbar in the live DOM; no saved content or page CSS was
changed. Project B must repair the capture script before final QA.

## Page 1 — front

| Area | Visible symptom | Root cause | Scope / owner |
|---|---|---|---|
| Typography | Lead, anchor and sales headline approach the same display weight. | Static type scale sees frame size, not story role or priority. | Architectural — `geometry.js`, `section-thumb.js` |
| Hierarchy | Two photo strips fragment the lead package; the display advert competes with the lead. | Frames have physical kinds but no semantic composition contract. | Architectural — templates and renderer |
| Whitespace / density | Large adverts and several reports contain conspicuous dead lower regions. | Short fixture copy exposes the lack of useful-occupancy analysis and reassignment. | Mixed — fixture + missing balancer |
| Balance | Dense journalism on the lower left opposes sparse advertising on the right. | Geometry is balanced; visual weight is never measured. | Architectural |
| Images | Solid-colour placeholders read as unrelated strips with tiny captions. | Synthetic assets are fixture-specific; absence of a lead-package/image policy is architectural. | Mixed |
| Story types | Lead, secondary reports and briefs mostly use one article treatment. | Section-key inference and `block_type` are not a semantic story model. | Architectural — `section-thumb.js` |
| Advertising | Ads are ordinary story headlines in large boxes with no artwork, offer or CTA hierarchy. | No advert data/treatment contract. | Architectural, exaggerated by fixture |
| Continuation | The marker is legal, but destination selection ignores page composition. | `jump.service.js` considers capacity/emptiness, not hierarchy or balance. | Architectural |
| Rhythm / reading order | Repeated top-aligned rectangles create CMS-card cadence; the entry sequence is fragmented. | No page-level reading-order or treatment variation. | Architectural |
| Editor/final parity | Editing and print padding differ, so wrapping can change. | Renderer CSS changes its content box between modes. | Architectural |

## Page 2 — local

| Area | Visible symptom | Root cause | Scope / owner |
|---|---|---|---|
| Typography / hierarchy | Oversized banner and Sudoku dominate; local stories have weak authority. | Frame-size defaults, no semantic headline fitting. | Architectural |
| Whitespace / density | Left and centre columns are largely empty below short stories. | Fixed 480px assignments and no story/frame balancing. | Mixed |
| Balance | Heavy top and bottom surround a hollow middle; the narrow continuation is denser than its larger neighbours. | No usable-occupancy or half-page weight analysis. | Architectural |
| Images | Centre image creates a narrow prose strip while the lower frame stays empty. | Runaround is safety-correct but no image-treatment planner avoids bad geometry. | Architectural |
| Smart Cards | Sudoku cells stretch into wide rectangles. | Structured renderer fills a shallow frame without enforcing a square board. | Architectural — Smart Card CSS/renderer |
| Continuation | Fixture forces the lead into `right-bottom` despite larger compatible space. | Destination is explicit/first-empty rather than quality-ranked. | Mixed |
| Rhythm / reading order | Banner, three tall slabs and a full-width puzzle make coarse, disconnected zones. | Template geometry is not followed by a composition pass. | Architectural |

## Page 3 — features

| Area | Visible symptom | Root cause | Scope / owner |
|---|---|---|---|
| Typography | Rashi and utility cards stay at 6.5–7px in large frames while the advert receives enormous type. | Fixed Smart Card type and generic article sizing for ads. | Architectural |
| Hierarchy / balance | Half-page horoscope and sparse advert outweigh photo, opinion and data journalism. | Frame area substitutes for editorial priority. | Architectural |
| Whitespace / density | Panchang, Dinविशेष, Suvichar, photo feature and advert all leave avoidable voids. | Cards are structured but not responsive to their measures. | Architectural, fixture-amplified |
| Images | Photo feature creates a narrow text strip and unused lower space. | No photo-feature policy or alternative treatment selection. | Architectural |
| Story types | Opinion and data use generic article composition. | No first-class semantic catalog. | Architectural |
| Advertising | The headline-only advert becomes the strongest page object. | Generic story renderer is used for commercial creative. | Architectural |
| Smart Cards | Rashi is twelve tiny rows with no zodiac identity; Suvichar is a tiny quote in a large void. | One fixed renderer scale, no card-specific measurement contract. | Architectural |
| Reading order / rhythm | The eye jumps from dense Rashi to sparse utility boxes and a dominant advert; opinion is buried. | No page-level hierarchy or visual-weight plan. | Architectural |

## Page 4 — dense inside

| Area | Visible symptom | Root cause | Scope / owner |
|---|---|---|---|
| Typography / hierarchy | Most of thirteen lower items use nearly identical scale. | Dense section names do not carry semantic roles or priority. | Architectural |
| Whitespace / density | One or two lines sit above large empty regions in most frames. | Fixture copy is short and no balancing pass reallocates it. | Mixed |
| Balance | Purple anchor image concentrates weight at upper left; the rest is pale despite geometric symmetry. | Visual occupancy is not measured. | Architectural |
| Images | Anchor image leaves a narrow prose sliver and tiny caption. | No policy relates aspect ratio and prose measure to frame. | Architectural |
| Story types / rhythm | Repeated 4×2 rectangles resemble a dashboard rather than a page of news. | One generic article renderer, no controlled variation. | Architectural |
| Advertising | `foot-right` contains sales copy but is classified and rendered as editorial. | Fixture semantics and template metadata disagree; no semantic validation. | Mixed |
| Reading order | The brief matrix has no meaningful sequence after the anchor. | No priority/prominence or geometric reading-order analysis. | Architectural |

## Systemic causes

1. Templates describe legal rectangles, not semantic composition goals.
2. `block_type` describes the physical slot/work (`article`, `briefs`, `photo`,
   `advert`, `feature`) but the schema has no independent story type or
   editorial priority.
3. The page renderer uses one main article composition for most meanings and
   still infers several roles from section keys.
4. Preflight answers “may this print?”; nothing currently answers “is this a
   well-composed newspaper page?”
5. A placed image is excluded accurately enough for safety, but no planner
   chooses a good image/body relationship.
6. Advertisements and Smart Cards lack measure-aware composition policies.
7. Continuation is capacity-safe but not quality-aware.
8. Editing and print use the same data but not invariant content-box metrics.
9. The fixture's short text and synthetic images exaggerate the symptoms, but
   they correctly expose architectural underfilling and weak hierarchy.

## Implementation boundary

`validatePageLayout()` remains the correctness/safety API. Project B will add a
separate deterministic `analyzeLayout()` quality API, a semantic story-policy
catalog, frame-aware headline fitting, and a page-level balancing proposal.
AI will not receive or control physical coordinates.

