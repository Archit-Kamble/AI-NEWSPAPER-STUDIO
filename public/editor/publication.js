import { showNotice, showFailure } from '../ui/notice.js';
import { busyButton } from '../ui/busy.js';

// The toolbar's Publish action is deliberately one newsroom decision: freeze
// what the editor can see now. Press files are a separate production concern;
// optional PDF e-paper releases live in E-paper management.
export async function showPublicationFiles(newspaperId) {
  const newspaper = await fetch(`/api/newspapers/${newspaperId}`).then((response) => response.json());
  const modalRoot = document.getElementById('modalRoot');
  if (!modalRoot) return;

  const selectedPublic = newspaper.epaperSelected === true || newspaper.epaper_selected === true;
  const released = Boolean(newspaper.epaperReleasedAt || newspaper.epaper_released_at);
  modalRoot.classList.add('open');
  modalRoot.innerHTML = `
    <div class="modal-backdrop" id="publishBackdrop"></div>
    <div class="modal-dialog publication-dialog publication-confirmation">
      <button class="modal-close" id="closePublish">&times;</button>
      <p class="publication-kicker">E-paper</p>
      <h3>${released ? 'Publish this updated newspaper?' : 'Publish this newspaper?'}</h3>
      <p>This freezes the pages exactly as they look in the editor now and releases them as the public e-paper.</p>
      <p class="muted">Empty news blocks stay empty. Publishing does not require a PDF, Scribus project, page sign-off, or a press-ready edition.</p>
      ${selectedPublic ? '<p class="muted">This is already the public issue. Publishing replaces its frozen pages with this editor version.</p>' : ''}
      <div class="publication-actions">
        <button class="btn-secondary" type="button" id="cancelPublish">Cancel</button>
        <button class="btn-submit" type="button" id="confirmPublish">${released ? 'Publish update' : 'Publish e-paper'}</button>
      </div>
    </div>
  `;

  const close = () => {
    modalRoot.classList.remove('open');
    modalRoot.innerHTML = '';
  };
  document.getElementById('publishBackdrop')?.addEventListener('click', close);
  document.getElementById('closePublish')?.addEventListener('click', close);
  document.getElementById('cancelPublish')?.addEventListener('click', close);

  document.getElementById('confirmPublish')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const outcome = await busyButton(button, 'Freezing pages…', async () => {
      const response = await fetch(`/api/newspapers/${newspaperId}/publish-current`, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      return { ok: response.ok, body };
    });
    if (!outcome.ok) {
      return showFailure(outcome.body.error || 'The current editor view could not be published.', {
        retry: () => button.click(),
      });
    }
    showNotice(`Published ${outcome.body.pages} pages and mapped ${outcome.body.stories} news blocks.`
      + `${outcome.body.selected ? ' It is now the public e-paper.' : ''}`);
    close();
  });
}
