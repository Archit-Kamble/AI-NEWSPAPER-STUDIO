const pool = require("../config/db");

async function create(news) {
  const query = `
        INSERT INTO news_items (
            newspaper_id,
            title,
            subheading,
            description,
            category,
            location,
            city,
            tags,
            reporter_name,
            story_type,
            editorial_priority,
            desired_page_role,
            image_urls,
            status,
            created_by
        )
        VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
        )
        RETURNING *;
    `;

  const values = [
    news.newspaper_id,
    news.title,
    news.subheading,
    news.description,
    news.category,
    news.location,
    news.city,
    news.tags,
    news.reporter_name,
    news.story_type,
    news.editorial_priority,
    news.desired_page_role || null,
    news.image_urls,
    news.status,
    news.created_by,
  ];
  const { rows } = await pool.query(query, values);
  return rows[0];
}

async function findAll(filter = {}) {
  let query = `SELECT * FROM news_items`;
  const conditions = [];
  const values = [];

  if (filter.status) {
    values.push(filter.status);
    conditions.push(`status = $${values.length}`);
  }

  if (filter.created_by) {
    values.push(filter.created_by);
    conditions.push(`created_by = $${values.length}`);
  }

  if (conditions.length) {
    query += ` WHERE ` + conditions.join(" AND ");
  }

  query += ` ORDER BY created_at DESC`;

  const { rows } = await pool.query(query, values);
  return rows;
}

async function findById(id) {
  const { rows } = await pool.query(`SELECT * FROM news_items WHERE id=$1`, [
    id,
  ]);

  return rows[0];
}

async function findByStatus(status) {
  const { rows } = await pool.query(
    `
        SELECT *
        FROM news_items
        WHERE status=$1
        ORDER BY created_at DESC
        `,
    [status],
  );

  return rows;
}

// A composition run owns a stable in-memory snapshot of this result. Only
// desk-approved newsroom material attached to the requested edition is
// eligible; drafts and rejected copy must never become autonomous output.
async function findForComposition(newspaperId) {
  const { rows } = await pool.query(
    `SELECT * FROM news_items
      WHERE newspaper_id = $1 AND status = 'approved'
      ORDER BY id ASC`,
    [newspaperId],
  );
  return rows;
}

async function update(id, news) {
  const query = `
        UPDATE news_items
        SET
            newspaper_id=$1,
            title=$2,
            subheading=$3,
            description=$4,
            category=$5,
            location=$6,
            city=$7,
            tags=$8,
            reporter_name=$9,
            story_type=$10,
            editorial_priority=$11,
            desired_page_role=$12,
            image_urls=$13,
            status=$14
        WHERE id=$15
        RETURNING *;
    `;

  const values = [
    news.newspaper_id,
    news.title,
    news.subheading,
    news.description,
    news.category,
    news.location,
    news.city,
    news.tags,
    news.reporter_name,
    news.story_type,
    news.editorial_priority,
    news.desired_page_role || null,
    news.image_urls,
    news.status,
    id,
  ];

  const { rows } = await pool.query(query, values);

  return rows[0];
}

async function remove(id) {
  await pool.query(`DELETE FROM news_items WHERE id=$1`, [id]);
}

module.exports = {
  create,
  findAll,
  findById,
  findByStatus,
  findForComposition,
  update,
  remove,
};
