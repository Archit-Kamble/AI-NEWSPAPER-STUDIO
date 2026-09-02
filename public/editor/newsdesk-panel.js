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
    plan: null, batch: null, dropped: new Set(),
  };
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
      <legend>What each story gets</legend>
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

function planRow(story, dropped) {
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
      <details><summary>What it will be written from</summary>
        <ul class="newsdesk-facts">${story.facts.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>
        ${story.doNotClaim?.length ? `<p class="muted">Will not claim: ${story.doNotClaim.map(escapeHtml).join("; ")}</p>` : ""}
        <ul class="newsdesk-sources">${story.sources.map((s) => `<li>${escapeHtml(s.publisher)} — <a href="${escapeHtml(s.url || "#")}" target="_blank" rel="noopener noreferrer">open</a></li>`).join("")}</ul>
      </details>
    </div>
    <button type="button" class="ext-editor-btn" data-plan-drop="${escapeHtml(rowKey(story))}">${off ? "Put back" : "Drop"}</button>
  </li>`;
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
    <ul class="newsdesk-plan">${plan.stories.map((s) => planRow(s, run.dropped)).join("")}</ul>
    ${emptyNote}
    <div class="newsdesk-actions">
      <button type="button" class="ext-editor-btn" id="newsdeskBack">Change the brief</button>
      <button type="button" class="ext-editor-btn ext-editor-btn-primary" id="newsdeskWrite"${keeping.length ? "" : " disabled"}>Write ${keeping.length} stor${keeping.length === 1 ? "y" : "ies"}</button>
      <span class="muted">${keeping.length} call${keeping.length === 1 ? "" : "s"}, four at a time.</span>
    </div>`;
}

// ---------------------------------------------------------------- the copy ---

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
    const body = stage === "plan" ? planMarkup(run) : stage === "copy" ? copyMarkup(run) : briefMarkup(run);
    const title = stage === "plan" ? "The plan" : stage === "copy" ? "The copy" : "Plan the edition";
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
    return bindCopy();
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
  function working(id, label) {
    const button = panel.querySelector(id);
    if (button) { button.disabled = true; button.dataset.was = button.textContent; button.textContent = label; }
    busy = true;
    return () => {
      busy = false;
      if (button && button.isConnected) { button.disabled = false; button.textContent = button.dataset.was; }
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
    const keeping = run.plan.stories.filter((s) => !run.dropped.has(rowKey(s)));
    if (!keeping.length) return;
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

  async function accept() {
    if (busy) return;
    const done = working("#newsdeskAccept", "Placing…");
    try {
      const stories = run.batch.results.filter((r) => r && !r.error);
      const result = await post(`/api/newspapers/${run.newspaperId}/newsdesk/accept`, { stories });
      say(`${result.saved} block${result.saved === 1 ? "" : "s"} placed, marked needs review.${result.refused.length ? ` ${result.refused.length} refused.` : ""}`);
      panel.remove();
      await onDone?.();
    } catch (error) {
      say(error.message);
    } finally {
      done();
    }
  }

  render("brief");
  return panel;
}
