// A picture may not leave a column too narrow to set type in.
//
// THE FAULT. Drop a photograph into a block so that the strip of measure left
// beside it is under one word wide, and the composition engine (correctly)
// refuses every band that crosses it: the block keeps its full depth, keeps
// its copy, and sets not one line of it. NO_LEGAL_MEASURE reports this
// accurately now, but reporting is not the same as preventing - a desk still
// has to notice the message and work out which of "make a picture narrower,
// move it, or set the body smaller" applies.
//
// THE RULE, and it is the ordinary one. A newspaper is set on a modular grid,
// and a picture is sized and positioned to the grid: it spans a whole number
// of columns, so what is left beside it is also a whole number of columns.
// Nobody sets a photograph 5mm narrower than the measure, because the 5mm
// strip beside it can hold nothing. Web typography ran into the same wall from
// the other side and asked CSS for a `minimum-column-width`, for the same
// reason: a leftover sliver is not a narrow column, it is a hole.
//
// So the legal placements of a picture are exactly these:
//
//   - flush to one edge of the measure, leaving ONE column of type beside it;
//   - inset far enough that the column beside it is at least MIN_CORRIDOR_EM;
//   - spanning the whole measure, with no column beside it at all.
//
// Anything between those is the dead zone, and this snaps out of it - during
// the drag, so the copy visibly reflows into the corridor it is going to
// have, rather than after the fact.
//
// AND THE SAME RULE VERTICALLY. A full-measure picture takes the whole
// measure, so the copy cannot pass it - it can only sit above it or below it.
// Left floating in the middle of the body it leaves a strip at the top and a
// strip at the bottom, and if neither is a whole line deep the block still
// sets nothing: widening the picture to the measure ALONE makes matters worse,
// which is why it is paired with a move to the top of the copy or the foot of
// the block. That is where a full-measure picture goes on a printed page.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It never changes the picture's height,
// and it changes its WIDTH only in the one case where no placement of that
// width can leave a legal column - where the honest answer is that this is a
// full-measure picture. Moving costs the desk nothing; resizing is their
// decision, so it is a last resort rather than a first one.

/**
 * Whether a composition has nowhere legal to set a line of body type.
 *
 * This, and NOT "is some corridor in the dead zone", is what the snap repairs.
 * A dead corridor on ONE side of a picture is harmless when the other side is
 * a whole column - the copy simply sets there, which is an ordinary
 * newspaper page. The fault is the block that can set NOTHING, and it is the
 * engine's own answer, not a second opinion about it: a caller composes with
 * the placement it is about to make and asks.
 *
 * Keeping the trigger this narrow is what stops the snap becoming a style
 * rule. A desk placing a picture somewhere unusual but printable is left
 * alone; only a placement that would put a block on the page carrying copy it
 * cannot set is moved.
 */
export function leavesNoLegalColumn(composition) {
  if (!composition || !composition.whitespace) return false;
  return (composition.warnings || []).some((warning) => warning.code === 'NO_LEGAL_MEASURE');
}

/**
 * The nearest legal placement of a picture, in the block's own pixels.
 *
 * `rect` is the proposed frame ({x, y, width, height}); `contentLeft` and
 * `contentRight` are the measure's own edges (composition.content). Returns a
 * new rect plus what it did, so a caller can say so.
 *
 * Single-column blocks only, which is every image-bearing block in this
 * database (350 of 350) - a multi-column block would have to snap against the
 * column its edges fall in, and inventing that against no real case would be
 * guessing.
 */
export function snapPictureToLegalCorridor(rect, {
  contentLeft = 0,
  contentRight = 0,
  standOffPx = 0,
  minCorridorPx = 0,
  expectsCopy = true,
  columnCount = 1,
  bodyTop = null,
  bodyBottom = null,
  bandHeightPx = 0,
} = {}) {
  const unchanged = { ...rect, snapped: false, how: 'none' };
  const measure = contentRight - contentLeft;
  if (!expectsCopy || columnCount > 1 || !(minCorridorPx > 0) || !(measure > 0)) return unchanged;

  const width = Math.min(rect.width, measure);
  const left = (rect.x - standOffPx) - contentLeft;
  const right = contentRight - (rect.x + width + standOffPx);
  const dead = (corridor) => corridor > 0 && corridor < minCorridorPx;
  if (!dead(left) && !dead(right)) return unchanged;

  // How much measure is left over once the picture and both its stand-offs
  // have taken theirs. If that is under one legal column then NO placement of
  // this picture leaves a column worth setting - it is a full-measure
  // picture, and saying so is better than leaving a hole for a desk to find.
  const spare = measure - width - 2 * standOffPx;
  if (spare < minCorridorPx) {
    return spanTheMeasure(rect, { contentLeft, measure, standOffPx, bodyTop, bodyBottom, bandHeightPx });
  }

  // Otherwise a legal placement exists, and there are four of them: flush to
  // either edge (one whole column beside the picture) or inset to exactly the
  // minimum from either edge. Take whichever asks the pointer to move least.
  const candidates = [
    { x: contentLeft, how: 'flush-left' },
    { x: contentRight - width, how: 'flush-right' },
    { x: contentLeft + minCorridorPx + standOffPx, how: 'inset-from-left' },
    { x: contentRight - width - minCorridorPx - standOffPx, how: 'inset-from-right' },
  ].filter((candidate) => {
    const l = (candidate.x - standOffPx) - contentLeft;
    const r = contentRight - (candidate.x + width + standOffPx);
    return !dead(l) && !dead(r);
  });
  if (!candidates.length) return unchanged;

  candidates.sort((a, b) => Math.abs(a.x - rect.x) - Math.abs(b.x - rect.x));
  const best = candidates[0];
  return { x: Math.round(best.x), y: rect.y, width, height: rect.height, snapped: true, how: best.how };
}

/**
 * A picture no column can survive beside becomes a full-measure picture - and
 * goes where a full-measure picture goes: the top of the copy, or the foot.
 *
 * Widening it alone is not enough and can be worse. Measured on the real
 * block this came from: a 95px picture at y=151 in a 190x264 frame set in
 * 16px type, widened to the full 182px measure, leaves 15px of copy above it
 * and 15px below - and one line of that type needs 25px, so the block still
 * sets nothing. Moved to the top of the copy instead, the whole remainder is
 * contiguous and the story sets under it.
 *
 * If the picture is so tall that neither end leaves room for a single line,
 * nothing is changed: that is a picture which does not fit this block, and
 * saying so (NO_LEGAL_MEASURE, still raised) is better than moving it about
 * to no effect.
 */
function spanTheMeasure(rect, { contentLeft, measure, standOffPx, bodyTop, bodyBottom, bandHeightPx }) {
  const spanned = { x: contentLeft, y: rect.y, width: measure, height: rect.height, snapped: true, how: 'spanned' };
  if (!(bandHeightPx > 0) || bodyTop === null || bodyBottom === null) return spanned;

  const depth = bodyBottom - bodyTop;
  // Nothing to be gained: even flush against one end there is no room for a
  // line of type beside it.
  if (depth - rect.height - standOffPx < bandHeightPx) {
    return { ...rect, width: Math.min(rect.width, measure), snapped: false, how: 'does-not-fit' };
  }

  const atTop = bodyTop;
  const atFoot = bodyBottom - rect.height;
  const y = Math.abs(atTop - rect.y) <= Math.abs(atFoot - rect.y) ? atTop : atFoot;
  return { ...spanned, y: Math.round(y), how: y === Math.round(atTop) ? 'spanned-at-top' : 'spanned-at-foot' };
}
