import { renderStoryExplorerMarkup, bindStoryExplorer } from "./story-explorer.js";

// THE STORY BROWSER IS NOT A FUNCTION OF THE PAGE.
//
// This ran on every PAGE topic change - so every time a desk pressed a page
// pill - and rebuilt the whole reporter archive from nothing: 1966 cards, one
// `<img>` each. Measured in the running app on this newsroom's own database,
// per page switch:
//
//   #storyExplorerResults   1,042,196 bytes of markup   158-229 ms to parse
//
// and then 1966 image elements for the browser to resolve on top of that. It
// was the single largest thing a page switch did, and every byte of it was
// IDENTICAL to what was already on screen: `reporterNews` is set once per
// edition (`store.setEdition`), so the same array was being re-rendered into
// the same panel to produce the same DOM. That is the 1-2 second pause a desk
// reported when changing pages.
//
// What this panel actually depends on is the story list and which story the
// selected block carries. Neither is the page. So it is rebuilt when one of
// those changes and NOT otherwise, and when only the selection moved, the
// explorer is asked to move its own highlight - it keeps `selectedId`, so
// there is no second copy of which story is picked.
//
// It also fixes a real fault of its own: the rebuild reset the desk's search
// box and all four filters every time they changed page.

let painted = null;

export function renderStoryPicker(currentPage, reporterNews, selectedSectionKey, onSelectStory) {
  const panel = document.getElementById("sidebarPanel");
  if (!panel) return;

  const section = currentPage?.sections?.find((s) => s.section_key === selectedSectionKey);
  const storyId = section?.news_item_id || null;

  // `panel.firstElementChild` is the check that this is still OUR markup:
  // anything else that writes into the sidebar invalidates the memo by
  // emptying it, and a stale controller can then never be reused.
  const reusable = painted
    && painted.panel === panel
    && painted.news === reporterNews
    && panel.firstElementChild
    && panel.contains(document.getElementById("storyExplorerResults"));

  if (reusable) {
    painted.controller?.setSelected(storyId);
    return;
  }

  panel.innerHTML = renderStoryExplorerMarkup(reporterNews);
  const controller = bindStoryExplorer(reporterNews, onSelectStory, storyId);
  painted = { panel, news: reporterNews, controller };
}
