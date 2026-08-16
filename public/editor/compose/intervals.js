// The representation the whole engine rests on: a line is a set of horizontal
// intervals.
//
// A page frame with photographs in it is a 2D region-with-holes problem, and
// the obvious representations are all worse than this one. A literal pixel
// matrix is 660 x 1060 booleans per block and answers the wrong question. A
// polygon library needs boolean geometry and still has to be sampled per line
// in the end. But text does not occupy arbitrary 2D space: it sets in
// horizontal bands, one line tall. Sample the obstacles once per band and the
// whole thing collapses to 1D interval arithmetic, which is a sort and a
// scan.
//
// This is the scanline idea out of raster graphics, and it is the same
// reduction a polygon filler makes for the same reason. What it buys here:
//
//   free(band) = columns(band) - obstacles(band)
//
// and every hard question - does this line fit, is this gap usable, how much
// of the block is unexplained white - is asked of that one list.
//
// Two mechanisms are borrowed on top of it, both because the geometry alone
// gives the wrong editorial answer:
//
//   * Obstacle inflation, from robot motion planning. A planner does not ask
//     whether a robot's centre point is clear, it grows every obstacle by the
//     robot's radius and then treats the robot as a point. Text has a radius
//     too - it must not touch the photograph - so the stand-off is added to
//     the obstacle instead of being checked against every line. (exclusion.js)
//
//   * Narrow-passage pruning, from the same field. A corridor can be
//     geometrically open and still be no use: a path planner rejects a gap
//     narrower than the body that has to pass through it. A 20px strip beside
//     a cut-out is free space that no Marathi word fits in, and pouring copy
//     into it produces a column of single syllables. viableIntervals() is
//     that rejection, and it is the reason this engine leaves some free
//     pixels deliberately empty.

/** Sorted, non-overlapping, touching pieces merged. */
export function normalise(intervals) {
  const sorted = intervals
    .filter((piece) => piece && piece.end > piece.start)
    .map((piece) => ({ start: piece.start, end: piece.end }))
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const piece of sorted) {
    const last = merged[merged.length - 1];
    if (last && piece.start <= last.end) last.end = Math.max(last.end, piece.end);
    else merged.push({ ...piece });
  }
  return merged;
}

/** Everything in `base` that is not in `holes`. Both are normalised first. */
export function subtract(base, holes) {
  const cuts = normalise(holes);
  const out = [];
  for (const piece of normalise(base)) {
    let start = piece.start;
    for (const hole of cuts) {
      if (hole.end <= start) continue;
      if (hole.start >= piece.end) break;
      if (hole.start > start) out.push({ start, end: Math.min(hole.start, piece.end) });
      start = Math.max(start, hole.end);
      if (start >= piece.end) break;
    }
    if (start < piece.end) out.push({ start, end: piece.end });
  }
  return out.filter((piece) => piece.end > piece.start);
}

export function totalWidth(intervals) {
  return intervals.reduce((sum, piece) => sum + (piece.end - piece.start), 0);
}

export function widest(intervals) {
  return intervals.reduce((max, piece) => Math.max(max, piece.end - piece.start), 0);
}

export function overlap(a, b) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

// How wide a gap has to be before copy may be set in it, expressed in ems of
// the type going into it rather than in screen pixels - a 40px rule means one
// thing at 9pt and something else at 24pt, and the whole point is that this
// is a typographic judgement. Six ems is roughly one ordinary Marathi word
// plus its space (measured: Marathi averages about six clusters a word and a
// Devanagari cluster averages a little under one em of advance). Below it,
// a line can hold a fragment but not a word, and a column of fragments is
// what this threshold exists to refuse.
export const MIN_CORRIDOR_EM = 6;

// A gap wide enough for a word can still be useless if it exists on one line
// only - a notch beside a shoulder, say. Copy set there is a single stranded
// line with the flow resuming elsewhere, which reads as a mistake. So a
// corridor also has to persist: it must overlap a viable gap on an adjacent
// band. This is the vertical-continuity half of narrow-passage pruning, and
// without it the width test alone still lets text into shoulder notches.
export const MIN_CORRIDOR_BANDS = 2;

/**
 * Which of a band's free gaps copy may actually be set in.
 *
 * `bands` is every band's raw free intervals, in order; `index` is the band
 * being judged. Returns the subset of that band's gaps that are both wide
 * enough and part of a run of at least MIN_CORRIDOR_BANDS bands.
 *
 * `fullWidthPx`, if given, exempts a gap that is (near enough) the WHOLE
 * column from the persistence test below. A notch is inherently a PARTIAL
 * shape - it exists only because something already narrowed that specific
 * band - so a gap spanning the full column cannot be one, whatever the band
 * next to it looks like. Without this, the ordinary case of a full-width
 * line sitting directly above a photograph that starts on the very next row
 * was being discarded as a "stranded single line": its downward neighbour
 * (now cut down to a sliver by the photograph, or gone entirely) never finds
 * a wide-enough match, so `persists(1)` failed and the line - real,
 * printable, no obstacle anywhere on its own band - was silently dropped.
 * Found on a real fixture: one short line of body copy directly over a
 * placed photograph composed to zero body lines at all, the block reporting
 * total overset despite having an genuinely printable row.
 */
export function viableIntervals(bands, index, minWidthPx, fullWidthPx = Infinity) {
  const here = bands[index] || [];
  return here.filter((piece) => {
    if (piece.end - piece.start < minWidthPx) return false;
    if (MIN_CORRIDOR_BANDS <= 1) return true;
    if (piece.end - piece.start >= fullWidthPx - 0.5) return true;

    // A corridor has to continue in BOTH directions, not either. Requiring
    // only one was not enough: a pocket that opens off the full-width lines
    // above a photograph and then closes immediately satisfies "continues
    // upward" while still being a single stranded line at the right of one
    // row - which is precisely the shoulder notch this rule exists to refuse.
    // (This is why the full-width exemption above checks the gap's OWN
    // width, not merely that it "connects upward" to a wide gap - a notch
    // can do that too, and still be a notch.)
    //
    // The top and bottom of the block count as satisfied. A column of copy
    // running from the top edge down to a picture is a real corridor; it has
    // no band above it because there is no page above it.
    const persists = (step) => {
      const edge = step < 0 ? index === 0 : index === bands.length - 1;
      if (edge) return true;
      let found = 0;
      for (let at = index + step; at >= 0 && at < bands.length; at += step) {
        const neighbour = (bands[at] || []).find(
          (other) => other.end - other.start >= minWidthPx && overlap(piece, other) >= minWidthPx / 2,
        );
        if (!neighbour) break;
        found += 1;
        if (found >= MIN_CORRIDOR_BANDS - 1) return true;
      }
      return found >= MIN_CORRIDOR_BANDS - 1;
    };

    return persists(-1) && persists(1);
  });
}
