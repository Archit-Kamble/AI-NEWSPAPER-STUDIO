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

function card(item) {
  return `<article class="epaper-admin-card" data-epaper-card data-search="${escapeHtml(`${item.name} ${item.district} ${item.date} ${marathiDate(item.date)}`.toLowerCase())}">
    <a class="epaper-admin-cover" href="${escapeHtml(item.readerUrl)}" target="_blank" rel="noopener"><img src="${escapeHtml(item.coverUrl)}" alt="Page one of ${escapeHtml(item.name)}" loading="lazy"></a>
    <div class="epaper-admin-copy">
      <p class="epaper-admin-date">${escapeHtml(marathiDate(item.date))}</p>
      <h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(item.district || 'सातारा')} · ${Number(item.pageCount) || 0} pages</p>
      <small>Published ${escapeHtml(publishedWhen(item.publishedAt))}</small>
      <div class="epaper-admin-actions">
        <a class="btn-secondary" href="${escapeHtml(item.readerUrl)}" target="_blank" rel="noopener">View e-paper</a>
        ${item.pdfUrl ? `<a class="btn-secondary" href="${escapeHtml(item.pdfUrl)}" download>Download PDF</a>` : ''}
        <button class="btn-secondary epaper-delete" type="button" data-unpublish="${item.id}">Delete public copy</button>
      </div>
    </div>
  </article>`;
}

export async function renderEpapers(host, { rightPanel } = {}) {
  if (rightPanel) rightPanel.innerHTML = '<h3>E-paper</h3><p>Only editions explicitly published from the workspace appear here or on the public website.</p><a class="btn-secondary" href="/epaper" target="_blank" rel="noopener">Open public archive</a>';
  host.innerHTML = '<div class="form-section"><h2>E-paper</h2><p class="muted">Loading published editions…</p></div>';

  let editions;
  try {
    const response = await fetch('/api/epapers');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    editions = await response.json();
  } catch (error) {
    console.error('E-paper list failed:', error);
    host.innerHTML = '<div class="form-section"><h2>E-paper</h2><p>The published archive could not be loaded.</p></div>';
    return;
  }

  host.innerHTML = `<div class="form-section epaper-admin">
    <div class="epaper-admin-heading"><div><h2>E-paper</h2><p>Published editions · latest update first</p></div><a class="btn-secondary" href="/epaper" target="_blank" rel="noopener">Public archive ↗</a></div>
    <label class="epaper-admin-search"><span>Search</span><input type="search" placeholder="Date, district or newspaper…" data-epaper-search></label>
    <p class="muted" data-epaper-empty ${editions.length ? 'hidden' : ''}>No edition has been published yet. Open an edition and use Publish after the final PDF is ready.</p>
    <div class="epaper-admin-grid">${editions.map(card).join('')}</div>
  </div>`;

  const search = host.querySelector('[data-epaper-search]');
  const cards = [...host.querySelectorAll('[data-epaper-card]')];
  const empty = host.querySelector('[data-epaper-empty]');
  const paint = () => {
    const query = search.value.trim().toLocaleLowerCase();
    let shown = 0;
    cards.forEach((entry) => {
      const match = !query || (entry.dataset.search || '').includes(query);
      entry.hidden = !match;
      if (match) shown += 1;
    });
    empty.hidden = shown > 0;
    if (!shown && query) empty.textContent = 'No published edition matches that search.';
  };
  search.addEventListener('input', paint);

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
