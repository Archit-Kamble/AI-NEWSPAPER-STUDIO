// "Write empty blocks", as a newsroom actually works.
//
// The old button briefed each empty block on its own with "today's news for
// this place" and wrote them one at a time. That fills a page; it does not make
// up a newspaper. A chief sub does not decide block by block - they decide what
// tomorrow's paper is MADE OF, and then find the stories for it.
//
// So this is three screens over one panel, and the order matters more than any
// of them:
//
//   THE BRIEF     what each page should carry, by category and demand. Free.
//   THE PLAN      what was found, which block each story goes in, on whose
//                 authority, and what could not honestly be filled. ONE call.
//   THE COPY      the approved stories written, one cheap call each, in
//                 parallel. Still saved to nothing.
//
// The checkpoint between the plan and the copy is the whole safety argument.
// A desk sees what it is about to spend before spending it, and reads the
// stories it is about to print before printing them - and can drop any of them
// for nothing, because no writing has happened yet.

import { escapeHtml, closeOnEscape, nameThePanel } from "./format.js";
import { tagList, NEWS_TAGS, DESK_FRESHNESS, DEMAND_LEVELS } from "./layout/news-tags.js";
// Where this paper covers, from the one place catalogue - never a second list
// of these names, and never a free-text box for a district: a misspelt one
// returns nothing and looks exactly like a district with no news today.
import { COUNTRIES, STATES, districtsOf, placeQuery, placeOf, DEFAULT_PLACE } from "./layout/places.js";

const PANEL_ID = "newsdeskPanel";

/** The state of one open run. Never global - a panel closed is a run abandoned. */
function newRun({ newspaperId, byPage, blocks, place }) {
  return {
    newspaperId, byPage, blocks,
    brief: defaultBrief(byPage),
    // What the owner set in Settings, sanitised - changing it here is for THIS
    // run only, because "where this paper covers" is a standing decision and
    // "what we are chasing tonight" is not.
    place: placeOf(place || DEFAULT_PLACE),
    // The same things a single block can be asked for. Defaults match the AI
    // panel's, so a desk who changes nothing gets what they already know.
    asks: { writeHeadline: true, writeSubheading: true, reason: false, writeChart: false, chartType: "bar" },
    // WHAT EACH BLOCK IS ASKED FOR, PER BLOCK.
    //
    // `asks` above is the run's default and stays exactly what it was; this is
    // the desk's override for one row. A page is not made up with one setting:
    // the anchor carries a deck, the fillers do not, and exactly one story
    // that morning has figures worth plotting. Keyed by `rowKey(story)`, so a
    // row that is dropped and put back keeps what it was told.
    asksByRow: new Map(),
    plan: null, batch: null, dropped: new Set(),
    // The stories actually sent to be written, so a block whose provider had a
    // bad minute can be sent again without paying for a second research pass.
    sent: [],
    // Placed into the paper so far, across however many passes it took, and
    // the rows still outstanding.
    placed: 0,
    leftOver: [],
  };
}

/** This row's own asks, falling back to the run's defaults for anything unset. */
function asksFor(run, story) {
  return { ...run.asks, ...(run.asksByRow.get(rowKey(story)) || {}) };
}

/**
 * A first guess at the brief, so the form opens with something to adjust
 * rather than empty.
 *
 * Deliberately a SUGGESTION and nothing more - it reads the page number and
 * the block count and knows nothing about today. Page one leads local because
 * that is what a district daily does; the rest is spread so no page is all one
 * subject, which is the same rule the planner's concentration cap enforces at
 * the other end.
 */
function defaultBrief(byPage) {
  const SPREAD = [
    ["local", "required"], ["state-politics", "preferred"], ["crime", "preferred"],
    ["agriculture", "preferred"], ["national-politics", "preferred"], ["sports", "preferred"],
    ["entertainment", "preferred"], ["economy", "preferred"], ["health", "preferred"],
    ["education", "preferred"], ["environment", "preferred"], ["world", "preferred"],
  ];
  const pages = Object.entries(byPage).map(([page, free], index) => {
    const rotated = [...SPREAD.slice(index * 3), ...SPREAD.slice(0, index * 3)];
    const wants = [];
    let left = Number(free);
    for (const [tagKey, demand] of rotated) {
      if (left <= 0) break;
      const count = Math.min(left, 2);
      wants.push({ tagKey, count, demand });
      left -= count;
    }
    return { page: Number(page), wants };
  });
  return { freshness: "24h", pages };
}

// --------------------------------------------------------------- the brief ---

function wantRow(pageIndex, wantIndex, want, free) {
  const options = tagList().map((tag) => `<option value="${tag.key}"${tag.key === want.tagKey ? " selected" : ""}>${escapeHtml(tag.name)} — ${escapeHtml(tag.marathi)}</option>`).join("");
  const demands = DEMAND_LEVELS.map((level) => `<option value="${level.key}"${level.key === want.demand ? " selected" : ""}>${escapeHtml(level.name)}</option>`).join("");
  return `<li class="newsdesk-want">
    <select data-want-tag="${pageIndex}:${wantIndex}" aria-label="Category">${options}</select>
    <input type="number" min="1" max="${free}" value="${want.count}" data-want-count="${pageIndex}:${wantIndex}" aria-label="How many blocks">
    <select data-want-demand="${pageIndex}:${wantIndex}" aria-label="How firmly">${demands}</select>
    <button type="button" class="ext-editor-btn" data-want-remove="${pageIndex}:${wantIndex}" aria-label="Remove this category">×</button>
  </li>`;
}

function briefMarkup(run) {
  const freshness = DESK_FRESHNESS
    .map((w) => `<option value="${w.key}"${w.key === run.brief.freshness ? " selected" : ""}>${escapeHtml(w.name)}</option>`)
    .join("");

  // EVERY PAGE OF THE PAPER IS LISTED, including the ones with nothing free.
  //
  // The desk's report was that this "shows only the first 2 pages". It showed
  // every page that had an empty block - which on their edition was two - and
  // a list that silently omits a page is indistinguishable from a list that
  // has lost one. A page with nothing to fill now says so, in one line, and a
  // desk can see the whole paper at a glance and know nothing is hidden.
  const pages = run.brief.pages.map((page, pageIndex) => {
    const free = Number(run.byPage[page.page] || 0);
    if (!free) {
      return `<section class="newsdesk-page is-full">
        <h4>Page ${page.page} <span class="muted">nothing free — every block is written, sold or standing furniture</span></h4>
      </section>`;
    }
    const asked = page.wants.reduce((sum, want) => sum + Number(want.count || 0), 0);
    // Asking for fewer than the page has free is an ordinary decision - a desk
    // may be holding blocks for reporter copy - so this states the arithmetic
    // rather than refusing it. Asking for MORE cannot be honoured and says so.
    const note = asked > free
      ? `<span class="newsdesk-over">${asked} asked for, only ${free} free</span>`
      : `<span class="muted">${asked} of ${free} block${free === 1 ? "" : "s"}</span>`;
    return `<section class="newsdesk-page">
      <h4>Page ${page.page} ${note}</h4>
      <ul class="newsdesk-wants">${page.wants.map((want, i) => wantRow(pageIndex, i, want, free)).join("")}</ul>
      <button type="button" class="ext-editor-btn" data-want-add="${pageIndex}">+ Category</button>
    </section>`;
  }).join("");

  return `
    <p class="worklist-summary">Say what tomorrow's paper should be made of. SAHAS searches the
       news feeds and the open web, groups what it finds into events, and comes back with a plan
       you read before anything is written.</p>
    <div class="newsdesk-controls">
      <label>How far back to look
        <select id="newsdeskFreshness">${freshness}</select>
      </label>
    </div>
    <!-- WHERE "LOCAL" IS, biggest to smallest.
         A district daily's local news is a named district, and a query for
         सातारा finds different stories from one for सांगली - so the run could
         only ever ask about the paper's own place of publication, and a desk
         who wanted a Sangli story on page three had no way to say so.
         It opens on what the owner set in Settings, and changing it here is
         for this run only: "where this paper covers" is a standing decision
         and "what we are chasing tonight" is not. -->
    <fieldset class="newsdesk-place">
      <legend>Where the local news is</legend>
      <label>Country
        <select id="newsdeskCountry">${COUNTRIES.map((c) => `<option value="${c.key}"${c.key === run.place.country ? " selected" : ""}>${escapeHtml(c.name)} — ${escapeHtml(c.marathi)}</option>`).join("")}</select>
      </label>
      <label>State
        <select id="newsdeskState">${STATES.map((st) => `<option value="${st.key}"${st.key === run.place.state ? " selected" : ""}>${escapeHtml(st.name)} — ${escapeHtml(st.marathi)}</option>`).join("")}</select>
      </label>
      <label>District
        ${districtsOf(run.place.state)
          ? `<select id="newsdeskDistrict"><option value="">Anywhere in the state</option>${districtsOf(run.place.state).map((d) => `<option value="${escapeHtml(d)}"${d === run.place.district ? " selected" : ""}>${escapeHtml(d)}</option>`).join("")}</select>`
          : `<input type="text" id="newsdeskDistrict" value="${escapeHtml(run.place.district)}" placeholder="District">`}
      </label>
      <label>City or taluka
        <input type="text" id="newsdeskCity" value="${escapeHtml(run.place.city)}" placeholder="Optional — Vaduj, Karad…">
      </label>
      <p class="muted">Chasing: <strong>${escapeHtml(placeQuery(run.place) || "nowhere in particular")}</strong></p>
    </fieldset>
    <!-- THE SAME THINGS A SINGLE BLOCK CAN BE ASKED FOR. "Write empty blocks"
         is the most powerful button in this product - one run makes up a whole
         paper - and it could ask for less than the panel that writes one
         block. Every option here ends in the same storyWriter.write(). -->
    <fieldset class="newsdesk-asks">
      <legend>What each story gets by default</legend>
      <p class="muted">You can change any of these on a story of its own, once the plan comes back.</p>
      <label class="toggle"><input type="checkbox" id="newsdeskHeadline" checked> A headline</label>
      <label class="toggle"><input type="checkbox" id="newsdeskSubheading" checked> A subheading</label>
      <label class="toggle"><input type="checkbox" id="newsdeskReason"> Think it through first</label>
      <label class="toggle"><input type="checkbox" id="newsdeskChart"> Chart of its figures</label>
      <select id="newsdeskChartType" aria-label="Which chart">
        <option value="bar">Bars</option><option value="pie">Pie</option>
        <option value="line">Line</option><option value="dots">Dots</option>
        <option value="stat">Figures</option>
      </select>
    </fieldset>
    ${pages}
    <p class="muted ext-note"><strong>Required</strong> means leave the block empty rather than fill it
       with a weak story. <strong>Preferred</strong> means fill it if there is something worth printing.
       <strong>Avoid</strong> keeps the subject out of tomorrow's paper.</p>
    ${run.commissioned ? `<p class="muted ext-note">${run.commissioned} block${run.commissioned === 1 ? "" : "s"} already carr${run.commissioned === 1 ? "ies" : "y"} a headline somebody typed. Those are commissioned stories and are not planned here — they are written from their own headlines.
       <button type="button" class="ext-editor-btn" id="newsdeskCommissioned">Write those on this page</button></p>` : ""}
    <div class="newsdesk-actions">
      <button type="button" class="ext-editor-btn ext-editor-btn-primary" id="newsdeskResearch">Research the edition</button>
      <span class="muted">One AI call. Nothing is written yet.</span>
    </div>`;
}

// ---------------------------------------------------------------- the plan ---

function sourceLine(story) {
  const names = story.publishers.join(", ");
  return `${story.sources.length} source${story.sources.length === 1 ? "" : "s"} · ${escapeHtml(names)}`;
}

function planRow(story, dropped, asks) {
  const off = dropped.has(rowKey(story));
  return `<li class="newsdesk-plan-row${off ? " is-dropped" : ""}">
    <div class="newsdesk-plan-where">
      <strong>p${story.page}</strong>
      <span class="muted">${escapeHtml(story.sectionKey)}</span>
      <span class="newsdesk-rung">${escapeHtml(story.rung)}</span>
    </div>
    <div class="newsdesk-plan-story">
      <span class="newsdesk-headline">${escapeHtml(story.headlineHint)}</span>
      <span class="muted">${escapeHtml(story.tagKey)} · importance ${story.importance} · ${sourceLine(story)}</span>
      ${story.verified
    ? `<span class="newsdesk-checked">✓ checked publishers</span>`
    : `<span class="newsdesk-unchecked">⚠ unchecked — you must verify this before it prints</span>`}
      ${story.repeats ? `<span class="newsdesk-repeat">Similar to: ${escapeHtml(story.repeats.headline)}</span>` : ""}
      ${story.disagreements?.length ? `<span class="newsdesk-disagree">Sources disagree on ${story.disagreements.length} point${story.disagreements.length === 1 ? "" : "s"} — the copy will say so</span>` : ""}
      ${askRow(story, asks)}
      <details><summary>What it will be written from</summary>
        <ul class="newsdesk-facts">${story.facts.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>
        ${story.doNotClaim?.length ? `<p class="muted">Will not claim: ${story.doNotClaim.map(escapeHtml).join("; ")}</p>` : ""}
        <ul class="newsdesk-sources">${story.sources.map((s) => `<li>${escapeHtml(s.publisher)} — <a href="${escapeHtml(s.url || "#")}" target="_blank" rel="noopener noreferrer">open</a></li>`).join("")}</ul>
      </details>
    </div>
    <button type="button" class="ext-editor-btn" data-plan-drop="${escapeHtml(rowKey(story))}">${off ? "Put back" : "Drop"}</button>
  </li>`;
}

// WHAT THIS ONE STORY IS ASKED FOR.
//
// These four used to be one setting for the whole run, on the brief, so a deck
// on the lead meant a deck on all thirty-one and a chart was either on every
// block or on none. A page is not made up that way.
//
// Written out in words rather than as initials: a desk should not have to
// learn that H means headline, and a tooltip is not something anybody reads
// while working - the same argument the device bar's own header makes.
//
// The chart's type only appears once a chart is asked for; a select for a
// thing that is switched off is a control that cannot act.
function askRow(story, asks) {
  const key = escapeHtml(rowKey(story));
  const box = (field, label, on) => `<label class="toggle newsdesk-ask">
      <input type="checkbox" data-ask="${field}" data-ask-row="${key}"${on ? " checked" : ""}> ${label}</label>`;
  return `<div class="newsdesk-ask-row">
    ${box("writeHeadline", "Headline", asks.writeHeadline !== false)}
    ${box("writeSubheading", "Subheading", asks.writeSubheading !== false)}
    ${box("reason", "Think it through", asks.reason === true)}
    ${box("writeChart", "Chart", asks.writeChart === true)}
    ${asks.writeChart === true ? `<select data-ask="chartType" data-ask-row="${key}" aria-label="Which chart for this story">
      ${["bar:Bars", "pie:Pie", "line:Line", "dots:Dots", "stat:Figures"].map((pair) => {
    const [value, label] = pair.split(":");
    return `<option value="${value}"${asks.chartType === value ? " selected" : ""}>${label}</option>`;
  }).join("")}
    </select>` : ""}
  </div>`;
}

const rowKey = (story) => `${story.page}/${story.sectionKey}`;

function planMarkup(run) {
  const plan = run.plan;
  const keeping = plan.stories.filter((s) => !run.dropped.has(rowKey(s)));
  const unchecked = keeping.filter((s) => !s.verified).length;

  const emptyNote = plan.leftEmpty.length
    ? `<details class="newsdesk-empty"><summary>${plan.leftEmpty.length} block${plan.leftEmpty.length === 1 ? " was" : "s were"} left empty</summary>
        <ul>${plan.leftEmpty.map((e) => `<li><strong>p${e.page}/${escapeHtml(e.sectionKey)}</strong> — ${escapeHtml(e.reason)}</li>`).join("")}</ul></details>`
    : "";

  // The count of stories nobody has checked, BEFORE the calls are spent. A
  // warning under copy that has already been read is a warning that has
  // already failed.
  const verifyNote = unchecked
    ? `<p class="ai-proposal-warn">${unchecked} of these ${keeping.length} come from an open web search and
        are <strong>not</strong> from publishers this paper has checked. Every one needs reading against its own
        sources before the paper prints.</p>`
    : "";

  return `
    <p class="worklist-summary">Found ${plan.retrieval.candidates} stories from
       ${plan.retrieval.feedsFetched} feeds, grouped into ${plan.stories.length} for
       ${plan.blocksOffered} empty blocks. <strong>Nothing is written yet.</strong></p>
    ${verifyNote}
    <ul class="newsdesk-plan">${plan.stories.map((s) => planRow(s, run.dropped, asksFor(run, s))).join("")}</ul>
    ${emptyNote}
    <div class="newsdesk-actions">
      <button type="button" class="ext-editor-btn" id="newsdeskBack">Change the brief</button>
      <button type="button" class="ext-editor-btn ext-editor-btn-primary" id="newsdeskWrite"${keeping.length ? "" : " disabled"}>Write ${keeping.length} stor${keeping.length === 1 ? "y" : "ies"}</button>
      <span class="muted">${keeping.length} call${keeping.length === 1 ? "" : "s"}, four at a time.</span>
    </div>`;
}

// ---------------------------------------------------------------- the copy ---

// THE STORY'S OWN PHOTOGRAPH, offered beside the copy it belongs to.
//
// A district daily's page is a photograph and a story. The run planned the
// story and had nothing to say about the picture, so every block it filled
// arrived as grey type and a desk went hunting for an image by hand, for
// thirty-one blocks.
//
// The picture is the publisher's own, carried on the source the story was
// written from - so it is the photograph that ran with this story, not a
// stock image and not a generated one. Measured across this paper's own
// Maharashtra feeds: 86 of 111 items carry one.
//
// IT IS AN OFFER, AND IT IS OFF UNTIL A PERSON SAYS SO. Where a photograph
// sits decides how the copy sets around it, and whose photograph it is decides
// whether the paper may print it at all - so nothing is fetched until the desk
// ticks the box, and the fetch is the SSRF-guarded one every pasted link
// already goes through: it resolves the address, refuses every private range,
// follows redirects by hand and judges the file by its BYTES.
function pictureOf(result) {
  const source = (result?.retrieval?.sources || []).find((one) => one && one.imageUrl);
  if (!source) return null;
  return { url: source.imageUrl, publisher: source.publisher || source.publisherDomain || 'the source' };
}

function pictureOffer(result) {
  const picture = pictureOf(result);
  const key = `${result.page}/${result.sectionKey}`;
  if (!picture) {
    return `<span class="muted newsdesk-nopic">No photograph came with this story.</span>`;
  }
  return `<div class="newsdesk-pic">
    <label class="toggle"><input type="checkbox" data-pic-row="${escapeHtml(key)}"> With its photograph</label>
    <span class="muted">from ${escapeHtml(picture.publisher)}</span>
    <a href="${escapeHtml(picture.url)}" target="_blank" rel="noopener noreferrer">see it</a>
    <label class="toggle"><input type="checkbox" data-cut-row="${escapeHtml(key)}"> Cut the background out</label>
    <span class="muted newsdesk-cut-note">Suits a portrait; a scene is better left whole.</span>
  </div>`;
}

function copyRow(result) {
  if (!result || result.error) {
    return `<li class="bulk-row is-error"><strong>p${result?.page}/${escapeHtml(result?.sectionKey || "?")}</strong>
      <span class="muted">${escapeHtml(result?.error || "The AI did not answer.")}</span></li>`;
  }
  const fit = result.fit || {};
  // `fit.fill` is bodyFill()'s whole record, not a number - the ratio is
  // inside it. Multiplying the object gave NaN, which `Number.isFinite`
  // then hid, so the desk was shown no fill figure at all on every row.
  const ratio = fit.fill?.ratio;
  const pct = Number.isFinite(ratio) ? `${Math.round(ratio * 100)}% set` : "";
  const state = fit.acceptable ? "fits" : (fit.overflowing ? "runs over" : "short of the foot");
  return `<li class="bulk-row">
    <strong>p${result.page}/${escapeHtml(result.sectionKey)}</strong>
    <span class="bulk-headline">${escapeHtml(result.proposal.headline)}</span>
    <span class="muted">${pct} — ${state}${result.retrieval?.status === "unverified" ? " · ⚠ unchecked sources" : ""}</span>
    ${pictureOffer(result)}
  </li>`;
}

function copyMarkup(run) {
  const batch = run.batch;
  return `
    <p class="worklist-summary">Written ${batch.written} of ${batch.written + batch.failed}.
       <strong>Nothing has been saved yet.</strong> Accepting puts each story into its own block
       marked <em>needs review</em>, and leaves the block's design, pictures and treatment alone.</p>
    <ul class="bulk-list">${batch.results.map(copyRow).join("")}</ul>
    <p class="ai-proposal-warn">The desk must check every fact before any of this is printed.</p>
    <div class="newsdesk-actions">
      <button type="button" class="ext-editor-btn ext-editor-btn-primary" id="newsdeskAccept"${batch.written ? "" : " disabled"}>Accept ${batch.written} into the paper</button>
    </div>`;
}

// WHAT IS STILL TO DO, after the paper has taken everything it could.
//
// This stage exists because the alternative was losing the stories. A run that
// placed 4 of 31 used to close and take the other 27 with it, including the
// research call the desk had already paid for.
function leftMarkup(run) {
  const left = run.leftOver || [];
  const recoverable = left.filter((row) => row && row.story).length;
  return `
    <p class="worklist-summary"><strong>${run.placed} block${run.placed === 1 ? "" : "s"} placed</strong>,
       marked <em>needs review</em>. ${left.length} still to do — nothing here has been lost.</p>
    <ul class="bulk-list">${left.map((row) => `<li class="bulk-row is-error">
      <strong>p${row?.page ?? "?"}/${escapeHtml(row?.sectionKey || "?")}</strong>
      <span class="bulk-headline">${escapeHtml(row?.story?.headlineHint || "")}</span>
      <span class="muted">${escapeHtml(row?.error || "The paper would not take this block.")}</span>
    </li>`).join("")}</ul>
    <p class="muted ext-note">These keep the sources and the facts the plan already found, so writing them
       again costs one call each and no research.</p>
    <div class="newsdesk-actions">
      <button type="button" class="ext-editor-btn ext-editor-btn-primary" id="newsdeskWriteAgain"${recoverable ? "" : " disabled"}>Write ${recoverable} again</button>
      <button type="button" class="ext-editor-btn" id="newsdeskDone">Leave the rest</button>
    </div>`;
}

// --------------------------------------------------------------- the panel ---

/**
 * Open the run.
 *
 * `onDone` is called after blocks are accepted so the workspace can reload its
 * pages - this route writes server-side rather than through the draft, because
 * a run spans the whole edition and `patchDraft` only reaches the page the desk
 * happens to be looking at.
 */
export function openNewsdeskPanel({ newspaperId, byPage, blocks, place, commissioned = 0, onDone, onWriteCommissioned, notice }) {
  document.getElementById(PANEL_ID)?.remove();
  const panel = document.createElement("aside");
  panel.id = PANEL_ID;
  panel.className = "preflight-panel worklist-panel newsdesk-panel";
  document.body.appendChild(panel);

  const run = newRun({ newspaperId, byPage, blocks, place });
  run.commissioned = commissioned;
  let busy = false;

  const say = (message) => notice?.(message);

  function render(stage) {
    const body = stage === "plan" ? planMarkup(run)
      : stage === "copy" ? copyMarkup(run)
        : stage === "left" ? leftMarkup(run)
          : briefMarkup(run);
    const title = stage === "plan" ? "The plan"
      : stage === "copy" ? "The copy"
        : stage === "left" ? "Still to do"
          : "Plan the edition";
    panel.innerHTML = `<header><strong>${title}</strong>
      <button type="button" id="newsdeskClose" aria-label="Close">×</button></header>${body}`;
    // The panel walks brief -> plan -> copy and rewrites its own header at each
    // stage, so it is named again each time.
    nameThePanel(panel);
    document.getElementById("newsdeskClose")
      .addEventListener("click", closeOnEscape(() => panel.remove()));
    bind(stage);
  }

  function bind(stage) {
    if (stage === "brief") return bindBrief();
    if (stage === "plan") return bindPlan();
    if (stage === "left") return bindLeft();
    return bindCopy();
  }

  function bindLeft() {
    panel.querySelector("#newsdeskWriteAgain")?.addEventListener("click", writeAgain);
    panel.querySelector("#newsdeskDone")?.addEventListener("click", () => panel.remove());
  }

  function bindBrief() {
    panel.querySelector("#newsdeskFreshness")?.addEventListener("change", (event) => {
      run.brief.freshness = event.target.value;
    });

    // WHERE "LOCAL" IS. Changing the state redraws the district list, because
    // a district belongs to a state and offering Satara under Kerala is how a
    // query comes back empty for a reason nobody can see.
    panel.querySelector("#newsdeskCountry")?.addEventListener("change", (event) => {
      run.place = placeOf({ ...run.place, country: event.target.value });
      render("brief");
    });
    panel.querySelector("#newsdeskState")?.addEventListener("change", (event) => {
      run.place = placeOf({ ...run.place, state: event.target.value, district: "" });
      render("brief");
    });
    panel.querySelector("#newsdeskDistrict")?.addEventListener("change", (event) => {
      run.place = placeOf({ ...run.place, district: event.target.value });
      render("brief");
    });
    panel.querySelector("#newsdeskCity")?.addEventListener("change", (event) => {
      run.place = placeOf({ ...run.place, city: event.target.value });
      render("brief");
    });

    // What each story gets. Read off the form rather than tracked per press,
    // for the same reason the chart dialog harvests: the panel is rewritten on
    // every render and a value held in a detached node is a value lost.
    const ask = (id, key) => panel.querySelector(id)?.addEventListener("change", (event) => {
      run.asks[key] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    });
    ask("#newsdeskHeadline", "writeHeadline");
    ask("#newsdeskSubheading", "writeSubheading");
    ask("#newsdeskReason", "reason");
    ask("#newsdeskChart", "writeChart");
    ask("#newsdeskChartType", "chartType");
    panel.querySelectorAll("[data-want-tag]").forEach((select) => select.addEventListener("change", (event) => {
      const [p, w] = event.target.dataset.wantTag.split(":").map(Number);
      run.brief.pages[p].wants[w].tagKey = event.target.value;
    }));
    panel.querySelectorAll("[data-want-count]").forEach((input) => input.addEventListener("change", (event) => {
      const [p, w] = event.target.dataset.wantCount.split(":").map(Number);
      run.brief.pages[p].wants[w].count = Math.max(1, Number(event.target.value) || 1);
      render("brief");
    }));
    panel.querySelectorAll("[data-want-demand]").forEach((select) => select.addEventListener("change", (event) => {
      const [p, w] = event.target.dataset.wantDemand.split(":").map(Number);
      run.brief.pages[p].wants[w].demand = event.target.value;
    }));
    panel.querySelectorAll("[data-want-remove]").forEach((button) => button.addEventListener("click", (event) => {
      const [p, w] = event.currentTarget.dataset.wantRemove.split(":").map(Number);
      run.brief.pages[p].wants.splice(w, 1);
      render("brief");
    }));
    panel.querySelectorAll("[data-want-add]").forEach((button) => button.addEventListener("click", (event) => {
      const p = Number(event.currentTarget.dataset.wantAdd);
      const used = new Set(run.brief.pages[p].wants.map((want) => want.tagKey));
      const next = NEWS_TAGS.find((tag) => !used.has(tag.key)) || NEWS_TAGS[0];
      run.brief.pages[p].wants.push({ tagKey: next.key, count: 1, demand: "preferred" });
      render("brief");
    }));
    panel.querySelector("#newsdeskResearch")?.addEventListener("click", research);
    panel.querySelector("#newsdeskCommissioned")?.addEventListener("click", () => {
      panel.remove();
      onWriteCommissioned?.();
    });
  }

  function bindPlan() {
    // A ROW'S OWN ASKS. Only the CHART re-renders, because turning it on adds
    // the type select beside it; the other three change nothing on screen, so
    // re-rendering for them would throw away the desk's scroll position half
    // way down a list of thirty-one.
    panel.querySelectorAll("[data-ask]").forEach((control) => {
      control.addEventListener("change", (event) => {
        const el = event.currentTarget;
        const key = el.dataset.askRow;
        const field = el.dataset.ask;
        const story = run.plan.stories.find((row) => rowKey(row) === key);
        if (!story) return;
        const own = { ...(run.asksByRow.get(key) || {}) };
        own[field] = el.type === "checkbox" ? el.checked : el.value;
        run.asksByRow.set(key, own);
        if (field === "writeChart") render("plan");
      });
    });
    panel.querySelectorAll("[data-plan-drop]").forEach((button) => button.addEventListener("click", (event) => {
      const key = event.currentTarget.dataset.planDrop;
      if (run.dropped.has(key)) run.dropped.delete(key); else run.dropped.add(key);
      render("plan");
    }));
    panel.querySelector("#newsdeskBack")?.addEventListener("click", () => render("brief"));
    panel.querySelector("#newsdeskWrite")?.addEventListener("click", write);
  }

  function bindCopy() {
    panel.querySelector("#newsdeskAccept")?.addEventListener("click", accept);
  }

  /** A failed fetch must say so. The five unchecked page re-reads, again. */
  async function post(path, body) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      throw new Error(data?.error || `The server answered ${response.status}.`);
    }
    return data;
  }

  // THE GUARD IS RELEASED IN A `finally`, AND THAT IS THE WHOLE POINT.
  //
  // `busy` is set here and cleared only by the function this returns. Each of
  // the three stages used to call it in its CATCH alone - so a run that
  // SUCCEEDED left `busy` true for the life of the panel, and the next stage's
  // `if (busy) return;` swallowed the press.
  //
  // The desk's report was "it shows me 31 stories, I click Write 31 stories
  // and nothing is happening", and that is exactly it: the plan renders, the
  // button is enabled, and pressing it makes no request, shows no message and
  // changes nothing on screen. Measured on a stubbed planner - 0 POSTs to
  // /newsdesk/write. The same leak in write() then killed Place these.
  //
  // It is the "a control that draws perfectly and does nothing" fault arriving
  // through a guard flag rather than through a listener - and it is worse than
  // the listener kind, because the FIRST press of each button works and only
  // the second stage is dead, so it looks like the AI failing rather than the
  // panel.
  //
  // Restoring a button `render()` has already replaced is a no-op: the
  // `isConnected` check below is what makes releasing in `finally` safe on the
  // success path as well as the failure one.
  //
  // It wears the SAME busy vocabulary as every other control in the product
  // (`ui/busy.js`): the spinner, `aria-busy` for a screen reader, and the
  // measured width pinned so a row of controls cannot reflow under the
  // pointer. It cannot simply call `busyButton` - that wraps one promise, and
  // these three stages release across a `render()` that replaces the button -
  // so it keeps its own release function and matches the contract by hand.
  //
  // This is the longest wait in the product by a distance: the planner is one
  // Ultra call for a whole newspaper (83s measured on a 26-block brief) and
  // the writers are one call per block, four at a time. A label alone on a
  // wait that long reads as a frozen screen.
  function working(id, label) {
    const button = panel.querySelector(id);
    if (button) {
      const wasWidth = button.getBoundingClientRect().width;
      button.disabled = true;
      button.dataset.was = button.textContent;
      button.textContent = label;
      button.setAttribute("aria-busy", "true");
      button.classList.add("is-busy");
      if (wasWidth > 0) button.style.minWidth = `${Math.round(wasWidth)}px`;
    }
    // The panel's own body is about to be replaced, so it says so too - the
    // button is at the foot of a long list and a desk reading the plan is not
    // looking at it.
    panel.setAttribute("aria-busy", "true");
    busy = true;
    return () => {
      busy = false;
      panel.removeAttribute("aria-busy");
      if (button && button.isConnected) {
        button.disabled = false;
        button.textContent = button.dataset.was;
        button.removeAttribute("aria-busy");
        button.classList.remove("is-busy");
        button.style.minWidth = "";
      }
    };
  }

  async function research() {
    if (busy) return;
    const done = working("#newsdeskResearch", "Searching the news…");
    try {
      run.plan = await post(`/api/newspapers/${run.newspaperId}/newsdesk/plan`, {
        brief: run.brief,
        // Where "local" is for THIS run. The planner's `local` tag requires the
        // open web because a district story is on it or nowhere, and the query
        // it searches with is this.
        place: run.place,
        placeQuery: placeQuery(run.place),
      });
      run.dropped = new Set();
      if (!run.plan.stories.length) {
        say("Nothing worth printing was found for that brief. Try a longer window, or fewer required categories.");
      }
      render("plan");
    } catch (error) {
      say(error.message);
    } finally {
      done();
    }
  }

  async function write() {
    if (busy) return;
    const keeping = run.plan.stories
      .filter((s) => !run.dropped.has(rowKey(s)))
      // Each story carries its OWN asks. The run's settings are still sent
      // below as the default, so a story that overrides nothing is written
      // exactly as it was before this existed.
      .map((s) => ({ ...s, asks: asksFor(run, s) }));
    if (!keeping.length) return;
    run.sent = keeping;
    const done = working("#newsdeskWrite", `Writing ${keeping.length}…`);
    try {
      run.batch = await post(`/api/newspapers/${run.newspaperId}/newsdesk/write`, {
        stories: keeping,
        // The same things a single block can be asked for. One run makes up a
        // whole paper, and it could ask for less than the panel that writes
        // one block - every one of these ends in the same storyWriter.write().
        asks: run.asks,
      });
      render("copy");
    } catch (error) {
      say(error.message);
    } finally {
      done();
    }
  }

  // ACCEPT PLACES EVERY STORY IT HAS, AND KEEPS WHAT IT COULD NOT.
  //
  // The desk's report was "it should accept all news to layout but it just
  // accepts one, then it vanishes all the other news". Two things were true
  // and they compound:
  //
  //   * the rows a provider had failed on were filtered out and then THROWN
  //     AWAY - `panel.remove()` destroyed the run, so a story the desk had
  //     already paid a research call for could not be written again without
  //     paying for the whole research pass a second time;
  //   * a row the SERVER refused (a block that had gone, a page belonging to
  //     another edition) was reported as a bare count in a toast that fades,
  //     next to no way of acting on it.
  //
  // So a run whose providers were rate-limited or out of quota - which is the
  // ordinary case on a metered account, and this project has measured a
  // 26-block run exhausting every configured provider - placed whatever
  // happened to succeed and silently lost the rest.
  //
  // Nothing about placing changes: the server loops every row it is given and
  // was verified doing so, 8 of 8. What changes is that the panel STAYS when
  // there is anything left, showing exactly which blocks are outstanding and
  // why, with the button that sends those same stories again for one call
  // each. It closes only when there is nothing left to do.
  async function accept() {
    if (busy) return;
    const done = working("#newsdeskAccept", "Placing…");
    try {
      const stories = run.batch.results.filter((r) => r && !r.error);
      const result = await post(`/api/newspapers/${run.newspaperId}/newsdesk/accept`, { stories });
      const refused = new Set((result.refused || []).map((row) => row.sectionKey));
      // THE PHOTOGRAPHS, AFTER THE COPY AND ONLY WHERE THE DESK ASKED.
      //
      // After, because a picture belongs to a block that carries its story: a
      // photograph placed on a block whose copy the paper then refused is a
      // picture of nothing. Each one goes through the ordinary picture route,
      // so the corridor snap, the default frame, the runaround and all four
      // exports work on it exactly as they do on an uploaded photograph -
      // there is no newsdesk-specific placement anywhere.
      const pictures = await placePictures(stories.filter((row) => !refused.has(row.sectionKey)));
      // What is still outstanding: a block the writer never answered for, and
      // a block the server would not take. Both are recoverable and both keep
      // their own story, so both can be written again.
      const left = run.batch.results.filter((row) => !row || row.error || refused.has(row.sectionKey));
      run.placed = (run.placed || 0) + result.saved;
      await onDone?.();
      const picLine = pictures.asked
        ? ` ${pictures.placed} photograph${pictures.placed === 1 ? "" : "s"} placed${pictures.failed ? `, ${pictures.failed} refused` : ""}.`
        : "";
      if (!left.length) {
        say(`${result.saved} block${result.saved === 1 ? "" : "s"} placed, marked needs review.${picLine}`);
        panel.remove();
        return;
      }
      run.leftOver = left;
      render("left");
      say(`${result.saved} placed.${picLine} ${left.length} still to do — they are still on this panel.`);
    } catch (error) {
      say(error.message);
    } finally {
      done();
    }
  }

  /**
   * The photographs the desk ticked, placed one at a time.
   *
   * ONE AT A TIME on purpose: each fetch reaches out to a publisher's server
   * and the picture route answers with the block's WHOLE image list, so two in
   * flight on one block would race and an older answer could replace a newer
   * one - which is the rule `block-frame.js` already states for picture
   * patches.
   *
   * A refusal is counted and never thrown: a photograph this paper may not
   * fetch must not cost the desk the story it belongs to. The reason is the
   * server's own sentence - not a public address, not a picture, too large -
   * because a line written here would throw away the only thing a desk can act
   * on.
   */
  async function placePictures(rows) {
    const wanted = rows
      .map((row) => {
        const key = `${row.page}/${row.sectionKey}`;
        const want = panel.querySelector(`[data-pic-row="${CSS.escape(key)}"]`)?.checked;
        const cut = panel.querySelector(`[data-cut-row="${CSS.escape(key)}"]`)?.checked;
        const picture = pictureOf(row);
        return want && picture ? { row, picture, cut } : null;
      })
      .filter(Boolean);
    if (!wanted.length) return { asked: false, placed: 0, failed: 0, why: [] };

    let placed = 0;
    let failed = 0;
    const why = [];
    for (const one of wanted) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const images = await post(
          `/api/pages/${one.row.pageId}/sections/${encodeURIComponent(one.row.sectionKey)}/images/from-link`,
          { link: one.picture.url },
        );
        placed += 1;
        // The cut-out is a SECOND, separate act on the picture that was just
        // placed, exactly as the Pictures panel does it - never a mode the
        // fetch is put into.
        const added = Array.isArray(images) ? images[images.length - 1] : null;
        if (one.cut && added?.id) {
          // eslint-disable-next-line no-await-in-loop
          await post(
            `/api/pages/${one.row.pageId}/sections/${encodeURIComponent(one.row.sectionKey)}/images/${added.id}/cutout`,
            {},
          ).catch(() => {});
        }
      } catch (error) {
        failed += 1;
        why.push(`${one.row.sectionKey}: ${error.message}`);
      }
    }
    if (why.length) say(why[0]);
    return { asked: true, placed, failed, why };
  }

  // Writing again the stories that did not come back, and ONLY those.
  //
  // Each carries the plan row it came from, so this costs one call per block
  // and no research at all - the retrieval, the clustering and the desk's own
  // reading of the plan are all still good.
  async function writeAgain() {
    if (busy) return;
    const stories = (run.leftOver || [])
      .map((row) => row.story)
      .filter(Boolean)
      .map((story) => ({ ...story, asks: asksFor(run, story) }));
    if (!stories.length) {
      return say("These blocks cannot be written again from here — research the edition afresh.");
    }
    const done = working("#newsdeskWriteAgain", `Writing ${stories.length}…`);
    try {
      run.batch = await post(`/api/newspapers/${run.newspaperId}/newsdesk/write`, {
        stories, asks: run.asks,
      });
      render("copy");
    } catch (error) {
      say(error.message);
    } finally {
      done();
    }
  }

  render("brief");
  return panel;
}
