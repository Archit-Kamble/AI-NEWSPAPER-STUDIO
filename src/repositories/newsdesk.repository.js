// What this paper has already printed - the only thing duplicate detection
// needs from the database.
//
// Two questions, and they are genuinely different. "Is this story already on a
// page of the edition I am making up?" is about one newspaper_id. "Did we run
// this yesterday?" is about a date window, and it is the reason
// newspapers_publication_date_idx exists.
//
// Both return headlines and nothing else on purpose: a headline is what a
// duplicate check compares, bodies are large, and an edition being made up may
// hold a hundred blocks.

const pool = require('../config/db');

/** Every written block already on this edition's pages. */
async function placedInEdition(newspaperId) {
  const { rows } = await pool.query(
    `SELECT ps.section_key, p.page_number, ps.headline, ps.subheading
       FROM page_sections ps
       JOIN pages p ON p.id = ps.page_id
      WHERE p.newspaper_id = $1
        AND COALESCE(ps.headline, '') <> ''
      ORDER BY p.page_number, ps.section_key`,
    [newspaperId],
  );
  return rows;
}

/**
 * Headlines this paper ran in the days before an edition.
 *
 * Bounded by a date window rather than a row count: "what did we run
 * yesterday" is a question about days, and a paper with district editions
 * publishes several rows per date.
 */
async function printedBefore(newspaperId, { days = 7 } = {}) {
  const { rows } = await pool.query(
    `SELECT ps.headline, n.publication_date
       FROM page_sections ps
       JOIN pages p ON p.id = ps.page_id
       JOIN newspapers n ON n.id = p.newspaper_id
      WHERE n.id <> $1
        AND n.publication_date >= (
          SELECT publication_date - ($2 || ' days')::interval
            FROM newspapers WHERE id = $1
        )
        AND n.publication_date <= (SELECT publication_date FROM newspapers WHERE id = $1)
        AND COALESCE(ps.headline, '') <> ''
      ORDER BY n.publication_date DESC
      LIMIT 2000`,
    [newspaperId, String(days)],
  );
  return rows;
}

module.exports = { placedInEdition, printedBefore };
