/** @param {import("pg").Pool} pool */
export async function startIngestRun(pool, jobName, sourceFile) {
  const { rows } = await pool.query(
    `INSERT INTO parceliq_ingest_runs (job_name, status, source_file)
     VALUES ($1, 'running', $2)
     RETURNING id`,
    [jobName, sourceFile]
  );
  return rows[0].id;
}

/** @param {import("pg").Pool} pool */
export async function finishIngestRun(pool, runId, result) {
  await pool.query(
    `UPDATE parceliq_ingest_runs SET
       finished_at = NOW(),
       status = $2,
       rows_inserted = $3,
       rows_updated = $4,
       error_message = $5,
       metadata = $6
     WHERE id = $1`,
    [
      runId,
      result.status,
      result.rowsInserted ?? 0,
      result.rowsUpdated ?? 0,
      result.errorMessage ?? null,
      result.metadata ? JSON.stringify(result.metadata) : null,
    ]
  );
}
