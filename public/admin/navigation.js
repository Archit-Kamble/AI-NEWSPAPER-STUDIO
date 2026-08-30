// A desk's Back button goes back through the DESK, not out of it.
//
// This product had no history handling anywhere: no pushState, no popstate,
// no hash. So every screen a desk reached - Past News, Reporters, Settings,
// E-paper, and an open edition - was the SAME history entry as the login
// page. Pressing Back, which is the gesture every person alive uses to mean
// "the thing before this one", left the application entirely and landed on
// whatever the browser had been showing beforehand. On an open edition with
// work in it that is not an annoyance, it is a way to lose the morning.
//
// Three things follow from stating a screen as an address rather than as a
// function call, and only the first was asked for:
//
//   * Back and Forward walk the desk's own screens.
//   * A RELOAD comes back to the screen the desk was on. An edition being
//     made up survives a refresh, which is the one thing a browser does to
//     you without being asked.
//   * A screen can be linked to. "Open edition 54470" is a URL now.
//
// The address is a HASH (`#!/edition/54470`), deliberately, and not a path.
// A path would be a second thing the server has to route and get right, and
// `app.get("*")` already had to be taught not to answer /api with index.html
// once. A hash never reaches the server at all. The `!` is there so a screen
// name can never collide with an element id and make the browser scroll to
// it - which is exactly the sort of fault this codebase has already met
// twice, under the name "two things called .smart-card-artwork".
//
// This module owns the history stack and NOTHING else. What a screen
// contains, who may see it and how it is painted all stay with the caller.

const PREFIX = '#!/';

/** `{screen, id}` as an address. `id` is optional and is always a string. */
export function toHash(view) {
  if (!view || !view.screen) return PREFIX;
  const id = view.id === 0 || view.id ? String(view.id) : '';
  return PREFIX + encodeURIComponent(view.screen) + (id ? `/${encodeURIComponent(id)}` : '');
}

/** An address as `{screen, id}`, or null when it is not one of ours. */
export function fromHash(hash) {
  const raw = String(hash || '');
  if (!raw.startsWith(PREFIX)) return null;
  const [screen, id] = raw.slice(PREFIX.length).split('/');
  if (!screen) return null;
  return { screen: decodeURIComponent(screen), id: id ? decodeURIComponent(id) : null };
}

export function sameView(a, b) {
  if (!a || !b) return false;
  const id = (v) => (v.id === 0 || v.id ? String(v.id) : '');
  return a.screen === b.screen && id(a) === id(b);
}

let paint = null;
let current = null;
let home = null;
let allowView = () => true;
// A workspace render awaits fonts, the shaper and three fetches, so a desk
// who presses two screens quickly can have the slower one land last and paint
// over the newer one. Every run carries a token and checks it before it
// commits; the caller is handed `stale()` so a long render can bail early
// rather than finishing into a screen nobody is looking at any more.
let token = 0;

async function run(view) {
  if (!paint) return;
  const mine = ++token;
  const stale = () => mine !== token;
  try {
    await paint(view, { stale });
  } catch (error) {
    console.error('Screen render failed:', view, error);
  }
}

/**
 * Go to a screen, recording it in the browser's history.
 *
 * `replace: true` overwrites the current entry instead of adding one - used
 * for the first paint, and for a redirect the desk never chose (a screen they
 * may not see, an edition that has gone).
 */
export async function navigate(view, { replace = false } = {}) {
  if (!view || !view.screen) return;
  // Navigating to where we already are is a repaint, not a history entry -
  // otherwise pressing "Past Newspapers" four times means four Backs.
  const repeat = sameView(view, current);
  const url = `${window.location.pathname}${window.location.search}${toHash(view)}`;
  const state = { sahas: view };
  if (replace || repeat || !current) window.history.replaceState(state, '', url);
  else window.history.pushState(state, '', url);
  current = view;
  await run(view);
}

export function currentView() {
  return current;
}

/**
 * Begin routing. `render(view, {stale})` paints a screen; `home` is where a
 * desk lands with no address; `allow(view)` says whether this user may see
 * the address they arrived with, so a reporter cannot deep-link to Reporters
 * merely by typing it.
 */
export async function startNavigation(render, { home: landing, allow = () => true } = {}) {
  paint = render;
  current = null;
  home = landing;
  allowView = allow;
  const wanted = fromHash(window.location.hash);
  const view = wanted && allow(wanted) ? wanted : landing;
  await navigate(view, { replace: true });
}

/** Signing out ends routing - the login screen is not one of the desk's screens. */
export function stopNavigation() {
  paint = null;
  current = null;
  home = null;
  token += 1;
  const url = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(null, '', url);
}

// ARRIVING AT AN ADDRESS THIS MODULE DID NOT WRITE.
//
// There are three ways in and they are not the ones the specification led me
// to expect, so this was measured rather than reasoned about:
//
//   * Back or Forward, which fires `popstate` carrying the state we pushed.
//   * A desk typing in the address bar, or any navigation that differs from
//     the current one only by its fragment - and Chrome fires BOTH `popstate`
//     (with a null state) and `hashchange` for that, popstate first.
//   * A reload or a pasted link, which is startNavigation's job, not this.
//
// So both events funnel through one function, and it is idempotent: the
// second event of a pair finds the screen already current and does nothing.
//
// The null-state case is the one that had a real bug in it. The popstate
// handler used to fall back to reading the hash and TRUSTING it, so typing
// `#!/not-a-screen` set that as the current screen: the dashboard was
// correctly painted underneath (an unknown name falls back), while the
// address bar went on naming a screen that does not exist. A bar that lies
// about which screen you are on is worse than not routing at all.
function arrive(view) {
  if (!paint || !view) return;
  if (!allowView(view)) {
    // Not a screen this user has - a stale bookmark, a typo, a reporter
    // reaching for the desk's own screens. Replace rather than push, so Back
    // does not walk straight back onto it.
    if (home) navigate(home, { replace: true });
    return;
  }
  if (sameView(view, current)) return;
  current = view;
  run(view);
}

window.addEventListener('popstate', (event) => {
  // The state we wrote is the authority; the hash is the fallback for an entry
  // this session did not create.
  arrive(event.state?.sahas || fromHash(window.location.hash));
});

window.addEventListener('hashchange', () => {
  arrive(fromHash(window.location.hash));
});
