# Typesetting parity audit

Date: 2026-08-12  
Baseline: `0bd3ba4`

SAHAS does not yet have one complete composition authority. The character grid
is already shared by many important paths, but the product still has four
different physical models: grid flow, browser/CSS flow, the legacy layout
metrics estimate, and Scribus frame construction.

## Current consumers

| Consumer | Current measurement | Material divergence |
|---|---|---|
| Shared fit grid | `text-flow.js`: fixed average advance, 1.45 line-height floor, placed-image cells and minimum readable runs | Uses UTF-16 length rather than grapheme/glyph advances; omits kicker, dateline, paragraph/list spacing and image captions. A zero margin is coerced to 12. |
| Legacy metrics | `layout-metrics.js`: independent vertical stack and assumed 3:2 legacy image | Ignores placed-image flow and Smart Cards; fixed padding; can disagree with the Space/overflow grid. |
| Canvas with placed images | `section-thumb.js` pours through grid runs | Dateline is drawn but not budgeted; kicker disappears from flowed mode; captions reserve no cells; headline height is planned before its image-avoiding band narrows. |
| Canvas without images / print view | Browser flex and CSS multicolumn | A different algorithm from placed-image flow; CSS can override stored type; editing/print padding differs. Adding one image changes the composition model. |
| Block Editor | Grid-derived read-only frames plus independent Quill writing flow | Quill can scroll rather than expose overset; preview offsets can differ from the newspaper canvas. |
| Preflight, fit, worklist | Shared grid capacity | Several paths compare raw stored HTML length instead of canonical plain text, producing false overset for rich text. |
| Continuation | Grid capacity plus raw-string splitting | Can split rich markup by string offset; marker cost is not exact; landing quality is not scored. |
| Smart Cards | Flattened body text for capacity, specialized fixed-size HTML for drawing | “Body fits” does not prove the structured card fits; Scribus receives the flattened form. |
| Scribus | Independent kicker/headline/deck multipliers, cursor stacking and its own automatic columns | Does not consume the grid plan; ignores several stored typographic/image settings, runaround, cut-out masks and captions. Largest WYSIWYG risk. |

## Canonical migration direction

The safe seam is a pure composition-plan API rather than another renderer:

```text
normalizeCompositionInput(section, draft, images)
                    ↓
composeBlock(input, measurementAdapter)
                    ↓
headline/deck/body boxes + runs + exclusions + captions
budget + used extent + overflow + diagnostics
```

Initially the adapter remains deterministic and grid-based. Later it can gain
font-aware Devanagari advances without changing every consumer.

Migration order:

1. Normalize plain text and zero-valued settings once; include kicker,
   dateline, caption, continuation markers and every placed image.
2. Make layout metrics, preflight, fit, worklist, AI space and canvas overflow
   consume the same composition result.
3. Route the no-image canvas through the same plan with an empty image list.
4. Pair every Smart Card renderer with a semantic measurement contract.
5. Split continuations over canonical text/rich-text ranges and rank every
   compatible destination using the same plan.
6. Make Scribus consume the canonical frame plan and report export-specific
   overset until shaping parity is verified.

Project B will not silently claim exact glyph-level WYSIWYG. Its quality score
must expose these confidence limits, and its tests will establish shared-plan
parity before tighter browser/export tolerances are introduced.

Required script coverage includes Devanagari clusters and matras, punctuation,
Devanagari numerals, English names inside Marathi copy, rich bold/italic spans,
zero margin, placed/cut-out images, captions, Smart Cards and continuation
markers.
