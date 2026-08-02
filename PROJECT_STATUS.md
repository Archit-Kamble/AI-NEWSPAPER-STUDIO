# PROJECT_STATUS.md

Architectural audit only. No code was changed to produce this document. Reflects repository state as of this commit.

---

## 1. Current architecture (as documented in CLAUDE.md)

CLAUDE.md commits the project to:

```
Route → Controller → Service → Repository → PostgreSQL
```

with normalized data (`Newspaper → Page → Editorial Block → Story → Images`), explicit px/mm coordinate conversion, and `src/layout/templates.js` as the single source of truth for template layout, served over `GET /api/templates`.

This is the **target**, not the current state. See §2.

---

## 2. Runtime architecture (what actually executes)

**Updated 2026-08-02 (Prompt 2): mixed state.** The News resource now follows the target layering; Newspaper, Page, and Page Section do not yet — see §9 for what changed and why.

```
News:                           Newspaper / Page / Page Section (unchanged):
server.js                       server.js
  ↓ app.use('/api/news', ...)     ↓ inline route handler
src/routes/news.routes.js         ↓ direct call
  ↓                              src/db.js (thin re-export facade)
src/controllers/news.controller.js  ↓
  ↓                              src/repositories/{newspaper,page}.repository.js
src/services/news.service.js        ↓
  ↓                              PostgreSQL
src/repositories/news.repository.js
  ↓
PostgreSQL
```

`src/db.js` is still not a real layer for what it has left (Newspaper/Page/auth) — 12 pass-through functions that just call into repositories. It now exists only for those two not-yet-migrated resources; once Prompt 2's remaining resources (Newspapers, Pages, Page Sections) are migrated the same way News was, `src/db.js` should disappear entirely rather than gain a matching new indirection.

### Frontend load path

`public/index.html` → `/app.js` → dynamic `import()` in this order:

1. `editor/publication.js` (35 lines — final Scribus/PDF upload UI, functional)
2. `admin/newspaper-workspace.js` (161 lines — functional, owns `renderWorkspace`)
3. `admin/page-editor.js` (126 lines — functional, owns canvas + section editor)
4. `admin/reporter-browser.js` (0 bytes — imported but empty)
5. `admin/template-selector.js` (0 bytes — imported but empty)
6. `admin.js` (813 lines — login, both dashboards, edition creation, news CRUD, and the `editNewspaper()` function that hands off into the workspace)

### Live REST surface (News routes now layered per §9; Newspaper/Page/Template routes still defined inline in `server.js`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness |
| POST | `/api/auth/login` | session login |
| GET | `/api/auth/me` | current session user |
| POST | `/api/news` | create news item (multipart, up to 10 images) |
| GET | `/api/news` | list, filter by `status`/`language`/`reporterId` |
| GET | `/api/news/status/:status` | list by status |
| GET | `/api/news/:id` | fetch one |
| PATCH | `/api/news/:id` | update (multipart, replaces images if new ones sent) |
| PATCH | `/api/news/:id/status` | approve/reject/etc. |
| POST | `/api/uploads/images` | standalone image upload, returns URLs |
| POST | `/api/newspapers` | create edition |
| GET | `/api/newspapers` | list, with `page_count` |
| GET | `/api/newspapers/latest` | most recent |
| GET | `/api/newspapers/:id` | fetch one, merged with latest Scribus/PDF file paths |
| PATCH | `/api/newspapers/:id` | update name/status |
| GET | `/api/templates` | **added this session** — serves `src/layout/templates.js` to the client |
| POST | `/api/newspapers/:newspaperId/pages` | create page (applies a template's sections) |
| GET | `/api/newspapers/:newspaperId/pages` | list pages, each hydrated with its sections |
| PATCH | `/api/pages/:pageId` | change a page's template (re-applies section layout) |
| PUT | `/api/pages/:pageId/sections/:sectionId` | write headline/body/etc. into one section |
| POST | `/api/newspapers/:id/final-files` | upload `.sla` and/or CMYK PDF, marks edition `finalised` |
| GET | `*` | SPA fallback to `index.html` |

No versioning, no auth middleware on any route (session is read ad hoc per-handler; nothing blocks a reporter from hitting admin-only endpoints like `PATCH /api/news/:id/status` or the final-files upload — there is no role check anywhere in `server.js`).

---

## 3. Dead code

Confirmed dead — either literally empty or unreachable from any entry point:

**Empty scaffolding (0 bytes), imported nowhere or imported-but-empty:**
- `src/controllers/{auth,newspaper,page}.controller.js` (`news.controller.js` implemented 2026-08-02, see §9)
- `src/routes/{auth,newspaper,page}.routes.js` (`news.routes.js` implemented 2026-08-02, see §9)
- `src/services/{auth,newspaper,page}.service.js` (`news.service.js` implemented 2026-08-02, see §9)
- `src/middleware/{auth,error}.middleware.js` (still empty; `src/middleware/upload.js` is new and non-empty, see §9)
- `src/layout/layout.{controller,model,repository,routes,service}.js`
- `public/admin/dashboard.js`, `public/admin/publication.js`
- `public/editor/{canvas,section-editor,sidebar,story-explorer,workspace}.js`
- `public/dashboard.js`

**Empty but actively imported by `app.js` (imports no-op, harmless today but misleading):**
- `public/admin/reporter-browser.js`
- `public/admin/template-selector.js`

**Non-empty but orphaned — not referenced by any HTML or JS in the project:**
- `public/admin-dashboard.js` (475 lines). Not linked from `index.html`, not imported by `app.js`. A full alternate dashboard implementation that predates the current `admin.js` dashboard and was never deleted.

**Unused database tables** — defined in `schema.sql`, created on every boot, but no repository, route, or frontend code ever reads or writes them:
- `media_assets`
- `section_images`
- `edition_history`

These represent modeled-but-unimplemented features (structured image management, audit trail), not accidental cruft — but today they are pure dead weight: schema exists, nothing populates it.

**Fixed this session** (documented here for the record, not still present): a hardcoded, drifted template catalog in `admin.js` (`newspaperTemplates`, with invented section keys like `side`/`bottom1` that didn't exist in the database) and two functions (`selectPageTemplates`, `showSectionEditor`) that were fully implemented but called by nothing. Removed; superseded by `GET /api/templates` + the real `page.sections` data.

---

## 4. Duplicate logic

- **Two dashboard implementations**: `admin.js`'s `renderAdminDashboard`/`showPastNewspapers`/etc. (live) vs. `admin-dashboard.js` (475 lines, dead but present). Same responsibility, only one wired up. This is exactly the "old vs. new parallel implementation" pattern to avoid going forward — it should be deleted, not left as a silent second copy.
- **Fetch/DOM patterns repeated with no shared helper**: every admin.js function that talks to the API repeats `fetch(...).then(r => r.json())` with no shared request wrapper, no shared error handling, and no shared "render list into container" helper — `showPastNewspapers`, `showPastNews`, `showReporterNewsList` all hand-roll the same list-rendering shape independently.
- **Two independent auth checks**: `server.js`'s `/api/auth/login` checks `user.role !== role` where `role` is guessed client-side from `email.includes("admin")` (see `admin.js:46`) — a role check driven by string-matching an email address on the client, duplicating (poorly) what should be a single server-side authorization decision.
- **`window.*` globals as the de facto state layer**: `admin.js` maintains its own module-scoped `currentNewspaper`/`currentPage`/etc. *and* mirrors nearly the same values onto `window.currentNewspaper`/`window.currentPage`/etc. for `newspaper-workspace.js` and `page-editor.js` to read. Two copies of the same state, kept in sync manually in `editNewspaper()`. Not yet a bug (they're reassigned together), but it's a duplicate-state pattern that will drift the moment one call site forgets to update both.

---

## 5. Remaining technical debt

- **No authorization layer.** Session presence is checked per-route (`req.session.user`), but role (reporter vs. admin) is never enforced server-side. Any authenticated session — or an unauthenticated one, for GET routes — can call any endpoint.
- **No input validation layer.** Route handlers trust `req.body` shape directly (e.g. `payload.title`, `req.body.pageCount`) with only ad hoc `if (!payload.title)` checks; no schema validation anywhere.
- **`px only, mm mentioned but not implemented.`** CLAUDE.md and the edition-creation UI both reference a 330×530mm / 310×510mm print spec, but nothing in the codebase converts between px and mm — the print dimensions are display-only strings in `admin.js`, unconnected to `page_width_px`/`page_height_px` or `src/layout/templates.js`.
- **`src/db.js` facade adds a layer with no purpose.** It re-exports repository calls 1:1 under different names (e.g. `getNewspaper` → `newspaperRepository.findById`). Once the controller/service layer is built, this file should disappear rather than gain a matching new indirection.
- **No image handling for page sections.** `PUT /api/pages/:pageId/sections/:sectionId` accepts no image fields at all — a section only gets images by linking a `news_item_id`, whose images were uploaded separately via `/api/news`. There is no path to attach a standalone image directly to a page section, despite `media_assets`/`section_images` existing in the schema for exactly this.
- **Multer upload directory is unbounded and unmanaged.** `public/uploads/` already has 40+ files from testing; there's no cleanup, no per-newspaper/per-story organization, and uploaded filenames leak directly as public static URLs with no access control.
- **`express-session` uses the default MemoryStore** (no `store` configured) — sessions are lost on every server restart and this is explicitly not production-safe (Express prints a warning about this on boot). Not mentioned anywhere in CLAUDE.md as a known gap.
- **Tests only cover the happy path of 3 flows** (health, reporter multi-image draft/submit, admin section-save + finalize). No coverage for auth, templates endpoint, error responses, or the newspaper/page CRUD surface.

---

## 6. Missing database tables

Per the ChatGPT-proposed target schema, comparing against `schema.sql`:

| Proposed table | Status |
|---|---|
| `users` | ✅ exists |
| `news_items` | ✅ exists |
| `news_images` | ❌ missing — images are a `TEXT[]` column (`news_items.image_urls`), not a normalized child table |
| `newspapers` | ✅ exists |
| `newspaper_pages` | ⚠️ exists as `pages` (different name, same role) |
| `page_sections` | ✅ exists |
| `templates` | ✅ exists (currently just `template_key`/`name`/default page size — no section geometry stored in DB; geometry lives only in `src/layout/templates.js` as code, not data) |
| `template_sections` | ❌ missing — template section geometry is hardcoded in JS, not a queryable table. This is the concrete blocker for Prompt 4 ("backend expands templates... frontend never hardcodes templates") — right now the *backend* still hardcodes them too, just in one JS file instead of many. |
| `publication_files` | ✅ exists |
| `edition_history` | ✅ exists (schema only — unused, see §3) |
| `reporters` | ❌ missing — reporter identity is just `users` rows with `role = 'reporter'`; no reporter-specific fields (beat, contact info, etc.) |

Also present in `schema.sql` but not in the proposed list, and currently unused (§3): `media_assets`, `section_images`.

---

## 7. Missing APIs

- No `GET /api/templates/:key` (single-template fetch — currently only the full list is served).
- No CRUD for `template_sections` (doesn't exist as data yet — see §6).
- No reporter-filtering API (`GET /api/news` supports `status`/`language`/`reporterId` only — no `category`, `location`, `date`, or full-text `search`, and no pagination — needed for Prompt 8's reporter browser).
- No role/permission API or middleware — no `requireAdmin`/`requireReporter` guard exists to hang future authorization on.
- No `DELETE` on any resource (news, newspapers, pages, sections) — creation and mutation only, no removal path anywhere in the REST surface.
- No dedicated image-attach-to-section endpoint (see §5).
- No publication-history read API — `edition_history` table exists but nothing writes or reads it, so "Publication History" (Prompt 9) has no backend to call yet.

---

## 8. Missing frontend modules

Per the current dynamic-import list in `app.js`, these are imported but empty (real gaps, not just naming):
- `admin/reporter-browser.js` — needed for Prompt 8.
- `admin/template-selector.js` — partially superseded by the layout picker already built into `newspaper-workspace.js`; needs a decision on whether this becomes its own module or stays folded in.

Not imported at all today, but implied by the target modular structure (Prompt 10 — "no admin.js larger than 300 lines"):
- A dedicated **page list** module (currently inline in `newspaper-workspace.js`'s `renderPagesList`).
- A dedicated **publication/pipeline** module beyond the current single-purpose `editor/publication.js` (Scribus/PDF upload only — no "Generate," "Publication History," or pipeline-stage UI yet).
- A **canvas/template renderer** separated from the **section editor** (currently both live together in `page-editor.js`, 126 lines — small today, but conflated responsibilities that will grow).
- No shared **API client** module — every file (`admin.js`, `newspaper-workspace.js`, `page-editor.js`, `editor/publication.js`) calls `fetch` directly with its own error handling.

`admin.js` itself (813 lines) still owns: login, both dashboards, edition creation, all news CRUD UI, and the workspace hand-off. This is the concrete gap Prompt 10 targets.

---

## Summary for sequencing

The audit confirms the proposed order is correct: the backend has no service/controller layer (Prompt 2), the template system's geometry is code not data (Prompts 3–4 are prerequisites for a real "backend expands templates, frontend never hardcodes" architecture), and the frontend's biggest concrete risk is the **already-present duplicate dashboard** (`admin-dashboard.js`) plus the **stale `window.*`/module-scope double state** — both should be resolved before Prompt 5 adds more surface area to the workspace.

---

## 9. Update — Prompt 2: News backend layering (2026-08-02)

### Completed work

Migrated the News resource only, per the rules given: `server.js → controllers → services → repositories → PostgreSQL`. Newspaper, Page, and Page Section were not touched — they still run through the old `server.js → src/db.js → repositories` path.

**New/filled files:**
- `src/routes/news.routes.js` — Express router; maps the six existing News paths (`POST /`, `GET /`, `GET /status/:status`, `GET /:id`, `PATCH /:id`, `PATCH /:id/status`) onto controller functions. Mounted in `server.js` as `app.use("/api/news", newsRoutes)`, so every URL is byte-identical to before (`/api/news/status/:status` etc. — no path changed).
- `src/controllers/news.controller.js` — HTTP layer only: reads `req.body`/`req.params`/`req.files`/`req.session.user`, calls the service, maps the service's result to the exact status code and JSON shape the old inline handler produced (200/201/400/404/500, same error message strings).
- `src/services/news.service.js` — business logic moved verbatim from the old inline handlers: title-required validation, image-URL construction from uploaded files, default field values (`""`, `"draft"`), status whitelist (`draft`/`pending`/`approved`/`rejected`), `created_by` resolution (session user → `reporterId` body field → `null`). Calls `src/repositories/news.repository.js` directly — that repository was already pure SQL and needed no changes.
- `src/middleware/upload.js` — new shared module. The generic image-upload `multer` instance (disk storage, 10 files / 10MB, image-mimetype filter) was previously defined once in `server.js` and used by three different routes (News create, News update, and the standalone `/api/uploads/images`). Since News routes now live in their own file, that config had to either be duplicated or shared — it's now defined once here and imported by both `news.routes.js` and `server.js` (which still owns `/api/uploads/images` and the Newspaper `final-files` upload, both out of scope for this prompt).

**Removed:**
- The six inline News route handlers in `server.js` (~100 lines).
- The now-dead News pass-through functions in `src/db.js` (`createNews`, `listNews`, `updateNews`, `getNews`, `getNewsByStatus`) and the `newsRepository` require — nothing else in the codebase called `src/db.js` for News anymore once the routes moved, so leaving them would have been exactly the "second implementation of the same feature" pattern flagged as the thing to avoid. Newspaper/Page functions in `src/db.js` were left untouched, per the rule not to modify those modules yet.

**Decisions made:**
- Used a plain discriminated-return-value pattern in the service (`{ item }` / `{ error }` / `{ notFound: true }`) rather than throwing custom exception classes. This was a deliberate choice to keep the diff a literal "move" of existing if/return logic rather than introducing new control-flow machinery — the original handlers used inline `if`/early-`return` for validation and 404s, not exceptions, so the service mirrors that shape and the controller does the same status-code mapping the old handler did.
- Left `POST /api/uploads/images` in `server.js`, not in the News module. It's not a `news_items` operation (no DB write, no News fields) — it's a generic upload utility that returns raw file URLs, currently only consumed by News-creation flows but not inherently News-domain. Flagging this explicitly in case a future prompt wants it moved into its own `uploads` module instead.
- Did not add a `src/middleware/error.middleware.js` handler for the new News routes — the original inline handlers had no consistent error handling either (5 of 6 routes had zero try/catch and would unhandled-reject on a DB error; only `POST /api/news` wrapped its body in try/catch). The migrated version preserves this exactly, including the crash-on-bad-input behavior on `GET/PATCH /api/news/:id` when `:id` isn't numeric (confirmed via smoke test — this is pre-existing, not introduced by this change). Fixing it is real work but is scope creep for "move logic only, preserve every existing endpoint."

**Verification:** `npm test` (4/4 pass, unchanged), plus a manual smoke test of every News endpoint not covered by the test suite (create validation, get-by-id, 404s, both list routes, status-transition validation, update) confirmed identical status codes and response bodies to the pre-refactor server.

### Remaining technical debt (News module, and backend layering generally)

- **Newspaper, Page, and Page Section are still unmigrated** — `server.js` still holds ~150 lines of inline route logic for those three, and `src/db.js` still exists solely to serve them. This was explicitly out of scope per the rules ("Do not modify Newspaper or Page modules yet") but is the obvious next step to actually retire `src/db.js`.
- **The pre-existing lack of error handling was preserved, not fixed.** `GET /api/news/:id` and both `:id/status`/`:id` PATCH routes will still crash the process on a malformed `:id` (confirmed: `parseInt("abc") → NaN` reaches Postgres as an invalid integer literal, which throws, which is unhandled in an async Express 4 handler with no `try/catch`). This is identical to the original code's behavior, but it's now duplicated across whichever future controllers follow the same pattern unless a shared async-error-catching wrapper or `src/middleware/error.middleware.js` handler is introduced — worth doing once all four resources are migrated, not per-resource.
- **No request validation library.** The service layer still does ad hoc `if (!body.title)` / whitelist-array checks rather than schema validation (e.g. a library, or even a small shared validator). Fine for a literal move; will get repetitive across four services if hand-rolled each time.
- **`src/middleware/upload.js` is now a second thing to keep in sync with `publicationUpload` in `server.js`** — they share `storage` (imported) but have independently-defined `limits`/`fileFilter`. Not a bug (different upload kinds legitimately need different limits), but worth noting since CLAUDE.md flags "duplicated logic" as the exact failure mode to avoid — this is intentionally *not* duplicated (shared `storage`), only the parts that should differ do.
- **No tests were added for the News module.** Coverage is exactly what existed before (the 3 flows in `tests/health.test.js`); the manual smoke test done for this task was not persisted as an automated test. Worth adding `tests/news.test.js` covering the paths that were only manually verified here (404s, status validation, list-by-status) before Newspaper/Page migrate the same way.
