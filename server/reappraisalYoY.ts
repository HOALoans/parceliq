import type { Pool } from "pg";
import { BUNCOMBE_ZIPS } from "./buncombeZips.js";

export type ReappraisalYoY = {
  value_2021: number;
  value_2026: number;
  change_amt: number;
  change_pct: number;
  zipcode: string;
  zip_name: string | null;
  zip_median_change_pct: number | null;
  county_median_change_pct: number | null;
  neighborhood_code: string | null;
  land_use: string | null;
  vs_zip_median_pts: number | null;
};

const YOY_FILTER = "change_pct BETWEEN -10 AND 400";

async function tableExists(pool: Pool, table: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT EXISTS (
       SELECT FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [table],
  );
  return Boolean(rows[0]?.exists);
}

export async function fetchReappraisalYoY(
  pool: Pool,
  pin: string,
): Promise<ReappraisalYoY | null> {
  const hasTable = await tableExists(pool, "parceliq_yoy_change");
  if (!hasTable) return null;

  const { rows } = await pool.query(
    `SELECT
       y.pin,
       y.zipcode,
       y.neighborhood_code,
       y.land_use,
       y.value_2021,
       y.value_2026,
       y.change_amt,
       y.change_pct,
       (
         SELECT ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY change_pct)::numeric, 2)
         FROM parceliq_yoy_change
         WHERE zipcode = y.zipcode AND ${YOY_FILTER}
       ) AS zip_median_change_pct,
       (
         SELECT ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY change_pct)::numeric, 2)
         FROM parceliq_yoy_change
         WHERE ${YOY_FILTER}
       ) AS county_median_change_pct
     FROM parceliq_yoy_change y
     WHERE y.pin = $1
     LIMIT 1`,
    [pin],
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }));

  const row = rows[0];
  if (!row) return null;

  const changePct = Number(row.change_pct);
  const zipMedian =
    row.zip_median_change_pct != null ? Number(row.zip_median_change_pct) : null;

  return {
    value_2021: Number(row.value_2021),
    value_2026: Number(row.value_2026),
    change_amt: Number(row.change_amt),
    change_pct: changePct,
    zipcode: String(row.zipcode ?? ""),
    zip_name: BUNCOMBE_ZIPS[String(row.zipcode)] ?? null,
    zip_median_change_pct: zipMedian,
    county_median_change_pct:
      row.county_median_change_pct != null ? Number(row.county_median_change_pct) : null,
    neighborhood_code: row.neighborhood_code != null ? String(row.neighborhood_code) : null,
    land_use: row.land_use != null ? String(row.land_use) : null,
    vs_zip_median_pts:
      zipMedian != null ? +(changePct - zipMedian).toFixed(1) : null,
  };
}

export type ReappraisalZipSummary = {
  zip: string;
  name: string;
  parcel_count: number;
  median_change_pct: number;
  avg_2021: number;
  avg_2026: number;
};

export type ReappraisalCountySummary = {
  matched_parcels: number;
  county_median_change_pct: number;
  avg_2021: number;
  avg_2026: number;
};

export async function fetchReappraisalSummary(pool: Pool): Promise<{
  county: ReappraisalCountySummary | null;
  zips: ReappraisalZipSummary[];
}> {
  const hasTable = await tableExists(pool, "parceliq_yoy_change");
  if (!hasTable) return { county: null, zips: [] };

  const zipCodes = Object.keys(BUNCOMBE_ZIPS);

  const [countyRes, zipRes] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)::integer AS matched_parcels,
         ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY change_pct)::numeric, 2) AS county_median_change_pct,
         ROUND(AVG(value_2021))::integer AS avg_2021,
         ROUND(AVG(value_2026))::integer AS avg_2026
       FROM parceliq_yoy_change
       WHERE ${YOY_FILTER}`,
    ).catch(() => ({ rows: [] as Record<string, unknown>[] })),
    pool.query(
      `SELECT
         zipcode,
         COUNT(*)::integer AS parcel_count,
         ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY change_pct)::numeric, 2) AS median_change_pct,
         ROUND(AVG(value_2021))::integer AS avg_2021,
         ROUND(AVG(value_2026))::integer AS avg_2026
       FROM parceliq_yoy_change
       WHERE ${YOY_FILTER} AND zipcode = ANY($1)
       GROUP BY zipcode
       ORDER BY median_change_pct ASC`,
      [zipCodes],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] })),
  ]);

  const countyRow = countyRes.rows[0];
  const county = countyRow
    ? {
        matched_parcels: Number(countyRow.matched_parcels),
        county_median_change_pct: Number(countyRow.county_median_change_pct),
        avg_2021: Number(countyRow.avg_2021),
        avg_2026: Number(countyRow.avg_2026),
      }
    : null;

  const zips = zipRes.rows.map((r) => ({
    zip: String(r.zipcode),
    name: BUNCOMBE_ZIPS[String(r.zipcode)] ?? String(r.zipcode),
    parcel_count: Number(r.parcel_count),
    median_change_pct: Number(r.median_change_pct),
    avg_2021: Number(r.avg_2021),
    avg_2026: Number(r.avg_2026),
  }));

  return { county, zips };
}
