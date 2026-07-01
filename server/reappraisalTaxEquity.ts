import type { Pool } from "pg";
import { BUNCOMBE_ZIPS } from "./buncombeZips.js";

const YOY_FILTER = "change_pct BETWEEN -10 AND 400";

export type ReappraisalZipTaxEquity = {
  zip: string;
  name: string;
  median_change_pct: number;
  vs_county_median_pts: number;
  total_value_2026: number;
  under_assessed_value: number;
  over_assessed_value: number;
  imputed_annual_tax_shortfall: number;
  imputed_annual_tax_surplus: number;
  share_of_county_value_pct: number;
};

export type ReappraisalTaxEquity = {
  county_median_change_pct: number;
  zip_median_spread_pts: number;
  lowest_zip: { zip: string; name: string; median_change_pct: number } | null;
  highest_zip: { zip: string; name: string; median_change_pct: number } | null;
  /** Parcels below county-median % increase — counterfactual assessed value gap */
  under_assessed_value: number;
  /** Parcels above county-median % increase */
  over_assessed_value: number;
  net_value_gap: number;
  total_value_2026: number;
  under_assessed_share_pct: number;
  /** Median levy_due ÷ total_value from current tax roll */
  effective_tax_rate: number;
  effective_tax_rate_pct: number;
  imputed_annual_tax_shortfall: number;
  imputed_annual_tax_surplus: number;
  /** Value-weighted avg percentage points below county median (ZIP medians × 2026 value) */
  value_weighted_median_gap_pts: number;
  matched_parcels: number;
  methodology: string;
  zips: ReappraisalZipTaxEquity[];
};

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

async function medianEffectiveTaxRate(pool: Pool): Promise<number> {
  const { rows } = await pool.query(
    `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (
       ORDER BY levy_due::numeric / NULLIF(total_value, 0)
     ) AS rate
     FROM parceliq_parcels
     WHERE total_value > 0 AND levy_due IS NOT NULL AND levy_due::numeric > 0`,
  ).catch(() => ({ rows: [{ rate: 0.007066 }] }));
  const rate = Number(rows[0]?.rate ?? 0.007066);
  return rate > 0 ? rate : 0.007066;
}

export async function fetchReappraisalTaxEquity(pool: Pool): Promise<ReappraisalTaxEquity | null> {
  const hasTable = await tableExists(pool, "parceliq_yoy_change");
  if (!hasTable) return null;

  const zipCodes = Object.keys(BUNCOMBE_ZIPS);
  const effectiveTaxRate = await medianEffectiveTaxRate(pool);

  const [countyRes, parcelGapsRes, zipRes, spreadRes] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)::integer AS matched_parcels,
         ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY change_pct)::numeric, 2) AS county_median_change_pct,
         SUM(value_2026)::bigint AS total_value_2026
       FROM parceliq_yoy_change
       WHERE ${YOY_FILTER}`,
    ),
    pool.query(
      `WITH county AS (
         SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY change_pct) AS m
         FROM parceliq_yoy_change WHERE ${YOY_FILTER}
       ),
       base AS (
         SELECT value_2021, value_2026,
           value_2021 * (1 + (SELECT m FROM county) / 100.0) AS fair_2026_uniform
         FROM parceliq_yoy_change
         WHERE ${YOY_FILTER}
       )
       SELECT
         SUM(GREATEST(fair_2026_uniform - value_2026, 0))::bigint AS under_assessed_value,
         SUM(GREATEST(value_2026 - fair_2026_uniform, 0))::bigint AS over_assessed_value,
         SUM(fair_2026_uniform - value_2026)::bigint AS net_value_gap
       FROM base`,
    ),
    pool.query(
      `WITH county AS (
         SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY change_pct) AS m
         FROM parceliq_yoy_change WHERE ${YOY_FILTER}
       ),
       zip_medians AS (
         SELECT zipcode,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY change_pct) AS zip_median
         FROM parceliq_yoy_change
         WHERE ${YOY_FILTER} AND zipcode = ANY($1)
         GROUP BY zipcode
       ),
       parcel_gaps AS (
         SELECT y.zipcode, y.value_2026,
           GREATEST(y.value_2021 * (1 + (SELECT m FROM county) / 100.0) - y.value_2026, 0) AS under_gap,
           GREATEST(y.value_2026 - y.value_2021 * (1 + (SELECT m FROM county) / 100.0), 0) AS over_gap
         FROM parceliq_yoy_change y
         WHERE y.change_pct BETWEEN -10 AND 400 AND y.zipcode = ANY($1)
       )
       SELECT
         zm.zipcode,
         zm.zip_median,
         (SELECT m FROM county) - zm.zip_median AS vs_county_median_pts,
         SUM(pg.value_2026)::bigint AS total_value_2026,
         SUM(pg.under_gap)::bigint AS under_assessed_value,
         SUM(pg.over_gap)::bigint AS over_assessed_value
       FROM zip_medians zm
       JOIN parcel_gaps pg ON pg.zipcode = zm.zipcode
       GROUP BY zm.zipcode, zm.zip_median
       ORDER BY zm.zip_median ASC`,
      [zipCodes],
    ),
    pool.query(
      `SELECT MIN(median_change_pct) AS low_median, MAX(median_change_pct) AS high_median
       FROM (
         SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY change_pct) AS median_change_pct
         FROM parceliq_yoy_change
         WHERE ${YOY_FILTER} AND zipcode = ANY($1)
         GROUP BY zipcode
       ) z`,
      [zipCodes],
    ),
  ]);

  const countyRow = countyRes.rows[0];
  if (!countyRow) return null;

  const countyMedian = Number(countyRow.county_median_change_pct);
  const totalValue2026 = Number(countyRow.total_value_2026 ?? 0);
  const gaps = parcelGapsRes.rows[0] ?? {};
  const underAssessedValue = Number(gaps.under_assessed_value ?? 0);
  const overAssessedValue = Number(gaps.over_assessed_value ?? 0);
  const netValueGap = Number(gaps.net_value_gap ?? 0);

  const spreadRow = spreadRes.rows[0];
  const lowMedian = spreadRow?.low_median != null ? Number(spreadRow.low_median) : null;
  const highMedian = spreadRow?.high_median != null ? Number(spreadRow.high_median) : null;
  const zipMedianSpread =
    lowMedian != null && highMedian != null ? +(highMedian - lowMedian).toFixed(1) : 0;

  let valueWeightedGapNumerator = 0;
  const zips: ReappraisalZipTaxEquity[] = zipRes.rows.map((r) => {
    const vsCounty = Number(r.vs_county_median_pts);
    const total2026 = Number(r.total_value_2026);
    valueWeightedGapNumerator += vsCounty * total2026;
    const underVal = Number(r.under_assessed_value);
    const overVal = Number(r.over_assessed_value);
    const zip = String(r.zipcode);
    return {
      zip,
      name: BUNCOMBE_ZIPS[zip] ?? zip,
      median_change_pct: +Number(r.zip_median).toFixed(1),
      vs_county_median_pts: +vsCounty.toFixed(1),
      total_value_2026: total2026,
      under_assessed_value: underVal,
      over_assessed_value: overVal,
      imputed_annual_tax_shortfall: Math.round(underVal * effectiveTaxRate),
      imputed_annual_tax_surplus: Math.round(overVal * effectiveTaxRate),
      share_of_county_value_pct:
        totalValue2026 > 0 ? +((total2026 / totalValue2026) * 100).toFixed(1) : 0,
    };
  });

  const valueWeightedMedianGapPts =
    totalValue2026 > 0 ? +(valueWeightedGapNumerator / totalValue2026).toFixed(2) : 0;

  const lowest = zips[0] ?? null;
  const highest = zips[zips.length - 1] ?? null;

  const methodology =
    "Counterfactual: if every matched parcel's 2026 assessment had increased by the county median " +
    `reappraisal rate (+${countyMedian.toFixed(1)}%), parcels with smaller actual increases are ` +
    "relatively under-shifted. Under-assessed value is the sum of (uniform target − actual 2026) " +
    "for those parcels. Imputed annual tax uses the median effective levy rate from the tax roll " +
    "(levy due ÷ assessed value). This measures reappraisal uniformity, not market under-assessment.";

  return {
    county_median_change_pct: countyMedian,
    zip_median_spread_pts: zipMedianSpread,
    lowest_zip: lowest
      ? { zip: lowest.zip, name: lowest.name, median_change_pct: lowest.median_change_pct }
      : null,
    highest_zip: highest
      ? { zip: highest.zip, name: highest.name, median_change_pct: highest.median_change_pct }
      : null,
    under_assessed_value: underAssessedValue,
    over_assessed_value: overAssessedValue,
    net_value_gap: netValueGap,
    total_value_2026: totalValue2026,
    under_assessed_share_pct:
      totalValue2026 > 0 ? +((underAssessedValue / totalValue2026) * 100).toFixed(1) : 0,
    effective_tax_rate: effectiveTaxRate,
    effective_tax_rate_pct: +(effectiveTaxRate * 100).toFixed(3),
    imputed_annual_tax_shortfall: Math.round(underAssessedValue * effectiveTaxRate),
    imputed_annual_tax_surplus: Math.round(overAssessedValue * effectiveTaxRate),
    value_weighted_median_gap_pts: valueWeightedMedianGapPts,
    matched_parcels: Number(countyRow.matched_parcels),
    methodology,
    zips,
  };
}
