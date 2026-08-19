CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'reporter')),
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS newspapers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  publication_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  page_width_px INTEGER NOT NULL DEFAULT 660,
  page_height_px INTEGER NOT NULL DEFAULT 1060,
  matter_width_px INTEGER NOT NULL DEFAULT 620,
  matter_height_px INTEGER NOT NULL DEFAULT 1020,
  color_mode VARCHAR(10) NOT NULL DEFAULT 'CMYK',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE newspapers ADD COLUMN IF NOT EXISTS publication_date DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE newspapers ADD COLUMN IF NOT EXISTS page_width_px INTEGER NOT NULL DEFAULT 660;
ALTER TABLE newspapers ADD COLUMN IF NOT EXISTS page_height_px INTEGER NOT NULL DEFAULT 1060;
ALTER TABLE newspapers ADD COLUMN IF NOT EXISTS matter_width_px INTEGER NOT NULL DEFAULT 620;
ALTER TABLE newspapers ADD COLUMN IF NOT EXISTS matter_height_px INTEGER NOT NULL DEFAULT 1020;
ALTER TABLE newspapers ADD COLUMN IF NOT EXISTS color_mode VARCHAR(10) NOT NULL DEFAULT 'CMYK';
ALTER TABLE newspapers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS news_items (
  id SERIAL PRIMARY KEY,
  newspaper_id INTEGER REFERENCES newspapers(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  subheading VARCHAR(255),
  description TEXT,
  category VARCHAR(100),
  location VARCHAR(120),
  city VARCHAR(120),
  tags TEXT,
  reporter_name VARCHAR(120),
  -- Editorial meaning is separate from physical layout. `story_type` tells
  -- the composition engine what treatment the copy needs; a page block's
  -- `block_type` still says what kind of physical slot it is.
  story_type VARCHAR(30) NOT NULL DEFAULT 'STANDARD',
  editorial_priority SMALLINT NOT NULL DEFAULT 3,
  desired_page_role VARCHAR(30),
  image_urls TEXT[] NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE news_items ADD COLUMN IF NOT EXISTS image_urls TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS story_type VARCHAR(30) NOT NULL DEFAULT 'STANDARD';
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS editorial_priority SMALLINT NOT NULL DEFAULT 3;
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS desired_page_role VARCHAR(30);

CREATE TABLE IF NOT EXISTS templates (
  id SERIAL PRIMARY KEY,
  template_key VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'editorial',
  page_width_px INTEGER NOT NULL DEFAULT 660,
  page_height_px INTEGER NOT NULL DEFAULT 1060,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pages (
  id SERIAL PRIMARY KEY,
  newspaper_id INTEGER NOT NULL REFERENCES newspapers(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  template_key VARCHAR(100) REFERENCES templates(template_key),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (newspaper_id, page_number)
);

-- A composition run stores operational truth only. Editorial content remains
-- in page_sections; prompts and generated bodies never enter this audit row.
CREATE TABLE IF NOT EXISTS edition_composition_runs (
  run_id UUID PRIMARY KEY,
  edition_id INTEGER NOT NULL REFERENCES newspapers(id) ON DELETE CASCADE,
  plan_token_hash VARCHAR(128) NOT NULL,
  source_snapshot_hash VARCHAR(128) NOT NULL,
  baseline_fingerprint VARCHAR(128) NOT NULL,
  writer_transport VARCHAR(40) NOT NULL,
  state VARCHAR(40) NOT NULL,
  page_count INTEGER NOT NULL,
  writer_call_count INTEGER NOT NULL DEFAULT 0,
  completion_state VARCHAR(40), failure_code VARCHAR(100), committed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TIMESTAMPTZ
);

-- Template rows are NOT seeded here. src/layout/templates.js is the single
-- source of truth for layouts and src/layout/syncTemplates.js mirrors it into
-- this table at boot, because pages.template_key has a foreign key onto it.
-- Listing layouts in both places is what let a template exist in JavaScript but
-- not in the database, which crashed page creation.

CREATE TABLE IF NOT EXISTS page_sections (
  id SERIAL PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  section_key VARCHAR(100) NOT NULL,
  block_type VARCHAR(30) NOT NULL DEFAULT 'article',
  story_type VARCHAR(30) NOT NULL DEFAULT 'STANDARD',
  editorial_priority SMALLINT NOT NULL DEFAULT 3,
  x_px INTEGER NOT NULL,
  y_px INTEGER NOT NULL,
  width_px INTEGER NOT NULL CHECK (width_px > 0),
  height_px INTEGER NOT NULL CHECK (height_px > 0),
  z_index INTEGER NOT NULL DEFAULT 0,
  news_item_id INTEGER REFERENCES news_items(id) ON DELETE SET NULL,
  headline TEXT,
  headline_font_px INTEGER NOT NULL DEFAULT 34,
  subheading TEXT,
  subheading_font_px INTEGER NOT NULL DEFAULT 20,
  body TEXT,
  body_font_px INTEGER NOT NULL DEFAULT 16,
  category VARCHAR(100),
  location VARCHAR(120),
  tags TEXT,
  reporter_name VARCHAR(120),
  ai_notes TEXT,
  editorial_presentation JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (page_id, section_key)
);

ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS editorial_presentation JSONB;

-- Production workspace fields. The editor's Story panel adds a caption and a
-- language; the section lifecycle (empty -> story_linked -> editing ->
-- ai_generated -> needs_review -> ready -> published) needs a status of its own,
-- separate from the linked news_item's reporter-side status; and a section can
-- carry one primary image chosen directly in the editor rather than inherited
-- from the linked story. Multi-image galleries remain the job of section_images.
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS caption TEXT;
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS language VARCHAR(20);
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'empty';
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS image_rotation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS image_zoom NUMERIC(5,2) NOT NULL DEFAULT 1;
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS image_fit VARCHAR(20) NOT NULL DEFAULT 'cover';
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS story_type VARCHAR(30) NOT NULL DEFAULT 'STANDARD';
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS editorial_priority SMALLINT NOT NULL DEFAULT 3;

-- Typography. Print composition needs each of these as its own column rather
-- than a JSON blob: the Scribus/PDF export will map them one-to-one onto frame
-- and paragraph-style properties. Sizes stay in px here (editor space) and are
-- converted to mm at export - never mixed silently.
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS font_family VARCHAR(80);
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS font_weight VARCHAR(20) NOT NULL DEFAULT 'normal';
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS font_italic BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS font_underline BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS text_align VARCHAR(10) NOT NULL DEFAULT 'left';
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS column_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS margin_px INTEGER NOT NULL DEFAULT 12;
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS line_height NUMERIC(4,2) NOT NULL DEFAULT 1.25;
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS letter_spacing_px NUMERIC(4,2) NOT NULL DEFAULT 0;
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS paragraph_spacing_px INTEGER NOT NULL DEFAULT 8;
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS list_style VARCHAR(10) NOT NULL DEFAULT 'none';
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS drop_cap BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS image_flip_h BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS image_flip_v BOOLEAN NOT NULL DEFAULT FALSE;

-- Newspaper typography, measured against real practice rather than assumed.
--
-- The defaults above were web defaults, and on a real 190x264 block they cost
-- roughly a third of the story's room:
--
--   margin_px 12          = 6 mm at this page's 2 px/mm. A newspaper separates
--                           two stories by a GUTTER of about 4 mm, shared - so
--                           2 mm (4 px) each side. 12 px each side took 24 of
--                           190 px of measure and 24 of 264 px of depth.
--   paragraph_spacing_px 8= a blank line between paragraphs. No printed
--                           newspaper spends a whole row of a column that way;
--                           it indents the first line instead. Measured on the
--                           block this was reported from: 0.7 of 5.83 body
--                           lines standing empty, 12% of the block.
--   text_align 'left'     = ragged right. Newspapers justify body copy; the
--                           measure is narrow and the ragged edge reads as
--                           unfinished against a column rule.
--
-- line_height is deliberately NOT changed. It looks generous at 1.45, but the
-- serif face's real worst-case ink box was measured exhaustively across every
-- consonant, every vowel sign and every virama conjunct: 1.475 em (ascent
-- 0.905 from the candrabindu, descent 0.570 from stacks like "ड़्रु"). 1.45 is
-- already at the edge of clipping Marathi and must not be lowered.
ALTER TABLE page_sections ALTER COLUMN margin_px SET DEFAULT 4;
ALTER TABLE page_sections ALTER COLUMN paragraph_spacing_px SET DEFAULT 0;
ALTER TABLE page_sections ALTER COLUMN text_align SET DEFAULT 'justify';

-- Backfill, guarded: ONLY rows still carrying the exact old default are moved.
-- A value a desk actually chose is never overwritten, which is why each clause
-- names the old default rather than updating everything.
UPDATE page_sections SET margin_px = 4 WHERE margin_px = 12;
UPDATE page_sections SET paragraph_spacing_px = 0 WHERE paragraph_spacing_px = 8;
UPDATE page_sections SET text_align = 'justify' WHERE text_align = 'left';

-- ...and the gutter was then counted TWICE.
--
-- The note above is right about the destination and wrong about the arithmetic,
-- and the error is visible on every page: it reasoned "a newspaper separates
-- two stories by about 4 mm, shared, so 2 mm each side" as though two blocks
-- touched. They do not. The page grid (src/layout/geometry.js, gridGutterMm 3)
-- already leaves 3 mm between one block and the next, and the templates leave
-- 4 mm above and below. The block's own inset is added to that, so the real
-- distance from the last character of one story to the first of the next was
--
--   horizontal: 2 mm + 3 mm + 2 mm = 7 mm   (measured on every pair, page 1)
--   vertical:   2 mm + 4 mm + 2 mm = 8 mm
--
-- against the ~4 mm the note was aiming for and the 3.8 mm measured off the
-- customer's own printed page. A 7 mm gutter is what makes a made-up page read
-- as a web layout: the columns stop being columns and become separate panels
-- floating on white.
--
-- So the inset stops trying to BE the gutter and becomes what it actually is -
-- the hair of air that keeps type off its own frame's edge. 0.5 mm, which at
-- 2 px/mm is the smallest step this page has:
--
--   horizontal: 0.5 + 3 + 0.5 = 4 mm
--   vertical:   0.5 + 4 + 0.5 = 5 mm   (a touch more, as a printed page has)
--
-- It can only give a block room, never take it, so nothing can overset on it.
-- A boxed block is unaffected in kind: it adds BOX_INSET_PX on top of this
-- (public/editor/compose/section-adapter.js), so its type still sets ~3 mm
-- inside its rule, which is what a printed panel does.
ALTER TABLE page_sections ALTER COLUMN margin_px SET DEFAULT 1;
UPDATE page_sections SET margin_px = 1 WHERE margin_px = 4;

CREATE TABLE IF NOT EXISTS media_assets (
  id SERIAL PRIMARY KEY,
  original_filename VARCHAR(500) NOT NULL,
  storage_path VARCHAR(1000) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  background_status VARCHAR(30) NOT NULL DEFAULT 'original',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS section_images (
  id SERIAL PRIMARY KEY,
  page_section_id INTEGER NOT NULL REFERENCES page_sections(id) ON DELETE CASCADE,
  media_asset_id INTEGER NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  crop_x_px INTEGER NOT NULL DEFAULT 0,
  crop_y_px INTEGER NOT NULL DEFAULT 0,
  crop_width_px INTEGER,
  crop_height_px INTEGER,
  UNIQUE (page_section_id, media_asset_id)
);

CREATE TABLE IF NOT EXISTS publication_files (
  id SERIAL PRIMARY KEY,
  newspaper_id INTEGER NOT NULL REFERENCES newspapers(id) ON DELETE CASCADE,
  file_type VARCHAR(30) NOT NULL CHECK (file_type IN ('scribus_project', 'print_pdf')),
  storage_path VARCHAR(1000) NOT NULL,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS edition_history (
  id SERIAL PRIMARY KEY,
  newspaper_id INTEGER NOT NULL REFERENCES newspapers(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_news_items_status ON news_items(status);
CREATE INDEX IF NOT EXISTS idx_news_items_created_by ON news_items(created_by);
CREATE INDEX IF NOT EXISTS idx_pages_newspaper ON pages(newspaper_id, page_number);
CREATE INDEX IF NOT EXISTS idx_page_sections_page ON page_sections(page_id, z_index);

-- ---------------------------------------------------------------------------
-- Print geometry, declared rather than implied.
--
-- SAHAS VARTA prints a 330 x 530 mm page with a 310 x 510 mm matter box (a
-- uniform 10 mm margin), in CMYK. The editor works at exactly 2 px per mm, so
-- 660 x 1060 px page / 620 x 1020 px matter - the px columns above are those
-- same measurements, and src/layout/geometry.js is the one place that scale is
-- written down. Storing the millimetres alongside them means the print export
-- never has to infer a scale, and a page of a different size cannot silently
-- break every template.
--
-- The column grid is what separates a national daily from a freehand page:
-- blocks snap to columns, so text lines up across the page.
ALTER TABLE newspapers ADD COLUMN IF NOT EXISTS page_width_mm NUMERIC(6,2) NOT NULL DEFAULT 330;
ALTER TABLE newspapers ADD COLUMN IF NOT EXISTS page_height_mm NUMERIC(6,2) NOT NULL DEFAULT 530;
ALTER TABLE newspapers ADD COLUMN IF NOT EXISTS matter_width_mm NUMERIC(6,2) NOT NULL DEFAULT 310;
ALTER TABLE newspapers ADD COLUMN IF NOT EXISTS matter_height_mm NUMERIC(6,2) NOT NULL DEFAULT 510;
ALTER TABLE newspapers ADD COLUMN IF NOT EXISTS bleed_mm NUMERIC(4,2) NOT NULL DEFAULT 3;
ALTER TABLE newspapers ADD COLUMN IF NOT EXISTS print_dpi INTEGER NOT NULL DEFAULT 300;
ALTER TABLE newspapers ADD COLUMN IF NOT EXISTS grid_columns INTEGER NOT NULL DEFAULT 16;
ALTER TABLE newspapers ADD COLUMN IF NOT EXISTS grid_gutter_mm NUMERIC(4,2) NOT NULL DEFAULT 3;

-- Block decoration. Borders, rules and headline treatments are a large part of
-- why a printed page reads as a newspaper rather than a web page; they are per
-- block, and they map onto Scribus frame and paragraph properties at export.
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS border_style VARCHAR(20) NOT NULL DEFAULT 'none';
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS border_width_px NUMERIC(4,2) NOT NULL DEFAULT 1;
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS border_color VARCHAR(20) NOT NULL DEFAULT '#111111';
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS headline_style VARCHAR(20) NOT NULL DEFAULT 'plain';
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS accent_color VARCHAR(20) NOT NULL DEFAULT '#c8102e';

-- Blocks are now drawn freely on the page rather than only coming from a
-- template, so a page can carry the 5-20 items a real inside page has. A
-- free-drawn block records that it is not part of the template layout.
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT FALSE;

-- Rich story text. `body` keeps the plain text every existing consumer reads
-- (fit estimates, the AI brief, search); `body_rich` holds the Quill Delta -
-- a list of runs with attributes - which is what carries coloured keywords and
-- inline emphasis, and what maps onto Scribus character styles at export.
-- Deltas, not HTML: HTML would have to be re-parsed and guessed at for print.
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS body_rich JSONB;

-- ---------------------------------------------------------------------------
-- Image placement inside a block.
--
-- A block can hold several pictures, each placed where the page designer wants
-- it, at whatever size and shape. `section_images` already modelled the link
-- and the crop; these add where the picture actually sits within the block, in
-- the same editor pixels as the block itself.
--
-- `shape` is what makes text wrap work for cut-outs: a rectangle occupies the
-- cells its box covers, an ellipse only the cells inside the ellipse, and
-- `cutout` follows the alpha of a background-removed PNG. See
-- public/editor/layout/text-flow.js - occupancy is what the character grid is
-- built from, and the character grid is what the AI is briefed with.
ALTER TABLE section_images ADD COLUMN IF NOT EXISTS x_px INTEGER NOT NULL DEFAULT 0;
ALTER TABLE section_images ADD COLUMN IF NOT EXISTS y_px INTEGER NOT NULL DEFAULT 0;
ALTER TABLE section_images ADD COLUMN IF NOT EXISTS width_px INTEGER NOT NULL DEFAULT 120;
ALTER TABLE section_images ADD COLUMN IF NOT EXISTS height_px INTEGER NOT NULL DEFAULT 90;
ALTER TABLE section_images ADD COLUMN IF NOT EXISTS rotation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE section_images ADD COLUMN IF NOT EXISTS flip_h BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE section_images ADD COLUMN IF NOT EXISTS flip_v BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE section_images ADD COLUMN IF NOT EXISTS z_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE section_images ADD COLUMN IF NOT EXISTS shape VARCHAR(20) NOT NULL DEFAULT 'rect';
ALTER TABLE section_images ADD COLUMN IF NOT EXISTS stand_off_px INTEGER NOT NULL DEFAULT 6;
ALTER TABLE section_images ADD COLUMN IF NOT EXISTS caption TEXT;
-- How the source (after crop) resolves into the placement frame - contain
-- (the whole cropped source, never cut), cover (fills the frame, excess
-- clipped) or stretch (fills both axes independently, distortion intended).
-- One shared resolver (public/editor/layout/image-geometry.js) is the only
-- place that reads this; paint, resize preview and alpha exclusion all
-- consume its one answer rather than each deciding fit for themselves.
-- Allowed values ('contain'/'cover'/'stretch') are validated at the one
-- place that reads them (image-geometry.js's normaliseFitMode()), not by a
-- CHECK constraint here - ALTER TABLE ... ADD CONSTRAINT has no idempotent
-- IF NOT EXISTS form in Postgres, and this file is re-run on every boot.
ALTER TABLE section_images ADD COLUMN IF NOT EXISTS fit_mode VARCHAR(20) NOT NULL DEFAULT 'contain';
-- Direct newsroom provenance for composition-created placements. A companion
-- photo section has no prose story from which this can safely be guessed.
ALTER TABLE section_images ADD COLUMN IF NOT EXISTS source_news_item_id INTEGER
  REFERENCES news_items(id) ON DELETE SET NULL;

-- media_assets gains the URL the browser actually loads. Uploads already land
-- in public/uploads; this is the row that lets a picture be reused across
-- blocks and editions rather than being re-uploaded each time.
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS width_px INTEGER;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS height_px INTEGER;

-- The body is written plainly by the editor and composed by the software; it is
-- not hand-formatted, so the rich-text column added earlier has no consumer.
ALTER TABLE page_sections DROP COLUMN IF EXISTS body_rich;

-- Marathi is the language this paper prints in; nothing should have to type it.
ALTER TABLE page_sections ALTER COLUMN language SET DEFAULT 'Marathi';

-- A finer grid: 16 columns rather than 8, so a block can be placed and sized in
-- half-column steps. The gutter narrows to 3 mm so the gutters still only take
-- 45 mm of the 310 mm matter rather than a quarter of the page.
ALTER TABLE newspapers ALTER COLUMN grid_columns SET DEFAULT 16;
ALTER TABLE newspapers ALTER COLUMN grid_gutter_mm SET DEFAULT 3;
UPDATE newspapers SET grid_columns = 16, grid_gutter_mm = 3 WHERE grid_columns = 8;

-- The occupancy mask of a cut-out, sampled from its alpha. This is what lets
-- copy wrap the subject rather than its bounding box - see
-- public/editor/layout/text-flow.js.
ALTER TABLE section_images ADD COLUMN IF NOT EXISTS mask JSONB;

-- The kicker: the short line that sits above a headline in a Marathi daily and
-- tells the reader what the story is before the headline shouts it - "पंतप्रधान
-- मोदी यांचे तरुणांना आवाहन" over "ड्रग्जपासून दूर राहा". It is not the
-- subheading, which sits below and elaborates; it reads as a different piece of
-- furniture and is set in a different size, so it needs its own field.
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS kicker TEXT;

-- Standing daily features. A block can be marked as one of them - राशिभविष्य,
-- सूर्योदय-सूर्यास्त, दिनविशेष, सुविचार - and the software fills it for the
-- edition's date instead of a reporter filing it. What lands in the block is
-- ordinary copy in the ordinary fields, so it is measured, edited, saved and
-- printed by exactly the same machinery as a news story; only where it came
-- from is different. See src/features/index.js.
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS feature_key VARCHAR(40);

-- Smart Cards: the structured content actually placed in a block.
--
-- `feature_key` above says what the LAYOUT reserved this block for, and it is
-- read-only to the desk - an almanac box stays an almanac box. These two say
-- what is IN the block right now, which is a different question with a
-- different answer: a desk can put today's sudoku into a spare block that the
-- layout never marked as anything.
--
-- The reason this is stored rather than derived is that a sudoku is a GRID.
-- Flattening it to "७ · · ३ · ·" and parsing it back on the way to the page is
-- lossy in both directions - it cannot carry a solution, a difficulty or a
-- lucky colour, and one stray character makes it unreadable. The structured
-- payload is the truth; the body text stays beside it as printable copy and as
-- what everything that MEASURES a block already reads.
--
-- JSONB rather than a table per feature: the shape differs per card (a grid, a
-- list of signs, a quote and its attribution), nothing is queried across cards,
-- and each renderer owns its own shape. This is the one blob in the schema and
-- it is deliberate - it is content, not a normalised newspaper.
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS smart_card_key VARCHAR(40);
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS smart_card_data JSONB;

-- ---------------------------------------------------------------------------
-- Jump lines.
--
-- No story is cut short because its block ran out of room; it continues on
-- another page, with "(उर्वरित पान ४ वर)" at the foot of the first part and
-- "(पान १ वरून)" at the head of the second. The continuation block records
-- where it came from; the forward direction is derived, so the two can never
-- point at different things.
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS continued_from_section_id INTEGER
  REFERENCES page_sections(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS page_sections_continued_from_idx
  ON page_sections (continued_from_section_id);

-- ---------------------------------------------------------------------------
-- District editions.
--
-- A district daily is not many papers, it is one paper with some pages swapped.
-- A child edition owns only the pages that differ; every other page is served
-- from its parent, so page one is made up once and every district gets it.
ALTER TABLE newspapers ADD COLUMN IF NOT EXISTS parent_edition_id INTEGER
  REFERENCES newspapers(id) ON DELETE CASCADE;
ALTER TABLE newspapers ADD COLUMN IF NOT EXISTS district VARCHAR(80);
CREATE INDEX IF NOT EXISTS newspapers_parent_idx ON newspapers (parent_edition_id);

-- ---------------------------------------------------------------------------
-- Colour formes.
--
-- Not every page prints in colour - a web press lays colour on the outer forme
-- and the centre spread, and the rest runs black only. Which pages those are is
-- a press fact, so it is stored per page, defaulted from the page number, and
-- shown honestly: a colour photograph placed on a mono page previews in grey
-- and is flagged, because on the press it will print grey.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS prints_colour BOOLEAN NOT NULL DEFAULT TRUE;
-- Once a desk says "we bought colour on page 5 this week", adding a page must
-- not quietly take it away again. Defaults are recomputed as an edition grows;
-- an explicit choice is not.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS colour_overridden BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- Passing a page for press.
--
-- A page is not finished when its last block is filled; it is finished when a
-- named person passes it, at a known time. Preflight has to be clean before
-- that can happen - the point of preflight is that it runs before the plate.
-- edition_history already existed for the audit trail; these three columns are
-- the state itself.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS production_state VARCHAR(20) NOT NULL DEFAULT 'making_up';
ALTER TABLE pages ADD COLUMN IF NOT EXISTS state_changed_at TIMESTAMPTZ;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS state_changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS signoff_fingerprint VARCHAR(64);

-- ---------------------------------------------------------------------------
-- Carrying an advertisement forward.
--
-- An advert is booked for a run of days, so yesterday's advert in a slot is
-- very likely today's advert in that slot. Starting an edition copies those
-- blocks forward (never news - see src/services/editionStart.service.js), and
-- records where each one came from. The provenance matters: a desk looking at a
-- filled advert box must be able to tell "this was booked today" from "this was
-- carried from yesterday and nobody has checked it".
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS carried_from_section_id INTEGER
  REFERENCES page_sections(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Type sizes are fractional.
--
-- These began as INTEGER, which is a screen assumption, not a print one. A
-- printer sets type in half and quarter points, Scribus takes a fractional
-- point size, and the px-to-pt conversion here produces one anyway (1 px is
-- about 1.42 pt at 2 px per mm). Whole-pixel steps meant the smallest available
-- adjustment to a story that would not fit was about a point and a half - a
-- visible jump, where a sub-editor wants half of one.
--
-- INTEGER converts to NUMERIC losslessly, so every existing size is unchanged.
ALTER TABLE page_sections ALTER COLUMN headline_font_px TYPE NUMERIC(5,1);
ALTER TABLE page_sections ALTER COLUMN subheading_font_px TYPE NUMERIC(5,1);
ALTER TABLE page_sections ALTER COLUMN body_font_px TYPE NUMERIC(5,1);

-- ---------------------------------------------------------------------------
-- Stage 4: page guides.
--
-- Reference lines a desk drags off the ruler - never printed, and (unlike
-- grid.js's column/baseline grid, which is computed, server-derived layout
-- geometry) never a snap target yet either, that is a later stage. Page-level,
-- not per-block: the page is the coordinate system the ruler itself reads, so
-- a guide belongs to the same scope. `position_px` is always an editor/page
-- pixel - never a screen or zoom-scaled value; the client is responsible for
-- converting a pointer position into one before it is ever sent here.
--
-- Deliberately as few columns as the earlier per-picture placement tables:
-- no "locked" column (nothing in this stage reads or writes one), no
-- "visible" column (visibility is a client-side view toggle over guides that
-- still exist, not a fact about the guide itself - see ruler.js's own note).
CREATE TABLE IF NOT EXISTS page_guides (
  id SERIAL PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  orientation VARCHAR(10) NOT NULL CHECK (orientation IN ('horizontal', 'vertical')),
  position_px INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_page_guides_page ON page_guides(page_id);

-- The headline and the deck are OBJECTS, and an object has its own alignment.
--
-- `text_align` (above) is one column for the whole block, and every surface
-- treated it as the body's: the exact engine's setDisplayFlow() placed a
-- headline line at the start of its measure and left it there, whatever the
-- column said. A sub-editor selecting the headline and pressing "centre"
-- therefore changed the BODY - the one object they were not looking at - and
-- nothing on screen said so. That is not a wiring slip in one control; it is
-- the block-wide model being wrong about what a newspaper page is. A centred
-- headline over justified copy, or a flush-right kicker, is ordinary Marathi
-- daily practice and one column could not express it.
--
-- NULL, not a default string, so "the desk has never expressed an opinion
-- about this headline" stays distinguishable from "the desk chose left". The
-- engine reads NULL as the paper's own display default (flush left, which is
-- what every existing row was already being set as), so no row changes
-- appearance on the day this column arrives, and a future change to that
-- default reaches every block that never had an opinion.
--
-- There is deliberately no kicker_align: the kicker is the headline's own
-- overline and follows it (compose.js). A separate control for it could only
-- ever be used to knock the two out of step.
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS headline_align VARCHAR(10);
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS subheading_align VARCHAR(10);

-- A block prints no box unless a person asked for one.
--
-- `border_style` has always defaulted to 'none' on the column, but
-- src/layout/templates.js shipped `border: 'box'` on every advert, every
-- briefs block and all four standing features - so a made-up page came out of
-- the press view ruled into panels nobody had chosen, which is what the desk
-- reported ("in print view we are seeing border around newsblock, we don't
-- want it, rather a button if the editor wants he can add").
--
-- Unguarded, and that IS the guard: there has never been a control anywhere in
-- this product that sets border_style, so every 'box' in this table came from
-- the template default above and not from a decision. From now on it can only
-- come from a decision - the Block Editor's Properties panel - so a future
-- migration would have to be guarded in the ordinary way.
UPDATE page_sections SET border_style = 'none' WHERE border_style = 'box';
