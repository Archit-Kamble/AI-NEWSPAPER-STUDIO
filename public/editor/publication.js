export async function showPublicationFiles(newspaperId) {
  const newspaper = await fetch(`/api/newspapers/${newspaperId}`).then((r) =>
    r.json(),
  );
  const editor = document.getElementById("sectionEditor");
  editor.innerHTML = `
    <h3>Scribus final touch-up</h3>
    <p class="muted">After finishing the page in Scribus, upload the editable .sla project and the CMYK print PDF here.</p>
    ${newspaper.scribusFile ? `<p><a href="${newspaper.scribusFile}" download>Download saved Scribus project</a></p>` : ""}
    ${newspaper.printPdf ? `<p><a href="${newspaper.printPdf}" target="_blank">View final CMYK PDF</a></p>` : ""}
    <div class="form-group"><label>Scribus project (.sla)</label><input id="scribusFile" type="file" accept=".sla" /></div>
    <div class="form-group"><label>Final print PDF (CMYK)</label><input id="printPdf" type="file" accept="application/pdf,.pdf" /></div>
    <button class="btn-submit" id="uploadPublication">Save final files</button>
  `;
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
        return alert(result.error || "Could not upload final files.");
      alert("Final files saved.");
      showPublicationFiles(newspaperId);
    });
}