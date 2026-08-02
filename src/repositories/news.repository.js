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
            image_urls,
            status,
            created_by
        )
        VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
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
            image_urls=$10,
            status=$11
        WHERE id=$12
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
  update,
  remove,
};
