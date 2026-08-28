// A PASSWORD MAY NOT BE GUESSED AT SIXTY-SEVEN TRIES A SECOND.
//
// The login route had no throttle of any kind. Measured against the running
// server: twenty wrong passwords for the owner's own account answered in
// 297 ms, and the twenty-first was treated exactly like the first - about
// 5.8 million guesses a day against the account that can create logins, block
// reporters and change the paper's settings.
//
// It is also a denial of service in its own right. Every attempt costs a
// bcrypt comparison, which is expensive ON PURPOSE, so an attacker who does
// not care about getting in can spend the newsroom's CPU instead and take the
// desk offline on press day.
//
// Deliberately a bare in-process Map with a sweep, matching what this project
// already does for the information cache and for the same stated reason: this
// is one newsroom on one machine, and adding Redis to rate-limit a login would
// be new infrastructure to run, monitor and get wrong.
//
// Keyed on the ACCOUNT and the ADDRESS TOGETHER, and this matters both ways:
// keyed on the address alone, a whole newsroom behind one router locks each
// other out; keyed on the account alone, anyone can lock the editor out of
// their own paper on deadline by guessing at it - the throttle becomes the
// attack. A pair means an attacker slows down only themselves.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const SWEEP_MS = 5 * 60 * 1000;

const failures = new Map();

function keyFor(req) {
  const email = String(req.body?.email || '').trim().toLowerCase();
  return `${email} ${req.ip}`;
}

function sweep() {
  const now = Date.now();
  for (const [key, entry] of failures) {
    if (entry.until <= now) failures.delete(key);
  }
}
const sweeper = setInterval(sweep, SWEEP_MS);
sweeper.unref?.();

/**
 * Refuses a login that has already failed too often from the same place, and
 * says when it may be tried again - a lockout that will not say how long it
 * lasts is one the desk cannot work around on deadline.
 */
function loginThrottle(req, res, next) {
  const key = keyFor(req);
  const entry = failures.get(key);
  if (entry && entry.count >= MAX_FAILURES && entry.until > Date.now()) {
    const minutes = Math.max(1, Math.ceil((entry.until - Date.now()) / 60000));
    res.setHeader('Retry-After', String(minutes * 60));
    return res.status(429).json({
      error: `Too many failed sign-ins. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask the newspaper owner to reset the password.`,
    });
  }

  // The outcome is only known after the controller has answered, so the
  // counter moves on the way OUT rather than being guessed on the way in.
  res.on('finish', () => {
    if (res.statusCode === 200) {
      failures.delete(key);
      return;
    }
    if (res.statusCode !== 401 && res.statusCode !== 403) return;
    const now = Date.now();
    const live = failures.get(key);
    const count = live && live.until > now ? live.count + 1 : 1;
    failures.set(key, { count, until: now + WINDOW_MS });
  });

  return next();
}

/** For tests, so one case cannot lock out the next. */
function resetLoginThrottle() {
  failures.clear();
}

module.exports = { loginThrottle, resetLoginThrottle, MAX_FAILURES, WINDOW_MS };
