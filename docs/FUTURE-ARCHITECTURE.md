# Future architecture: where Project A and Project B attach

This is a boundary document, not a design document. It says where the next
two projects meet the system as it exists today, so that building either does
not require rewriting the editor. Neither project is designed here in depth,
and nothing in this file should be read as an implementation plan.

## What exists today, and what it is not

The editor already places blocks and measures type, but it does not do either
of the two things these projects are named for:

- **Placement today is fixed, not computed.** `src/layout/templates.js` holds
  every template's sections as literal `{key, x, y, width, height}` in px.
  Choosing a template picks one of these fixed arrangements; nothing balances
  columns, reflows text across frames, or decides where a block *should* go.
  `src/layout/geometry.js`'s `typeScaleFor()` derives a block's default type
  size from its own dimensions, and `pageSection.service.js`'s `snapGeometry()`
  snaps any drag/resize onto the column grid and baseline — real geometry
  rules, but about one block at a time, never about a page's overall
  composition.
- **Writing today is one block at a time, briefed with a budget it did not
  choose.** `storyWriter.service.js` writes a single block's copy to fit the
  character budget `public/editor/layout/text-flow.js` already measured for
  that block. Nothing decides *which* blocks to fill, in what order, or how
  to trade a shorter headline against a longer photo caption across a whole
  page.

Both projects extend real, working systems — the character grid, the
snap-to-grid geometry, the AI provider/tier/retry layer in `src/services/ai/`
— rather than replacing them.

## Where each project attaches

```
                    ┌────────────────────┐
                    │   Newspaper Data   │   Newspaper → Page → page_sections → news_items → Images
                    └─────────┬──────────┘   (the schema this document does not change)
                              │
                              ▼
                    ┌────────────────────┐
                    │   Layout Engine    │   PROJECT A
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │   Layout Result    │   still page_sections rows: x_px, y_px, width_px,
                    └─────────┬──────────┘   height_px, headline/subheading/body_font_px
                              │
                              ▼
                    ┌────────────────────┐
                    │      Editor        │   unchanged: reads/writes page_sections exactly as now
                    └────────────────────┘
```

```
Articles, images, page constraints
       │
       ▼
AI Composition            PROJECT B
       │
       ▼
Layout Engine              (Project A, called as a service — not reimplemented)
       │
       ▼
Layout Result
       │
       ▼
Editor
```

**The Layout Result is the contract.** Whatever Project A computes has to
come out the other end as ordinary `page_sections` rows — the same shape the
editor already reads via `GET /api/newspapers/:id/pages` and writes via
`pageSection.service.js`. The editor does not need to know a layout engine
produced a placement instead of a drag; a `page_sections` row looks identical
either way. This is what "operate without rewriting the editor" means
concretely: no new fields the canvas has to learn to draw, no second
rendering path alongside `section-thumb.js`.

**Project B sits above Project A, not beside the writer.** `storyWriter.service.js`
already separates "decide the budget" (the character grid) from "fill the
budget" (the AI call) — Project B's composition scoring is a new decision
layer ABOVE that split, choosing which blocks get written and what each is
asked to fill, not a replacement for how a single block gets written once
that decision is made. The verified-information layer (`src/services/information/`)
and the condition-based retry policy (`src/services/ai/conditions.js`) are
already provider-agnostic and block-scoped; Project B calls into them the same
way `write()` does today, it does not reimplement them.

## The one concrete attachment point already reserved

`src/layout/layout.controller.js`, `.service.js`, `.repository.js`, `.model.js`
and `.routes.js` exist and are still 0 bytes — reserved scaffolding, not dead
code (CLAUDE.md's own "Current reality" section says so explicitly). This is
the natural home for whatever new persistent state Project A needs beyond a
`page_sections` row's existing geometry columns (a saved composition, a
column-balance strategy, an overset/reflow record) — a new domain, following
the same Route → Controller → Service → Repository → PostgreSQL shape every
other resource in this codebase already uses. It is not yet clear whether
Project A needs new persistent state at all, or can compute a layout and
write it straight into existing `page_sections` columns; that is a real
design question for Project A's own planning, not answered here.

## What this document deliberately does not do

- It does not choose a layout algorithm, a scoring function, or a data model
  for either project.
- It does not add, rename, or reserve any database column.
- It does not write any code toward either project.

Both projects should be designed on their own, in depth, when work on them
actually begins.
