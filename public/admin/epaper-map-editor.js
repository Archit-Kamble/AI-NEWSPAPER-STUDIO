import { escapeHtml } from '../editor/format.js';

const MIN_BLOCK = 8;

function frame(article, page) {
  const hotspot = article.hotspot || {};
  return {
    x: Math.round((Number(hotspot.leftPct) || 0) * page.width / 100),
    y: Math.round((Number(hotspot.topPct) || 0) * page.height / 100),
    width: Math.max(MIN_BLOCK, Math.round((Number(hotspot.widthPct) || 0) * page.width / 100)),
    height: Math.max(MIN_BLOCK, Math.round((Number(hotspot.heightPct) || 0) * page.height / 100)),
  };
}

function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }

function fit(article, page) {
  article.x = clamp(Number(article.x) || 0, 0, Math.max(0, page.width - MIN_BLOCK));
  article.y = clamp(Number(article.y) || 0, 0, Math.max(0, page.height - MIN_BLOCK));
  article.width = clamp(Number(article.width) || MIN_BLOCK, MIN_BLOCK, page.width - article.x);
  article.height = clamp(Number(article.height) || MIN_BLOCK, MIN_BLOCK, page.height - article.y);
}

function pageFrom(snapshot, number) {
  return snapshot.pages.find((page) => Number(page.number) === Number(number));
}

function mapArticle(article, page) {
  const box = frame(article, page);
  return { ...article, ...box };
}

// What a newly added block is called until the desk names it. Named once so
// the check below and the block that carries it cannot drift apart.
const NEW_BLOCK_TITLE = 'New news block';

function manualId() {
  const token = globalThis.crypto?.randomUUID?.().replace(/-/g, '')
    || `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return `manual-${token.slice(0, 70)}`;
}

/**
 * The PDF is a finished visual; this desk-only overlay is how an operator
 * maps its actual stories. It writes a released manifest rather than trying
 * to infer rectangles from a PDF or mutate the live editorial page.
 */
export async function openEpaperMapEditor(edition, { onSaved } = {}) {
  let response;
  try {
    response = await fetch(`/api/newspapers/${edition.id}/epaper`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    window.alert('This released e-paper map could not be opened.');
    return;
  }
  const snapshot = await response.json();
  snapshot.pages = (snapshot.pages || []).map((page) => ({
    ...page,
    width: Number(page.width) || 660,
    height: Number(page.height) || 1060,
    articles: (page.articles || []).map((article) => mapArticle(article, page)),
  }));
  let selectedPage = snapshot.pages[0];
  let selectedId = selectedPage?.articles[0]?.id || null;
  let drag = null;

  const root = document.createElement('div');
  root.className = 'epaper-map-modal';
  root.innerHTML = `<div class="epaper-map-shell" role="dialog" aria-modal="true" aria-labelledby="epaperMapTitle">
    <header class="epaper-map-header"><div><p>Released e-paper map</p><h2 id="epaperMapTitle">${escapeHtml(edition.name)} · ${escapeHtml(edition.date)}</h2><span>Drag a block or use its X, Y, width and height. Save refreshes only this release’s clickable areas and PNG cards.</span></div><button type="button" class="btn-secondary" data-map-close>Close</button></header>
    <div class="epaper-map-toolbar"><label>Page <select data-map-page>${snapshot.pages.map((page) => `<option value="${page.number}">Page ${page.number}</option>`).join('')}</select></label><button type="button" class="btn-secondary" data-map-add>Add news block</button><button type="button" class="btn-secondary" data-map-delete>Delete selected</button><button type="button" class="btn-submit" data-map-save>Save map</button></div>
    <div class="epaper-map-workspace"><div class="epaper-map-viewport"><div class="epaper-map-canvas" data-map-canvas></div></div><aside class="epaper-map-inspector" data-map-inspector></aside></div>
  </div>`;
  document.body.append(root);

  const canvas = root.querySelector('[data-map-canvas]');
  const inspector = root.querySelector('[data-map-inspector]');
  const chosen = () => selectedPage.articles.find((item) => String(item.id) === String(selectedId));

  const renderInspector = () => {
    const article = chosen();
    if (!article) {
      inspector.innerHTML = '<p class="muted">Select a news block, or add one for an unmapped story.</p>';
      return;
    }
    const titleControl = article.manual
      ? `<label>Title <input type="text" data-map-title value="${escapeHtml(article.headline || '')}" maxlength="240"></label>`
      : `<label>Story title <input type="text" value="${escapeHtml(article.headline || '')}" readonly></label><p class="muted">Released editorial text stays frozen; this editor changes the page map only.</p>`;
    inspector.innerHTML = `<h3>${article.manual ? 'Manual news block' : 'Saved news block'}</h3>${titleControl}<div class="epaper-map-fields">
      <label>X <input type="number" min="0" step="1" data-map-field="x" value="${article.x}"></label>
      <label>Y <input type="number" min="0" step="1" data-map-field="y" value="${article.y}"></label>
      <label>Width <input type="number" min="${MIN_BLOCK}" step="1" data-map-field="width" value="${article.width}"></label>
      <label>Height <input type="number" min="${MIN_BLOCK}" step="1" data-map-field="height" value="${article.height}"></label>
    </div><p class="muted">Page size: ${selectedPage.width} × ${selectedPage.height}px</p>`;
    inspector.querySelector('[data-map-title]')?.addEventListener('input', (event) => { article.headline = event.target.value; renderCanvas(); });
    inspector.querySelectorAll('[data-map-field]').forEach((input) => input.addEventListener('input', () => {
      article[input.dataset.mapField] = Number(input.value);
      fit(article, selectedPage);
      renderCanvas();
      renderInspector();
    }));
  };

  const renderCanvas = () => {
    if (!selectedPage) return;
    canvas.style.aspectRatio = `${selectedPage.width} / ${selectedPage.height}`;
    canvas.innerHTML = `<img src="${escapeHtml(selectedPage.imageUrl)}" alt="Released page ${selectedPage.number}">${selectedPage.articles.map((article) => {
      const selected = String(article.id) === String(selectedId);
      return `<button type="button" class="epaper-map-block${selected ? ' is-selected' : ''}" data-map-block="${escapeHtml(article.id)}" style="left:${article.x / selectedPage.width * 100}%;top:${article.y / selectedPage.height * 100}%;width:${article.width / selectedPage.width * 100}%;height:${article.height / selectedPage.height * 100}%"><span>${escapeHtml(article.headline || 'News block')}</span><i class="map-handle tl" data-map-handle="tl"></i><i class="map-handle tr" data-map-handle="tr"></i><i class="map-handle bl" data-map-handle="bl"></i><i class="map-handle br" data-map-handle="br"></i></button>`;
    }).join('')}`;
  };

  const render = () => { renderCanvas(); renderInspector(); };
  const updateFromPointer = (event) => {
    if (!drag) return;
    const rect = canvas.getBoundingClientRect();
    const dx = (event.clientX - drag.startX) * selectedPage.width / rect.width;
    const dy = (event.clientY - drag.startY) * selectedPage.height / rect.height;
    const article = chosen();
    if (!article) return;
    if (drag.handle === 'move') { article.x = drag.x + dx; article.y = drag.y + dy; }
    if (drag.handle.includes('l')) { article.x = drag.x + dx; article.width = drag.width - dx; }
    if (drag.handle.includes('r')) article.width = drag.width + dx;
    if (drag.handle.includes('t')) { article.y = drag.y + dy; article.height = drag.height - dy; }
    if (drag.handle.includes('b')) article.height = drag.height + dy;
    if (article.width < MIN_BLOCK && drag.handle.includes('l')) { article.x = drag.x + drag.width - MIN_BLOCK; article.width = MIN_BLOCK; }
    if (article.height < MIN_BLOCK && drag.handle.includes('t')) { article.y = drag.y + drag.height - MIN_BLOCK; article.height = MIN_BLOCK; }
    fit(article, selectedPage);
    renderCanvas();
    renderInspector();
  };

  canvas.addEventListener('pointerdown', (event) => {
    const block = event.target.closest('[data-map-block]');
    if (!block) return;
    event.preventDefault();
    selectedId = block.dataset.mapBlock;
    const article = chosen();
    const handle = event.target.closest('[data-map-handle]')?.dataset.mapHandle || 'move';
    drag = { handle, startX: event.clientX, startY: event.clientY, x: article.x, y: article.y, width: article.width, height: article.height };
    canvas.setPointerCapture?.(event.pointerId);
    render();
  });
  canvas.addEventListener('pointermove', updateFromPointer);
  canvas.addEventListener('pointerup', () => { if (drag) { drag = null; render(); } });
  canvas.addEventListener('pointercancel', () => { drag = null; render(); });

  root.querySelector('[data-map-page]').addEventListener('change', (event) => {
    selectedPage = pageFrom(snapshot, event.target.value);
    selectedId = selectedPage?.articles[0]?.id || null;
    render();
  });
  root.querySelector('[data-map-add]').addEventListener('click', () => {
    const article = { id: manualId(), sectionKey: '', headline: NEW_BLOCK_TITLE, manual: true, x: Math.round(selectedPage.width * .12), y: Math.round(selectedPage.height * .12), width: Math.round(selectedPage.width * .42), height: Math.round(selectedPage.height * .18) };
    selectedPage.articles.push(article);
    selectedId = article.id;
    render();
    inspector.querySelector('[data-map-title]')?.focus();
  });
  root.querySelector('[data-map-delete]').addEventListener('click', () => {
    if (!selectedId) return;
    const article = chosen();
    if (!window.confirm(`Remove “${article?.headline || 'this block'}” from this released e-paper map?`)) return;
    selectedPage.articles = selectedPage.articles.filter((item) => String(item.id) !== String(selectedId));
    selectedId = selectedPage.articles[0]?.id || null;
    render();
  });
  root.querySelector('[data-map-save]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    // THE PLACEHOLDER IS NOT A TITLE.
    //
    // This checked for an EMPTY headline, and a new block is created carrying
    // the words "New news block" - which is not empty, so ten of them saved
    // straight through to the public reader and printed as ten identical
    // stories with nothing under them. Measured on this newsroom's own
    // released issue. A title nobody typed is the same as no title.
    const untitled = selectedPage.articles.find((article) => article.manual
      && (!String(article.headline || '').trim() || String(article.headline).trim() === NEW_BLOCK_TITLE));
    if (untitled) return window.alert('Give each manually added news block its own title before saving — "' + NEW_BLOCK_TITLE + '" is the placeholder, not a headline.');
    button.disabled = true;
    button.textContent = 'Saving PNG cards…';
    const payload = {
      pageNumber: selectedPage.number,
      mapRevision: Number(snapshot.edition?.mapRevision) || 0,
      articles: selectedPage.articles.map(({ id, headline, x, y, width, height }) => ({ id, headline, x, y, width, height })),
    };
    const save = await fetch(`/api/newspapers/${edition.id}/epaper/map`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await save.json().catch(() => ({}));
    if (!save.ok) {
      button.disabled = false;
      button.textContent = 'Save map';
      return window.alert(result.error || 'The e-paper map could not be saved.');
    }
    selectedPage.articles = (result.page.articles || []).map((article) => mapArticle(article, selectedPage));
    snapshot.edition.mapRevision = result.mapRevision;
    selectedId = selectedPage.articles.find((article) => String(article.id) === String(selectedId))?.id || selectedPage.articles[0]?.id || null;
    button.disabled = false;
    button.textContent = 'Save map';
    render();
    onSaved?.();
  });
  root.querySelector('[data-map-close]').addEventListener('click', () => root.remove());
  render();
}
