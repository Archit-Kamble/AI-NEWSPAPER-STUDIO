export async function showPublicationFiles(newspaperId) {
  const [newspaper, status] = await Promise.all([
    fetch(`/api/newspapers/${newspaperId}`).then((r) => r.json()),
    fetch(`/api/newspapers/${newspaperId}/status`).then((r) => r.json()).catch(() => ({ readyForPress: false })),
  ]);
  const modalRoot = document.getElementById("modalRoot");
  if (!modalRoot) return;

  modalRoot.classList.add("open");
  const selectedPublic = newspaper.epaperSelected === true || newspaper.epaper_selected === true;
  const released = Boolean(newspaper.epaperReleasedAt || newspaper.epaper_released_at);
  modalRoot.innerHTML = `
    <div class="modal-backdrop" id="publishBackdrop"></div>
    <div class="modal-dialog publication-dialog">
      <button class="modal-close" id="closePublish">&times;</button>
      <p class="publication-kicker">Press &amp; public edition</p>
      <h3>Publish this newspaper</h3>
      <ol class="publication-steps">
        <li class="${status.readyForPress ? 'done' : ''}"><strong>Pass every page</strong><span>${status.readyForPress ? 'Press checks are clear.' : `${status.readiness?.counts?.needsReview || 0} blocks need review; ${status.readiness?.counts?.pagesNotPassed || 0} pages are not passed.`}</span></li>
        <li class="${newspaper.printPdf ? 'done' : ''}"><strong>Upload the final PDF</strong><span>This CMYK artifact becomes both the whole-paper download and the sharp page images.</span></li>
        <li class="${released ? 'done' : ''}"><strong>Release the e-paper</strong><span>A frozen web snapshot is created. Later newsroom edits cannot change it until you release again.</span></li>
      </ol>
      <div class="publication-files">
        ${newspaper.scribusFile ? `<a href="${newspaper.scribusFile}" download>Saved Scribus project</a>` : ""}
        ${newspaper.printPdf ? `<a href="${newspaper.printPdf}" target="_blank" rel="noopener">View final CMYK PDF</a>` : ""}
        ${selectedPublic ? `<a href="/epaper" target="_blank" rel="noopener">View selected public e-paper</a>` : ""}
      </div>
      <details class="publication-upload" ${newspaper.printPdf ? '' : 'open'}>
        <summary>${newspaper.printPdf ? 'Replace final files' : 'Upload final files'}</summary>
        <p class="muted">After the designer's Scribus touch-up, upload the editable project and final PDF.</p>
        <div class="form-group"><label>Scribus project (.sla)</label><input id="scribusFile" type="file" accept=".sla" /></div>
        <div class="form-group"><label>Final print PDF (CMYK)</label><input id="printPdf" type="file" accept="application/pdf,.pdf" /></div>
        <button class="btn-submit" id="uploadPublication" ${status.readyForPress ? '' : 'disabled'}>Save final files</button>
      </details>
      <div class="publication-release">
        <button class="btn-submit" id="publishEpaper" ${status.readyForPress && newspaper.printPdf ? '' : 'disabled'}>${released ? 'Republish press-final e-paper' : 'Publish press-final e-paper'}</button>
        ${!newspaper.printPdf ? '<p class="muted">The final PDF is required before the public edition can be built.</p>' : ''}
        <p class="muted">Press-final: rasterises the accepted PDF at print-quality resolution and creates one branded PNG for every clickable story.</p>
        <button class="btn-secondary" id="publishCurrentEpaper">Publish current editor view</button>
        <p class="muted">Web proof: freezes the current editor pages without waiting for Scribus, CMYK PDF or press sign-off. It does not make the edition press-final.</p>
      </div>
    </div>
  `;

  const close = () => {
    modalRoot.classList.remove("open");
    modalRoot.innerHTML = "";
  };
  document.getElementById("publishBackdrop").addEventListener("click", close);
  document.getElementById("closePublish").addEventListener("click", close);

  document.getElementById("uploadPublication")?.addEventListener("click", async () => {
      const button = document.getElementById("uploadPublication");
      const formData = new FormData();
      const scribusFile = document.getElementById("scribusFile").files[0];
      const printPdf = document.getElementById("printPdf").files[0];
      if (scribusFile) formData.append("scribusFile", scribusFile);
      if (printPdf) formData.append("printPdf", printPdf);
      if (!scribusFile && !printPdf)
        return alert("Choose a Scribus .sla file or final PDF.");
      button.disabled = true;
      button.textContent = 'Saving…';
      const response = await fetch(
        `/api/newspapers/${newspaperId}/final-files`,
        { method: "POST", body: formData },
      );
      const result = await response.json();
      if (!response.ok) {
        button.disabled = false;
        button.textContent = 'Save final files';
        return alert(result.code === 'PRESS_NOT_READY' ? 'Not ready for press. Clear review and page-signoff blockers first.' : result.error || "Could not upload final files.");
      }
      alert("Final files saved.");
      showPublicationFiles(newspaperId);
    });

  document.getElementById('publishEpaper')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Building page and story PNGs…';
    const response = await fetch(`/api/newspapers/${newspaperId}/publish`, { method: 'POST' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      button.disabled = false;
      button.textContent = released ? 'Republish press-final e-paper' : 'Publish press-final e-paper';
      return alert(result.error || 'The e-paper could not be published.');
    }
    alert(`Published ${result.pages} pages and ${result.stories} story cards.`);
    showPublicationFiles(newspaperId);
  });

  document.getElementById('publishCurrentEpaper')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Freezing current editor pages…';
    const response = await fetch(`/api/newspapers/${newspaperId}/publish-current`, { method: 'POST' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      button.disabled = false;
      button.textContent = 'Publish current editor view';
      return alert(result.error || 'The current editor view could not be published.');
    }
    alert(`Released ${result.pages} current pages and ${result.stories} story cards.${result.selected ? ' It is now the public e-paper.' : ' Choose it in the E-paper list when it should become public.'}`);
    showPublicationFiles(newspaperId);
  });
}
