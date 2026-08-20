import { escapeHtml } from '../editor/format.js';
import { marathiDate } from './editions.js';

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
  return item.source === 'editor_snapshot' ? 'Current editor snapshot' : 'Final PDF / Scribus';
}

function row(item) {
  return `<article class="epaper-admin-row" data-epaper-row data-search="${escapeHtml(`${item.name} ${item.district} ${item.date} ${marathiDate(item.date)}`.toLowerCase())}">
    <label class="epaper-select" title="Make this the one public e-paper"><input type="radio" name="public-epaper" data-select-epaper="${item.id}" ${item.selected ? 'checked' : ''}><span class="sr-only">Select ${escapeHtml(item.name)} for the public e-paper</span></label>
    <a class="epaper-admin-thumb" href="${escapeHtml(item.previewUrl)}" target="_blank" rel="noopener"><img src="${escapeHtml(item.coverUrl)}" alt="Page one of ${escapeHtml(item.name)}" loading="lazy"></a>
    <div class="epaper-admin-copy"><p class="epaper-admin-date">${escapeHtml(marathiDate(item.date))}</p><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.district || 'सातारा')} · ${Number(item.pageCount) || 0} pages · ${escapeHtml(sourceLabel(item))}</p><small>Released ${escapeHtml(publishedWhen(item.publishedAt))}</small></div>
    <div class="epaper-admin-actions"><a class="btn-secondary" href="${escapeHtml(item.previewUrl)}" target="_blank" rel="noopener">Open</a>${item.pdfUrl ? `<a class="btn-secondary" href="${escapeHtml(item.pdfUrl)}" download>PDF</a>` : ''}<button class="btn-secondary epaper-delete" type="button" data-unpublish="${item.id}">Delete</button></div>
  </article>`;
}

export async function renderEpapers(host, { rightPanel } = {}) {
  if (rightPanel) rightPanel.innerHTML = '<h3>E-paper</h3><p>The checked issue is the only public e-paper. Other released issues stay private to this list until selected.</p>';
  host.innerHTML = '<div class="form-section"><h2>E-paper</h2><p class="muted">Loading released editions…</p></div>';

  let editions;
  try {
    const response = await fetch('/api/epapers');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    editions = await response.json();
  } catch (error) {
    console.error('E-paper list failed:', error);
    host.innerHTML = '<div class="form-section"><h2>E-paper</h2><p>The e-paper list could not be loaded.</p></div>';
    return;
  }

  host.innerHTML = `<div class="form-section epaper-admin">
    <div class="epaper-admin-heading"><div><h2>E-paper</h2><p>Released editions · latest first. Select exactly one issue for the public link.</p></div></div>
    <div class="epaper-public-url"><label for="epaperPublicUrl">Public E-paper URL</label><div><input id="epaperPublicUrl" readonly value="${escapeHtml(`${window.location.origin}/epaper`)}"><button class="btn-secondary" type="button" data-copy-epaper-url>Copy URL</button><a class="btn-secondary" href="/epaper" target="_blank" rel="noopener">Open public view</a></div><p class="muted">This URL is read-only. It never carries an editor session, selected edition id or write permission.</p></div>
    <label class="epaper-admin-search"><span>Search</span><input type="search" placeholder="Date, district or newspaper…" data-epaper-search></label>
    <p class="muted" data-epaper-empty ${editions.length ? 'hidden' : ''}>No released e-paper yet. Open an edition and choose final-PDF or current-editor publishing.</p>
    <div class="epaper-admin-list">${editions.map(row).join('')}</div>
  </div>`;

  const search = host.querySelector('[data-epaper-search]');
  const rows = [...host.querySelectorAll('[data-epaper-row]')];
  const empty = host.querySelector('[data-epaper-empty]');
  const paint = () => {
    const query = search.value.trim().toLocaleLowerCase();
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

  host.querySelector('[data-copy-epaper-url]')?.addEventListener('click', async () => {
    const url = host.querySelector('#epaperPublicUrl').value;
    try { await navigator.clipboard.writeText(url); window.alert('Public e-paper URL copied.'); }
    catch { window.prompt('Copy this public e-paper URL:', url); }
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
