// A BLOCK'S ROLE ON THE PAGE - the layer between "which page is this" and
// "what colour is this block".
//
// The desk's report was that a dressed page looks "very saturated", and the
// obvious reading is that too many blocks are dressed. Measured, that is not
// what was wrong. `styleForPage` ordered blocks by AREA and dressed the top
// share of them, and area cannot rank equals: on this newspaper's own page
// four - ten blocks of 150x176 in a grid - it tinted `col-one-a` and
// `col-three-a` and left the other eight plain. Two arbitrary cells of a
// ten-cell grid, chosen by nothing but sort stability.
//
// Two coloured cells in a grid of ten is worse than none and worse than ten,
// because a reader looks for the pattern and there is not one. No budget can
// fix that; only knowing what a block IS can.
//
// WHAT A ROLE IS FOR. A printed page does not decorate by size, it decorates
// by job. The lead's emphasis is its size, so a ground under it makes a front
// page read as a poster. A चौकट - a small box beside a big story - is exactly
// where a ground belongs, and under the old rule it almost never got one,
// because a sidebar is by definition small and the rule spent its budget from
// the top. A brief takes a rule and no ground. A grid is one object and is
// dressed as one object.
//
// EVERY ROLE IS INFERRED, AND THAT IS DELIBERATE. There is no `block_role`
// column and no dropdown. A desk making up thirty blocks a day must not also
// classify thirty blocks a day, and a role that had to be set by hand would
// be exactly the state `background_color` was in before page-styles.js
// existed - a mechanism nobody has time to reach. Every signal used here is
// one the block already carries: its size, where it sits, what it is beside,
// and what its kind is.
//
// IT IS THE EIGHTH SHARED CATALOGUE, beside the character grid, the block
// kinds, the picture style, the inks, the borders, the page styles, the
// furniture styles and the block shapes - and it is shared for the same
// reason they are: the canvas, the Block Editor, the PDF, the IDML and the
// .sla must dress a block identically or the page the desk approved is not
// the page that prints.
//
// THE COUNT IS KEPT BY HAND AND HAS DRIFTED ONCE ALREADY - furniture-styles
// and this file both called themselves the sixth. If a ninth is added, sweep
// `grep -rn "shared catalogue" CLAUDE.md public/editor/layout/` rather than
// trusting the last number you read.

/**
 * THE FIVE ROLES, and what each one may WEAR.
 *
 * A ROLE DOES NOT DECIDE WHETHER IT IS TINTED, and that is deliberate: the
 * same secondary story is tinted on a feature page and must not be on a front
 * page, so the page is what says which. `DECORATION.grounds` in page-styles.js
 * is the one authority on that, and a `ground` flag here as well would be a
 * second one - two catalogues answering one question, which is the drift this
 * project has been bitten by twice.
 *
 * NOR DOES IT DECIDE ITS OWN PRIORITY. `DECORATION.grounds` lists the roles a
 * level dresses IN THE ORDER THAT LEVEL WANTS THEM, so the list is the
 * priority - a front page reaches for its चौकट first and a feature page for
 * its lead, and one rank here could not say both.
 */
export const BLOCK_ROLES = [
  // The biggest story on the page. Its size IS its emphasis; a ground under
  // it as well is the "poster" look measured on the reference paper's own
  // front page, where the lead is black on white and the tinted blocks are
  // the secondary stories beside it. It may carry the reversed band at the
  // strongest decoration level, which is what a feature page leads with.
  { key: 'lead', label: 'Lead', rule: true, headlineInk: true, mayBand: true },
  // A large story that is not the lead. A rule and an inked heading; a ground
  // on two large neighbouring blocks is two leads.
  { key: 'secondary', label: 'Secondary', rule: true, headlineInk: true, mayBand: false },
  // THE चौकट: a small block standing beside a much larger one. This is where
  // a printed page puts a ground, and it is the role the old area-ordered
  // rule could almost never reach.
  { key: 'sidebar', label: 'Sidebar', rule: true, headlineInk: true, mayBand: false },
  // One cell of a run of equal blocks. Dressed as a SET or not at all - see
  // `gridSets` below.
  { key: 'grid', label: 'Grid', rule: true, headlineInk: true, mayBand: false },
  // Short copy in a small frame. A rule at most: a ground behind four lines
  // of type is a label, not a story.
  { key: 'brief', label: 'Brief', rule: true, headlineInk: false, mayBand: false },
];

export const ROLE_KEYS = BLOCK_ROLES.map((r) => r.key);

export function roleOf(key) {
  return BLOCK_ROLES.find((r) => r.key === key) || null;
}

/**
 * A GRID IS A RUN OF EQUAL BLOCKS, and equal has to mean "equal to the eye".
 *
 * This paper's own page four carries blocks at 150x176 and 151x176 in one
 * run - a pixel apart because the column grid does not divide evenly - so an
 * exact match would see two runs where a reader sees one. The bucket is
 * `GRID_TOLERANCE_PX` wide, which is comfortably under the 3 mm gutter
 * between two blocks and so cannot merge two genuinely different sizes.
 *
 * THREE, not two. Two equal blocks side by side is a pair - an ordinary
 * arrangement that carries no implication about how it is dressed. Three or
 * more reads as a run, and a run is one object.
 */
const GRID_TOLERANCE_PX = 8;
const GRID_MIN_MEMBERS = 3;

function gridBucket(section) {
  const w = Math.round(Number(section.width_px) / GRID_TOLERANCE_PX);
  const h = Math.round(Number(section.height_px) / GRID_TOLERANCE_PX);
  return `${w}x${h}`;
}

/** Every run of three or more equal blocks, as a Map of bucket -> sections. */
export function gridSets(sections = []) {
  const buckets = new Map();
  for (const section of sections) {
    const key = gridBucket(section);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(section);
  }
  const sets = new Map();
  for (const [key, members] of buckets) {
    if (members.length >= GRID_MIN_MEMBERS) sets.set(key, members);
  }
  return sets;
}

const areaOf = (s) => Number(s.width_px) * Number(s.height_px);

/**
 * A SIDEBAR is small AND stands beside something much larger.
 *
 * Both halves are needed. Small alone is a brief; beside-something-large
 * alone is any block on a page with a big lead on it. What makes a चौकट a
 * चौकट is the contrast between it and the story it sits against, which is
 * why the test is against its NEIGHBOUR's area rather than against the page's.
 */
const SIDEBAR_MAX_OF_LEAD = 0.35;
const SIDEBAR_NEIGHBOUR_RATIO = 2;

/**
 * A BRIEF is a small frame carrying little copy.
 *
 * Stated as characters rather than as a share of the frame because that is
 * what makes it a brief: a short item, whatever size box it happens to be
 * given. `briefs` is also a block kind in its own right and always counts.
 */
const BRIEF_MAX_BODY_CHARS = 500;

/**
 * WHAT EVERY BLOCK ON ONE PAGE IS.
 *
 * Pure - it reads sections and a `touching` predicate and returns a Map of
 * section key to role key. It takes the predicate rather than importing one
 * so that this file and page-styles.js cannot end up with two answers to
 * "do these two blocks meet", which is the same fact the column rule between
 * them is drawn from.
 */
export function rolesForPage(sections = [], touching = () => false) {
  const roles = new Map();
  if (!sections.length) return roles;

  const sets = gridSets(sections);
  const inGrid = new Set();
  for (const members of sets.values()) {
    for (const member of members) inGrid.add(member.section_key);
  }

  const byArea = [...sections].sort((a, b) => areaOf(b) - areaOf(a));
  // THE LEAD IS NEVER A GRID CELL. A run of ten equal blocks has no lead in
  // it, and calling its first member one would give a whole grid's worth of
  // blocks a role none of them has.
  const lead = byArea.find((s) => !inGrid.has(s.section_key)) || null;
  const leadArea = lead ? areaOf(lead) : 0;

  for (const section of sections) {
    const key = section.section_key;
    if (inGrid.has(key)) { roles.set(key, 'grid'); continue; }
    if (lead && key === lead.section_key) { roles.set(key, 'lead'); continue; }

    const area = areaOf(section);
    const isBrief = section.block_type === 'briefs'
      || (area < leadArea * SIDEBAR_MAX_OF_LEAD
        && String(section.body || '').length < BRIEF_MAX_BODY_CHARS);

    if (area <= leadArea * SIDEBAR_MAX_OF_LEAD) {
      const beside = sections.some((other) => other.section_key !== key
        && areaOf(other) >= area * SIDEBAR_NEIGHBOUR_RATIO
        && touching(section, other));
      // A block that is both small-beside-a-big-one and short is a sidebar
      // rather than a brief: standing against a large story is the stronger
      // signal, and it is the one that decides where the ground goes.
      if (beside) { roles.set(key, 'sidebar'); continue; }
      if (isBrief) { roles.set(key, 'brief'); continue; }
    }
    roles.set(key, isBrief ? 'brief' : 'secondary');
  }
  return roles;
}

/**
 * THE UNITS A PAGE'S DECORATION BUDGET IS SPENT ON.
 *
 * A unit is one thing a desk would perceive as one decision: a single block,
 * or a whole grid run. `order` is the caller's own role preference - the list
 * `DECORATION.grounds` names - and units are ranked by it, then by area
 * within a role, so what gets dressed on a thin budget is the block that page
 * most wants dressed rather than whichever happened to be biggest.
 *
 * `order` IS BOTH THE FILTER AND THE PRIORITY. A role the caller does not
 * name is a role that page does not dress - not one ranked last - because
 * "ranked last" would still dress a lead on a front page the moment the
 * budget stretched, which is the one thing that level exists to refuse.
 */
export function groundUnits(sections = [], roles = new Map(), order = ROLE_KEYS) {
  const sets = gridSets(sections);
  const units = [];
  const claimed = new Set();

  for (const members of sets.values()) {
    const role = roleOf('grid');
    units.push({ role, members, area: Math.max(...members.map(areaOf)) });
    for (const m of members) claimed.add(m.section_key);
  }
  for (const section of sections) {
    if (claimed.has(section.section_key)) continue;
    const role = roleOf(roles.get(section.section_key));
    if (!role) continue;
    units.push({ role, members: [section], area: areaOf(section) });
  }
  const wanted = units.filter((unit) => order.includes(unit.role.key));
  wanted.sort((a, b) => (order.indexOf(a.role.key) - order.indexOf(b.role.key)) || (b.area - a.area));
  return wanted;
}
