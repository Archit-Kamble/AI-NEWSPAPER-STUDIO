# Production readiness — the problem register

Two independent full regressions were run on 2026-09-06: one by Claude on `main`, one by
Codex on `codex/newspaper-block-designs`. This is the combined list, ranked by what it
costs the newsroom on press day.

A twentieth was found by Codex while reviewing the merge, and a twenty-first by
driving the browser net afterwards — that one a fault this pass introduced. A
post-merge review then found four more: a net asserting a gesture the product
had outgrown (#22), a swallowed press (#23), three save races behind the
snapshot fix (#24), and a net robustness change that cost twelve checks (#25).
All seven are closed and all seven are below.

**Twenty-four of the twenty-six are now closed**, on 2026-09-06, and each entry below says what
was done and how it was verified. Three remain, and each of them is blocked on something
this software cannot supply for itself — artwork, a printer's colour profile, or a
decision only the owner can take. They are at the bottom, under **Still open**.

Source is marked: **[C]** Claude's regression, **[X]** Codex's regression, **[C+X]** both
found it independently.

---

## Closed

| | what it was, and what closed it |
|---|---|
| **[C]** #6 | **The press file declared black as NO INK.** `Black = #00000000` in the `.sla` colour table — the attribute is four bytes `#CCMMYYKK`, so C0 M0 Y0 K0, nothing on any of the four plates, on the **443 of 465 text runs (95% of all type)** set in `TXTFILL="Black"`. A press file whose black is no ink prints essentially blank. Now `#000000ff`, which is the rule this project already states for the PDF writer. The byte order is not assumed: `tests/inkAndGround.test.js` asserts `Registration` at `#ffffffff` and `SahasRed` at its own known separation *before* it reads Black, and fails against the old value. White stays `#00000000` — white IS the absence of ink — and the two being byte-identical is what made the fault visible. |
| **[X]** #1 | **Two editors silently overwrote each other.** `page_sections` gains an integer `revision`; the UPDATE carries `AND ($59::int IS NULL OR revision = $59)`. **Opt-in by construction**: a caller that sends no expected revision makes the condition vacuous and saves exactly as before, so the AI writer, the styling pass, the newsdesk run and every script are untouched. A conflict answers **409** (not 400 — a conflict is not a bad request) carrying the current row, and the desk is shown which fields differ and chooses; "Keep mine" re-sends against *their* revision, so a third save asks again rather than being overwritten in silence. Driven through the real routes: 200 → 409 with the server's row intact → 200 after reloading → 200 for a caller sending none. All 6,047 existing rows start at 1 and none changed. |
| **[X]** #2 | **Autosave's retry saved whatever was open when it fired.** `run()` called a zero-argument save that reached into the store, so a retry 1.5s or 4s later wrote the block the desk had moved to. A save is now OF something: `capture()` takes an immutable snapshot once and every retry re-sends that one. The payload is deep-cloned (`payloadFromDraft` carries `tags` and `insetPanels` by reference). And a late answer may no longer mark a **newer** draft saved — `history.markSaved()` runs only when the response is still for the selected block. |
| **[X]** #3 | **Refresh or tab close lost recent copy.** There was no `beforeunload`, no `pagehide` and no local journal anywhere in the workspace. Both added: a guard while a save is outstanding, and `public/editor/autosave/draft-journal.js` — localStorage rather than IndexedDB *precisely because* `beforeunload` cannot await anything. Throttled to one small write per two seconds of typing (the compositor already runs per keystroke), every write wrapped so a full quota or a private window can never make a keystroke fail, bounded at 40 entries / 7 days. It **never restores by itself**: it names the blocks and a person presses it. It journals the **draft**, not the payload — `payloadFromDraft` is a translation, not a copy, and restoring one into the other would drop the byline and pin every Auto block to an explicit column count. |
| **[C+X]** #4 | **The test suite wrote into the real newsroom.** Seven files upserted `admin@esahas.com` and **replaced its password hash** with a constant published in this repository, never restoring it — which is also why nothing noticed, since the tests worked *because* they had corrupted the account. All seven are gone; `tests/helpers/desk-owner.js` makes a disposable per-role login on an `@example.test` address with a random password, removes it, and sweeps abandoned ones. `roles.test.js` addressed self-protection through a literal `/api/staff/1`, which meant "self" only by accident of insertion order — it uses its own seeded owner's id now. `health.test.js` created one edition per run and removed none, and filed news as the real reporter under user id 2; it cleans up in the same `finally` and uses its own account. The twenty browser nets no longer hardcode the credential (`SAHAS_DESK_EMAIL` / `SAHAS_DESK_PASSWORD`). `tests/helpers/test-database.js` **refuses outright** under `NODE_ENV=production` and warns loudly otherwise — it does not refuse on a dev machine, because a fix that turns 1,199 passing tests into zero is not a fix. **The existing rows are NOT deleted — see Still open.** |
| **[X]** #5 | **A published placeholder passed the startup guard.** It named `dev-secret` and nothing else, so `.env.example`'s own `SESSION_SECRET=change-this-secret` walked past it. The guard checks the CLASS of value now — placeholder wording first (so a short placeholder is not merely told to be longer), then length, then character variety — and one test points at `.env.example`'s **actual bytes**, so the two cannot drift. The example ships an **empty** secret rather than an example one. |
| **[X]** #7 | **Repeatedly opening editions made page switching progressively slower.** `subscribeViews()` added seven store subscriptions per render and released none, so five opens meant five page-area renders, five side-panel renders and five guide requests per page click — the measured 1–2 s. `store.subscribe()` has **returned its own unsubscribe since it was written** and no caller had ever used it. Released at the top of `subscribeViews()` and again in `leaveWorkspace()`. The two window listeners are deliberately **not** included: `onWorkspaceResized` is one stable module-level function and the DOM ignores a duplicate registration, so teardown there would be removing a leak that is not there. |
| **[X]** #8 | **Rapid edition navigation could paint the wrong edition.** The navigator's `stale` token was checked before `renderWorkspace` and never again — and everything slow about opening an edition is *inside* that function (two edition fetches, the news list, the identity, the geometry, the fonts, the shaper). It is threaded in and checked at the two points where the function commits. `loadIdentity()` had the same shape one layer down: it set `loadedFor` on the way out and committed unconditionally on the way back, so B's nameplate carried A's volume and issue number whenever A finished last. |
| **[X]** #9 | **Page guides and block images could cross selections.** Both loaders captured their subject, awaited, then wrote a module global — and `redrawCompose()` applies that global to whatever is selected **now**, so a slow response for block A displayed A's photographs inside block B and `history.primeImages()` wrote them into B's opening snapshot, where an undo would restore pictures that were never in it. Both check on the way back and drop a response whose subject is no longer open. |
| **[C]** #11 | **FALSE ALARM, and corrected.** The report was "zero `/ActualText` in a 2.76 MB export". Every content stream is `/FlateDecode`, so that was a grep of compressed bytes. Decompressed, a real four-page export carries **948 `/ActualText` spans**, including the exact string `सूर्योदय ०६:३७ · सूर्यास्त १७:५९ · दिनमान ११ तास २२ मिनिटे`. Extraction with `pdftotext` recovers full Marathi body copy correctly; the words that degrade do so because **poppler does not honour `/ActualText`** and falls back to `/ToUnicode`, which cannot describe many-to-many Devanagari shaping — a limitation `pdf.writer.js` already documents. `tests/pdfTextRecovery.test.js` decompresses the streams and holds it, and fails if the marked content is dropped. |
| **[X]** #12 | **Production environment was not configured.** `.env.example` now documents `NODE_ENV`, `TRUST_PROXY`, `DB_SSL` and `JSON_BODY_LIMIT` — and `TRUST_PROXY` and `DB_SSL` are **wired**, not merely documented: a variable nothing reads is the mechanism-with-no-surface fault this codebase records three times. `DB_SSL` defaults to off, so no existing deployment changes; `TRUST_PROXY` is deliberately not defaulted on in production, because trusting a forwarding header from a client that is *not* behind a proxy lets it claim any address and turns the login throttle into a way past itself. |
| **[X]** #13 | **Dependency and header hardening.** CSP, Permissions-Policy, HSTS (production only), `x-powered-by` off. The policy admits `'wasm-unsafe-eval'` — without it Chrome refuses `WebAssembly.instantiate` and the HarfBuzz shaper never becomes ready, so every block would silently compose against the fallback grid — and `'unsafe-inline'` for **style only**, because `render.js` positions every composed line with a style attribute. `express.json` came down from **50 MB** (parsed before anything asks who is sending it) to a configurable 5 MB; pictures and press files are multipart and bounded separately. `npm` and `start` were production dependencies and nothing required either. **Vulnerabilities 10 (6 high, 4 moderate) → 3 (moderate)**: removing those two deps and taking `onnxruntime-node` to 1.29.0 cleared both highs, and the ONNX cut-out model was re-verified loading with the same input/output shape. The remaining three are Express 4's transitive `body-parser`/`qs`; Express is already at the latest 4.x and the fix requires **Express 5**, a breaking major — see Still open. |
| **[X]** #14 | **Cold load was heavy.** Three measured changes, no API contract touched. **Compression** (`compression`, registered first so it wraps the API too): the editor's 90-module graph **1.63 MB → 0.56 MB (66%)**, `styles.css` **328 KB → 88 KB**, `/api/news` **2.02 MB → 170 KB**, `/api/newspapers` **330 KB → 10 KB**. **One font reader** (`public/editor/compose/font-bytes.js`): `font-metrics.js` and `shaper.js` each carried a byte-identical `readFontFile()` and each independently fetched every face, so a desk downloaded the paper's ten faces **twice** — 3.2 MB arriving as 6.4 MB. **The editor is loaded on demand**: `admin.js` imported `editor/workspace.js` statically, so the login screen fetched 108 modules of layout desk before it could draw a form. Fonts and vendored libraries are held for a day; the application's own code still revalidates, because a deploy leaving desks on yesterday's editor is a far worse fault than a slow load. |
| **[C]** #15 | **One genuinely unguarded `fetch(...).json()`.** The Publish dialog read the edition with no `response.ok` and no `.catch()`, so on a 401 or 500 it drew its question for an edition it had never loaded, and on a non-JSON answer it threw inside an async click handler and the button silently did nothing. Guarded, and a failure now says so with a retry. |
| **[X]** #16 | **Accessibility gaps.** The publication modal had no dialog semantics, focus trap or restore, no Escape and no accessible close — fixed by putting it on `public/ui/dialog.js`, which already had all of that, **removing a second dialog implementation** rather than teaching it to behave. Page pills gained `aria-current` and a real label ("Page 4, has copy") instead of state carried in colour alone; the Story Explorer close button gained a name. |
| **[C]** #19 | **Housekeeping.** Two nets wrote screenshots over **tracked** files, so every verification run dirtied the working tree; they write to a gitignored `runs/` now and the historical shots stay. The 41 equal-specificity CSS conflicts are unchanged and remain cosmetic debt. |

### #20 — found by Codex during the merge review, and confirmed independently

**`schema.sql` never declared `newspapers.template`**, which
`newspaper.repository.js` names in **both** of its INSERTs. Invisible on every
database that exists — they all carry the column — and fatal on a fresh
install, where creating the very first edition fails with
`column "template" of relation "newspapers" does not exist`. The **third**
instance of this drift here, after `news_items.newspaper_id`'s ON DELETE rule
and the `users.role` CHECK.

`tests/schemaBootstrap.test.js` applies the whole file into a transaction-scoped
schema namespace, creates an edition, applies it again to prove re-running is
free, and rolls it all back. Checked both ways: it fails against the old file
with exactly that error.

### #21 — an expired timeout made autosave believe a save was always pending

Introduced by this pass's own #2/#3 work and caught by the browser net.
`schedule()` stores the debounce id in `timer` and nothing cleared it once the
timeout **fired**, so `isOutstanding()` was permanently true from the first
autosave onwards. The unload guard would have asked every desk to confirm
leaving on every navigation, and the journal's forced write then left an entry
for a block that was safely saved — which the next page load offered to restore,
as a modal whose backdrop covered the canvas. Cleared at the top of `run()`;
verified in the running app.

The journal's DRAFT subscriber is now guarded on `store.isDirty()` for the same
family of reason: that topic fires after a save has landed too.

### #22 — a net that outlived the gesture it was pinned to (NOT a product fault)

**[C]** `headline-focus.browser.js` failed 9/11 deterministically while this register
recorded it as a flake. Bisected against servers booted at `c19d93c` and the pre-merge
`74b1578` — it fails at both, so nothing in the merge caused it.

A product fix was written for it and **reverted**, which is the useful part. The trace
looked exactly like a fault (`renderExternalEditor()` destroys the field the caret is
in, then the fresh mount parks focus on `.workspace-shell`), and a fix that restored the
caret measured working. It was wrong: `focusin` on a display field SELECTS that part, so
restoring the caret would have silently undone the gesture that caused the rebuild.

Following that through gives the real answer. The check's comment says *"Re-selecting
the block is what mounts it again"*, true when written — that click used to return early
and do nothing. `selectSection()` now treats it as *select the BLOCK itself*, so the desk
has genuinely moved to another object and the caret leaving the headline is correct. The
check asserted the old product; it now asserts the invariant its own name states (the
load may not pull the caret INTO THE STORY), and `workspace-shell` is not the story. The
two load-bearing checks beside it — 0 of 24 keystrokes reaching the copy, 24 of 24
reaching the headline — passed throughout. 11/11.

### #26 — a reversed headline drew no panel, and its type is white

**[Desk]** Reported against edition 40082's 620x224 banner: the headline never
appeared on the layout, and appeared in the Block Editor only after a double click —
which is the inline editable field, styled from the stored value while every other
surface draws the composition.

The composition was correct: one line, full text, at the locked size. `roomBelow()` in
`render.js` bounds a reverse panel's bleed against the next display band, else the first
body line — and read `firstBody.top`. A composed LINE carries `y`; only a BAND carries
`top`. So it returned undefined, `undefined - MIN_PANEL_GAP` is NaN, and `panelRect()`
answered `height: NaN`. The browser drops `height:NaNpx`, the panel collapses, and the
type is white because that is what `reverse` means. White on white paper.

Reaching that fallback needs a block with no deck AND no kicker, which is why it
survived — every reversed fixture had a subheading. Swept: `reverse` is on 5 blocks,
exactly 1 without a deck, the one reported. **The press path shares `panelRect()`
deliberately**, so the `.sla`, the PDF and the IDML were emitting a NaN-height panel for
that block too — each writer's `if (rect)` guard passes, because the rect is truthy.

Held by `tests/displayType.test.js`, which fails against the old property.

### #25 — a robustness change to a net cost twelve checks

**[X]** `workspace.browser.js` 224/224 → 212/224. Its "click empty room" point was found
by scanning from `(2, 2)` — the ~2px margin corner that the comment directly above the
scan says to stay out of, because a test that depends on which side of it the hit lands
is testing rounding rather than the product. The concern behind the change was real, so
the scan is kept and made to mean what the comment says: inset from the edge, and empty
only when the neighbours are empty too. 224/224.

### #23 — a press on a panel selected nothing, and swallowed the block's own click

**[C]** Arrived with the merged branch. The panel drag layer is drawn over the block
already open, its `pointerdown` calls `stopPropagation()`, and it selects nothing —
while its own comment claims *"Selected on POINTERDOWN, like every other object on this
page"*. Over a panel's rectangle (a quarter of the block for a chart, its whole width
for a cross-head) the press did nothing at all, killing the documented *click a block
that is already open to select the block itself* — the only way back to Border, Ground,
Columns and Drop cap once the caret has been in the body.

Read at first as a test colliding with its own fixture, and the workaround for that
reading is to press Escape — which is precisely the symptom this codebase already fixed
once. The frame now selects the owning block through the canvas's own
`onSelectSection`. `visual-pass.browser.js` presses the panel and asserts it; reverting
the one line takes it from 47/47 to 45/47 with exactly that diagnosis.

### #24 — three save races behind the snapshot fix

**[X]** found in the post-merge review, verified and merged here. A stale `saved`
cleared the dirty flag for newer typing; a late receipt erased a newer recovery entry;
and `flush()` returned while a request was still in flight, so a navigation could switch
blocks before the last keystrokes were captured. Closed by comparing the acknowledged
snapshot against the live draft, a `through` timestamp on `journal.forget()`, and
`flush()` draining the in-flight save with `selectSection`/`selectPage` awaiting it
behind a `selectionRequest` counter.

**The wait is bounded at 5s** — added here on top of that work. Awaiting an unanswered
save turns one dead request into an editor that ignores clicks, with no error on screen
because the save has not failed, it simply has not come back. A failed save settles at
once, so the bound only releases a request that never answered, and the draft is already
in the recovery journal. `tests/autosaveRace.test.js` — 12 tests, each of the four
failing against the code without its fix.

### And one the CSP found rather than merely being adopted

Four inline `onerror` handlers — the broken-image fallbacks on the canvas's placed picture,
a block's thumbnail, the Pictures panel and the Story Explorer — measured as **263 CSP
violations in one net run**. They matter more than they look: under a policy worth having
they would silently **stop working**, and the desk would see the broken glyph they exist to
remove, with nothing anywhere saying why. `public/ui/broken-image.js` replaces all four with
one capture-phase listener at the document — `error` does not bubble, which is why the
capture flag is load-bearing. After it: **224/224 with zero violations and zero console
errors**, where the same net had been exit 1.

---

## Still open

Each of these is blocked on something outside the code.

### 10. **[X]** The masthead artwork is below press resolution

`sahas-nameplate.png` is 1600×300 and measures ~190 PPI in the generated press file. It
should be vector, or at least 300 PPI at printed size — **1600×300 cannot be resampled into
either**. This needs the original artwork from whoever drew the nameplate; nothing in the
software can create resolution that is not in the file. The RNI number is part of that
artwork, so it is a registered mark rather than something to redraw.

- `src/layout/identity.js:31`, `src/services/export/print-model.js:864`

### 17. **[X]** The PDF is valid CMYK but not a colour-managed press standard

No ICC profile, no OutputIntent, no PDF/X declaration, no bleed geometry; the DeviceCMYK
conversion is deliberately naïve and says so (`pdf.writer.js:36`). This is **not wrong** —
it is honest about having no colour-management pipeline — but SAHAS should not describe the
output as universally press-ready. Closing it needs the press to state its own ICC profile
and required PDF/X variant; those then belong in preflight. Ask the printer.

### 4 (second half). The 266 fixture editions already in the database

The leak is fixed and nothing new accumulates. What is already there is **the owner's data
to remove**, so it is not removed here:

```
node scripts/prune-test-fixtures.js                            # reports, changes nothing
node scripts/prune-test-fixtures.js --delete --i-have-a-backup # after a pg_dump
```

Measured: **266 of 477 editions**, 4,222 blocks (70% of `page_sections`), 1,660 filings,
all of them one `health.test.js` run repeated — `2099-01-01`, named `साहस`, one page,
`finalised`, two placeholder files.

**The script's first version was wrong in the most dangerous possible direction** and it is
worth recording why. It filtered on "2099-dated, no e-paper release, **no press file**" —
and the leaked editions all *do* carry press files, because the leaking test uploads a fake
`.sla` and `.pdf` on every run. So that filter excluded all 266 and selected the **ten that
were left**, which are the editions the browser nets open by default (40294, 44929, 49291)
and the showcase page CLAUDE.md tells you to look at. Running it would have deleted the
useful fixtures and kept the junk. It matches the leak's measured signature instead, and
prints the list it is **keeping** so the claim can be checked rather than believed.

### 18. **[X]** CI

`npm run test:browser` now runs all twenty nets serially against the running app, reporting
the **last** line rather than the first failure — this repository has been bitten by a net
that crashed at check 18 of 211 and looked like a pass. Actual CI (a runner, an isolated
database, artifact retention) is an infrastructure decision with a cost, not a code change,
so it is left for the owner. The database side is ready for it: point `DB_NAME` at anything
ending `_test` and `tests/helpers/test-database.js` stops warning.

### 13 (remainder). ~~Express 5~~ — CLOSED, and the premise was wrong

This entry said *"the fix is Express 5"*. It is not, and that claim would have bought a
router/`req.query`/error-handling migration to fix two advisories in a leaf dependency.

All three advisories are **`qs`**, reached twice: Express parses `req.query` with it, and
body-parser's extended urlencoded parser uses it. `qs@6.16.0` is the patched release.
Express 4.22.2 and body-parser 1.20.6 both declare `qs@~6.15.1`, and a tilde range cannot
reach 6.16 — which is the whole of why `npm audit fix` could not do it and why Express 5
looked like the only road.

One `overrides` entry in `package.json` reaches it: **3 moderate → 0 vulnerabilities.**

**Pinned exactly, not floated.** Express and body-parser were tested against 6.15.x, so
forcing 6.16.0 is already a small leap the suite has to validate; a `^6.16.0` override
would let every future install run a combination nothing here has checked. `npm audit` is
what says when to move it.

Verified rather than assumed, because `qs` sits under every request: the whole suite
(1213 unit tests, 20/20 browser nets) plus a direct parity check of what `qs` actually
decides — scalars, repeated keys, `a[b]` nesting, `tags[]` arrays, a Devanagari value and
an urlencoded form body. All identical.

Express 5 remains available and is no longer urgent: nothing on this register needs it.

---

## Known flakes — recorded, not bugs

- `tests/browser/body-editing.browser.js` — **no longer a flake and no longer
  failing**: it was the expired-timeout fault above plus a real race of its own
  (an out-of-band fixture PUT landing inside the autosave debounce, which the
  optimistic lock correctly refuses with a 409). 35/35, exit 0, zero console
  errors.
- `tests/currentNewsWriting.test.js` "check the sources first" — failed ~1 run in 4 inside a
  full sweep. **Still not diagnosed.** The obvious explanation was checked and is wrong:
  `withProviders` deletes the whole real chain before installing its stubs (that was fixed
  in an earlier pass, and CLAUDE.md records it), so nothing there can reach a live account.
  It did not recur across three full suite runs during this work. Left recorded rather than
  papered over — loosening an assertion nobody has explained would hide a real
  extra-charge path, which is exactly what that check is for.
- `tests/browser/headline-focus.browser.js` — **was recorded here as a flake and was
  not one.** It failed 9/11 deterministically (three runs alone, three more in the
  suite). Bisected against servers booted at `c19d93c` and the pre-merge `74b1578`: it
  fails at both, so it is older than this pass and nothing in the merge caused it — but
  it is real, and reproduces with an ordinary desk gesture. See **#22** below. A test
  that fails intermittently is not automatically a flake; this one was believed to be
  because it had only ever been run in a sweep.

## Verified sound — do not re-audit

Claude's regression: schema drift **zero** · all four exports produce valid artifacts ·
86 written blocks compared canvas-vs-plate with **0** headline/body/rule/ground mismatches ·
API 404 answers JSON · unauthenticated desk GET → 401 · `nosniff` present · PostgreSQL
session store · `unhandledRejection`/`uncaughtException`/`SIGTERM` handlers · login throttle
wired · upload byte-signature check · e-paper non-selected assets 404 and traversal 404 ·
PDF is CMYK (0 `DeviceRGB`) · the `'; DROP TABLE page_sections; --` fixture headline is
correctly XML-escaped in the `.sla` · 113 browser modules parse as ESM with 0 syntax
failures · only the two documented dead mechanisms (`border_color`, `letter_spacing_px`) ·
all four `working()` guard flags release in a `finally`.

Codex's regression: all 108 frontend modules HTTP 200 · valid CMYK PDF 1.4 at 330×530 mm
with embedded CID Devanagari and searchable text · valid IDML ZIP · valid Scribus XML · no
missing assets.
