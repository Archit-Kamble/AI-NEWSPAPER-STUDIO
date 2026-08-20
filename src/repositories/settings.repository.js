const pool = require('../config/db');

const COLUMNS = `publication_name, publisher_name, address, contact_email,
  contact_phone, public_website, timezone, default_language, updated_by, updated_at`;

async function get() {
  await pool.query(`INSERT INTO publication_settings (singleton) VALUES (TRUE) ON CONFLICT (singleton) DO NOTHING`);
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM publication_settings WHERE singleton = TRUE`);
  return rows[0];
}

async function update(values, updatedBy) {
  const { rows } = await pool.query(
    `INSERT INTO publication_settings (
       singleton, publication_name, publisher_name, address, contact_email,
       contact_phone, public_website, timezone, default_language, updated_by, updated_at
     ) VALUES (TRUE, $1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP)
     ON CONFLICT (singleton) DO UPDATE SET
       publication_name=EXCLUDED.publication_name, publisher_name=EXCLUDED.publisher_name,
       address=EXCLUDED.address, contact_email=EXCLUDED.contact_email,
       contact_phone=EXCLUDED.contact_phone, public_website=EXCLUDED.public_website,
       timezone=EXCLUDED.timezone, default_language=EXCLUDED.default_language,
       updated_by=EXCLUDED.updated_by, updated_at=CURRENT_TIMESTAMP
     RETURNING ${COLUMNS}`,
    [values.publicationName, values.publisherName, values.address, values.contactEmail,
      values.contactPhone, values.publicWebsite, values.timezone, values.defaultLanguage, updatedBy],
  );
  return rows[0];
}

module.exports = { get, update };
