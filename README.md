# SAHAS

An AI-assisted newspaper production system built for a real customer (SAHAS
VARTA) who runs it daily — not a CMS, blog platform, or generic page builder.

**Read [`VISION.md`](VISION.md) first.** It is the project's constitution: the
product, the production workflow, and the design and AI philosophy.
[`CLAUDE.md`](CLAUDE.md) describes how the code is built and what is actually
live versus legacy versus still scaffolding — read it before changing
anything. [`PROJECT_STATUS.md`](PROJECT_STATUS.md) is the running log of every
pass made against the codebase, in the order it happened.

## Stack

- Frontend: HTML/CSS/vanilla JS, `<script type="module">` + dynamic `import()`
  — no framework, no bundler.
- Backend: Node.js + Express, session-based auth (CommonJS, `require`).
- Database: PostgreSQL.
- AI: Gemini (primary), Sarvam and Anthropic as fallback — see
  [`docs/AI.md`](docs/AI.md).

## Running it

```bash
cp .env.example .env   # fill in DB_* and an AI provider key
npm install
node server.js
```

The app serves on `PORT` (default 3000). Stop it by finding the PID bound to
that port and killing it directly — `pkill -f "node server.js"` kills the
shell that launched it instead, and the process shows in `ps` as `MainThread`,
not `node`, so `pgrep -x node` will not find it either:

```bash
pid=$(ss -ltnpH "sport = :3000" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
kill "$pid"
```

## Testing

```bash
npm test                                    # tests/*.test.js, real Postgres, real createApp()
node tests/browser/workspace.browser.js     # drives the running app in a real browser
```

`npm test` does not see the browser, and most of this product is the browser
— every UI regression this project has had was found by driving the running
app, never by reading code. The browser suite needs the app running on
`:3000`, `playwright-core`, and Chrome at `/usr/bin/google-chrome`
(`CHROME_PATH` overrides).

## Further reading

- [`docs/AI.md`](docs/AI.md) — the AI writing pipeline, budgets, retry policy, the verified-information layer.
- [`docs/EDITOR.md`](docs/EDITOR.md) — the Block Editor: what happens when a block is selected, Smart Cards, module boundaries.
- [`docs/FUTURE-ARCHITECTURE.md`](docs/FUTURE-ARCHITECTURE.md) — where the upcoming Layout Engine and AI Fill projects attach to the current system.
