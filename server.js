require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const dotenv = require("dotenv");
const multer = require("multer");
const { templates } = require('./src/layout/templates');
const { geometryOf } = require('./src/layout/geometry');
const { identityFor } = require('./src/layout/identity');
const ai = require('./src/services/ai');
const { asyncRoute } = require('./src/middleware/asyncRoute');
const pool = require('./src/config/db');
const { deskWrites, requireAdmin, requireDesk, requireSignIn } = require('./src/middleware/auth');
const { syncTemplates } = require('./src/layout/syncTemplates');
const { upload, verifyUploadedImages } = require('./src/middleware/upload');
const { PostgresSessionStore } = require('./src/middleware/sessionStore');
const { guardIdParams } = require('./src/middleware/params');
const newsRoutes = require('./src/routes/news.routes');
const newspaperRoutes = require('./src/routes/newspaper.routes');
const pageRoutes = require('./src/routes/page.routes');
const authRoutes = require('./src/routes/auth.routes');
const featureRoutes = require('./src/routes/feature.routes');
const staffRoutes = require('./src/routes/staff.routes');
const settingsRoutes = require('./src/routes/settings.routes');
const newspaperController = require('./src/controllers/newspaper.controller');
const { hydratePublicationIdentity } = require('./src/services/settings.service');

dotenv.config();

// The session secret signs every desk's login cookie. "dev-secret" is fine on
// a desk machine on a newsroom LAN in development - it is not fine on a
// production deploy, where anyone who knows this codebase is public would
// know the fallback and could forge a session. Only enforced when
// NODE_ENV=production is actually set, so local dev and npm test - which
// never set it - are unaffected.
//
// A GUARD THAT REJECTS ONE STRING REJECTS ONE STRING. It named "dev-secret"
// and nothing else, so `.env.example`'s own published placeholder -
// SESSION_SECRET=change-this-secret, a value in this repository for anyone to
// read - walked straight past it. A deploy that copied the example and
// changed everything except the line telling it to change that line would
// have signed every desk's cookie with a public constant.
//
// So the check is on the CLASS of value, not on a list of them: anything
// short, and anything that reads like a placeholder rather than a secret.
// PLACEHOLDER_WORDS are matched as substrings, case-insensitively, because a
// real secret is random and will not contain the word "secret" or "change"
// except by an accident far less likely than a copied example.
const MIN_SECRET_LENGTH = 32;
const PLACEHOLDER_WORDS = [
  "dev-secret", "change-this", "changeme", "change-me", "your-secret",
  "placeholder", "example", "xxxxx", "todo", "sahas-secret", "secret-here",
];

// The order of these checks is the order of how USEFUL the answer is, not the
// order they were written in. A placeholder is diagnosed before length,
// because "change-this-secret" is both short AND a placeholder, and being
// told to make it longer would invite a deploy to pad the placeholder rather
// than replace it.
function sessionSecretProblem(secret) {
  if (!secret) return "it is not set at all";
  const lower = secret.toLowerCase();
  const word = PLACEHOLDER_WORDS.find((w) => lower.includes(w));
  if (word) return `it contains the placeholder text "${word}"`;
  if (secret.length < MIN_SECRET_LENGTH) {
    return `it is ${secret.length} characters and must be at least ${MIN_SECRET_LENGTH}`;
  }
  // A secret made of one repeated character is long and carries no entropy.
  if (new Set(secret).size < 8) return "it is made of too few distinct characters to be random";
  return null;
}

function assertSessionSecretConfigured() {
  if (process.env.NODE_ENV !== "production") return;
  const problem = sessionSecretProblem(process.env.SESSION_SECRET);
  if (!problem) return;
  throw new Error(
    `SESSION_SECRET is not usable in production: ${problem}. ` +
    "It signs every desk's login cookie, so anyone who can guess it can forge " +
    "a session and take the paper over. Generate one with: " +
    "node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
  );
}

function createApp(options = {}) {
  assertSessionSecretConfigured();
  const app = express();
  app.set("sessionStore", options.sessionStore || new PostgresSessionStore());

  // A BROWSER MUST NOT GUESS WHAT A STORED FILE IS.
  //
  // `nosniff` is the layer under the upload whitelist: even if something got
  // onto disk with a name this paper did not choose, a browser may not decide
  // from the bytes that it is a document and run it. The other two are
  // ordinary hygiene for an application that holds a newsroom's session -
  // it is never framed, and it does not leak the edition being worked on into
  // a third party's referer log.
  // The e-paper routes below hang off the app rather than a router, so the
  // id guard is registered here as well. Without it `/epaper/abc` reaches the
  // repository as NaN and answers 500 instead of "that is not an edition".
  guardIdParams(app);

  // The version of Express this newsroom runs is not a fact a visitor needs,
  // and it is the first thing an automated scan reads.
  app.disable("x-powered-by");

  // WHERE TLS IS TERMINATED DECIDES WHETHER THE COOKIE IS EVER SENT.
  //
  // The session cookie is `secure` under NODE_ENV=production. When TLS is
  // terminated by a reverse proxy rather than by Node - which is how this is
  // normally deployed - Express sees a plain HTTP connection and a secure
  // cookie is set on a request the browser was told was insecure, so the desk
  // cannot stay signed in. Trusting the proxy's X-Forwarded-Proto is what
  // makes `req.secure` true and the cookie reach the browser.
  //
  // Off unless configured, and deliberately not defaulted on in production:
  // trusting a forwarding header from a client that is NOT behind a proxy
  // lets that client claim any address it likes, which would be handed
  // straight to the login throttle - keyed on the account and the address
  // together - and turn the throttle into a way past itself.
  if (process.env.TRUST_PROXY) {
    const hops = Number(process.env.TRUST_PROXY);
    app.set("trust proxy", Number.isFinite(hops) ? hops : process.env.TRUST_PROXY);
  }

  // WHAT THIS PAGE MAY LOAD, AND FROM WHERE.
  //
  // Every byte this application serves is its own: one module script, a local
  // Quill, local fonts, local uploads. So the policy is 'self' throughout and
  // costs the product nothing - which is exactly why it is worth having, as
  // the layer under the upload whitelist and `nosniff`. If a file ever did
  // reach disk with a name this paper did not choose, `script-src 'self'`
  // still refuses to run anything a THIRD party hosts, and `object-src
  // 'none'` refuses the plugin embeds that are the usual way round a policy.
  //
  // Two entries are load-bearing and must not be tidied away:
  //
  // - 'wasm-unsafe-eval'. The compositor's shaper is HarfBuzz compiled to
  //   WebAssembly, and Chrome refuses WebAssembly.instantiate under any
  //   script-src that does not admit it. Without this the shaper never
  //   becomes ready - which in Node is a thrown EXACT_SHAPER_NOT_READY and in
  //   the browser is every block silently measured against the fallback grid,
  //   a page composed against a font it is not set in. It is far narrower
  //   than 'unsafe-eval': it permits WASM compilation and still refuses
  //   eval() and new Function().
  //
  // - 'unsafe-inline' for STYLE ONLY. This product positions every composed
  //   line by writing a style attribute - that is what render.js IS - so a
  //   policy without it would leave the newspaper canvas unpositioned. It is
  //   not extended to script-src, where it would give away the whole
  //   protection; the palette boundary at the service is what keeps arbitrary
  //   text out of those attributes, and that check is unchanged.
  //
  // img-src carries data: and blob: because a picture is cropped and previewed
  // in the browser before it is ever uploaded.
  const CSP = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", CSP);
    // This application asks for none of these. Saying so stops an embedded
    // third party asking on its behalf.
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    );
    // HSTS only where TLS is actually terminated in front of Node. Sent on a
    // plain-HTTP deployment it is ignored by browsers, but sending it there
    // would still be a promise this deployment has not made.
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });

  // A BODY IS PARSED BEFORE ANYONE HAS SIGNED IN.
  //
  // This was 50mb, and express.json runs ahead of every route and every
  // guard - so an anonymous request could make this server buffer and parse
  // fifty megabytes of JSON before anything asked who was sending it. Nothing
  // in this product needs that: pictures and the final press files arrive as
  // MULTIPART and are bounded by multer's own limits (10 MB an image, 50 MB a
  // press file), which express.json never sees. The largest legitimate JSON
  // body here is a page save or an e-paper map, both far under a megabyte.
  //
  // Configurable, because the ceiling belongs to a deployment rather than to
  // this file, and generous enough that no real payload can meet it.
  const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "5mb";
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));
  // Session comes before the e-paper image gate so a signed-in desk can
  // preview a private release, while anonymous visitors remain limited to
  // the single selected public issue.
  app.use(
    session({
      // A desk's login outlives a restart, and expired sessions are swept.
      // Without a store this is express-session's MemoryStore, which leaks and
      // signs the whole desk out whenever the process restarts.
      store: app.get("sessionStore"),
      secret: process.env.SESSION_SECRET || "dev-secret",
      resave: false,
      saveUninitialized: false,
      // The cookie carries a desk's authority over the whole paper.
      // `secure` was hard-coded false, so on any HTTPS deployment it was
      // also sent over plain HTTP; it follows the deployment now. `sameSite`
      // stops another site's page driving a desk's session by making the
      // browser attach the cookie to its own cross-site request.
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 12 * 60 * 60 * 1000,
      },
    }),
  );
  // Generated e-paper assets sit under public/uploads for deployment
  // simplicity, but they are not ordinary static uploads. This route comes
  // first so a guessed PNG URL cannot reveal an edition before Publish or
  // after the desk removes its public copy.
  app.get("/uploads/epaper/:id/:filename", asyncRoute(newspaperController.epaperAsset));
  app.use(express.static(path.join(__dirname, "public")));

  // A HEALTH CHECK THAT DOES NOT CHECK ANYTHING IS WORSE THAN NONE.
  //
  // This answered `{status:"ok"}` unconditionally, without touching the
  // database. So a monitor watching it stayed green while every real request
  // returned 500 - the one situation the check exists to catch. It asks the
  // database the cheapest question there is now, and says which part is down.
  app.get("/api/health", asyncRoute(async (req, res) => {
    try {
      await pool.query("SELECT 1");
    } catch (error) {
      console.error(`[${new Date().toISOString()}] health: database unreachable`, error.message);
      return res.status(503).json({ status: "degraded", database: "unreachable" });
    }
    return res.json({ status: "ok", database: "ok" });
  }));

  app.use("/api/auth", authRoutes);

  // Owner-only identity and publication setup. These routes intentionally sit
  // outside the deskWrites mount: a colleague's profile and contact details are
  // private and cannot become public merely because GET is normally read-only.
  //
  // It is `/api/staff`, not `/api/reporters`, because it stopped being about
  // reporters: an owner adds and blocks editors and Sampadaks here too, and a
  // route named for one of the four roles it manages is the fault this project
  // states as "every control names the object it acts on".
  app.use('/api/staff', requireAdmin, staffRoutes);
  app.use('/api/settings', requireAdmin, settingsRoutes);

  // News API
  // Reporters file here, so signing in is enough; the desk-only check is on
  // the make-up routes below.
  app.use("/api/news", requireSignIn, newsRoutes);

  app.post("/api/uploads/images", requireSignIn, upload.array("images"), asyncRoute(verifyUploadedImages), (req, res) => {
    const files = req.files || [];
    res.status(201).json({
      imageUrls: files.map((file) => `/uploads/${file.filename}`),
      imageFiles: files.map((file) => file.filename),
    });
  });

  // Newspaper API
  app.use("/api/newspapers", deskWrites, newspaperRoutes);

  // Templates API
  app.get("/api/templates", (req, res) => {
    res.json(Object.values(templates));
  });

  // Print geometry API. The px-per-mm scale, the matter box, the column grid and
  // the baseline are computed in src/layout/geometry.js and served from here, so
  // the browser never carries a second copy of the numbers that decide how the
  // page prints (CLAUDE.md: no duplicated data catalogs, never mix px and mm
  // silently).
  app.get("/api/geometry", (req, res) => {
    res.json(geometryOf({}));
  });

  // Masthead identity API - the standing furniture of the paper.
  //
  // Given an edition's date and page count it also returns that edition's
  // volume and issue number, computed in src/layout/identity.js from the date
  // the paper was founded. The desk never keys a number that a date already
  // determines.
  app.get("/api/identity", (req, res) => {
    res.json(identityFor(req.query.date, req.query.pages));
  });

  // Standing features API
  app.use("/api/features", deskWrites, featureRoutes);

  // Which provider writes this paper's copy, who covers for it, and the tiers
  // of effort on offer. The editor reads this to build its dropdown - so the
  // menu describes the newsroom that is actually configured rather than a fixed
  // list of names, and says plainly when nothing is set up at all.
  app.get("/api/ai/status", requireDesk, (req, res) => {
    res.json(ai.status());
  });

  // The desk has a private list of released snapshots. The link given to
  // another website is simply /epaper: it opens the one radio-selected issue
  // and carries no id, token or write capability.
  app.get("/api/epapers", requireDesk, asyncRoute(newspaperController.epaperList));
  app.get("/epaper/preview/:id", requireDesk, asyncRoute(newspaperController.epaperPreviewHtml));
  app.get("/epaper", asyncRoute(newspaperController.selectedEpaperHtml));
  app.get("/epaper/:id/pdf", asyncRoute(newspaperController.epaperPdf));
  app.get("/epaper/:id", asyncRoute(newspaperController.epaperHtml));
  app.get("/_internal/epaper-canvas/:token", asyncRoute(newspaperController.epaperCanvasCaptureHtml));

  // Page API
  app.use("/api", deskWrites, pageRoutes);

  // EVERY FAILURE THAT REACHES HERE IS RECORDED, AND ONLY THE ONES THE CALLER
  // CAUSED ARE BLAMED ON THE CALLER.
  //
  // This used to answer every error with `400 Bad Request` and the error's own
  // `message`, and log nothing at all. Three things were wrong with that, and
  // all three cost a newsroom time on the one day it matters:
  //
  //   - a bug in this software, a dropped database connection or a missing
  //     font file was reported to the desk as "you sent something wrong". A
  //     desk told that will retype the request, which cannot help.
  //   - the raw internal message went to the browser. `relation
  //     "page_sections" does not exist` is not a sentence for a sub-editor and
  //     is not a sentence for the public either.
  //   - NOTHING WAS LOGGED. A failure left no trace anywhere, so the only
  //     record of it was whatever the desk remembered.
  //
  // Multer's own errors are genuinely the caller's (a file too large, an
  // unexpected field) and keep their message and their 400. An error a service
  // raised deliberately can say so by carrying `status`. Everything else is
  // ours: 500, a sentence a person can act on, and the real one in the log.
  app.use((error, req, res, next) => {
    if (!error) return next();

    const status = error instanceof multer.MulterError
      ? 400
      : Number(error.status || error.statusCode) || 500;

    // One line per failure, always - including the ones answered as 400, so a
    // run of malformed requests is visible too.
    console.error(
      `[${new Date().toISOString()}] ${status} ${req.method} ${req.originalUrl}`,
      status >= 500 ? (error.stack || error.message) : (error.message || error),
    );

    if (res.headersSent) return next(error);
    return res.status(status).json({
      error: status >= 500
        ? "Something went wrong on the server. The edition is unchanged; try again, and tell the desk if it keeps happening."
        : (error.message || "That request could not be accepted."),
    });
  });

  // AN API PATH THAT DOES NOT EXIST SAYS SO, IN JSON.
  //
  // The SPA catch-all below answered EVERY unmatched path with index.html and
  // a 200 - including `/api/*`. So a mistyped or removed endpoint came back as
  // a successful HTML document: `response.ok` was TRUE, and the caller's
  // `.json()` then threw a parse error from inside an async handler with
  // nothing on screen to say why. That is the same silent failure this
  // codebase already fixed for the five unchecked page re-reads, arriving
  // through the router instead. An API route must never resolve to the
  // application shell.
  app.use("/api", (req, res) => {
    res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` });
  });

  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  return app;
}

// ONE STRAY PROMISE MUST NOT TAKE THE PAPER OFF THE AIR.
//
// Node terminates the process on an unhandled rejection - verified on the
// version this runs under - and there was no handler anywhere. So a single
// forgotten `.catch()` in any service, on any request, killed the server for
// the whole newsroom, in the middle of an edition, and left NOTHING in any log
// to say what had happened. That is the same fault the catch-all error handler
// was written to fix, one level up, where it is fatal instead of merely
// silent.
//
// The two are deliberately treated differently. A rejected promise is a bug in
// one request and the process is still sound, so it is recorded and the paper
// stays up. An uncaught exception may have unwound the stack anywhere, so the
// process is no longer trustworthy: it is recorded and the server is closed
// down deliberately, for the supervisor to restart, rather than left serving
// from an unknown state.
function installCrashHandlers(server) {
  process.on("unhandledRejection", (reason) => {
    console.error(
      `[${new Date().toISOString()}] UNHANDLED REJECTION - the edition is unchanged and the server is still up`,
      reason instanceof Error ? (reason.stack || reason.message) : reason,
    );
  });

  process.on("uncaughtException", (error) => {
    console.error(
      `[${new Date().toISOString()}] UNCAUGHT EXCEPTION - shutting down; the supervisor should restart`,
      error?.stack || error,
    );
    shutdown(server, 1);
  });
}

// A DEPLOY IN THE MIDDLE OF A SAVE MUST NOT LOSE THE BLOCK.
//
// Without this, SIGTERM kills the process outright and every request in flight
// dies with it - including a block being written. Refusing new connections and
// letting the open ones finish costs a few seconds and is the difference
// between a restart and a lost story. The timer is the backstop for a request
// that never finishes.
let shuttingDown = false;
function shutdown(server, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("Shutting down: finishing requests already in flight...");
  const force = setTimeout(() => {
    console.error("Shutdown timed out; exiting anyway.");
    process.exit(code || 1);
  }, 10000);
  force.unref?.();
  server.close(() => {
    pool.end().catch(() => {}).finally(() => process.exit(code));
  });
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  const sessionStore = new PostgresSessionStore();
  const app = createApp({ sessionStore });

  // Each of these is reported as ITSELF. They used to share one `.catch`
  // labelled "Publication settings load failed", so a template-sync failure
  // was logged as a settings failure - a misleading line is worse than none at
  // four in the morning. Neither is fatal: the server still listens, so the
  // health check can be reached and can say what is wrong.
  const ready = sessionStore.ready()
    .catch((error) => { console.error("Session store unavailable:", error.message); })
    .then(() => syncTemplates()
      .then((count) => console.log(`Synced ${count} layouts`))
      .catch((error) => { console.error("Layout sync failed:", error.message); }))
    .then(() => hydratePublicationIdentity()
      .catch((error) => { console.error("Publication settings load failed:", error.message); }));

  ready.finally(() => {
    const server = app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
    });
    installCrashHandlers(server);
    process.on("SIGTERM", () => shutdown(server, 0));
    process.on("SIGINT", () => shutdown(server, 0));
  });
}

module.exports = { createApp };
