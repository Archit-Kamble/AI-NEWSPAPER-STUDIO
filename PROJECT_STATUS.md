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

**Updated 2026-08-02 (Prompt 5): fully layered.** News, Newspaper, Page, and Page Section all now follow the target layering — see §9, §10, §11, §12 for what changed and why. `server.js → src/db.js → repository` no longer exists as a path for any resource.

```
server.js
  ↓ app.use('/api/news', ...)
  ↓ app.use('/api/newspapers', ...)
  ↓ app.use('/api', pageRoutes)
src/routes/{news,newspaper,page}.routes.js
  ↓
src/controllers/{news,newspaper,page,pageSection}.controller.js
  ↓
src/services/{news,newspaper,page,pageSection}.service.js
  ↓
src/repositories/{news,newspaper,page,publication}.repository.js
  ↓
PostgreSQL
```

Page Section's controller/service (`pageSection.controller.js`, `pageSection.service.js`) are nested inside the same `page.routes.js` router as Page itself, since both live under the `/api/pages/:pageId/...` URL space that router already owns — see §12.

`src/db.js` is now down to a single export, `authenticateUser` (auth was never in scope for this migration series — see §12's note on why it wasn't deleted). Every other resource has been fully migrated off it.

### Frontend load path

**Updated 2026-08-02 (Prompt 7): zero `window.*` usage anywhere in `public/`, confirmed by grep.** §13 (Prompt 6) got the editor's six core modules off `window.*`; this pass (§14) found and fixed two more stub files with the same pattern, plus deleted the last confirmed-dead files.

`public/index.html` → `/app.js` → dynamic `import()` in this order:

1. `editor/publication.js` (34 lines — final Scribus/PDF upload UI; now a proper `export async function showPublicationFiles(...)`, no more `window.showPublicationFiles`. Still dead/unreachable — nothing calls it, see §3 — that's unchanged; only its export mechanism changed, see §14)
2. `admin/reporter-browser.js` (1 line — `export function renderReporterBrowser() {}`, was `window.renderReporterBrowser = function () {}`)
3. `admin/template-selector.js` (1 line — `export function renderTemplateSelector() {}`, was `window.renderTemplateSelector = function () {}`)
4. `admin.js` (~780 lines — login, both dashboards, edition creation, news CRUD; `editNewspaper()` delegates to the Workspace module via a real ES `import`)

`admin.js`'s `import { renderWorkspace } from "./editor/workspace.js"` transitively loads the rest of the editor tree via static ES imports (not side-effect scripts): `editor/workspace.js` (owns the single editor state object, ~140 lines) imports `editor/canvas.js`, `editor/page-sidebar.js`, `editor/layout-sidebar.js`, and `editor/section-editor.js`; `section-editor.js` in turn imports `editor/story-explorer.js`. Six modules, one direction of dependency, zero cycles. **Updated 2026-08-02 (§15):** `story-explorer.js` is no longer a single `<select>` — it's now a search+filter+card browser; see §15.

### Live REST surface (all four resources now layered per §9/§10/§11/§12; only Templates/auth/upload remain inline in `server.js`, and those are out of scope for this migration series — see §7/§8)

| Method | Path | Purpose | Layered? |
|---|---|---|---|
| GET | `/api/health` | liveness | inline |
| POST | `/api/auth/login` | session login | inline |
| GET | `/api/auth/me` | current session user | inline |
| POST | `/api/news` | create news item (multipart, up to 10 images) | ✅ |
| GET | `/api/news` | list, filter by `status`/`language`/`reporterId` | ✅ |
| GET | `/api/news/status/:status` | list by status | ✅ |
| GET | `/api/news/:id` | fetch one | ✅ |
| PATCH | `/api/news/:id` | update (multipart, replaces images if new ones sent) | ✅ |
| PATCH | `/api/news/:id/status` | approve/reject/etc. | ✅ |
| POST | `/api/uploads/images` | standalone image upload, returns URLs | inline (see §9) |
| POST | `/api/newspapers` | create edition | ✅ |
| GET | `/api/newspapers` | list, with `page_count` | ✅ |
| GET | `/api/newspapers/latest` | most recent | ✅ |
| GET | `/api/newspapers/:id` | fetch one, merged with latest Scribus/PDF file paths | ✅ |
| PATCH | `/api/newspapers/:id` | update name/status | ✅ |
| POST | `/api/newspapers/:id/final-files` | upload `.sla` and/or CMYK PDF, marks edition `finalised` | ✅ |
| GET | `/api/templates` | serves `src/layout/templates.js` to the client | inline (own concern, see §10) |
| POST | `/api/newspapers/:newspaperId/pages` | create page (applies a template's sections) | ✅ |
| GET | `/api/newspapers/:newspaperId/pages` | list pages, each hydrated with its sections | ✅ |
| PATCH | `/api/pages/:pageId` | change a page's template (re-applies section layout) | ✅ |
| PUT | `/api/pages/:pageId/sections/:sectionId` | write headline/body/etc. into one section | ✅ **new this session** |
| GET | `*` | SPA fallback to `index.html` | inline |

No versioning, no auth middleware on any route (session is read ad hoc per-handler; nothing blocks a reporter from hitting admin-only endpoints like `PATCH /api/news/:id/status` or the final-files upload — there is no role check anywhere).

---

## 3. Dead code

Confirmed dead — either literally empty or unreachable from any entry point:

**Empty scaffolding (0 bytes), imported nowhere or imported-but-empty:**
- `src/controllers/auth.controller.js` (`news`, `newspaper`, `page` controllers now implemented, see §9/§10/§11)
- `src/routes/auth.routes.js` (`news`, `newspaper`, `page` routes now implemented, see §9/§10/§11)
- `src/services/auth.service.js` (`news`, `newspaper`, `page` services now implemented, see §9/§10/§11)
- `src/middleware/{auth,error}.middleware.js` (still empty; `src/middleware/upload.js` is new and non-empty, see §9/§10)
- `src/layout/layout.{controller,model,repository,routes,service}.js`
- `public/editor/publication.js` is non-empty (34 lines) but still dead/unreachable — `showPublicationFiles` is a proper named export as of §14, but nothing imports/calls it (confirmed via repo-wide grep). It also targets a `#sectionEditor` element that hasn't existed in the workspace markup since before this document's first draft — even if something did call it, it would fail. Deliberately left unconsumed in both §13 and §14: wiring it up would mean adding a new button/panel to the workspace, which is a UI change, out of scope for architecture-only tasks. It's Prompt 9 territory (Publication Pipeline).

**Deleted 2026-08-02 (§14)** — confirmed genuinely unreferenced (repo-wide grep, zero hits) before removal:
- `public/admin-dashboard.js` (475 lines) — the orphaned duplicate dashboard flagged since the very first audit in this document. Not linked from `index.html`, not imported by `app.js`, fully superseded by the live dashboard in `admin.js`.
- `public/admin/dashboard.js`, `public/admin/publication.js`, `public/dashboard.js` — empty (0-byte) stubs, not imported by anything.

**Still empty but actively imported by `app.js` (kept — see below, not the same as the deleted stubs above):**
- `public/admin/reporter-browser.js`, `public/admin/template-selector.js` — as of §14 these are one-line `export function ... () {}` stubs (previously `window.X = function () {}`) rather than 0-byte files. Kept, not deleted: both are actively imported (unlike the deleted files above). **Updated 2026-08-02 (§15):** `reporter-browser.js`'s originally-assumed purpose ("Prompt 8's filterable Story Explorer") has now been fulfilled — but by `editor/story-explorer.js`, not this file (that's where CLAUDE.md's "reporter-story picker" already lived, wired into `section-editor.js` since §13; `admin/reporter-browser.js` was never actually on that call path). This file is now a genuinely undecided stub with no assigned future task, not a scaffold-in-progress — worth an explicit decision (repurpose as a standalone full-page browser distinct from the inline picker, or delete) rather than continuing to carry it as "not yet built." `template-selector.js` is unchanged: still superseded in practice by `editor/layout-sidebar.js`, still no decision made.

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
- ~~**`window.*` globals as the de facto state layer**~~ **Fully fixed 2026-08-02 (§13, completed §14).** `admin.js` no longer holds `currentNewspaper`/`currentPage`, and `grep -rn "window\." public/ --include="*.js"` returns zero results — confirmed empty as of §14. §13 got the editor's six core modules clean; it left two more `window.*` stubs unnoticed (`admin/reporter-browser.js`, `admin/template-selector.js`) that §14 found and fixed. There is now exactly one editor state object, module-scoped inside `editor/workspace.js`, not duplicated anywhere, and no `window.*` state anywhere in the frontend.

---

## 5. Remaining technical debt

- **No authorization layer.** Session presence is checked per-route (`req.session.user`), but role (reporter vs. admin) is never enforced server-side. Any authenticated session — or an unauthenticated one, for GET routes — can call any endpoint.
- **No input validation layer.** Route handlers trust `req.body` shape directly (e.g. `payload.title`, `req.body.pageCount`) with only ad hoc `if (!payload.title)` checks; no schema validation anywhere.
- **`px only, mm mentioned but not implemented.`** CLAUDE.md and the edition-creation UI both reference a 330×530mm / 310×510mm print spec, but nothing in the codebase converts between px and mm — the print dimensions are display-only strings in `admin.js`, unconnected to `page_width_px`/`page_height_px` or `src/layout/templates.js`.
- **`src/db.js` is now a single function.** All four resources (News, Newspaper, Page, Page Section — §9/§10/§11/§12) have been migrated out of it; only `authenticateUser` remains, because Auth was never in scope for this migration series. It stops being a "facade with no purpose" and starts being an honest, minimal auth module the moment it's renamed/relocated accordingly — see §12 for why it wasn't deleted outright.
- **`page.repository.js`'s `updateTemplate` crashes the process on a nonexistent page ID when a template is specified** (confirmed via smoke test during §11 — `PATCH /api/pages/999999` with `{template: "..."}` throws an unhandled Postgres FK-violation error instead of returning 404, because the `UPDATE pages ...` silently matches zero rows and the code proceeds to `INSERT INTO page_sections` anyway). Same class of bug as the News `:id`-crash issue in §9. Now that all four resources are migrated, this is the top candidate for an actual fix (a shared "does this ID exist" guard) rather than more deferral.
- **`page.repository.js`'s `saveSection` silently no-ops on an unknown section key** (confirmed and now covered by a regression test in §12 — `PUT .../sections/bogus-key` returns 200 with the page unchanged, no error surfaced). Not a crash like the above, but still a footgun: a typo'd section key in a future frontend change would silently fail to save with no indication to the user.
- **No image handling for page sections.** `PUT /api/pages/:pageId/sections/:sectionId` accepts no image fields at all — a section only gets images by linking a `news_item_id`, whose images were uploaded separately via `/api/news`. There is no path to attach a standalone image directly to a page section, despite `media_assets`/`section_images` existing in the schema for exactly this.
- **Multer upload directory is unbounded and unmanaged.** `public/uploads/` already has 40+ files from testing; there's no cleanup, no per-newspaper/per-story organization, and uploaded filenames leak directly as public static URLs with no access control.
- **`express-session` uses the default MemoryStore** (no `store` configured) — sessions are lost on every server restart and this is explicitly not production-safe (Express prints a warning about this on boot). Not mentioned anywhere in CLAUDE.md as a known gap.
- **Test coverage has grown across this migration series but auth and templates remain untested.** News, Newspaper, Page, and Page Section all have some coverage now (Page and Page Section have solid automated coverage — 6 and 6 tests respectively; News/Newspaper were only smoke-tested manually, not automated — worth backfilling). No coverage for `/api/auth/*` or `/api/templates`, and the two crash/no-op bugs above are documented rather than regression-tested (one would crash the suite, the other now IS tested — see previous bullet).
- ~~**`editor/page-sidebar.js` renders `page.pageNumber` (camelCase), but the API returns `page_number` (snake_case)**~~ **Fixed 2026-08-02 (§14).** Was a one-line fix; re-verified live via browser test — page buttons now correctly render "1", "2", "3", "4" instead of blank.

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
- No reporter-filtering API (`GET /api/news` supports `status`/`language`/`reporterId` only — no `category`, `location`, `date`, or full-text `search`, and no pagination). **Updated 2026-08-02 (§15):** the Story Explorer's search/reporter/category/location/status filtering is now implemented entirely client-side, over the single already-fetched `GET /api/news` array — a deliberate workaround since the task's constraints ruled out backend API changes. This is fine at today's data volume but doesn't scale: every filter keystroke re-scans the full in-memory list, and the client downloads every news item up front regardless of whether it'll ever be shown. A server-side `?search=&category=&location=` querystring plus pagination is still the real fix, and is now a slightly more concrete ask than before this session.
- No role/permission API or middleware — no `requireAdmin`/`requireReporter` guard exists to hang future authorization on.
- No `DELETE` on any resource (news, newspapers, pages, sections) — creation and mutation only, no removal path anywhere in the REST surface.
- No dedicated image-attach-to-section endpoint (see §5).
- No publication-history read API — `edition_history` table exists but nothing writes or reads it, so "Publication History" (Prompt 9) has no backend to call yet.

---

## 8. Missing frontend modules

**Updated 2026-08-02 (Prompt 6):** the editor is now genuinely split — `editor/{workspace,canvas,page-sidebar,layout-sidebar,section-editor,story-explorer}.js`, see §13. What's below reflects what's still missing after that split.

**Updated 2026-08-02 (§15):** ~~`admin/reporter-browser.js` — a richer, filterable reporter browser (Prompt 8) is still not built. `editor/story-explorer.js` (§13) is deliberately the small version of this — a single-select dropdown~~ — **done, see §15**, but landed in `editor/story-explorer.js` (search by title, filter by reporter/category/location/status, story cards with thumbnail/headline/reporter/category/date) rather than in `admin/reporter-browser.js`. `admin/reporter-browser.js` itself is still an empty stub — see the updated note in §3 on why it's now a genuinely undecided placeholder rather than "not yet built."

Per the current dynamic-import list in `app.js`, still imported but empty (real gap, not just naming):
- `admin/template-selector.js` — still superseded by `editor/layout-sidebar.js`; still needs an explicit decision on whether this stub gets deleted or repurposed for something Prompt 4's template-engine work will need.

Not imported at all today, but implied by the target modular structure (Prompt 10 — "no admin.js larger than 300 lines"):
- A dedicated **publication/pipeline** module beyond the current single-purpose (and still dead — see §3) `editor/publication.js`.
- No shared **API client** module — every editor module (`workspace.js`, `layout-sidebar.js`, `section-editor.js`) still calls `fetch` directly with its own inline error handling; `workspace.js` in particular now owns 5 separate fetch call sites. Worth a thin shared wrapper once a sixth or seventh shows up.

`admin.js` is down to ~780 lines after §13 removed the window-syncing code from `editNewspaper()`, but still owns: login, both dashboards, edition creation, and all news CRUD UI. Still the concrete gap Prompt 10 targets — the editor split didn't touch `admin.js`'s other responsibilities, only how it hands off into the workspace.

---

## Summary for sequencing

The audit confirms the proposed order is correct: the backend has no service/controller layer (Prompt 2), the template system's geometry is code not data (Prompts 3–4 are prerequisites for a real "backend expands templates, frontend never hardcodes" architecture), and the frontend's biggest concrete risk is the **already-present duplicate dashboard** (`admin-dashboard.js`) plus the **stale `window.*`/module-scope double state** — both should be resolved before Prompt 5 adds more surface area to the workspace.

**Updated 2026-08-02 (Prompt 3):** News and Newspaper are now both layered (§9, §10). Only Page and Page Section remain on the old `server.js → src/db.js → repository` path — `src/db.js` is down to `authenticateUser` + 5 Page functions and should be the next and final target before it's deleted outright.

**Updated 2026-08-02 (Prompt 4):** Page is now layered too (§11). Only Page Section remains on the old path — `src/db.js` is down to exactly 2 exports (`authenticateUser`, `savePageSection`). Migrating Page Section is now the only thing standing between the current state and deleting `src/db.js` entirely.

**Updated 2026-08-02 (Prompt 5):** Page Section is now layered (§12) — the fourth and final resource in this migration series. `src/db.js` is down to exactly `authenticateUser` and was **not** deleted: it's still required by `server.js`'s login route, and Auth was never part of this migration's scope (it has its own untouched empty scaffolding — `src/{controllers,routes,services}/auth.*` — that a future, explicitly-scoped Auth migration would fill in). The Route→Controller→Service→Repository layering CLAUDE.md calls for is now real for every content resource in the system; what's left inline in `server.js` (auth, templates, uploads) is inline by scope decision, not by omission. See §12's "Next recommended migration" for what that Auth migration would look like.

**Updated 2026-08-02 (Prompt 6):** the backend series (§9–§12) is done; this session was the first to touch the frontend since the workspace-duplication fix that predates this document. The **stale `window.*`/module-scope double state** flagged above as a risk back at the top of this document is now fixed (§13) — `admin/newspaper-workspace.js` and `admin/page-editor.js` are deleted, replaced by a six-module `editor/*.js` tree with one state object and zero `window.*` reads/writes anywhere in the live app. The **already-present duplicate dashboard** (`admin-dashboard.js`) flagged in that same original risk callout is still present and still not addressed — it wasn't in scope for this session's task (editor architecture only) and remains the next concrete cleanup opportunity alongside Prompt 10's admin.js size target.

**Updated 2026-08-02 (Prompt 7):** the two loose ends §13 left — `admin-dashboard.js` still present, and `window.*` not fully eliminated — are both closed now (§14). `grep -rn "window\." public/ --include="*.js"` returns nothing; `public/admin-dashboard.js`, `public/admin/dashboard.js`, `public/admin/publication.js`, and `public/dashboard.js` are deleted (all confirmed unreferenced first). The editor cleanup this document has been tracking since §13 is complete: one state object, six modules, zero duplicate implementations, zero dead-file clutter left over from the pre-this-document era.

**Updated 2026-08-02 (Story Explorer):** `editor/story-explorer.js` is now the production-ready filterable browser this document has been calling "Prompt 8" since §8/§13 — search by title, filter by reporter/category/location/status, story cards with thumbnail/headline/reporter/category/created-date, click-to-populate into the selected section (§15). It landed in the file already wired into `section-editor.js` since §13, not in `admin/reporter-browser.js`, which this document had assumed (per CLAUDE.md's own wording) would eventually become this feature — see §3 for the correction. Filtering is entirely client-side over the existing `GET /api/news` response, per this task's "no backend API changes" constraint; §7 now documents that as a real (if currently fine) scaling limit rather than a pure gap.

---

## 9. Update — Prompt 2: News backend layering (2026-08-02)

### Completed work

Migrated the News resource only, per the rules given: `server.js → controllers → services → repositories → PostgreSQL`. Newspaper, Page, and Page Section were not touched — they still run through the old `server.js → src/db.js → repositories` path.

**New/filled files:**
- `src/routes/news.routes.js` — Express router; maps the six existing News paths (`POST /`, `GET /`, `GET /status/:status`, `GET /:id`, `PATCH /:id`, `PATCH /:id/status`) onto controller functions. Mounted in `server.js` as `app.use("/api/news", newsRoutes)`, so every URL is byte-identical to before (`/api/news/status/:status` etc. — no path changed).
- `src/controllers/news.controller.js` — HTTP layer only: reads `req.body`/`req.params`/`req.files`/`req.session.user`, calls the service, maps the service's result to the exact status code and JSON shape the old inline handler produced (200/201/400/404/500, same error message strings).
- `src/services/news.service.js` — business logic moved verbatim from the old inline handlers: title-required validation, image-URL construction from uploaded files, default field values (`""`, `"draft"`), status whitelist (`draft`/`pending`/`approved`/`rejected`), `created_by` resolution (session user → `reporterId` body field → `null`). Calls `src/repositories/news.repository.js` directly — that repository was already pure SQL and needed no changes.
- `src/middleware/upload.js` — new shared module. The generic image-upload `multer` instance (disk storage, 10 files / 10MB, image-mimetype filter) was previously defined once in `server.js` and used by three different routes (News create, News update, and the standalone `/api/uploads/images`). Since News routes now live in their own file, that config had to either be duplicated or shared — it's now defined once here and imported by both `news.routes.js` and `server.js` (which still owns `/api/uploads/images`, out of scope for this prompt; `publicationUpload` was also here at the time but has since moved into this same module too, see §10).

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

---

## 10. Update — Prompt 3: Newspaper backend layering (2026-08-02)

### Completed work

Migrated the Newspaper resource only, following the same pattern as News (§9): `server.js → controllers → services → repositories → PostgreSQL`. News stayed as §9 left it; Page and Page Section were not touched — both still run through `server.js → src/db.js → src/repositories/page.repository.js`.

**New/filled files:**
- `src/routes/newspaper.routes.js` — Express router covering all six existing Newspaper paths: `POST /`, `GET /`, `GET /latest`, `GET /:id`, `PATCH /:id`, `POST /:id/final-files`. Mounted in `server.js` as `app.use("/api/newspapers", newspaperRoutes)`. Route order inside the router matches the original registration order (`/latest` before `/:id`) so the literal path `/api/newspapers/latest` still resolves to the `latest` handler rather than being swallowed by `:id`.
- `src/controllers/newspaper.controller.js` — HTTP layer only: reads `req.body`/`req.params`/`req.files`/`req.session.user`, calls the service, maps results to the exact status codes/response shapes the old inline handlers produced.
- `src/services/newspaper.service.js` — business logic moved verbatim: create defaults (`name` → `'साहस'`, `date` → today, `createdBy` → session user or `null`), `getNewspaper` merging in the latest Scribus/PDF paths (the `withPublicationFiles` helper, moved out of `server.js` unchanged), and `saveFinalFiles` (validates at least one file present, 404s on missing newspaper, writes to `publication_files` via the existing `publicationRepository`, flips `status` to `finalised` only when a print PDF was uploaded — matching the original's asymmetric behavior exactly: uploading only a `.sla` does *not* finalise the edition). Calls `newspaperRepository` and `publicationRepository` directly — both already pure SQL, neither needed changes (rule: reuse existing repositories).
- `src/middleware/upload.js` — extended with `publicationUpload` (the Scribus/PDF-specific multer instance: 2 files / 50MB, `.sla`/PDF filename+mimetype filter), moved out of `server.js` and imported by `newspaper.routes.js`. `server.js` no longer defines any multer instance itself.

**Removed:**
- The six inline Newspaper route handlers in `server.js`, including the `withPublicationFiles` local helper (~85 lines total).
- The now-dead Newspaper pass-through functions in `src/db.js` (`createNewspaper`, `updateNewspaper`, `listNewspapers`, `getNewspaper`, `getLatestNewspaper`) and the `newspaperRepository` require, per the explicit rule to remove dead Newspaper helpers after migration. Page functions in `src/db.js` are untouched.
- `publicationRepository`'s direct require in `server.js` (no longer used there — only the newspaper service needs it now).

**`server.js` is now, per rule 10, only:** Express app setup (json/urlencoded/static/session middleware), the multer error-handling middleware, route registration (`app.use` for News/Newspaper routers, inline handlers for the still-unmigrated Page/Template/auth/upload routes), and the SPA fallback. No business logic, no direct repository calls, no multer instance definitions remain in it.

**Decisions made:**
- Kept `GET /api/templates` inline in `server.js`, not folded into the Newspaper module. It serves `src/layout/templates.js`, not the `newspapers` table — it's a distinct Templates concern (already tracked as its own future migration target, Prompt 4), not Newspaper data.
- `saveFinalFiles`'s asymmetric finalise-only-on-PDF behavior was preserved exactly rather than "fixed," even though it reads like it could be an oversight (uploading a `.sla` alone leaves status `draft`) — rule 8 forbids introducing new business logic during a pure move, so this stays as-is; flagging it in case it's actually a bug worth a follow-up decision.
- Verified the router-mounting boundary explicitly: since `app.use('/api/newspapers', newspaperRoutes)` sits before the still-inline `POST/GET /api/newspapers/:newspaperId/pages` handlers, there was a real risk the Newspaper router's `/:id` or `/:id/final-files` patterns could shadow `/:newspaperId/pages`. Confirmed via smoke test (a page-create call under a real newspaper ID succeeded and returned hydrated sections) that Express's exact-segment-count matching means no collision — Page routes need no changes to keep working.

**Verification:** `npm test` (4/4 pass, including the existing final-files integration test), plus a manual smoke test of every Newspaper endpoint not covered by the suite (create, list, latest, get-by-id, both 404 paths, update, final-files 400/404 paths, and the Page-route boundary check above) — all status codes and response bodies identical to the pre-refactor server. Smoke-test data (one newspaper row, three uploaded files) was cleaned up afterward.

### Remaining technical debt (Newspaper module, and backend layering generally)

- **Page and Page Section are the last resources on the old path.** `src/db.js` is now just `authenticateUser` + 5 Page functions (`createPage`, `updatePage`, `listPages`, `addArticleToPage`, `savePageSection`) — migrating Page the same way would let `src/db.js` be deleted entirely rather than shrink further.
- **The `addArticleToPage` function is dead code that will need a decision, not a migration.** It's exported from `src/db.js` but nothing in `server.js` calls it — it just `throw`s "Use savePageSection with a section key". Worth confirming it's genuinely unreferenced (frontend included) before dropping it when Page is migrated, rather than mechanically porting a function that exists only to throw.
- **Same pre-existing gaps as §9 apply here too**, now confirmed present in Newspaper's routes as well: no auth/role enforcement (any session can finalise any edition or rename it), no request validation beyond ad hoc checks, and no automated test coverage beyond what already existed (this session's smoke test was manual only, not persisted as `tests/newspaper.test.js`).
- **`withPublicationFiles` and `saveFinalFiles` both duplicate the "merge latest Scribus/PDF paths onto a newspaper" shape in spirit** — `getNewspaper` calls `withPublicationFiles` to attach existing files, while `saveFinalFiles` builds `response = { ...newspaper }` and attaches new files field-by-field separately. Not literal code duplication (different inputs: reading vs. just-uploaded), but the same conceptual shape twice in one service file — worth a small shared helper if a third call site for "newspaper + its files" ever shows up; not worth doing for two call sites.

### Next recommended migration

**Page and Page Section**, in that order (Page section-editing logic already depends on Page existing). This is explicitly the next step per the roadmap and is now the only thing keeping `src/db.js` alive — after it, `src/db.js` can be deleted outright rather than migrated down to zero functions and left as an empty file. It's also the largest remaining resource: `PUT /api/pages/:pageId/sections/:sectionId`'s field-mapping block in `server.js` (newsItemId/headline/subheading/body/fontPx fields, etc.) is the single largest inline handler left, so budget for it accordingly.

---

## 11. Update — Prompt 4: Page backend layering (2026-08-02)

### Completed work

Migrated the Page resource only (create/list/update-template), following the same pattern as News (§9) and Newspaper (§10): `server.js → controllers → services → repositories → PostgreSQL`. Page Section (`PUT /api/pages/:pageId/sections/:sectionId`) was explicitly excluded and stays on the old `server.js → src/db.js → page.repository.js` path, still calling `savePageSection`.

**New/filled files:**
- `src/routes/page.routes.js` — Express router covering the three Page paths: `POST /newspapers/:newspaperId/pages`, `GET /newspapers/:newspaperId/pages`, `PATCH /pages/:pageId`. **Mounted at the broad `/api` prefix** (`app.use("/api", pageRoutes)`), not `/api/newspapers` or `/api/pages` — because Page's own two paths live under *two different* URL prefixes, one of which (`/api/newspapers`) is already owned by the Newspaper router that this task must not touch. Defining full sub-paths inside `page.routes.js` and mounting it at `/api` reproduces the exact same URLs without adding a single line to `newspaper.routes.js`.
- `src/controllers/page.controller.js` — HTTP layer only: same status codes/response shapes as the inline handlers.
- `src/services/page.service.js` — business logic moved verbatim: `createPage` builds the repository call from `pageNumber`/`templateKey`/`template` (silently dropping `sectionName`/`language`, which the original also received but never used — preserved as dead parameters, not "cleaned up"), `updatePage` keeps the exact original branch (`if no templateKey/template given, return findById; else call updateTemplate`). Calls `pageRepository` directly, unchanged (rule: reuse existing repository).

**Removed:**
- The three inline Page route handlers in `server.js` (~25 lines).
- The now-dead Page pass-through functions in `src/db.js` (`createPage`, `updatePage`, `listPages`) and the now-fully-dead `addArticleToPage` (confirmed via repo-wide grep: exported from `src/db.js`, imported into `server.js`, but never called anywhere — not by any route, not by frontend, not by tests. §10 flagged this as needing a decision before dropping; decision made: it's genuinely dead, removed). `savePageSection` and the `pageRepository` require stay in `src/db.js`, since Page Section is out of scope.

**`server.js` is now, per rule 10, only:** Express app setup, the multer error-handling middleware, route registration (`app.use` for News/Newspaper/Page routers plus the still-inline Page Section/Template/auth/upload routes), and the SPA fallback.

**Decisions made:**
- Mounted `page.routes.js` at `/api` rather than trying to force it under `/api/newspapers` or `/api/pages` — see above. Verified this doesn't shadow anything: `app.use('/api', pageRoutes)` only intercepts requests whose remaining path matches `/newspapers/:newspaperId/pages` or `/pages/:pageId` exactly; the still-inline `PUT /api/pages/:pageId/sections/:sectionId` (3 segments after `/api/pages`) and the Newspaper router's own routes (all mounted more specifically at `/api/newspapers`, registered earlier) are structurally unreachable from `pageRoutes`' patterns regardless of registration order.
- Kept `templateKey`/`template` field-name duplication in `createPage`/`updatePage` (both accepted, `templateKey` preferred) exactly as the original did, rather than picking one — not this task's call to make.
- Did not touch `page.repository.js`'s `updateTemplate`, even after discovering it crashes the process on a nonexistent page ID (see Remaining technical debt). Rule 8 forbids new business logic during a pure move; a null/existence check there is a real fix, not a relocation, so it's flagged rather than made.

**Verification:**
- `npm test`: all 4 pre-existing tests still pass, plus 6 new tests added in `tests/page.test.js` (10/10 total) — see rule 11 below.
- Manual smoke test of every Page endpoint not fully covered by the automated suite: create with explicit template, create with default template, create a second page, list pages for a newspaper, update template (with section-key verification), update with no template field (no-op), update on a missing ID (404, using the non-crashing no-template-field path — see below).
- Explicit boundary verification: newspaper routes (`get by id`, `latest`, `list`) all still 200 after mounting `pageRoutes`; the Page Section `PUT .../sections/:key` route still works; `/api/templates` and `/api/uploads/images` unaffected; server stayed alive throughout.
- Found and did **not** fix a pre-existing crash: `PATCH /api/pages/999999` **with** a `template` field throws an unhandled Postgres FK-violation error and kills the Node process, because `pageRepository.updateTemplate` doesn't check the page exists before inserting into `page_sections`. Confirmed via `git diff`/`git log` that `page.repository.js` was untouched this session (last touched in the Prompt 3 catch-up commit) — this bug predates this task entirely. The new automated 404 test deliberately uses the *other* branch (`PATCH` with no `template` field, which takes the safe `findById` path) to assert 404 without crashing the test run; the crashing case is documented in Remaining technical debt instead of tested, since a test that crashes the process would fail the suite by definition.

### Remaining technical debt (Page module, and backend layering generally)

- **Page Section is the last resource on the old path.** `src/db.js` is now exactly `authenticateUser` + `savePageSection`. Migrating Page Section the same way lets `src/db.js` be deleted outright.
- **The `updateTemplate` crash described above is a real bug**, not just a documentation note — `PATCH /api/pages/:pageId` with a template field and a bad ID currently takes the whole server down, not just that request. Worth a dedicated fix (an existence check before the child-table insert) once Page Section is migrated and this pattern can be addressed consistently rather than piecemeal.
- **Same pre-existing gaps as §9/§10 apply to Page too**: no auth/role enforcement, no schema validation beyond ad hoc field checks.
- **`page.routes.js` being mounted at `/api` (rather than a resource-specific prefix) is structurally sound but easy to misread later** — a future contributor skimming `server.js` might reasonably expect a `pageRoutes` import to only touch `/api/pages`. Worth a one-line comment if this pattern repeats for Page Section (which shares the same `/api/pages/:pageId/...` prefix problem).

### Next recommended migration

**Page Section** (`PUT /api/pages/:pageId/sections/:sectionId`) — the last resource on the old path, and the one with the most inline business logic left in `server.js` (the newsItemId/headline/subheading/body/fontPx field-mapping block). Completing it retires `src/db.js` entirely. It will face the same routing question Page did: Page Section's URL also lives under `/api/pages/:pageId/sections/...`, one segment deeper than what `page.routes.js` already claims (`/pages/:pageId`) — worth deciding whether Page Section gets its own router mounted at `/api` (consistent with this session's approach) or is added as a nested route inside `page.routes.js` itself (arguably more natural now that Page Section is conceptually "under" Page, though the task rules for Page explicitly forbade doing that this time).

---

## 12. Update — Prompt 5: Page Section backend layering (2026-08-02)

### Completed work

Migrated the Page Section resource (`PUT /api/pages/:pageId/sections/:sectionId`) — the fourth and last resource from the original roadmap's "News, then Newspaper, then Page, then Page Section" sequence. `server.js → src/db.js → repository` no longer exists as a path for *any* content resource.

**New files:**
- `src/services/pageSection.service.js` — the field-mapping logic moved verbatim from the old inline handler (newsItemId/sourceNewsId, headline/title, subheading/subtitle, body/description aliasing, plus the font-px/category/location/tags/reporterName/aiNotes passthroughs), followed by the same "write then re-fetch the whole page" shape `savePageSection` in `src/db.js` used to have. Calls `page.repository.js`'s existing `saveSection`/`findById` directly — no repository changes (rule: reuse existing repository).
- `src/controllers/pageSection.controller.js` — HTTP layer only, same 404-on-missing-page / 200-with-full-page-on-success shape as before.

**Decision: no separate router, no separate `app.use` call.** Page Section's URL (`/api/pages/:pageId/sections/:sectionId`) is one segment deeper than the `/pages/:pageId` pattern `page.routes.js` already owns (§11 flagged this exact question as open). Rather than mount a third thing at `/api`, `pageSectionController.update` was added as one more route *inside* the existing `page.routes.js` router:
  ```
  router.put('/pages/:pageId/sections/:sectionId', pageSectionController.update);
  ```
  This answers §11's open question in favor of "nested inside `page.routes.js`" — Page Section is conceptually a sub-resource of Page, they already share a router mounted at the same prefix, and it avoids a fourth `app.use()` line in `server.js` for what would otherwise be a one-route file.

**Removed:**
- The inline `PUT /api/pages/:pageId/sections/:sectionId` handler in `server.js` (~20 lines) and the `savePageSection` entry from the `require("./src/db")` destructure.
- `savePageSection` and the `pageRepository` require from `src/db.js`.

**`src/db.js` was evaluated for deletion and kept.** Per the task's conditional instruction ("delete `src/db.js` if it becomes unused"): after removing Page Section, `src/db.js` exports exactly one function, `authenticateUser` — and that function is still imported and called by `server.js`'s `/api/auth/login` route. It did not become unused, so it was not deleted. Confirmed via a repo-wide grep that `require("./src/db")` has exactly one call site (`server.js`). Auth was never in scope for this four-part migration series (the roadmap's Prompt 2 was explicitly "News, Newspapers, Pages, Page Sections" — no Auth), and `src/controllers/auth.controller.js`, `src/routes/auth.routes.js`, `src/services/auth.service.js` remain the empty scaffolding they've been since before this series started, ready for a future, separately-scoped Auth migration.

**Verification:**
- `npm test`: all 10 pre-existing tests still pass, plus 6 new tests added in `tests/pageSection.test.js` (16/16 total).
- Manual smoke test of the full Page Section surface: direct field names (headline/subheading/body + all three font-px fields + category/location/tags/reporterName/aiNotes, all round-tripped and individually verified), the title/subtitle/description alias path (matching what the pre-existing integration test already exercised), linking a real reporter news item via `newsItemId` (created a live `news_items` row via `POST /api/news`, linked it, verified `news_item_id` on the section), overwriting an already-saved section, a 404 on a nonexistent page, and the silent no-op on an unknown section key (see below).
- Explicit boundary verification: `GET .../pages` (list), `PATCH /api/pages/:id` (update template), `GET /api/newspapers/:id`, and `GET /api/newspapers/latest` were all still 200 after adding the nested route to `page.routes.js`; server stayed alive throughout.
- **Found and locked in with a new regression test** (rather than just documenting) a second pre-existing quirk beyond the §11 crash bug: `pageRepository.saveSection`'s `UPDATE ... WHERE page_id = $1 AND section_key = $2` silently matches zero rows and returns success if the section key doesn't exist on that page — no error, no indication the write did nothing. Confirmed via `git diff`/`git log` that `page.repository.js` was untouched this session (unmodified since the Prompt 3 catch-up commit), so this is pre-existing behavior, not something introduced now. Unlike the §11 crash (which can't be tested without failing the suite), this one *can* be safely tested — added `'saving a section with an unknown section key is a silent no-op'` to lock in the current (if surprising) behavior as a documented contract rather than an untested landmine.

### Remaining technical debt

- **The §11 `updateTemplate` crash bug is now the single loudest piece of debt in the whole backend**, since it's the last surviving "silent landmine" — everything else content-related is now migrated, tested, or both. Worth fixing directly rather than migrating around again.
- **The newly-confirmed `saveSection` silent-no-op** (previous section) is lower severity than the crash but has the same root cause: neither `saveSection` nor `updateTemplate` verifies its target row(s) exist before acting. A single shared "assert page/section exists" helper in `page.repository.js` would fix both at once.
- **`src/db.js` is legitimately minimal now but still a slight misnomer** — a one-function file called `db.js` that only handles authentication reads oddly next to `src/repositories/*.js` (the actual DB layer). If/when Auth gets its own migration (`auth.controller.js`/`auth.service.js`/`auth.routes.js`, all already scaffolded and empty), `src/db.js` can be deleted for real and `authenticateUser`'s logic folded into `auth.service.js`.
- **Test coverage is now uneven across the four migrated resources**: Page and Page Section have solid automated suites (6 tests each) added specifically to close gaps; News and Newspaper were only manually smoke-tested during their respective migrations (§9, §10) and have no dedicated test files. Worth a follow-up pass to bring `tests/news.test.js` and `tests/newspaper.test.js` up to the same standard, purely for consistency — not because anything is currently broken.

### Next recommended migration

With all four content resources layered, the natural next steps are no longer "which resource is left" but architectural cleanup and the pieces intentionally deferred throughout this series:
1. **Fix the two silent-failure bugs in `page.repository.js`** (`updateTemplate`'s crash, `saveSection`'s no-op) — real bugs now that they're the last ones standing, not migration scope creep.
2. **Auth**, if it's ever going to move off `src/db.js` — smallest possible migration (one function), and would let `src/db.js` be deleted entirely rather than kept as a permanent one-function file.
3. Per the original roadmap, **Prompt 3 (database)** and **Prompt 4 (template engine)** are the next un-started items — the layering work this series completed is exactly the prerequisite CLAUDE.md and earlier updates to this document said it was.

---

## 13. Update — Prompt 6: Newspaper Editor UI architecture (2026-08-02)

### Completed work

Rebuilt the Newspaper Workspace editor's *internal architecture* — no visual changes, no backend changes, same API calls, same markup/CSS classes. The goal was killing scattered `window.*` state and giving the editor real module boundaries, per the task's explicit six-way split.

**Before:** `public/admin/newspaper-workspace.js` (`renderWorkspace`, page list, layout list) and `public/admin/page-editor.js` (canvas, section editor) communicated by reading and writing `window.currentNewspaper`, `window.currentPage`, `window.selectedSection`, `window.pages`, `window.reporterNews`, and `window.availableTemplates` — six pieces of shared mutable state living on the global object, set by whichever file happened to run last, read by whichever file happened to need them. `admin.js` *also* kept its own parallel copies (module-scoped `currentNewspaper`/`currentPage`) that it manually kept in sync with the `window.*` copies inside `editNewspaper()`. Two copies of the same state, one of them global.

**After — six modules, one state object, zero `window.*`:**
- `public/editor/workspace.js` — **the single Workspace state.** A module-scoped `state` object (`newspaper`, `pages`, `currentPage`, `reporterNews`, `selectedSection`) that nothing outside this file touches directly. Exports one function, `renderWorkspace(newspaperId)`, which fetches newspaper/pages/reporter-news, populates `state`, and renders. Internally owns the actions that mutate state and re-render (`selectPage`, `selectSection`, `applyTemplate`, `saveSection`) — these are passed *down* to child modules as callback arguments, never imported back by them, so there are zero circular imports in the tree.
- `public/editor/canvas.js` — **Canvas.** Renders the page preview grid from `page.sections`, same absolute-positioned-div markup as before. Takes `(page, newspaper, selectedSectionKey, onSelectSection)` as arguments; calls `onSelectSection` on click instead of writing `window.selectedSection` directly.
- `public/editor/page-sidebar.js` — **Page Sidebar** (new file; this responsibility was inline inside the old `newspaper-workspace.js`'s `renderPagesList`). Renders the page-number button list.
- `public/editor/layout-sidebar.js` — **Layout Sidebar** (new file; was inline as `renderLayouts`/`fetchTemplates`). Renders the template picker; caches the `/api/templates` response in a module-private variable (not `state`, not `window` — a plain HTTP cache, same lifetime/behavior as the old `window.availableTemplates` cache had).
- `public/editor/section-editor.js` — **Section Editor.** Renders the headline/subheading/body/etc. form. Delegates the reporter-story picker to Story Explorer instead of building it inline.
- `public/editor/story-explorer.js` — **Story Explorer** (new file, but the *code* existed inline inside the old `page-editor.js`'s `renderSectionEditor` — this session extracted it, didn't invent new behavior). Renders the "Auto-fill from reporter" `<select>` and its change handler. ~~Deliberately still the simple single-dropdown version — a full filterable browser is Prompt 8, not this task.~~ **Rebuilt into the full filterable browser 2026-08-02, see §15.**

**Wiring:**
- `public/app.js` no longer dynamically imports `admin/newspaper-workspace.js` or `admin/page-editor.js` (deleted, see below).
- `public/admin.js` now has `import { renderWorkspace } from "./editor/workspace.js"` at its top — a real ES import, not a side-effect script load. `editNewspaper(newspaperId)` shrank from ~25 lines (three fetches, two "pick current page or fall back" checks, four `window.*` assignments) to three: clear the right panel, `await renderWorkspace(newspaperId)`. The fetches and page-fallback logic already existed *and were correct* — they just now live in exactly one place (`workspace.js`) instead of being duplicated between `admin.js` and the old `newspaper-workspace.js`.
- `createEdition()` in `admin.js` no longer assigns to a module-scoped `currentNewspaper` — it's a local variable now, since nothing outside that function needed it once `editNewspaper` stopped reading it.

**Deleted (superseded, not left as parallel dead code):**
- `public/admin/newspaper-workspace.js`, `public/admin/page-editor.js` — fully replaced by the six modules above.
- `public/editor/sidebar.js` — was an empty 0-byte stub for a single combined "sidebar" module; superseded by the deliberate two-file split (`page-sidebar.js` + `layout-sidebar.js`) the task asked for. Confirmed empty and unimported before deleting.

**Decisions made:**
- **Data flows one direction: `workspace.js` → children, via function parameters and callbacks.** Children never import `workspace.js` back. This was a deliberate choice over the alternative (a separate `editor/state.js` that both `workspace.js` and the children import) — that alternative is also cycle-free and arguably more conventional, but it would have meant seven files for a task that named exactly six pieces. Keeping state ownership *inside* `workspace.js` and passing data/actions down as arguments matches "Workspace ... Canvas ... Page Sidebar ... Layout Sidebar ... Story Explorer ... Section Editor" literally, at the cost of `workspace.js` being a bit more of an orchestrator than a thin shell (~140 lines, still small).
- **`editor/publication.js` was left completely untouched**, including its `window.showPublicationFiles` assignment. It's not one of the six named pieces, it's already dead code unrelated to this refactor (confirmed unreachable before this session too — see §3), and the task said no backend changes and implicitly no scope beyond the six pieces. Its `window.*` usage is the one remaining instance in the whole frontend; flagged, not fixed.
- **Every markup string, CSS class name, and element ID was copied verbatim** from the code being replaced — including a bug (see Remaining technical debt) that a "no visual redesign" task shouldn't be quietly fixing along the way.

**Verification:**
- `npm test`: all 16 backend tests still pass, unaffected (no backend files were touched).
- **Real browser test**, not just a syntax check: started the app, installed `playwright-core` in a scratch directory (pointed at the system's `google-chrome`, no bundled browser download, nothing added to the project's `package.json`), created a temporary throwaway admin user, and drove the actual UI — login → admin dashboard → create edition → workspace renders (page canvas, 4 page buttons, 4 layout buttons, 6 canvas sections for the default Front Page template) → click a canvas section → section editor opens → fill headline + body → save → canvas re-renders showing the section as `.filled` with the new headline → switch to the "Local News" layout → canvas re-renders with that template's 6 sections. Zero console errors, zero page errors, at every step. Screenshots taken and visually reviewed. Temporary admin user and test newspaper deleted afterward.
- This browser test is also what caught the `pageNumber` bug below — a plain code read wouldn't have surfaced it as clearly as seeing empty buttons in a screenshot.

### Remaining technical debt

- ~~**Found a real, pre-existing bug via the browser test: `editor/page-sidebar.js` renders `page.pageNumber`, but the API field is `page_number`.**~~ **Fixed 2026-08-02, see §14.**
- **`editor/publication.js` is still dead code** and still out of scope — same status as before this session. As of §14 it's a proper ES export rather than `window.*`, but still unconsumed by anything.
- ~~**`admin-dashboard.js` (475 lines, dead duplicate dashboard) is still present and unaddressed**~~ **Deleted 2026-08-02, see §14.**
- **`workspace.js` re-fetches all three resources (newspaper, pages, reporter news) on every `renderWorkspace()` call**, same as the code it replaced — no caching, no incremental updates on `selectPage`/`selectSection` (those don't re-fetch, only `applyTemplate`/`saveSection` do, matching prior behavior exactly). Fine for now; worth revisiting if the workspace ever needs to feel faster on a slow connection.
- **No automated frontend tests exist for the editor at all** — verification across both §13 and §14 was a one-off manual browser script, not a committed test. `tests/*.test.js` only cover the backend. If a frontend test story ever gets prioritized, the `drive.js` script used both times (browser-driven, Playwright-based) is a reasonable starting template, though it wasn't committed to the repo either time.

### Next recommended migration

Per the original roadmap this document has been tracking, the two items §9–§13 called out repeatedly are now done (see §14: `page.pageNumber` fixed, `admin-dashboard.js` deleted). What's left:
1. ~~**Prompt 7 (production Section Editor: images, alignment, crop, more fields)** and **Prompt 8 (real Story Explorer / Reporter Browser with filters)**~~ — editor cleanup landed as §14; the filterable Story Explorer landed as §15. Production Section Editor work beyond the read-only image preview added in §15 (alignment, crop, direct image upload to a section) is still open.
2. Backend-side, **Prompt 3 (database)** and **Prompt 4 (template engine)** remain the next un-started items from the original roadmap, unaffected by this session's frontend work.

---

## 14. Update — Prompt 7: editor cleanup (2026-08-02)

### Completed work

Closed out the loose ends §13 left open: finished eliminating `window.*` from the frontend, fixed the `page.pageNumber`/`page_number` bug, deleted the confirmed-dead files, and re-verified everything both by grep and by running the same browser smoke test as §13.

**1. `window.*` fully eliminated, not just from the six editor modules:**
- `editor/publication.js`: `showPublicationFiles` is now `export async function showPublicationFiles(newspaperId)`; the trailing `window.showPublicationFiles = showPublicationFiles` line is gone. Not wired into any UI trigger — doing so would mean adding a button/panel to the workspace, which is a UI change, out of scope here (see §3).
- **Found two more `window.*` stubs §13 missed**, not named in this task but directly in scope for "complete the editor cleanup": `admin/reporter-browser.js` (`window.renderReporterBrowser = function () {}`) and `admin/template-selector.js` (`window.renderTemplateSelector = function () {}`). Both were one-line no-op placeholders — converted to `export function renderReporterBrowser() {}` / `export function renderTemplateSelector() {}`. Zero behavior change (they did nothing before, do nothing now), pure mechanical cleanup, kept because both are still actively imported by `app.js` as deliberate forward-looking placeholders (see §3/§8) — not deleted, just no longer using `window.*`.
- Verified with `grep -rn "window\." public/ --include="*.js"` returning zero results.

**2. `page.pageNumber` → `page.page_number` fixed** in `editor/page-sidebar.js` — the one-line change flagged in §13. Re-verified live: the browser smoke test's page buttons went from `""` (empty) to `"1"`/`"2"`/`"3"`/`"4"`, screenshot confirms it visually.

**3. Deleted confirmed-dead files** (each checked via repo-wide grep for zero references before removal):
- `public/admin-dashboard.js` (475 lines) — the duplicate dashboard flagged since this document's very first audit.
- `public/admin/dashboard.js`, `public/admin/publication.js`, `public/dashboard.js` — 0-byte stubs, unimported anywhere.

Not deleted, deliberately: `admin/reporter-browser.js` and `admin/template-selector.js` (still imported by `app.js`, treated as intentional scaffolding for future prompts, not orphaned code — see §3 for the distinction and reasoning); `editor/publication.js` (dead but explicitly Prompt-9 scope, not this task's).

**4. Verified no duplicate editor implementations remain.** Grepped for every render-function name that had a "before" and "after" across the whole migration series (`renderWorkspace`, `renderCanvas`/`renderPageCanvas`, `renderPagesList`/`renderPageSidebar`, `renderLayouts`/`renderLayoutSidebar`, `renderSectionEditor`/`showSectionEditor`, `newspaperTemplates`, `selectPageTemplates`) — exactly one definition of each current name, zero hits for any retired name. This is also what surfaced the two extra `window.*` stubs above; a verification pass that only checked what the task named would have missed them.

**5. Browser smoke test re-run**, same script and same flow as §13 (login → admin dashboard → create edition → workspace renders → click section → fill + save → canvas updates → switch layout → canvas re-renders): all steps passed, zero console errors, zero page errors. New this time: page-sidebar buttons render actual numbers instead of blank text, confirming the fix. Screenshot reviewed. Temporary admin user and test newspaper created and deleted the same way as §13 (scratch `playwright-core` install pointed at system Chrome, nothing added to the project's `package.json`).

**6. `npm test`: 16/16 pass**, unaffected — no backend files touched.

### Remaining technical debt

- `editor/publication.js` remains dead code with no consumer — same status as §13, just cleaner internally now.
- `admin/reporter-browser.js` / `admin/template-selector.js` are still one-line no-op stubs. They're intentional placeholders, not urgent, but worth remembering they currently do *nothing* — `app.js` spends two `import()` calls loading files that have no effect yet. **Updated 2026-08-02 (§15):** `reporter-browser.js` in particular no longer has a clearly assigned future — the filterable Story Explorer it was presumed to become was actually built in `editor/story-explorer.js` instead (see §3, §8, §15).
- Every other item in this document's technical-debt list (no authorization layer, no input validation, `page.repository.js`'s `updateTemplate` crash bug, no image handling for page sections, unmanaged upload directory, default session store, uneven test coverage) is unchanged by this session — all backend/schema concerns, out of scope for an editor-cleanup pass.

### Next recommended migration

With the editor cleanup complete and the duplicate-dashboard/`window.*` debt this document has tracked since its first draft now fully closed, the codebase has no more "second implementation of the same feature" instances left to find via inspection. The next steps are additive, not corrective:
1. ~~**Prompt 7 (production Section Editor)** and **Prompt 8 (Story Explorer / Reporter Browser with real filters)**~~ — Story Explorer done, see §15. Production Section Editor (image upload/crop/alignment directly on a section, not just linking a reporter story) is still open.
2. Backend-side, **Prompt 3 (database)** and **Prompt 4 (template engine)** remain untouched and are the largest remaining pieces of the original roadmap.
3. **`page.repository.js`'s `updateTemplate` crash** (§11) is still the single highest-severity known bug in the system — worth prioritizing over new features if reliability matters more than scope right now.

---

## 15. Update — Story Explorer (2026-08-02)

### Completed work

Replaced `editor/story-explorer.js`'s single "Auto-fill from reporter" `<select>` (§13's deliberately-minimal placeholder) with a production-ready filterable browser, per the task: search by title, filter by reporter/category/location/status, story cards showing headline/reporter/category/thumbnail/created-date, click-to-populate the selected section's headline/subheading/body/category/location/tags/reporter/images. No backend API changes, no workspace redesign — same panel, same `#editorBody` mount point, same six-module architecture from §13.

**`public/editor/story-explorer.js` (rewritten):**
- `renderStoryExplorerMarkup(reporterNews)` — renders a search `<input>`, four filter `<select>`s (reporter/category/location/status, options built from `[...new Set(reporterNews.map(...))]` over whatever's actually in the fetched data — no hardcoded option lists), and an empty results container.
- `bindStoryExplorer(reporterNews, onSelectStory, initialSelectedId)` — owns filter state and the currently-selected story ID in a closure (not `state`, not `window`, matching the "one direction of dependency" rule §13 established); re-renders the card list on every keystroke/filter change; clicking a card calls `onSelectStory(story)` and re-renders with that card highlighted `.active`.
- Filtering is a plain `.filter()` over the `reporterNews` array `workspace.js` already fetches once via `GET /api/news` on `renderWorkspace()` — no new network calls, no new endpoint. This was a deliberate consequence of "do not modify backend APIs," not an oversight; see §7 for the scaling caveat.

**`public/editor/section-editor.js` (updated, not rewritten):**
- Replaced the old pattern of reading the selected story off a hidden `<select id="reporterStory">` at save time with a closure variable (`selectedStoryId`), initialized from `section?.news_item_id` (already returned by `GET /api/newspapers/:id/pages` — no backend change needed, that field was already there and simply unused by the frontend before) so reopening an already-linked section shows it pre-selected and highlighted.
- Added a read-only "Attached images" preview (`renderImagePreview`, a small `<div id="secImages">` populated from `story.image_urls`) — this is how "images" gets populated per the task's field list. Page sections have no image column of their own (`schema.sql`'s `page_sections` table — confirmed, see §6); images live on the linked `news_items` row and are already carried through via `newsItemId` in the existing `PUT /api/pages/:pageId/sections/:sectionId` payload (unchanged, see §12). The preview is display-only, not a new upload path — attaching a *different* image directly to a section (rather than via a reporter story) is still the unbuilt "no image handling for page sections" item in §5.
- The save payload's `newsItemId` now comes from the closure variable instead of `document.getElementById("reporterStory").value` — same field, same backend contract, just reading from the new source of truth.

**`public/styles.css` (additive only):** new `.story-explorer*`, `.story-card*`, `.story-image-preview` rules, reusing existing CSS custom properties (`--accent`, `--border`, `--secondary`) and the same visual language as the existing `.admin-news-card`/`.page-card` patterns elsewhere in the app — not a new design system, no existing rule changed.

**Verification:**
- `npm test`: 16/16 pass, unaffected — no backend files touched.
- **Real browser test**: reused the §13/§14 scratch `playwright-core` + system-Chrome setup (fresh `npm install` — the scratch directory doesn't persist between sessions). Seeded a temporary admin user and four throwaway `news_items` rows (varied reporter/category/location/status, two with a fake image URL) directly via SQL, since there's no UI path to control every one of those fields easily. Drove: login → create edition → click a canvas section → confirm the story explorer renders with the seeded data → search by title (title-only match confirmed) → filter by reporter, then category, then location, then status independently (each filter reduced the card count correctly, cards not matching stayed hidden not just visually blurred) → click a story card with images attached → confirmed every target field populated (`secHeadline`, `secCategory`, `secLocation`, `secReporter`) plus the image preview (`#secImages img` count = 1, matching the seeded `image_urls`) plus the `.story-card.active` highlight moved to the clicked card → save → canvas re-rendered showing the section `.filled` with the new headline → reopened the same section → confirmed the linked story stayed pre-selected/highlighted and its image preview reappeared (this exercises the `section.news_item_id` pre-select path, not just the click-to-populate path). Zero console errors, zero page errors, at every step. Screenshots taken and visually reviewed. Temp admin user, temp news rows, and the test newspaper (with its pages/sections) were all deleted afterward via direct SQL — same test-data hygiene pattern as §13/§14.

### Remaining technical debt

- Filtering is client-side over the full `GET /api/news` response — see the updated §7 entry. Fine today; will need server-side search/filter/pagination before the reporter-story list grows large.
- The image preview added to the section editor is read-only. There is still no way to attach a standalone image to a page section without going through a reporter story first — same `page_sections` schema gap flagged in §5, unchanged by this session.
- `admin/reporter-browser.js` is now a stub with no assigned future task (its presumed purpose is fulfilled by `story-explorer.js` instead) — worth an explicit decision (repurpose as a separate full-page browse view, or delete) rather than continuing to import a no-op file on every page load. Not fixed here: deciding and acting on that is a bigger call than "keep the changes small" covers for this task.
- Every other item in this document's technical-debt list (no authorization layer, no input validation, `page.repository.js`'s `updateTemplate` crash bug, unmanaged upload directory, default session store, uneven test coverage) is unchanged by this session.

### Next recommended migration

1. **Production Section Editor** (direct image upload/crop/alignment on a section, more fields) is now the last named editor-UI item from the original roadmap still open.
2. Backend-side, **Prompt 3 (database)** and **Prompt 4 (template engine)** remain untouched and are the largest remaining pieces of the original roadmap.
3. **`page.repository.js`'s `updateTemplate` crash** (§11) is still the single highest-severity known bug in the system.
4. Deciding `admin/reporter-browser.js`'s fate (repurpose vs. delete) is a small, low-risk cleanup worth bundling into whichever session next touches the editor's frontend module list.
