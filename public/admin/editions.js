// The editions panel: today's paper, and every edition that came before it.
//
// This replaces a list that could not do its job. It read `np.date` and
// `np.pageCount` when the API returns `publication_date` and `page_count`, so
// every row on the dashboard said "undefined • undefined Pages"; it reversed a
// newest-first list into oldest-first, so the row at the top was the oldest
// edition in the database and today's was 116 rows down; and there was no sign
// of whether an edition had any work in it, so the top row opened an empty
// paper and the desk concluded that nothing had saved.
//
// What a desk needs from this screen is small and specific:
//
//   * today's edition, by name, with the state it is in and one button that
//     opens it - the same button whether it exists yet or not.
//   * the recent editions, newest first, each showing its date the way the
//     paper prints it and how much of it is filled.
//   * a way to find an older one without scrolling past a hundred rows.

import { escapeHtml } from "../editor/format.js";
import { askConfirm, askPrompt } from '../ui/dialog.js';
import { showFailure } from '../ui/notice.js';
import { emptyStateMarkup } from '../ui/empty.js';

const DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
const WEEKDAYS = ['रविवार', 'सोमवार', 'मंगळवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'];
const MONTHS = ['जानेवारी', 'फेब्रुवारी', 'मार्च', 'एप्रिल', 'मे', 'जून',
  'जुलै', 'ऑगस्ट', 'सप्टेंबर', 'ऑक्टोबर', 'नोव्हेंबर', 'डिसेंबर'];

const RECENT_LIMIT = 12;
const FALLBACK_PAGE_COUNTS = Object.freeze([4, 6, 8, 10, 12, 14, 16]);

const devanagari = (value) => String(value).replace(/\d/g, (d) => DIGITS[Number(d)]);
const isoDate = (value) => String(value || '').slice(0, 10);

/** The edition belonging to the date the desk selected, never implicitly today. */
export function editionForDate(editions, date) {
  const wanted = isoDate(date);
  return (Array.isArray(editions) ? editions : [])
    .find((edition) => isoDate(edition?.publication_date) === wanted) || null;
}

/** The one request shape used by the date-aware edition creator. */
export function editionStartPayload({ publicationDate, pageCount, name, carryForward, fillFeatures } = {}) {
  const payload = {
    publicationDate: isoDate(publicationDate),
    pageCount: Number(pageCount) || 4,
    carryForward: carryForward !== false,
    fillFeatures: fillFeatures !== false,
  };
  const cleanName = String(name || '').trim();
  if (cleanName) payload.name = cleanName;
  return payload;
}

export async function loadSupportedPageCounts(fetcher = fetch) {
  try {
    const response = await fetcher('/api/newspapers/supported-page-counts');
    if (!response.ok) throw new Error(`supported page counts: HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data) || !data.length || !data.every(Number.isInteger)) throw new Error('supported page counts: invalid payload');
    return data;
  } catch (error) {
    console.error(error);
    return [...FALLBACK_PAGE_COUNTS];
  }
}

/** Today where the paper is printed - not the browser's timezone, and never UTC. */
export function todayIso() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** "सोमवार, ४ ऑगस्ट २०२६" - the date as the masthead sets it. */
export function marathiDate(iso) {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${devanagari(d)} ${MONTHS[m - 1]} ${devanagari(y)}`;
}

/**
 * HOW A DESK SAYS WHEN, AND IT IS NOT AN ARITHMETIC RESULT.
 *
 * This was unbounded, so every 2099-dated fixture in the archive read
 * "in 26785 days" - twelve of them on screen at once. A real archive would
 * read "412 days ago" where a newsroom says "last March".
 *
 * A desk works in today, yesterday, a weekday inside this week, and then a
 * date. Past that the relative form stops carrying information a person can
 * use, so it stops being offered and the masthead's own date - already on the
 * row beside this - is the answer.
 */
const RELATIVE_LIMIT_DAYS = 6;
function relativeDay(iso, today) {
  const day = (value) => {
    const [y, m, d] = String(value || '').slice(0, 10).split('-').map(Number);
    return y ? Date.UTC(y, m - 1, d) : NaN;
  };
  const at = day(iso);
  const diff = Math.round((at - day(today)) / 86400000);
  if (!Number.isFinite(diff)) return '';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (Math.abs(diff) <= RELATIVE_LIMIT_DAYS) {
    const weekday = WEEKDAYS_EN[new Date(at).getUTCDay()];
    return diff > 0 ? `This ${weekday}` : `Last ${weekday}`;
  }
  // Beyond the week the relative form says nothing useful, so it says nothing.
  return '';
}

const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// How much of an edition is actually made up. This is the number that tells a
// desk at a glance whether an edition holds their work or is an empty shell.
function fillOf(edition) {
  const blocks = Number(edition.block_count) || 0;
  const filled = Number(edition.filled_block_count) || 0;
  return { blocks, filled, percent: blocks ? Math.round((filled / blocks) * 100) : 0 };
}

// `mayDelete` is passed in rather than looked up. Deleting an edition is the
// owner's alone (src/auth/roles.js), and this renderer is fed what it may draw
// the same way grid.js is fed its geometry and masthead.js its identity - the
// renderers in this product do not reach for state. The server refuses the
// route regardless; hiding the door is so a desk is not offered one that
// answers 403.
/*
 * ONE SCRIPT TO A LINE.
 *
 * This row read "४ pages · 3 of 32 blocks filled" - Devanagari numerals
 * against Latin ones inside one sentence, with English words around both. The
 * masthead date above it sets its numerals in Devanagari, which is right; the
 * chrome describing the edition is written in English and counts in Latin.
 *
 * An edition with no pages also rendered "० pages ·" - a separator with
 * nothing after it - so the count is omitted rather than printed as a zero.
 *
 * (The comment that used to carry this sat inside the row's template literal
 * as an HTML comment, and its backtick closed the string. Third time in this
 * codebase; the reasoning lives in JS from here on.)
 */
function pageCountLine(edition, fill, empty) {
  const pages = Number(edition.page_count) || 0;
  const parts = [];
  if (pages) parts.push(`${pages} page${pages === 1 ? '' : 's'}`);
  parts.push(empty
    ? '<span class="edition-empty">nothing written yet</span>'
    : `${fill.filled} of ${fill.blocks} blocks filled`);
  return parts.join(' · ');
}

/*
 * OPEN IS THE ROW'S ACTION; DELETE IS NOT ITS PEER.
 *
 * They were two buttons of the same size side by side, so Tab through the list
 * went Open, Delete, Open, Delete - 24 stops for twelve editions, with the
 * destructive control adjacent to the safe one at every row, and Tab-Tab-Enter
 * a plausible way to lose an edition. Delete is a quiet mark at the end of the
 * row now: still one press, still where it was, no longer competing for the
 * eye, and carrying the edition's own date as its accessible name rather than
 * the word "Delete" twelve times over.
 */
function editionRowHtml(edition, today, mayDelete) {
  const fill = fillOf(edition);
  const iso = String(edition.publication_date || '').slice(0, 10);
  const empty = fill.filled === 0;
  return `
    <div class="edition-row${iso === today ? ' edition-row--today' : ''}" data-edition-id="${edition.id}">
      <div class="edition-row-date">
        <strong>${escapeHtml(marathiDate(iso))}</strong>
        <small>${[iso, relativeDay(iso, today)].filter(Boolean).map(escapeHtml).join(' · ')}</small>
      </div>
      <div class="edition-row-name">
        <span class="edition-number" title="Edition number">#${escapeHtml(String(edition.id))}</span>
        ${escapeHtml(edition.name || '')}
        <small>${pageCountLine(edition, fill, empty)}</small>
      </div>
      <div class="edition-row-fill" title="${fill.percent}% of the blocks have copy in them">
        <span style="width:${fill.percent}%"></span>
      </div>
      <span class="status-pill ${escapeHtml(edition.status || 'draft')}">${escapeHtml(edition.status || 'draft')}</span>
      <button class="btn-secondary edition-open" data-edition-id="${edition.id}">Open</button>
      ${mayDelete ? `<button class="edition-delete" data-edition-id="${edition.id}"
              aria-label="Delete the edition for ${escapeHtml(marathiDate(iso))}"
              title="Delete this edition and everything on its pages">&#215;</button>` : ''}
    </div>`;
}

/**
 * What the desk is about to destroy, in the words of the thing itself.
 *
 * A confirmation that says "Delete edition 40294?" asks about an id. Nobody
 * knows what is in an id, so the honest answer is always No and the desk
 * learns to dismiss the question - which is the exact fault this codebase
 * already fixed once, for a scoped AI overwrite that named three fields when
 * one was changing.
 */
function deletionQuestion(edition) {
  const fill = fillOf(edition);
  const iso = String(edition.publication_date || '').slice(0, 10);
  const what = fill.filled
    ? `${fill.filled} of its ${fill.blocks} blocks have copy in them.`
    : 'Nothing has been written into it.';
  // A dialog has a title slot, so the QUESTION goes in it and the consequences
  // go underneath. Through `window.confirm` all of this arrived as one run of
  // unstyled OS text under the words "localhost:3000 says", with no way to
  // emphasise the date and no way to make the destructive button look
  // destructive - which is the whole reason this sentence was written.
  return {
    title: `Delete the edition for ${marathiDate(iso)}?`,
    body: `${edition.name || 'Unnamed edition'} — ${iso} — ${edition.page_count || 0} pages. ${what}\n`
      + '\nEvery page, block, story and placed picture on it goes with it, and this cannot be undone. '
      + "Reporters' own filings are not affected.",
  };
}

/**
 * Renders the editions panel into `host`.
 *
 * `onOpen(id)` opens an edition in the workspace - the panel never navigates by
 * itself, so the dashboard stays in charge of what the screen shows.
 */
export async function renderEditions(host, { onOpen, openCreator: startOpen = false, mayDelete = false } = {}) {
  const today = todayIso();
  let editions;
  try {
    const response = await fetch('/api/newspapers');
    if (!response.ok) throw new Error(`editions: HTTP ${response.status}`);
    editions = await response.json();
  } catch (error) {
    host.innerHTML = '<div class="form-section"><h2 class="editions-title">आजचा अंक</h2><p class="muted">Editions could not be loaded. Other dashboard tools remain available.</p></div>';
    console.error(error);
    return;
  }
  const list = Array.isArray(editions) ? editions : [];
  const todays = editionForDate(list, today);
  const supportedCounts = await loadSupportedPageCounts();
  const pageOptions = (selected) => supportedCounts.map((count) => `<option value="${count}" ${Number(count) === Number(selected) ? 'selected' : ''}>${count}</option>`).join('');
  const defaultPages = supportedCounts[0] || 4;
  const todayLadder = await fetch(`/api/newspapers/ladder?pages=${todays?.page_count || defaultPages}`).then((r) => r.json()).catch(() => []);

  host.innerHTML = `
    <div class="form-section">
      <h2 class="editions-title">आजचा अंक</h2>
      <p class="editions-sub">${escapeHtml(marathiDate(today))} · ${escapeHtml(today)}</p>

      <div class="dashboard-card edition-today">
        <div class="edition-today-main">
          <h3>${todays ? escapeHtml(todays.name || 'Today\'s edition') : "Today's edition has not been started"}</h3>
          <p>${todays
            ? `${Number(todays.page_count) || 0} pages · ${fillOf(todays).filled} of ${fillOf(todays).blocks} blocks filled · ${escapeHtml(todays.status)}`
            : 'Starting it builds the page ladder, carries the booked adverts forward from the last edition and fills the day&rsquo;s standing features.'}</p>
        </div>
        <div class="edition-today-form">
          ${todays ? `<p><strong>Current edition:</strong> ${Number(todays.page_count) || 0} pages</p>
            <button class="btn-submit" id="openEditionBtn">Open Edition</button>
            <label>Change pages
              <select id="todayEditionPages">${pageOptions(todays.page_count)}</select>
            </label>
            <button class="btn-secondary" id="resizeEditionBtn">Change Page Count</button>`
            : '<button class="btn-submit" id="startTodayBtn">Start Today\'s Edition</button>'}
        </div>
      </div>
      <p class="edition-ladder" id="todayEditionLadder">${ladderLine(todayLadder)}</p>

      <div class="editions-list-heading">
        <div>
          <h3 class="editions-heading">Past Newspapers</h3>
          <p>Create a newspaper for any date, or open the one already assigned to that date.</p>
        </div>
        <button class="btn-submit" id="createEditionToggle" type="button">+ Create Edition</button>
      </div>

      <form class="dashboard-card edition-creator" id="editionCreator" hidden>
        <div class="edition-creator-heading">
          <div><h3>Create Edition</h3><p>Select the publication date first. An existing date opens its own edition; a free date creates a new one.</p></div>
          <button class="btn-secondary" id="createEditionClose" type="button" aria-label="Close edition creator">Close</button>
        </div>
        <div class="edition-creator-fields">
          <label>Publication date
            <input type="date" id="createEditionDate" value="${today}" required>
          </label>
          <label>Edition name <small>Optional</small>
            <input type="text" id="createEditionName" placeholder="Uses the publication name">
          </label>
          <label>Pages
            <select id="createEditionPages">${pageOptions(defaultPages)}</select>
          </label>
        </div>
        <div class="edition-creator-options">
          <label><input type="checkbox" id="createEditionCarry" checked> Carry booked adverts from the previous edition</label>
          <label><input type="checkbox" id="createEditionFeatures" checked> Fill standing daily features for this date</label>
        </div>
        <p class="edition-existing-note" id="createEditionExisting" aria-live="polite"></p>
        <p class="edition-ladder" id="createEditionLadder"></p>
        <div class="edition-creator-actions">
          <button class="btn-submit" id="createEditionSubmit" type="submit">Create Edition</button>
          <button class="btn-secondary" id="createAnotherEdition" type="button" hidden>Another edition for this date</button>
        </div>
      </form>

      <input class="edition-search" id="editionSearch" placeholder="Search by edition number, date or name…">
      <div id="editionList"></div>
      ${list.length > RECENT_LIMIT
        ? `<button class="btn-secondary edition-more" id="editionMoreBtn">Show all ${list.length} editions</button>`
        : ''}
    </div>`;

  let showAll = false;
  let query = '';

  const paint = () => {
    const q = query.trim().toLowerCase();
    // THE EDITION NUMBER IS SEARCHABLE, and with or without its hash.
    //
    // A date is how a desk finds yesterday's paper; a NUMBER is how they find
    // the one somebody named on the telephone - and it is the only handle that
    // is unique now that a date can carry more than one edition. `#54470`,
    // `54470` and a bare `470` all reach it.
    const matched = q
      ? list.filter((e) =>
          `#${e.id} ${e.name || ''} ${e.publication_date || ''} ${marathiDate(e.publication_date)}`.toLowerCase().includes(q.replace(/^#/, '')))
      : list;
    const shown = showAll || q ? matched : matched.slice(0, RECENT_LIMIT);
    const target = host.querySelector('#editionList');
    target.innerHTML = shown.length
      ? shown.map((e) => editionRowHtml(e, today, mayDelete)).join('')
      : emptyStateMarkup({
        title: q ? `No edition matches “${query.trim()}”.` : 'No editions yet.',
        body: q
          ? 'Search by the edition number, the date as the masthead sets it, the ISO date, or the edition name.'
          : 'Start today\'s paper above and it will appear here.',
        action: q ? { label: 'Clear the search', attr: 'data-clear-edition-search' } : null,
      });
    target.querySelector('[data-clear-edition-search]')?.addEventListener('click', () => {
      const box = host.querySelector('#editionSearch');
      query = '';
      if (box) { box.value = ''; box.focus(); }
      paint();
    });
    target.querySelectorAll('.edition-open').forEach((button) => {
      button.addEventListener('click', () => onOpen(Number(button.dataset.editionId)));
    });
    target.querySelectorAll('.edition-delete').forEach((button) => {
      button.addEventListener('click', () => removeEdition(Number(button.dataset.editionId), button));
    });
  };
  paint();

  async function removeEdition(id, button) {
    const edition = list.find((e) => Number(e.id) === id);
    if (!edition) return;
    const question = deletionQuestion(edition);
    const go = await askConfirm({
      title: question.title,
      body: question.body,
      confirm: 'Delete this edition',
      cancel: 'Keep it',
      destructive: true,
    });
    if (!go) return;

    button.disabled = true;
    const was = button.textContent;
    button.textContent = 'Deleting…';
    try {
      const response = await fetch(`/api/newspapers/${id}`, { method: 'DELETE' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.code === 'EPAPER_RELEASED'
          ? 'This edition is published as an e-paper. Open the E-paper screen, remove its public copy, then delete it.'
          : result.error || `The edition could not be deleted (HTTP ${response.status}).`);
      }
      // Only the row that went is removed. Repainting the whole panel would
      // throw away the desk's search and take the list back to the top, which
      // on a database of 221 editions is most of the work of finding the next
      // one to be rid of.
      const at = list.findIndex((e) => Number(e.id) === id);
      if (at >= 0) list.splice(at, 1);
      paint();
    } catch (error) {
      button.disabled = false;
      button.textContent = was;
      // A failure on a destructive route is the worst kind to lose: it used to
      // be shown for five seconds and then erased itself, carrying whatever
      // the server said. It stays now, and offers the way to try again.
      showFailure(error.message, { retry: () => removeEdition(id, button) });
    }
  }

  host.querySelector('#editionSearch').addEventListener('input', (event) => {
    query = event.target.value;
    paint();
  });
  host.querySelector('#editionMoreBtn')?.addEventListener('click', (event) => {
    showAll = true;
    event.target.remove();
    paint();
  });

  // Today's card opens/resizes TODAY only. Date selection lives exclusively
  // in the creator below, so editing a date can never still open today's id.
  host.querySelector('#openEditionBtn')?.addEventListener('click', () => onOpen(todays.id));
  const todayPagesInput = host.querySelector('#todayEditionPages');
  todayPagesInput?.addEventListener('change', async () => {
    const rungs = await fetch(`/api/newspapers/ladder?pages=${Number(todayPagesInput.value) || defaultPages}`)
      .then((r) => r.json()).catch(() => []);
    host.querySelector('#todayEditionLadder').innerHTML = ladderLine(rungs);
  });
  host.querySelector('#resizeEditionBtn')?.addEventListener('click', async (event) => {
    const button = event.currentTarget; button.disabled = true;
    try {
      const response = await fetch(`/api/newspapers/${todays.id}/resize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageCount: Number(todayPagesInput.value) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.code === 'EDITION_RESIZE_HAS_CONTENT' ? `Cannot reduce: ${result.blockers.map((p) => `page ${p.pageNumber} (${p.reasons.join(', ')})`).join('; ')}` : (result.code || 'Could not change page count.'));
      onOpen(todays.id, result);
    } catch (error) { button.disabled = false; showFailure(error.message, { retry: () => button.click() }); }
  });

  // One date-aware creator for every edition. It checks the chosen date before
  // submission, so an occupied date says "Open Existing Edition" and a free
  // date says "Create Edition". The server remains the final authority if
  // another desk starts that date between this check and the POST.
  const creator = host.querySelector('#editionCreator');
  const creatorDate = host.querySelector('#createEditionDate');
  const creatorName = host.querySelector('#createEditionName');
  const creatorPages = host.querySelector('#createEditionPages');
  const creatorCarry = host.querySelector('#createEditionCarry');
  const creatorFeatures = host.querySelector('#createEditionFeatures');
  const creatorExisting = host.querySelector('#createEditionExisting');
  const creatorLadder = host.querySelector('#createEditionLadder');
  const creatorSubmit = host.querySelector('#createEditionSubmit');
  const anotherBtn = host.querySelector('#createAnotherEdition');
  let ladderRequest = 0;

  const refreshCreator = async () => {
    const selectedDate = creatorDate.value || today;
    const existing = editionForDate(list, selectedDate);
    // Three states, not two: a free date, a date carrying a made-up edition,
    // and a date carrying a row with no pages at all. The third is opened as a
    // paper with no front page unless the ladder is built into it, so it keeps
    // its page controls live and the button says what it is about to do.
    const madeUp = Boolean(existing) && Number(existing.page_count) > 0;
    for (const control of [creatorName, creatorPages, creatorCarry, creatorFeatures]) control.disabled = madeUp;
    if (madeUp) creatorPages.value = String(existing.page_count || defaultPages);
    creatorSubmit.textContent = madeUp ? 'Open Existing Edition' : (existing ? 'Build Its Pages' : 'Create Edition');
    // A DATE MAY CARRY MORE THAN ONE EDITION, and this is the door to that.
    //
    // `POST /start` is idempotent per date on purpose - it is the button a
    // desk presses every morning, and pressing it twice must open the paper
    // rather than make a second one. (That promise is why this database was
    // rescued from 116 editions nobody could tell apart.) But a district
    // daily genuinely prints several editions of one date: one core, with two
    // or three pages swapped per district. Lokmat runs about fifteen.
    //
    // The server has done this since districtEdition.service.js was written -
    // routes, page inheritance, a printed-pages merge - AND NOTHING IN THE
    // BROWSER HAD EVER CALLED IT. That is this codebase's signature fault: a
    // mechanism with no door. This is the door, and it appears only on a date
    // that already has an edition, where it is the only thing left to want.
    anotherBtn.hidden = !madeUp;
    creatorExisting.classList.toggle('has-existing-edition', Boolean(existing));
    creatorExisting.textContent = madeUp
      ? `${selectedDate} already has edition ${existing.id} with ${existing.page_count} pages. It will be opened without changing its blocks.`
      : existing
        ? `${selectedDate} has edition ${existing.id}, but it carries no pages. Its page ladder will be built into that same edition.`
        : `${selectedDate} is available for a new edition.`;

    const request = ++ladderRequest;
    const rungs = await fetch(`/api/newspapers/ladder?pages=${Number(creatorPages.value) || defaultPages}`)
      .then((r) => r.json()).catch(() => []);
    if (request === ladderRequest) creatorLadder.innerHTML = ladderLine(rungs);
  };

  const openCreator = async (date = today) => {
    creator.hidden = false;
    creatorDate.value = isoDate(date) || today;
    await refreshCreator();
    creatorDate.focus();
    creator.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  host.querySelector('#createEditionToggle').addEventListener('click', () => openCreator(today));
  // The sidebar's own "+ New Edition" is an address (`#!/new-edition`), so it
  // arrives here as a flag rather than as a click - a desk who bookmarks it,
  // or reloads on it, gets the creator open exactly as if they had pressed it.
  if (startOpen) await openCreator(today);
  host.querySelector('#startTodayBtn')?.addEventListener('click', () => openCreator(today));
  host.querySelector('#createEditionClose').addEventListener('click', () => { creator.hidden = true; });
  creatorDate.addEventListener('change', refreshCreator);
  creatorPages.addEventListener('change', refreshCreator);

  // ANOTHER EDITION FOR A DATE THAT ALREADY HAS ONE.
  //
  // It goes through `POST /:id/district-editions`, which is the route the
  // server already has for exactly this and the only one that can make a
  // second edition on an occupied date - `/start` is idempotent there by
  // design, and `POST /api/newspapers` makes a row with no page ladder that
  // `/start` would then never reach, because it finds the date's FIRST
  // edition.
  //
  // Every page is its own by default: the service's model is that a child
  // owns only the pages that differ and serves the rest from its parent, which
  // is right for a district that swaps two pages, and a desk asking for
  // "another edition of this date" from this screen is asking for a paper they
  // can make up in full. The service still refuses a page the parent has not
  // got, so the request cannot invent a ladder.
  anotherBtn?.addEventListener('click', async () => {
    const selectedDate = creatorDate.value || today;
    const parent = editionForDate(list, selectedDate);
    if (!parent) return;
    const answer = await askPrompt({
      title: `Another edition for ${marathiDate(selectedDate)}?`,
      body: `${selectedDate} already carries edition #${parent.id}. A second edition of one date is an EDITION OF A PLACE — `
        + 'a district daily prints one core paper with two or three pages made up differently for each district.\n\n'
        + 'It starts with its own copy of every page of #' + parent.id + `'s ladder, empty, and it is deleted like any other edition.`,
      label: 'Which district is this edition for?',
      placeholder: 'Satara',
      confirm: 'Create it',
      cancel: 'Not now',
    });
    const district = String(answer?.field || '').trim();
    if (!answer?.action || !district) return;

    anotherBtn.disabled = true;
    const was = anotherBtn.textContent;
    anotherBtn.textContent = 'Creating…';
    try {
      const pages = await fetch(`/api/newspapers/${parent.id}/pages`).then((r) => {
        if (!r.ok) throw new Error(`The parent edition's pages could not be read (HTTP ${r.status}).`);
        return r.json();
      });
      const response = await fetch(`/api/newspapers/${parent.id}/district-editions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          district,
          localPages: pages.map((page) => Number(page.page_number)),
          name: `${parent.name || 'Edition'} — ${district}`,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.error) throw new Error(result.error || `The edition could not be created (HTTP ${response.status}).`);
      onOpen(Number(result.edition.id), { created: true, newspaper: result.edition });
    } catch (error) {
      anotherBtn.disabled = false;
      anotherBtn.textContent = was;
      showFailure(error.message, { retry: () => anotherBtn.click() });
    }
  });

  creator.addEventListener('submit', async (event) => {
    event.preventDefault();
    const selectedDate = creatorDate.value || today;
    const existing = editionForDate(list, selectedDate);
    // An edition with no pages is not an edition - an interrupted start, a
    // create through POST /api/newspapers, or a page delete that took the last
    // one all leave a row the desk would open as a paper with no front page.
    // `startEdition` builds the ladder into that row and reports `repaired`, so
    // a page-less date goes through the server rather than being opened here.
    if (existing && Number(existing.page_count) > 0) {
      onOpen(Number(existing.id), { created: false, existing: true, newspaper: existing });
      return;
    }

    creatorSubmit.disabled = true;
    creatorSubmit.textContent = 'Creating…';
    try {
      const response = await fetch('/api/newspapers/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editionStartPayload({
          publicationDate: selectedDate,
          pageCount: creatorPages.value,
          name: creatorName.value,
          carryForward: creatorCarry.checked,
          fillFeatures: creatorFeatures.checked,
        })),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not start the edition.');
      onOpen(result.newspaper.id, result);
    } catch (error) {
      creatorSubmit.disabled = false;
      await refreshCreator();
      showFailure(error.message, { retry: () => creatorSubmit.click() });
    }
  });
}

/*
 * The ladder set its ordinals in Devanagari and its page names in English -
 * "१. Front Page · २. Local News · ३. Feature & Puzzle Page" - two scripts
 * inside every item. The page names come from src/layout/templates.js and are
 * English, so the numbering that labels them is too. One script to a line,
 * the same rule as the row above.
 */
function ladderLine(rungs) {
  if (!Array.isArray(rungs) || !rungs.length) return '';
  return `<strong>Page ladder:</strong> ${rungs
    .map((r) => `${Number(r.pageNumber)}. ${escapeHtml(r.templateName || r.templateKey)}`)
    .join(' &nbsp;·&nbsp; ')}`;
}
