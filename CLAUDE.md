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

`server.js` is the **only wired entry point**. It defines every HTTP route inline and calls straight into `src/db.js` (a thin facade) → `src/repositories/*.js` (raw parameterized SQL via the shared `pg.Pool` in `src/config/db.js`). The target Route→Controller→Service→Repository layering is **not implemented**.

`src/controllers/`, `src/routes/`, `src/services/`, `src/middleware/`, and `src/layout/layout.*.js` are **all empty (0-byte) scaffolding** from an unfinished migration attempt. Don't assume they do anything — they don't exist at runtime. When doing the layering migration, do it one resource at a time (start with `news`), verify boot + tests after each, small commits.

### Frontend load path

`public/index.html` loads `/app.js`, which dynamically imports, in order:
`editor/publication.js` → `admin/newspaper-workspace.js` → `admin/page-editor.js` → `admin/reporter-browser.js` (empty stub) → `admin/template-selector.js` (empty stub) → `admin.js` (the ~800-line workhorse: login, reporter dashboard, admin dashboard, edition creation).

Several other `public/**/*.js` files are 0-byte stubs not yet built out (`dashboard.js`, `admin/dashboard.js`, `admin/publication.js`, `editor/canvas.js`, `editor/sidebar.js`, `editor/story-explorer.js`, `editor/workspace.js`). Treat these as placeholders for planned features (reporter browsing with filters, template engine UI, etc.) described below — not confirmed-dead code. Don't delete without checking they're truly unused first.

> **This section has drifted from the repository and the repository wins.** `src/controllers/`, `src/routes/`, `src/services/` and `src/middleware/` are no longer empty — they hold real code, and `server.js` mounts them. The workspace now lives under `public/editor/` (`workspace.js` and the `canvas/`, `external-editor/`, `layout/` folders), not `admin/newspaper-workspace.js`. Verify against the tree before relying on the paragraphs above.

### Starting an edition

`POST /api/newspapers/start` is how a day's paper begins, and it is **idempotent per date**: one paper per publication date, so pressing the button twice opens the existing edition rather than making a second one. (Before this existed the database reached 116 editions, most of them empty, and editors could not find the one holding their work.)

Starting an edition also:

- builds the **page ladder** from the page count (`src/layout/ladder.js`) — page one is the front, page two is city news, the last page is the back page, and there is exactly one features page. Never four front pages.
- **carries the booked adverts forward** from the previous edition (`src/services/editionStart.service.js`), and never carries news. An advert is booked for a run of days; a story is not.
- **fills the standing daily features** for the edition's own date.

Asking for more pages adds them at their proper rung. Asking for fewer never removes a page — there may be work on it.

### Type sizes are derived, and fractional

`typeScaleFor()` in `src/layout/geometry.js` sets a block's default type from its size, and the headline may never take more than half the block's usable height at two lines. A rule with a cliff in it (the old "cap at 18px below 160px tall") gives a full-width banner a headline that consumes the whole block, leaving a character budget of **zero** — a hole nothing can be written into. `tests/layout.test.js` holds this: no article block in any layout may be born unable to carry a sentence.

`headline_font_px`, `subheading_font_px` and `body_font_px` are `NUMERIC(5,1)`, not integers — a printer sets type in half points. They therefore arrive over the wire as strings, like the page's mm dimensions; every reader coerces with `Number()`.

### The Newspaper Workspace — single source of truth for templates

The Newspaper Workspace is the heart of SAHAS. Never redirect away from it; everything (page preview, page list, layout picker, editorial editor) happens inside this one screen (`renderWorkspace` in `admin/newspaper-workspace.js`, canvas + section editor in `admin/page-editor.js`).

**Template definitions live in exactly one place: `src/layout/templates.js`**, served to the client via `GET /api/templates`. Each template has a `key`, `name`, and `sections[]` with `{key, x, y, width, height}` in px (base canvas: 660×1060, matching `newspapers.page_width_px`/`page_height_px`). Do **not** hardcode a second copy of template names/section keys anywhere in frontend JS — a prior drifted duplicate (`admin.js`'s old `newspaperTemplates` object, with invented keys like `side`/`bottom1` that didn't exist in the DB) silently broke every section save except `lead`. It was removed; `newspaper-workspace.js` and `page-editor.js` now fetch `/api/templates` and render from real persisted `page.sections` (which already carry position + content, returned by `GET /api/newspapers/:id/pages`).

When adding a new template, add it to `src/layout/templates.js` only — both the picker UI and the canvas pick it up automatically through `/api/templates` and `page.sections`.

## Page model

```
Newspaper → Page → Editorial Block (page_section) → Story (news_item) → Images
```

Each editorial block (`page_sections` row) currently carries: headline, subheading, body, images (via a linked `news_item_id`), reporter, category, location, tags, font sizes, and `ai_notes`. A block can be filled either by writing directly into it or by linking a reporter's submitted story (`news_item_id`), which auto-fills the block's fields — this is deliberate (see Reporter Workflow below), not a duplication bug.

## Reporter workflow

Editors never search a dropdown of thousands of stories. The section editor lists a reporter-story picker (filterable by reporter/category/location/status/date in the eventual full implementation — `admin/reporter-browser.js` is the stub for this). Selecting a story auto-fills the editorial block; everything stays editable afterward.

## Fitting copy to the hole

Copy never arrives the right length, and a sub-editor has exactly three moves. All three exist:

- **Cut it** — the worklist and preflight both say by how many characters.
- **Set it tighter** — `POST /api/pages/:pageId/sections/:sectionKey/fit` finds the smallest type change that makes it fit. `GET` on the same path answers what it *would* do without doing it, because changing a block's type is a design decision. It never goes below 6.5 pt (what preflight fails a page for) and never shrinks a headline to buy room for its own body unless the body alone cannot do it — a headline is the page's hierarchy.
- **Carry it over** — `jump.service.js`, with the two lines a reader follows.

`GET /api/newspapers/:id/worklist` answers "what is left?": every unfinished block in page order, with **the exact number of characters it holds**. That number is knowable before a word is written, and quoting it only after the copy has already run over is the thing this replaces. Never duplicate the measurement — the server imports `public/editor/layout/text-flow.js`, the one character grid, exactly as `editionFeatures`, `jump` and `preflight` do.

## Scribus / PDF export (not yet built)

```
Workspace → Save → Generate Scribus → Editor adjusts → Export CMYK PDF → Upload PDF → Archive
```

Don't redesign this workflow when it lands. `POST /api/newspapers/:id/final-files` already accepts a `.sla` Scribus project and/or a final CMYK PDF and marks the edition `finalised` — this is the upload/archive tail end of that pipeline, already working.

## Engineering rules

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
