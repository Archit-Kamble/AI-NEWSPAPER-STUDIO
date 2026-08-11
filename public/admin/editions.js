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

const devanagari = (value) => String(value).replace(/\d/g, (d) => DIGITS[Number(d)]);

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
    </div>`;
}

/**
 * Renders the editions panel into `host`.
 *
 * `onOpen(id)` opens an edition in the workspace - the panel never navigates by
 * itself, so the dashboard stays in charge of what the screen shows.
 */
export async function renderEditions(host, { onOpen }) {
  const today = todayIso();
  const editions = await fetch('/api/newspapers').then((r) => r.json());
  const list = Array.isArray(editions) ? editions : [];
  const todays = list.find((e) => String(e.publication_date || '').slice(0, 10) === today);
  const ladder = await fetch('/api/newspapers/ladder?pages=4').then((r) => r.json()).catch(() => []);

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
          <label>Date
            <input type="date" id="editionDate" value="${today}">
          </label>
          <label>Pages
            <input type="number" id="editionPages" min="1" max="32" value="${todays?.page_count || 4}">
          </label>
          <button class="btn-submit" id="startEditionBtn">
            ${todays ? "Open today's edition" : "Start today's edition"}
          </button>
        </div>
      </div>
      <p class="edition-ladder" id="editionLadder">${ladderLine(ladder)}</p>

      <h3 class="editions-heading">Recent editions</h3>
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
  };
  paint();

  host.querySelector('#editionSearch').addEventListener('input', (event) => {
    query = event.target.value;
    paint();
  });
  host.querySelector('#editionMoreBtn')?.addEventListener('click', (event) => {
    showAll = true;
    event.target.remove();
    paint();
  });

  // The ladder is shown before the edition is made, not after - the desk sees
  // what four pages will actually be.
  const pagesInput = host.querySelector('#editionPages');
  pagesInput.addEventListener('change', async () => {
    const rungs = await fetch(`/api/newspapers/ladder?pages=${Number(pagesInput.value) || 4}`)
      .then((r) => r.json()).catch(() => []);
    host.querySelector('#editionLadder').innerHTML = ladderLine(rungs);
  });

  host.querySelector('#startEditionBtn').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Starting…';
    try {
      const response = await fetch('/api/newspapers/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicationDate: host.querySelector('#editionDate').value || today,
          pageCount: Number(pagesInput.value) || 4,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not start the edition.');
      onOpen(result.newspaper.id, result);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Start today's edition";
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
