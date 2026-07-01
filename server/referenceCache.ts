import type { Pool } from "pg";

const TTL_MS = 5 * 60 * 1000;

type Entry<T> = { value: T; expires: number };

let marketIndexEntry: Entry<Record<string, unknown> | null> | null = null;
const zipEquityEntries = new Map<string, Entry<Record<string, unknown> | null>>();
let rodSyncEntry: Entry<string | null> | null = null;

function fresh<T>(entry: Entry<T> | null | undefined): T | undefined {
  if (!entry || Date.now() >= entry.expires) return undefined;
  return entry.value;
}

export async function fetchCachedMarketIndexRow(
  pool: Pool,
): Promise<Record<string, unknown> | null> {
  const hit = fresh(marketIndexEntry);
  if (hit !== undefined) return hit;

  const { rows } = await pool
    .query(
      `SELECT metro_name, as_of_date, zhvi_current, zhvi_base, zhvi_base_date,
              median_sale_current, median_sale_base, appreciation_factor, source
       FROM parceliq_market_index ORDER BY created_at DESC LIMIT 1`,
    )
    .catch(() => ({ rows: [] as Record<string, unknown>[] }));

  const value = rows[0] ?? null;
  marketIndexEntry = { value, expires: Date.now() + TTL_MS };
  return value;
}

export async function fetchCachedZipEquityRow(
  pool: Pool,
  zip: string,
): Promise<Record<string, unknown> | null> {
  const hit = fresh(zipEquityEntries.get(zip));
  if (hit !== undefined) return hit;

  const { rows } = await pool
    .query(
      `SELECT zip_code, zip_name, median_ratio, sample_count, avg_assessed, avg_sale_price, updated_at
       FROM parceliq_zip_equity WHERE zip_code=$1 LIMIT 1`,
      [zip],
    )
    .catch(() => ({ rows: [] as Record<string, unknown>[] }));

  const value = rows[0] ?? null;
  zipEquityEntries.set(zip, { value, expires: Date.now() + TTL_MS });
  return value;
}

export async function fetchCachedRodSyncAt(pool: Pool): Promise<string | null> {
  const hit = fresh(rodSyncEntry);
  if (hit !== undefined) return hit;

  const { rows } = await pool
    .query(
      `SELECT finished_at FROM parceliq_ingest_runs
       WHERE job_name='register_of_deeds' AND status='success'
       ORDER BY finished_at DESC LIMIT 1`,
    )
    .catch(() => ({ rows: [] as Record<string, unknown>[] }));

  const raw = rows[0]?.finished_at;
  const value = raw != null ? String(raw) : null;
  rodSyncEntry = { value, expires: Date.now() + TTL_MS };
  return value;
}
