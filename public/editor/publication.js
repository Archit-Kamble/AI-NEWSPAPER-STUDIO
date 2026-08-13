export async function showPublicationFiles(newspaperId) {
  const [newspaper, status] = await Promise.all([
    fetch(`/api/newspapers/${newspaperId}`).then((r) => r.json()),
    fetch(`/api/newspapers/${newspaperId}/status`).then((r) => r.json()).catch(() => ({ readyForPress: false })),
  ]);
  const modalRoot = document.getElementById("modalRoot");
  if (!modalRoot) return;

  modalRoot.classList.add("open");
  modalRoot.innerHTML = `
    <div class="modal-backdrop" id="publishBackdrop"></div>
    <div class="modal-dialog">
      <button class="modal-close" id="closePublish">&times;</button>
      <h3>Scribus final touch-up</h3>
      <p class="muted">After finishing the page in Scribus, upload the editable .sla project and the CMYK print PDF here.</p>
      ${status.readyForPress ? '<p><strong>Ready for press.</strong></p>' : `<p><strong>Not ready for press.</strong> ${status.readiness?.counts?.needsReview || 0} blocks need review; ${status.readiness?.counts?.pagesNotPassed || 0} pages are not passed.</p>`}
      ${newspaper.scribusFile ? `<p><a href="${newspaper.scribusFile}" download>Download saved Scribus project</a></p>` : ""}
      ${newspaper.printPdf ? `<p><a href="${newspaper.printPdf}" target="_blank">View final CMYK PDF</a></p>` : ""}
      <div class="form-group"><label>Scribus project (.sla)</label><input id="scribusFile" type="file" accept=".sla" /></div>
      <div class="form-group"><label>Final print PDF (CMYK)</label><input id="printPdf" type="file" accept="application/pdf,.pdf" /></div>
      <button class="btn-submit" id="uploadPublication" ${status.readyForPress ? '' : 'disabled'}>Save final files</button>
    </div>
  `;

  const close = () => {
    modalRoot.classList.remove("open");
    modalRoot.innerHTML = "";
  };
  document.getElementById("publishBackdrop").addEventListener("click", close);
  document.getElementById("closePublish").addEventListener("click", close);

  document
    .getElementById("uploadPublication")
    .addEventListener("click", async () => {
      const formData = new FormData();
      const scribusFile = document.getElementById("scribusFile").files[0];
      const printPdf = document.getElementById("printPdf").files[0];
      if (scribusFile) formData.append("scribusFile", scribusFile);
      if (printPdf) formData.append("printPdf", printPdf);
      if (!scribusFile && !printPdf)
        return alert("Choose a Scribus .sla file or final PDF.");
      const response = await fetch(
        `/api/newspapers/${newspaperId}/final-files`,
        { method: "POST", body: formData },
      );
      const result = await response.json();
      if (!response.ok)
        return alert(result.code === 'PRESS_NOT_READY' ? 'Not ready for press. Clear review and page-signoff blockers first.' : result.error || "Could not upload final files.");
      alert("Final files saved.");
      showPublicationFiles(newspaperId);
    });
}
