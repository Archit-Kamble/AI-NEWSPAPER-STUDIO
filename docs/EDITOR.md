# The single-story editor

SAHAS is currently migrating toward one editor for one selected newspaper block.
Until the dock replacement has been accepted in the live workflow, the
Inspector keeps the immediately visible editable headline, subheading, body,
caption and metadata form. The composition dock reads and writes the same
workspace draft and provides the richer writing, image, AI and Smart Card tools.

## What happens when a block is selected

1. The page thumbnail highlights the block.
2. The dock opens its story source bar, Word-style writing surface, Smart Cards,
   image controls, space read-out, AI controls, details, typography and history.
3. Every change goes through the workspace draft. That one draft updates the
   page thumbnail, composition proof, character budget, undo history and
   autosave together.
4. Moving to another block flushes a dirty autosave before the draft changes.

Reporter selection, caption, reporter, category, location, tags, language and
editorial status are available in both the immediate Inspector form and the
dock's folded **Story details** section during this compatibility stage. They
stay synchronised through the one workspace draft; neither surface keeps its
own story copy.

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
