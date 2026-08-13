const pool = require('../config/db');

const ensureSql = `CREATE TABLE IF NOT EXISTS edition_composition_runs (
  run_id UUID PRIMARY KEY, edition_id INTEGER NOT NULL REFERENCES newspapers(id) ON DELETE CASCADE,
  plan_token_hash VARCHAR(128) NOT NULL, source_snapshot_hash VARCHAR(128) NOT NULL,
  baseline_fingerprint VARCHAR(128) NOT NULL, writer_transport VARCHAR(40) NOT NULL,
  state VARCHAR(40) NOT NULL, page_count INTEGER NOT NULL, writer_call_count INTEGER NOT NULL DEFAULT 0,
  completion_state VARCHAR(40), failure_code VARCHAR(100), committed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TIMESTAMPTZ
)`;
let ensured;
async function ensure(db = pool) { if (!ensured) ensured = db.query(ensureSql); await ensured; }
async function create(run, { tx } = {}) { const db = tx || pool; await ensure(db); const { rows } = await db.query(
  `INSERT INTO edition_composition_runs (run_id, edition_id, plan_token_hash, source_snapshot_hash, baseline_fingerprint, writer_transport, state, page_count)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
  [run.runId, run.editionId, run.planTokenHash, run.sourceSnapshotHash, run.baselineFingerprint, run.writerTransport, run.state, run.pageCount]); return rows[0]; }
async function update(runId, patch, { tx } = {}) { const db = tx || pool; await ensure(db); const { rows } = await db.query(
  `UPDATE edition_composition_runs SET state=COALESCE($2,state), writer_call_count=COALESCE($3,writer_call_count), completion_state=COALESCE($4,completion_state), failure_code=COALESCE($5,failure_code), committed_at=CASE WHEN $6 THEN CURRENT_TIMESTAMP ELSE committed_at END, finished_at=CASE WHEN $7 THEN CURRENT_TIMESTAMP ELSE finished_at END WHERE run_id=$1 RETURNING *`,
  [runId, patch.state ?? null, patch.writerCallCount ?? null, patch.completionState ?? null, patch.failureCode ?? null, patch.committed === true, patch.finished === true]); return rows[0] || null; }
async function recoverUnfinished(editionId) { await ensure(); const { rows } = await pool.query(
  `UPDATE edition_composition_runs SET state=CASE WHEN state='PREPARING' THEN 'BLOCKED' ELSE 'HUMAN_REQUIRED' END,
   failure_code=CASE WHEN state='PREPARING' THEN 'INTERRUPTED_BEFORE_PERSISTENCE' ELSE 'UNKNOWN_COMMIT_STATE' END, finished_at=CURRENT_TIMESTAMP
   WHERE edition_id=$1 AND state IN ('PREPARING','PREPARED','PERSISTING','VERIFYING') RETURNING *`, [editionId]); return rows; }
async function findById(runId) { await ensure(); const { rows } = await pool.query('SELECT * FROM edition_composition_runs WHERE run_id=$1', [runId]); return rows[0] || null; }
module.exports = { ensure, create, update, recoverUnfinished, findById };
