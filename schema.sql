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
  image_urls TEXT[] NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE news_items ADD COLUMN IF NOT EXISTS image_urls TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

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

INSERT INTO templates (template_key, name) VALUES
  ('front', 'Front Page'),
  ('local', 'Local News'),
  ('opinion', 'Opinion'),
  ('photo', 'Photo Feature')
ON CONFLICT (template_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS page_sections (
  id SERIAL PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  section_key VARCHAR(100) NOT NULL,
  block_type VARCHAR(30) NOT NULL DEFAULT 'article',
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (page_id, section_key)
);

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
