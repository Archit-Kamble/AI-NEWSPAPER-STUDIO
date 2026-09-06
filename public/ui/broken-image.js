/**
 * A PICTURE THAT WILL NOT LOAD, HANDLED WITHOUT AN INLINE HANDLER.
 *
 * Four places in this product wrote `onerror="…"` straight into their markup -
 * the placed picture on the canvas, the block thumbnail's image box, the
 * Pictures panel's list and the Story Explorer's card. Every one of them does
 * the same ordinary thing: this newsroom's archive holds uploads whose files
 * are no longer on disk, and a broken-image glyph in the middle of a made-up
 * page is worse than nothing at all.
 *
 * They cannot stay inline. An inline event handler is script in an attribute,
 * so a Content-Security-Policy strict enough to be worth having refuses to run
 * it - and the fallback then silently stops happening, which is the WORSE
 * failure: the desk sees the broken glyph the handler existed to remove, with
 * no error anywhere saying why. (Measured: 263 CSP violations across one run of
 * the workspace net, every one of them these four attributes.) The alternative
 * - adding 'unsafe-inline' to script-src - would give away almost everything
 * the policy is for, to keep four lines that have a better form anyway.
 *
 * BOUND ONCE, AT THE DOCUMENT, IN THE CAPTURE PHASE. `error` on an <img> does
 * not bubble, so an ordinary delegated listener never sees it; it does
 * capture, which is why `true` below is load-bearing and must not be tidied
 * away. One listener covers every image this product will ever draw, including
 * the ones drawn after this module ran - which is the same reason the device
 * bar and the marks toolbar are bound at the document rather than per render.
 *
 * The policy is named on the element (`data-broken`), so the markup still says
 * what it wants to happen; it just says it as data rather than as script.
 */

// A 1x1 transparent GIF. Substituted rather than the src merely cleared, so the
// box keeps the size the layout gave it.
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

const POLICIES = {
  // The canvas's placed picture: the frame is the picture, so it goes.
  remove: (img) => img.remove(),
  // The thumbnail's image box carries the caption too, so the BOX goes rather
  // than leaving a caption under nothing.
  'remove-box': (img) => (img.closest('.section-image-box') || img).remove(),
  // The Pictures panel keeps the row - a desk still has to be able to see and
  // delete the record of a picture whose file has gone - and marks it.
  mark: (img) => img.classList.add('broken'),
  // The Story Explorer keeps the card's shape and falls back to its own empty
  // style, which is what most of this archive's cards need.
  blank: (img) => {
    img.classList.add('story-card-thumb-empty');
    img.src = BLANK;
  },
};

let bound = false;

export function bindBrokenImages(root = document) {
  if (bound) return;
  bound = true;
  root.addEventListener(
    'error',
    (event) => {
      const img = event.target;
      if (!img || img.tagName !== 'IMG') return;
      // Without this the blank substitution below re-fires this handler on the
      // data: URI if that ever failed, which is the loop the old inline
      // handler's own `this.onerror=null` was there to prevent.
      if (img.dataset.brokenHandled === '1') return;
      const policy = POLICIES[img.dataset.broken];
      if (!policy) return;
      img.dataset.brokenHandled = '1';
      policy(img);
    },
    true,
  );
}
