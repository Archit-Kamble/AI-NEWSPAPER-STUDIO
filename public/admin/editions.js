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

function relativeDay(iso, today) {
  const day = (value) => {
    const [y, m, d] = String(value || '').slice(0, 10).split('-').map(Number);
    return y ? Date.UTC(y, m - 1, d) : NaN;
  };
  const diff = Math.round((day(iso) - day(today)) / 86400000);
  if (!Number.isFinite(diff)) return '';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}

// How much of an edition is actually made up. This is the number that tells a
// desk at a glance whether an edition holds their work or is an empty shell.
function fillOf(edition) {
  const blocks = Number(edition.block_count) || 0;
  const filled = Number(edition.filled_block_count) || 0;
  return { blocks, filled, percent: blocks ? Math.round((filled / blocks) * 100) : 0 };
}

function editionRowHtml(edition, today) {
  const fill = fillOf(edition);
  const iso = String(edition.publication_date || '').slice(0, 10);
  const empty = fill.filled === 0;
  return `
    <div class="edition-row${iso === today ? ' edition-row--today' : ''}" data-edition-id="${edition.id}">
      <div class="edition-row-date">
        <strong>${escapeHtml(marathiDate(iso))}</strong>
        <small>${escapeHtml(iso)} · ${escapeHtml(relativeDay(iso, today))}</small>
      </div>
      <div class="edition-row-name">
        ${escapeHtml(edition.name || '')}
        <small>${devanagari(edition.page_count || 0)} pages ·
          ${empty ? '<span class="edition-empty">nothing written yet</span>'
                  : `${fill.filled} of ${fill.blocks} blocks filled`}</small>
      </div>
      <div class="edition-row-fill" title="${fill.percent}% of the blocks have copy in them">
        <span style="width:${fill.percent}%"></span>
      </div>
      <span class="status-pill ${escapeHtml(edition.status || 'draft')}">${escapeHtml(edition.status || 'draft')}</span>
      <button class="btn-secondary edition-open" data-edition-id="${edition.id}">Open</button>
      <button class="btn-danger edition-delete" data-edition-id="${edition.id}"
              title="Delete this edition and everything on its pages">Delete</button>
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
  return `Delete the edition for ${marathiDate(iso)} (${iso})?\n\n`
    + `${edition.name || 'Unnamed edition'} — ${edition.page_count || 0} pages. ${what}\n\n`
    + 'Every page, block, story and placed picture on it goes with it, and this cannot be undone. '
    + "Reporters' own filings are not affected.";
}

/**
 * Renders the editions panel into `host`.
 *
 * `onOpen(id)` opens an edition in the workspace - the panel never navigates by
 * itself, so the dashboard stays in charge of what the screen shows.
 */
export async function renderEditions(host, { onOpen }) {
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
            ? `${devanagari(todays.page_count || 0)} pages · ${fillOf(todays).filled} of ${fillOf(todays).blocks} blocks filled · ${escapeHtml(todays.status)}`
            : 'Starting it builds the page ladder, carries the booked adverts forward from the last edition and fills the day&rsquo;s standing features.'}</p>
        </div>
        <div class="edition-today-form">
          ${todays ? `<p><strong>Current edition:</strong> ${devanagari(todays.page_count || 0)} pages</p>
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
        </div>
      </form>

      <input class="edition-search" id="editionSearch" placeholder="Search by date or name…">
      <div id="editionList"></div>
      ${list.length > RECENT_LIMIT
        ? `<button class="btn-secondary edition-more" id="editionMoreBtn">Show all ${list.length} editions</button>`
        : ''}
    </div>`;

  let showAll = false;
  let query = '';

  const paint = () => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? list.filter((e) =>
          `${e.name || ''} ${e.publication_date || ''} ${marathiDate(e.publication_date)}`.toLowerCase().includes(q))
      : list;
    const shown = showAll || q ? matched : matched.slice(0, RECENT_LIMIT);
    const target = host.querySelector('#editionList');
    target.innerHTML = shown.length
      ? shown.map((e) => editionRowHtml(e, today)).join('')
      : '<p class="muted">No edition matches that.</p>';
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
    if (!window.confirm(deletionQuestion(edition))) return;

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
      alert(error.message);
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
    } catch (error) { button.disabled = false; alert(error.message); }
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
  host.querySelector('#startTodayBtn')?.addEventListener('click', () => openCreator(today));
  host.querySelector('#createEditionClose').addEventListener('click', () => { creator.hidden = true; });
  creatorDate.addEventListener('change', refreshCreator);
  creatorPages.addEventListener('change', refreshCreator);

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
      alert(error.message);
    }
  });
}

function ladderLine(rungs) {
  if (!Array.isArray(rungs) || !rungs.length) return '';
  return `<strong>Page ladder:</strong> ${rungs
    .map((r) => `${devanagari(r.pageNumber)}. ${escapeHtml(r.templateName || r.templateKey)}`)
    .join(' &nbsp;·&nbsp; ')}`;
}
