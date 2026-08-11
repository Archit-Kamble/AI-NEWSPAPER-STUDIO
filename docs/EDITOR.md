# The single-story editor

There is one editor for one selected newspaper block: the **Block Editor**
(`public/editor/external-editor/`, still named "external-editor" in the
filesystem — see CLAUDE.md's "Terminology" section for why the folder keeps
that name while nothing user-facing does). There used to be a separate
Inspector beside the page carrying its own copy of headline/subheading/body,
bound to the same draft as the dock below it. Two editors on one story is how
a desk loses work — a plain textarea could only show the rich editor's marks
as literal `<p><br></p>`, and every read-out had to be kept in step twice.
Everything the Inspector did that the Block Editor did not was moved into the
Block Editor first, then the Inspector was deleted. It is not coming back.

## What happens when a block is selected

1. The page thumbnail highlights the block.
2. The Block Editor opens: its story source bar, Word-style writing surface
   (`story-editor.js` + `block-frame.js`), Smart Cards, image controls, an AI
   panel, and — beside the page, not inside the dock — Typography, Properties,
   Story details and History (`workspace-tools`, capped to the page's own
   height, see CLAUDE.md's "Newspaper Workspace" section).
3. Every change goes through the one workspace draft (`store.js`). That one
   draft updates the page thumbnail, the character budget, undo history and
   autosave together.
4. Moving to another block flushes a dirty autosave before the draft changes.

Reporter selection, caption, reporter, category, location, tags, language and
editorial status live in exactly one place: the dock's **Story details**
panel (`story-details-panel.js`), reading and writing the one workspace draft.
There is no second copy of this form anywhere to keep in sync.

## The writing surface

The surface provides headline, subheading and rich body copy with bold, italic,
underline, ordered and unordered lists, undo, redo, clean paste, browser
keyboard shortcuts, a source view and focus mode. The supported rich-text marks
are defined once in `public/editor/layout/rich-text.js`; the browser and press
pipeline use the same plain-text measurement.

Block typography remains a layout decision. It belongs in the Typography panel
because free per-word fonts, colours and sizes would make a newspaper page look
like unrelated documents.

## Smart Cards

Smart Cards do not create a special layout. They make a proposal for the
currently selected block's calculated character capacity, then the editor
accepts or discards it.

- Panchang and Sudoku are computed.
- Dinविशेष is curated source material.
- Rashi-bhavishya and Suvichar are AI drafts and enter the block as
  `needs_review`.
- Rashi is the only card with a coverage choice: automatic, one, three or all
  twelve signs. Automatic derives the count from the selected block.
- Weather remains disabled until a real forecast provider exists. The system
  must never invent factual weather or market information.

## Boundaries

`workspace.js` owns API calls, selected-block images and the shared draft.
Views write through `onPatch`; they do not call each other or keep another copy
of a story. `story-editor.js`, `story-details-panel.js` and
`smart-card-panel.js` are view modules only. This keeps future drag/drop,
collaboration and PDF/Scribus work compatible with the same story state.
