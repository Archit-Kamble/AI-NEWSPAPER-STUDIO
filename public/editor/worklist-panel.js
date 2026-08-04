// "What's left" — the edition's worklist, on the one screen.
//
// The question a night desk asks all evening, and the software could not
// answer: which blocks are still empty, and how long should the copy for each
// one be. Finding out meant clicking every block of every page - forty-four of
// them in a four-page paper - and the character budget only appeared once you
// were inside a block, which is after you have written the copy, not before.
//
// So this lists every unfinished block in page order with the number a
// sub-editor actually wants: how many characters that hole holds. Clicking a
// row goes to it. It is a panel over the workspace, never another screen
// (VISION.md: everything happens inside the one workspace).

const escapeAttribute = (value) =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const STATE_LABEL = {
  empty: "empty",
  started: "started",
  "needs-caption": "no caption",
  overset: "too long",
};

function rowHtml(block) {
  const budget =
    block.state === "overset"
      ? `<span class="worklist-over">${block.over} characters too long</span>`
      : block.capacity
        ? `holds ${block.capacity} characters`
        : "";
  return `
    <li class="worklist-row worklist-${block.state}"
        data-page="${block.pageNumber}" data-section="${escapeAttribute(block.sectionKey)}">
      <span class="worklist-where">p${block.pageNumber} · ${escapeAttribute(block.sectionKey)}</span>
      <span class="worklist-what">
        ${escapeAttribute(block.headline || block.work)}
        <small>${escapeAttribute(block.widthPx)}×${escapeAttribute(block.heightPx)} px · ${budget}</small>
      </span>
      <span class="worklist-state">${STATE_LABEL[block.state] || block.state}</span>
    </li>`;
}

/**
 * Shows the worklist panel.
 *
 * `onGoTo(pageNumber, sectionKey)` takes the desk to a block - the panel never
 * changes the page itself, so the workspace stays in charge of selection.
 */
export function renderWorklist(list, { onGoTo }) {
  document.getElementById("worklistPanel")?.remove();

  const { totals } = list;
  const pagesWithWork = list.pages.filter((page) => page.blocks.length);

  const body = pagesWithWork.length
    ? pagesWithWork
        .map(
          (page) => `
          <li class="worklist-page">Page ${page.pageNumber} — ${page.blocks.length} to do</li>
          ${page.blocks.map(rowHtml).join("")}`,
        )
        .join("")
    : `<li class="worklist-clear">Every block on this edition is filled.</li>`;

  const panel = document.createElement("aside");
  panel.id = "worklistPanel";
  panel.className = "preflight-panel worklist-panel";
  panel.innerHTML = `
    <header>
      <strong>What's left — ${totals.done} of ${totals.blocks} blocks done</strong>
      <button type="button" id="worklistClose" aria-label="Close">×</button>
    </header>
    <p class="worklist-summary">
      ${totals.empty} empty${totals.overset ? ` · ${totals.overset} too long` : ""}${
        totals.started ? ` · ${totals.started} started` : ""
      }${totals.needsCaption ? ` · ${totals.needsCaption} without a caption` : ""}
      ${totals.charactersWanted ? `<br>About ${totals.charactersWanted.toLocaleString()} characters of copy still wanted.` : ""}
    </p>
    <ul>${body}</ul>`;
  document.body.appendChild(panel);

  document.getElementById("worklistClose").addEventListener("click", () => panel.remove());
  panel.querySelectorAll(".worklist-row").forEach((row) => {
    row.addEventListener("click", () => onGoTo(Number(row.dataset.page), row.dataset.section));
  });
  return panel;
}
