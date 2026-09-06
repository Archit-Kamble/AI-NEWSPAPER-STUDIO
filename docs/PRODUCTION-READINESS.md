# Production readiness — the open problem register

Two independent full regressions were run on 2026-09-06: one by Claude on `main`, one by
Codex on `codex/newspaper-block-designs`. This is the combined list, ranked by what it
costs the newsroom on press day.

**Nothing in this file is fixed unless it says FIXED.** Each entry names the file and line
so the next pass can start from evidence rather than from a description.

Source is marked: **[C]** Claude's regression, **[X]** Codex's regression, **[C+X]** both
found it independently.

---

## Already fixed (recorded so it is not re-audited)

| | what it was | where |
|---|---|---|
| **[C]** FIXED | The folio rule was struck **through** the folio type on every inside page of every PDF and IDML. Text ink 32.72→49.82, rule at 39.00. Cause: `lineY = header.top + bandPx * 0.32`, a fraction tuned while the rule still sat at the bottom of the 32px band; the chip-row change moved the rule to 19 and left the type behind. Now centred in the chip row, mirroring the canvas's `align-items: center`. | `src/services/export/print-model.js` `folioItems()` |
| **[C]** FIXED | Scribus dropped **every** furniture text colour. `furnitureFrames()` passed the field as `ink:`; `lineFrame()` reads `run.colour`, so all 465 runs fell to `'Black'`. A `sunday`-themed folio drew its orange panel and set **black** type on it. `colourFor()` also had no white case, so reversed type could not resolve. | `src/services/scribus.service.js:597`, `:302`, `colourFor()` |

Both are held by tests that fail against the old code, in `tests/furnitureExport.test.js`.

---

## P0 — release blockers

### 1. **[X]** Two editors silently overwrite each other

Two authenticated sessions edited the same block from the same base version. First save
200, second **stale** save 200, and the first editor's work was gone. The API receives
`updated_at` and ignores it; the UPDATE carries no revision condition.

- `src/repositories/page.repository.js:435`, `:495`

**Fix shape:** an integer section revision, `UPDATE … WHERE revision = $expected`, HTTP 409
when someone saved first, and a compare UI offering keep-mine / load-theirs. Durable
revisions so overwritten copy is recoverable.

### 2. **[X]** Autosave can save or clear the **wrong** draft

Page and block changes call `autosave.flush()` without awaiting it, then immediately replace
the current draft. The retry then calls `persistDraft()` against whichever page/block is
current **at retry time**. Deterministically reproduced: `block-A save fails → selection
changes → retry saves block-B`.

- `public/editor/workspace.js:907`, `:1474`, `:1366`
- `public/editor/autosave/autosave.js:36`

**Fix shape:** autosave an immutable `{pageId, sectionKey, payload, revision}` snapshot;
ignore stale responses; never let a late response mark a *newer* draft as saved.

### 3. **[X]** Refresh or tab close can lose recent copy

Workspace drafts live only in memory and autosave debounces one second. There is no
`beforeunload`, no `pagehide`, no local draft journal anywhere in the workspace — only the
reporter form has an unload guard. A failed flush inside `leaveWorkspace()` is swallowed and
schedules a retry that may run after another block is selected.

- `public/editor/workspace.js:100` (`leaveWorkspace`)

**Fix shape:** a small IndexedDB draft journal held until the server acknowledges the exact
revision, plus a warn-before-unload while a save is outstanding.

### 4. **[C+X]** The test suite writes into the **real** newsroom database

Two halves, both confirmed by measurement:

- **[X]** Seven test files upsert `admin@esahas.com` and replace its password hash with a
  repository-known test credential, never restoring it. The real administrator password has
  therefore been overwritten and **must be rotated by hand** — the old hash was not
  preserved. The known reporter credential also works.
  - `tests/roles.test.js:36`, `tests/pressReadiness.test.js:11`, and five more
- **[C+X]** Fixtures are never cleaned up. `tests/health.test.js:81` creates an edition with
  **zero `t.after` blocks and zero DELETEs** — one leaked edition per run.

Measured contamination (Claude, 2026-09-06):

| | |
|---|---|
| editions | **273 of 474** are 2099-dated fixtures (263 named `साहस`, 264 on `2099-01-01`) |
| pages | 301 of 435 |
| `page_sections` | **4,555 of 6,002 — 76%** |
| accumulated | 2026-08-23 → 2026-09-05, ~20/day |

Codex measured the same shape from the other side: 1,652 leaked `test-{timestamp}` news
rows; 827 of 1,399 rows returned by `/api/news`; 263 of 474 editions on `/api/newspapers`.

**And they sort first.** All ten of the first entries in `GET /api/newspapers` are fixtures,
so a desk opening Past Newspapers wades through test data before reaching a real edition.
This is the failure this codebase has already recorded twice (116 editions, then 221) and it
is now larger than either.

**Fix shape:** a dedicated `sahas_test` database; refuse to run unless the database name
ends in `_test`; unique disposable users instead of real addresses; cleanup in `finally`.
Then prune the existing 273 fixtures **after a backup** — that deletion needs the owner's
explicit approval, so it was not done.

### 5. **[X]** A production secret placeholder passes the startup guard

`.env.example:6` ships `SESSION_SECRET=change-this-secret` and no `NODE_ENV=production`.
The guard at `server.js:36` rejects only the literal `dev-secret`, so the public placeholder
is accepted.

**Fix shape:** reject known placeholders and enforce a length/entropy floor; put
`NODE_ENV=production` in the example with deployment notes.

### 6. **[C]** The Scribus colour table defines `Black` as **no ink**

```
Black        = C0%  M0%  Y0%  K0%      <- no ink on any plate
White        = C0%  M0%  Y0%  K0%      <- identical
Registration = C100% M100% Y100% K100% <- correct, and validates the format reading
```

`SahasRed` decodes to C0 M100 Y90 K10, which confirms the byte order independently. **443 of
465 text runs — 95% of all type in the press file — are set in `TXTFILL="Black"`.** If
Scribus honours the document's own colour table, the press file prints essentially blank.

- `src/services/scribus.service.js`, the `COLOURS` constant

**Not fixed deliberately.** The correct value is almost certainly `#000000ff` (100% K, which
is this project's own stated rule), but no Scribus binary is available here to render
against, and this is the single most consequential value in the press file. **Open one `.sla`
in real Scribus and check whether black type prints, before changing it.**

---

## P1 — serious, not release-blocking

### 7. **[X]** Repeatedly opening editions makes page switching progressively slower

Every workspace render calls `subscribeViews()` again, adding seven store subscriptions plus
window resize listeners; `leaveWorkspace()` removes none. After five opens, one page click
triggers ~5 page-area renders, ~5 side-panel renders and ~5 guide requests. This is the
direct cause of the observed 1–2 second page switching.

- `public/editor/workspace.js:2020`, `:3100`, `:100`

### 8. **[X]** Rapid edition navigation can paint the **wrong** edition

Stale-operation tokens are checked only *before* the async work. Reproduced: address showed
the fast edition, the painted screen showed the slow earlier one. The masthead identity has
the same race and retained edition A's identity when A finished last.

- `public/admin/navigation.js:66`, `public/admin.js:473`, `public/editor/workspace.js:144`
- `public/editor/canvas/masthead.js:26`

### 9. **[X]** Page guides and block images can cross selections

Both loaders capture a page/block, await, then replace module-global data without checking
the selection still matches. `redrawCompose()` assigns the returned image list to the
*currently* selected section — so a slow response for block A can display A's pictures inside
block B and contaminate B's history.

- `public/editor/workspace.js:260`, `:319`

### 10. **[X]** The masthead artwork is below press resolution

`sahas-nameplate.png` is 1600×300 and measures ~190 PPI in the generated press file. It
should be vector, or at least 300 PPI at printed size. (The 12 Rashi images are fine — above
~560 DPI at current card size.)

- `src/layout/identity.js:31`, `src/services/export/print-model.js:864`

### 11. **[C]** The press PDF carries no `/ActualText`

Zero occurrences in a 2.76 MB export; only 3 ToUnicode CMaps. CLAUDE.md states
"`/ActualText` on every run" — that is not what the file contains. **Rendering is correct**
(verified by rasterising page 2); only extraction degrades, and only for complex clusters:
`सूर्यास्त` extracts as `सय स्त`, `दिनमान` as `दनम न`; simple words extract fine. The
archive and any indexer cannot find complex Marathi words.

### 12. **[X]** Production environment is not configured

`NODE_ENV` unset · `SESSION_SECRET` absent (falls back to `dev-secret`, non-secure cookie) ·
documented default admin credential still works · `OPEN_METEO_API_KEY` absent so weather
correctly refuses (`src/features/havaman.js:96`) · `DB_SSL` absent with no pool SSL config
(`src/config/db.js:35`) · reverse-proxy trust not configured, so secure cookies need
verification when TLS terminates before Node.

### 13. **[X]** Dependency and header hardening

10 vulnerabilities (6 high, 4 moderate) across `onnxruntime-node`/`adm-zip`, `tar`,
`brace-expansion`, `ip-address`, Express/`qs`, `undici`. Also: `npm` and `start` are
unnecessary production dependencies (`package.json:19`); anonymous requests are parsed up to
**50 MB before authentication** (`server.js:70`); no CSP, HSTS or Permissions-Policy;
`X-Powered-By` still exposed.

---

## P2 — real, lower cost

### 14. **[X]** Cold load is heavy

108 JS modules ≈1.94 MB · `styles.css` ≈330 KB · 3.15 MiB across ten fonts · ≈422 KB
HarfBuzz WASM · assets `max-age=0` with no compression · `admin.js:1` imports the whole
workspace so login/admin screens load editor code · `/api/news` returns 1,399 records
≈2.1 MB when the picker shows 40 · `/api/newspapers` returns 476 editions ≈343 KB.

`font-metrics.js:229` and `shaper.js:77` **each independently fetch every font**, with no
shared byte cache.

Backend is not the cause: warm API/static TTFB 0.7–1.7 ms, page composition 5–10 ms.

### 15. **[C]** One genuinely unguarded `fetch(...).json()`

```js
const newspaper = await fetch(`/api/newspapers/${newspaperId}`).then((r) => r.json());
```
No `response.ok`, no `.catch()`. On 401/500 the Publish dialog renders normally for an
edition it failed to load; on a non-JSON response it throws inside an async click handler and
the button silently does nothing. Publishing itself is server-guarded, so nothing wrong is
published.

- `public/editor/publication.js:8`

### 16. **[X]** Accessibility gaps

The publication confirmation modal has no dialog semantics, focus trap/restore, Escape
handling, or accessible name on its close button (`public/editor/publication.js:15`). The
Story Explorer close button has no accessible name (`public/editor/workspace.js:1705`). Page
buttons expose active state visually only, with no `aria-current`/`aria-pressed`
(`public/editor/page-navigator.js:5`).

### 17. **[X]** The PDF is valid CMYK but not a colour-managed press standard

No ICC profile, no OutputIntent, no PDF/X declaration, no bleed geometry; DeviceCMYK
conversion is deliberately naïve (`src/services/export/pdf.writer.js:36`). Not wrong until
the press states its requirements — but SAHAS should not call the output universally
press-ready. Get the press's ICC profile and required PDF/X variant, then make those part of
preflight.

### 18. **[X]** `npm test` runs none of the 20 browser nets, and there is no CI

Documented at `README.md:40`. Add `npm run test:browser`, an isolated test server and
database, browser execution in CI, artifact retention for failed screenshots, and regression
tests for the navigation race, autosave failure and repeated-edition-open leak.

### 19. **[C]** Housekeeping

- `tmp-visual-pass/canvas-chart-panel.png` is **tracked** and overwritten by
  `chart-panel.browser.js`, so every net run dirties the working tree.
- 41 equal-specificity CSS conflicts (e.g. `.section-handle { width: 7px VS 10px }`). The
  later value wins; cosmetic debt, consistent with the state already recorded.

---

## Known flakes — recorded, not bugs

- `tests/currentNewsWriting.test.js` "check the sources first" — fails ~1 run in 4 inside a
  full sweep, passes in isolation. Inside the settle loop's designed `MAX_FILL_CALLS` envelope.
- `tests/browser/headline-focus.browser.js` — 8/11 in a back-to-back sweep, **11/11 three
  times in isolation** (re-verified 2026-09-06). Not a regression.

## Verified sound — do not re-audit

Claude's regression: schema drift **zero** (every hand-applied migration present, including
`news_items.newspaper_id → SET NULL`, all four roles in the `users.role` CHECK, `epaper_pdf`
in the publication-files CHECK, both indexes) · all four exports produce valid artifacts ·
86 written blocks compared canvas-vs-plate with **0** headline/body/rule/ground mismatches ·
API 404 answers JSON · unauthenticated desk GET → 401 · `nosniff` present · PostgreSQL
session store · `unhandledRejection`/`uncaughtException`/`SIGTERM` handlers · login throttle
wired · upload byte-signature check · e-paper non-selected assets 404 and traversal 404 ·
PDF is CMYK (0 `DeviceRGB`) · the `'; DROP TABLE page_sections; --` fixture headline is
correctly XML-escaped in the `.sla` · 113 browser modules parse as ESM with 0 syntax failures
· only the two documented dead mechanisms (`border_color`, `letter_spacing_px`) · all four
`working()` guard flags release in a `finally`.

Codex's regression: 1,180/1,184 tests (four failures are env leakage and one missing ignored
fixture) · all 108 frontend modules HTTP 200 · valid CMYK PDF 1.4 at 330×530 mm with embedded
CID Devanagari and searchable text · valid IDML ZIP · valid Scribus XML · no missing assets.
