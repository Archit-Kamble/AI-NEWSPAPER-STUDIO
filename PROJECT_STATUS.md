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

**Updated 2026-08-02 (Prompt 4): mixed state.** News, Newspaper, and Page now follow the target layering; Page Section does not yet — see §9, §10, §11 for what changed and why.

```
News / Newspaper / Page:            Page Section (unchanged):
server.js                           server.js
  ↓ app.use('/api/news', ...)         ↓ inline route handler
  ↓ app.use('/api/newspapers', ...)   ↓ direct call
  ↓ app.use('/api', pageRoutes)     src/db.js (thin re-export facade, 2 exports)
src/routes/{news,newspaper,page}.routes.js  ↓
  ↓                                 src/repositories/page.repository.js
src/controllers/{news,newspaper,page}.controller.js  ↓
  ↓                                 PostgreSQL
src/services/{news,newspaper,page}.service.js
  ↓
src/repositories/{news,newspaper,page,publication}.repository.js
  ↓
PostgreSQL
```

`src/db.js` is now down to 2 exports: `authenticateUser` and `savePageSection` (the Page Section write path, deliberately excluded from this migration). Once Page Section is migrated the same way, `src/db.js` should disappear entirely rather than gain a matching new indirection.

### Frontend load path

`public/index.html` → `/app.js` → dynamic `import()` in this order:

1. `editor/publication.js` (35 lines — final Scribus/PDF upload UI, functional)
2. `admin/newspaper-workspace.js` (161 lines — functional, owns `renderWorkspace`)
3. `admin/page-editor.js` (126 lines — functional, owns canvas + section editor)
4. `admin/reporter-browser.js` (0 bytes — imported but empty)
5. `admin/template-selector.js` (0 bytes — imported but empty)
6. `admin.js` (813 lines — login, both dashboards, edition creation, news CRUD, and the `editNewspaper()` function that hands off into the workspace)

### Live REST surface (News + Newspaper + Page routes now layered per §9/§10/§11; Page Section/Template routes still defined inline in `server.js`)

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
| POST | `/api/newspapers/:newspaperId/pages` | create page (applies a template's sections) | ✅ **new this session** |
| GET | `/api/newspapers/:newspaperId/pages` | list pages, each hydrated with its sections | ✅ **new this session** |
| PATCH | `/api/pages/:pageId` | change a page's template (re-applies section layout) | ✅ **new this session** |
| PUT | `/api/pages/:pageId/sections/:sectionId` | write headline/body/etc. into one section | inline (Page Section, out of scope, see §11) |
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
- **`src/db.js` facade adds a layer with no purpose.** Down to 2 exports now (`authenticateUser`, `savePageSection`) after News (§9), Newspaper (§10), and Page (§11) were migrated out of it. Once Page Section is migrated the same way, this file should disappear rather than gain a matching new indirection.
- **`page.repository.js`'s `updateTemplate` crashes the process on a nonexistent page ID when a template is specified** (confirmed via smoke test during §11 — `PATCH /api/pages/999999` with `{template: "..."}` throws an unhandled Postgres FK-violation error instead of returning 404, because the `UPDATE pages ...` silently matches zero rows and the code proceeds to `INSERT INTO page_sections` anyway). Same class of bug as the News `:id`-crash issue in §9, now confirmed present in Page too. Preserved as-is per this task's rules; a shared "does this ID actually exist before touching child rows" guard is worth adding once all four resources are migrated, not per-resource.
- **No image handling for page sections.** `PUT /api/pages/:pageId/sections/:sectionId` accepts no image fields at all — a section only gets images by linking a `news_item_id`, whose images were uploaded separately via `/api/news`. There is no path to attach a standalone image directly to a page section, despite `media_assets`/`section_images` existing in the schema for exactly this.
- **Multer upload directory is unbounded and unmanaged.** `public/uploads/` already has 40+ files from testing; there's no cleanup, no per-newspaper/per-story organization, and uploaded filenames leak directly as public static URLs with no access control.
- **`express-session` uses the default MemoryStore** (no `store` configured) — sessions are lost on every server restart and this is explicitly not production-safe (Express prints a warning about this on boot). Not mentioned anywhere in CLAUDE.md as a known gap.
- **Test coverage has grown but is still partial.** News, Newspaper, and Page each have some coverage now (§9 notes News was smoke-tested only, not automated; Page got 6 new automated tests in §11). Still no coverage for auth, the templates endpoint, or Page Section — and no negative-path test exists for the crash bug above (deliberately — it would fail the suite).

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

**Updated 2026-08-02 (Prompt 3):** News and Newspaper are now both layered (§9, §10). Only Page and Page Section remain on the old `server.js → src/db.js → repository` path — `src/db.js` is down to `authenticateUser` + 5 Page functions and should be the next and final target before it's deleted outright.

**Updated 2026-08-02 (Prompt 4):** Page is now layered too (§11). Only Page Section remains on the old path — `src/db.js` is down to exactly 2 exports (`authenticateUser`, `savePageSection`). Migrating Page Section is now the only thing standing between the current state and deleting `src/db.js` entirely.

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
