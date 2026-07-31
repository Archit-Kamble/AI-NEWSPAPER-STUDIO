CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  role VARCHAR(20) NOT NULL,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS newspapers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  template VARCHAR(100) NOT NULL,
  status VARCHAR(20) DEFAULT 'draft',
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS news_items (
  id SERIAL PRIMARY KEY,
  newspaper_id INT REFERENCES newspapers(id),
  title VARCHAR(255) NOT NULL,
  subheading VARCHAR(255),
  description TEXT,
  category VARCHAR(100),
  location VARCHAR(120),
  city VARCHAR(120),
  tags TEXT,
  reporter_name VARCHAR(120),
  image_url VARCHAR(500),
  status VARCHAR(20) DEFAULT 'draft',
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE layouts (
    id SERIAL PRIMARY KEY,

    newspaper_id INTEGER NOT NULL REFERENCES newspapers(id) ON DELETE CASCADE,

    page_number INTEGER NOT NULL,

    layout_name VARCHAR(100) NOT NULL,

    width INTEGER NOT NULL,

    height INTEGER NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE layout_blocks (
    id SERIAL PRIMARY KEY,

    layout_id INTEGER NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,

    block_type VARCHAR(30) NOT NULL,

    x INTEGER NOT NULL,

    y INTEGER NOT NULL,

    width INTEGER NOT NULL,

    height INTEGER NOT NULL,

    rotation INTEGER DEFAULT 0,

    z_index INTEGER DEFAULT 0,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);