import { escapeHtml } from '../editor/format.js';
import { marathiDate } from './editions.js';
import { openEpaperMapEditor } from './epaper-map-editor.js';

const devanagariDigits = { '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9' };

function searchText(value) {
  return String(value || '').toLocaleLowerCase().replace(/[०-९]/g, (digit) => devanagariDigits[digit]);
}

function englishDate(value) {
  const date = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const when = new Date(`${date}T12:00:00Z`);
  return [date, new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(when), new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(when)].join(' ');
}

function editionSearch(item) {
  const date = item.publication_date || item.date || '';
  return searchText(`${item.name || ''} ${item.district || ''} ${date} ${marathiDate(date)} ${englishDate(date)}`);
}

function publishedWhen(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
    }).format(new Date(value));
  } catch {
    return '';
  }
}

function sourceLabel(item) {
  if (item.source === 'editor_snapshot') return 'Current editor snapshot';
  if (item.source === 'uploaded_pdf') return 'Uploaded e-paper PDF';
  return 'Press-final PDF';
}

function row(item) {
  return `<article class="epaper-admin-row" data-epaper-row data-search="${escapeHtml(editionSearch(item))}">
    <label class="epaper-select" title="Make this the one public e-paper"><input type="radio" name="public-epaper" data-select-epaper="${item.id}" ${item.selected ? 'checked' : ''}><span class="sr-only">Select ${escapeHtml(item.name)} for the public e-paper</span></label>
    <a class="epaper-admin-thumb" href="${escapeHtml(item.previewUrl)}" target="_blank" rel="noopener"><img src="${escapeHtml(item.coverUrl)}" alt="Page one of ${escapeHtml(item.name)}" loading="lazy"></a>
    <div class="epaper-admin-copy"><p class="epaper-admin-date">${escapeHtml(marathiDate(item.date))}</p><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.district || 'सातारा')} · ${Number(item.pageCount) || 0} pages · ${escapeHtml(sourceLabel(item))}</p><small>Released ${escapeHtml(publishedWhen(item.publishedAt))}</small></div>
    <div class="epaper-admin-actions"><a class="btn-secondary" href="${escapeHtml(item.previewUrl)}" target="_blank" rel="noopener">Open</a><button class="btn-secondary" type="button" data-map-epaper="${item.id}">Map blocks</button>${item.pdfUrl ? `<a class="btn-secondary" href="${escapeHtml(item.pdfUrl)}" download>PDF</a>` : ''}<button class="btn-secondary epaper-delete" type="button" data-unpublish="${item.id}">Delete</button></div>
  </article>`;
}

export async function renderEpapers(host, { rightPanel } = {}) {
  if (rightPanel) rightPanel.innerHTML = '<h3>E-paper</h3><p>The checked issue is the only public e-paper. Publish the editor view in one confirmation, or upload an optional finished PDF here. Both use the saved news-block frames for their maps.</p>';
  host.innerHTML = '<div class="form-section"><h2>E-paper</h2><p class="muted">Loading released editions…</p></div>';

  let editions;
  let newspapers;
  try {
    const [releasesResponse, newspapersResponse] = await Promise.all([
      fetch('/api/epapers'), fetch('/api/newspapers'),
    ]);
    if (!releasesResponse.ok || !newspapersResponse.ok) throw new Error(`HTTP ${releasesResponse.status}/${newspapersResponse.status}`);
    [editions, newspapers] = await Promise.all([releasesResponse.json(), newspapersResponse.json()]);
  } catch (error) {
    console.error('E-paper list failed:', error);
    host.innerHTML = '<div class="form-section"><h2>E-paper</h2><p>The e-paper list could not be loaded.</p></div>';
    return;
  }

  const uploadEditions = newspapers.map((item) => ({
    ...item,
    date: String(item.publication_date || item.date || '').slice(0, 10),
    search: editionSearch(item),
  })).filter((item) => item.date).sort((a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id));
  const latestEdition = uploadEditions[0] || null;

  host.innerHTML = `<div class="form-section epaper-admin">
    <div class="epaper-admin-heading"><div><h2>E-paper</h2><p>Released editions · latest first. Select exactly one issue for the public link.</p></div></div>
    <div class="epaper-public-url"><label for="epaperPublicUrl">Public E-paper URL</label><div><input id="epaperPublicUrl" readonly value="${escapeHtml(`${window.location.origin}/epaper`)}"><button class="btn-secondary" type="button" data-copy-epaper-url>Copy URL</button><a class="btn-secondary" href="/epaper" target="_blank" rel="noopener">Open public view</a></div><p class="muted">This URL is read-only. It never carries an editor session, selected edition id or write permission.</p></div>
    <form class="epaper-pdf-publish" data-epaper-pdf-form>
      <div><h3>Publish from a finished PDF</h3><p>Choose the date and find the edition by name. Search accepts English dates too: “15 Aug 2099” finds “शनिवार, १५ ऑगस्ट २०९९”. After publishing, use <b>Map blocks</b> to draw the PDF’s exact story rectangles.</p></div>
      <label><span>Date</span><input type="date" data-epaper-pdf-date value="${escapeHtml(latestEdition?.date || '')}" ${latestEdition ? '' : 'disabled'}></label>
      <label><span>Find edition</span><input type="search" placeholder="15 Aug 2099 or newspaper name" data-epaper-pdf-search ${latestEdition ? '' : 'disabled'}></label>
      <div class="epaper-pdf-editions" data-epaper-pdf-results></div>
      <label><span>PDF</span><input type="file" accept="application/pdf,.pdf" data-epaper-pdf-file ${latestEdition ? '' : 'disabled'}></label>
      <button class="btn-submit" type="submit" data-epaper-pdf-submit ${latestEdition ? '' : 'disabled'}>Upload PDF &amp; publish</button>
    </form>
    <label class="epaper-admin-search"><span>Search</span><input type="search" placeholder="Date, district or newspaper…" data-epaper-search></label>
    <p class="muted" data-epaper-empty ${editions.length ? 'hidden' : ''}>No released e-paper yet. Use Publish in the editor, or upload a finished PDF above.</p>
    <div class="epaper-admin-list">${editions.map(row).join('')}</div>
  </div>`;

  const search = host.querySelector('[data-epaper-search]');
  const rows = [...host.querySelectorAll('[data-epaper-row]')];
  const empty = host.querySelector('[data-epaper-empty]');
  const paint = () => {
    const query = searchText(search.value.trim());
    let shown = 0;
    rows.forEach((entry) => {
      const match = !query || (entry.dataset.search || '').includes(query);
      entry.hidden = !match;
      if (match) shown += 1;
    });
    empty.hidden = shown > 0;
    if (!shown && query) empty.textContent = 'No published edition matches that search.';
  };
  search.addEventListener('input', paint);

  let chosenUploadEdition = latestEdition;
  const pdfForm = host.querySelector('[data-epaper-pdf-form]');
  const pdfDate = pdfForm?.querySelector('[data-epaper-pdf-date]');
  const pdfSearch = pdfForm?.querySelector('[data-epaper-pdf-search]');
  const pdfResults = pdfForm?.querySelector('[data-epaper-pdf-results]');
  const paintUploadEditions = () => {
    if (!pdfResults) return;
    const date = pdfDate?.value || '';
    const query = searchText(pdfSearch?.value.trim());
    const matches = uploadEditions.filter((item) => (!date || item.date === date) && (!query || item.search.includes(query)));
    if (!matches.some((item) => Number(item.id) === Number(chosenUploadEdition?.id))) chosenUploadEdition = matches[0] || null;
    pdfResults.innerHTML = matches.length ? matches.slice(0, 8).map((item) => `<button type="button" class="${Number(item.id) === Number(chosenUploadEdition?.id) ? 'is-selected' : ''}" data-epaper-pdf-candidate="${item.id}"><strong>${escapeHtml(marathiDate(item.date))}</strong><span>${escapeHtml(item.name || 'Newspaper')} · ${Number(item.page_count) || 0} pages</span></button>`).join('') : '<p>No edition matches this date and search.</p>';
    pdfResults.querySelectorAll('[data-epaper-pdf-candidate]').forEach((button) => button.addEventListener('click', () => {
      chosenUploadEdition = uploadEditions.find((item) => Number(item.id) === Number(button.dataset.epaperPdfCandidate)) || null;
      paintUploadEditions();
    }));
  };
  pdfDate?.addEventListener('input', paintUploadEditions);
  pdfSearch?.addEventListener('input', paintUploadEditions);
  paintUploadEditions();

  host.querySelector('[data-copy-epaper-url]')?.addEventListener('click', async () => {
    const url = host.querySelector('#epaperPublicUrl').value;
    try { await navigator.clipboard.writeText(url); window.alert('Public e-paper URL copied.'); }
    catch { window.prompt('Copy this public e-paper URL:', url); }
  });

  host.querySelector('[data-epaper-pdf-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.querySelector('[data-epaper-pdf-file]').files[0];
    const id = Number(chosenUploadEdition?.id);
    if (!file || !id) return window.alert('Choose both an edition and a PDF.');
    const button = form.querySelector('[data-epaper-pdf-submit]');
    const data = new FormData();
    data.append('printPdf', file);
    button.disabled = true;
    button.textContent = 'Building e-paper…';
    const response = await fetch(`/api/newspapers/${id}/epaper/pdf`, { method: 'POST', body: data });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      button.disabled = false;
      button.textContent = 'Upload PDF & publish';
      return window.alert(result.error || 'The PDF could not be published as an e-paper.');
    }
    window.alert(`Published ${result.pages} PDF pages and mapped ${result.stories} news blocks.`);
    renderEpapers(host, { rightPanel });
  });

  host.querySelectorAll('[data-select-epaper]').forEach((radio) => {
    radio.addEventListener('change', async () => {
      if (!radio.checked) return;
      radio.disabled = true;
      const response = await fetch(`/api/newspapers/${radio.dataset.selectEpaper}/epaper/select`, { method: 'POST' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        radio.checked = false;
        radio.disabled = false;
        return window.alert(result.error || 'Could not select this public e-paper.');
      }
      renderEpapers(host, { rightPanel });
    });
  });

  host.querySelectorAll('[data-map-epaper]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = editions.find((edition) => Number(edition.id) === Number(button.dataset.mapEpaper));
      if (item) openEpaperMapEditor(item, { onSaved: () => renderEpapers(host, { rightPanel }) });
    });
  });

  host.querySelectorAll('[data-unpublish]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = Number(button.dataset.unpublish);
      if (!window.confirm('Remove this edition from the public e-paper? The newsroom edition and final PDF will be kept.')) return;
      button.disabled = true;
      button.textContent = 'Removing…';
      const response = await fetch(`/api/newspapers/${id}/epaper`, { method: 'DELETE' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        button.disabled = false;
        button.textContent = 'Delete public copy';
        return window.alert(result.error || 'Could not remove the public copy.');
      }
      renderEpapers(host, { rightPanel });
    });
  });
}
