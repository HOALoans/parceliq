import { pool } from "./db.js";

export type ReportStatus = "pending" | "paid" | "generated" | "sent" | "failed";

export async function ensureReportTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS parceliq_report_requests (
      id VARCHAR(32) PRIMARY KEY,
      pin VARCHAR(64) NOT NULL,
      address VARCHAR(255),
      email VARCHAR(255) NOT NULL,
      stripe_session_id VARCHAR(255) UNIQUE,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      pdf_path VARCHAR(512),
      error_message TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_report_requests_session
    ON parceliq_report_requests(stripe_session_id)
  `);
}

export async function insertReportRequest(opts: {
  id: string;
  pin: string;
  address: string | null;
  email: string;
  stripeSessionId: string;
}) {
  await pool.query(
    `INSERT INTO parceliq_report_requests (id, pin, address, email, stripe_session_id, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')`,
    [opts.id, opts.pin, opts.address, opts.email, opts.stripeSessionId],
  );
}

export async function findReportBySessionId(sessionId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM parceliq_report_requests WHERE stripe_session_id = $1 LIMIT 1`,
    [sessionId],
  );
  return rows[0] as Record<string, unknown> | undefined;
}

export async function findReportById(id: string) {
  const { rows } = await pool.query(
    `SELECT * FROM parceliq_report_requests WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] as Record<string, unknown> | undefined;
}

export async function updateReportStatus(
  id: string,
  status: ReportStatus,
  extras?: { pdfPath?: string; errorMessage?: string },
) {
  await pool.query(
    `UPDATE parceliq_report_requests
     SET status = $2,
         pdf_path = COALESCE($3, pdf_path),
         error_message = COALESCE($4, error_message),
         updated_at = NOW()
     WHERE id = $1`,
    [id, status, extras?.pdfPath ?? null, extras?.errorMessage ?? null],
  );
}
