import { showNotice, showFailure } from '../ui/notice.js';
import { askConfirm } from '../ui/dialog.js';

// The toolbar's Publish action is deliberately one newsroom decision: freeze
// what the editor can see now. Press files are a separate production concern;
// optional PDF e-paper releases live in E-paper management.
//
// IT ASKS THROUGH THE PAPER'S OWN DIALOG, NOT A SECOND ONE.
//
// This built its own modal - its own backdrop, its own close button, its own
// three listeners - and being hand-rolled is exactly why it had none of the
// things a dialog needs: no `role`, no `aria-modal`, no accessible name on the
// close button, no Escape, and focus neither moved into it nor restored to the
// control that opened it. A desk on a keyboard could open this question and
// have no way to answer or leave it.
//
// `public/ui/dialog.js` already had all of that, and already replaced forty
// native `confirm()` calls for the same reason. Using it here fixes every one
// of those gaps and removes a second implementation of the same object rather
// than teaching the second one to behave - which is this project's own rule
// about duplicated catalogues, applied to a dialog.
export async function showPublicationFiles(newspaperId) {
  // AN UNREAD RESPONSE IS A DIALOG ABOUT AN EDITION THAT WAS NEVER LOADED.
  //
  // This was `fetch(...).then((r) => r.json())` with no `response.ok` and no
  // `.catch()` - the "five unchecked page re-reads" fault, one more time. On a
  // 401 or a 500 the question still drew, in its "Publish this newspaper?"
  // wording rather than its "Publish this UPDATED newspaper?" wording, for an
  // edition whose release state was never known; on a non-JSON answer it threw
  // inside an async click handler and the Publish button silently did nothing,
  // which is indistinguishable from a broken button.
  //
  // Publishing itself is server-guarded, so nothing wrong was ever published.
  // What was wrong was the desk being asked a question the software could not
  // answer, and being told nothing when it could not.
  let newspaper;
  try {
    const response = await fetch(`/api/newspapers/${newspaperId}`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return showFailure(
        body.error || `This edition could not be read (${response.status}), so it cannot be published yet.`,
        { retry: () => showPublicationFiles(newspaperId) },
      );
    }
    newspaper = await response.json();
  } catch {
    return showFailure('This edition could not be read, so it cannot be published yet.', {
      retry: () => showPublicationFiles(newspaperId),
    });
  }

  const selectedPublic = newspaper.epaperSelected === true || newspaper.epaper_selected === true;
  const released = Boolean(newspaper.epaperReleasedAt || newspaper.epaper_released_at);

  const lines = [
    'This freezes the pages exactly as they look in the editor now and releases them as the public e-paper.',
    'Empty news blocks stay empty. Publishing does not require a PDF, Scribus project, page sign-off, or a press-ready edition.',
  ];
  if (selectedPublic) {
    lines.push('This is already the public issue. Publishing replaces its frozen pages with this editor version.');
  }

  // askConfirm answers a BOOLEAN, not the {action} shape openDialog resolves.
  const confirmed = await askConfirm({
    title: released ? 'Publish this updated newspaper?' : 'Publish this newspaper?',
    body: lines.join('\n'),
    confirm: released ? 'Publish update' : 'Publish e-paper',
    cancel: 'Cancel',
  });
  if (!confirmed) return;

  showNotice('Freezing pages…');
  let outcome;
  try {
    const response = await fetch(`/api/newspapers/${newspaperId}/publish-current`, { method: 'POST' });
    const body = await response.json().catch(() => ({}));
    outcome = { ok: response.ok, body };
  } catch {
    outcome = { ok: false, body: {} };
  }
  if (!outcome.ok) {
    return showFailure(outcome.body.error || 'The current editor view could not be published.', {
      retry: () => showPublicationFiles(newspaperId),
    });
  }
  showNotice(`Published ${outcome.body.pages} pages and mapped ${outcome.body.stories} news blocks.`
    + `${outcome.body.selected ? ' It is now the public e-paper.' : ''}`);
}
