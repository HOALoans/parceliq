import type { Pool } from "pg";
import { BUNCOMBE_ZIPS } from "./buncombeZips.js";
import { EFFECTIVE_ASSESSED_SQL, EQUITY_SAMPLE_SALES_SUBQUERY } from "./equitySampleSql.js";

export type CountyEquityQueueSort =
  | "deviation_asc"
  | "deviation_desc"
  | "ratio_asc"
  | "ratio_desc"
  | "assessed_desc"
  | "sale_desc";

export type CountyEquityReappraisalFilter =
  | "all"
  | "above_zip"
  | "below_zip"
  | "high_growth"
  | "low_growth";

const SORT_SQL: Record<CountyEquityQueueSort, string> = {
  deviation_asc: "ratio_vs_zip ASC NULLS LAST, ratio ASC",
  deviation_desc: "ratio_vs_zip DESC NULLS LAST, ratio DESC",
  ratio_asc: "ratio ASC",
  ratio_desc: "ratio DESC",
  assessed_desc: "assessed DESC",
  sale_desc: "sale_price DESC",
};

const BUNCOMBE_ZIP_LIST = Object.keys(BUNCOMBE_ZIPS);

function formatSellDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

export type CountyEquityQueueInput = {
  zip?: string;
  neighborhood?: string;
  reappraisal?: CountyEquityReappraisalFilter;
  minDeviationPts?: number;
  sort?: CountyEquityQueueSort;
  limit?: number;
  offset?: number;
};

export async function queryCountyEquityQueue(pool: Pool, input: CountyEquityQueueInput) {
  const sort = input.sort ?? "deviation_asc";
  const limit = input.limit ?? 100;
  const offset = input.offset ?? 0;
  const params: unknown[] = [BUNCOMBE_ZIP_LIST];
  let paramIdx = 2;

  let zipFilter = "AND p.postal_code = ANY($1::varchar[])";
  if (input.zip) {
    zipFilter += ` AND p.postal_code = $${paramIdx}`;
    params.push(input.zip);
    paramIdx++;
  }

  let neighborhoodFilter = "";
  if (input.neighborhood?.trim()) {
    neighborhoodFilter = ` AND (
      COALESCE(p.prc_neighborhood, y.neighborhood_code, p.subdivision, '') ILIKE $${paramIdx}
      OR p.subdivision ILIKE $${paramIdx}
    )`;
    params.push(`%${input.neighborhood.trim()}%`);
    paramIdx++;
  }

  let reappraisalFilter = "";
  switch (input.reappraisal ?? "all") {
    case "above_zip":
      reappraisalFilter =
        " AND y.change_pct IS NOT NULL AND y.change_pct > COALESCE(zm.zip_median_change, 0) + 5";
      break;
    case "below_zip":
      reappraisalFilter =
        " AND y.change_pct IS NOT NULL AND y.change_pct < COALESCE(zm.zip_median_change, 0) - 5";
      break;
    case "high_growth":
      reappraisalFilter = " AND y.change_pct IS NOT NULL AND y.change_pct >= 80";
      break;
    case "low_growth":
      reappraisalFilter = " AND y.change_pct IS NOT NULL AND y.change_pct < 50";
      break;
    default:
      break;
  }

  let deviationFilter = "";
  if (input.minDeviationPts != null && input.minDeviationPts > 0) {
    deviationFilter = ` AND ABS(ratio_vs_zip) >= $${paramIdx}`;
    params.push(input.minDeviationPts / 100);
    paramIdx++;
  }

  const baseFrom = `
    FROM parceliq_parcels p
    INNER JOIN (${EQUITY_SAMPLE_SALES_SUBQUERY}) s ON s.pin = p.pin
    LEFT JOIN parceliq_zip_equity e ON e.zip_code = p.postal_code
    LEFT JOIN parceliq_yoy_change y ON y.pin = p.pin
    LEFT JOIN (
      SELECT zipcode, ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY change_pct)::numeric, 2) AS zip_median_change
      FROM parceliq_yoy_change
      WHERE change_pct BETWEEN -10 AND 400
      GROUP BY zipcode
    ) zm ON zm.zipcode = y.zipcode
    WHERE ${EFFECTIVE_ASSESSED_SQL} > 10000
      AND p.postal_code IS NOT NULL AND p.postal_code != ''
      ${zipFilter}
      ${neighborhoodFilter}
      ${reappraisalFilter}
  `;

  const ratioExpr = `CAST(${EFFECTIVE_ASSESSED_SQL} AS FLOAT) / NULLIF(s.selling_price, 0)`;

  const dataSql = `
    WITH matched AS (
      SELECT
        p.pin,
        p.address,
        p.owner_name,
        p.postal_code,
        ${EFFECTIVE_ASSESSED_SQL} AS assessed,
        s.selling_price AS sale_price,
        s.sell_date,
        ${ratioExpr} AS ratio,
        e.median_ratio AS zip_median_ratio,
        CASE WHEN e.median_ratio IS NOT NULL THEN ${ratioExpr} - e.median_ratio ELSE NULL END AS ratio_vs_zip,
        COALESCE(p.prc_neighborhood, y.neighborhood_code, p.subdivision) AS neighborhood,
        p.subdivision,
        y.change_pct AS reappraisal_change_pct,
        zm.zip_median_change AS reappraisal_zip_median_pct
      ${baseFrom}
    )
    SELECT * FROM matched
    WHERE ratio BETWEEN 0.1 AND 5.0
      ${deviationFilter}
    ORDER BY ${SORT_SQL[sort]}
    LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
  `;

  const countSql = `
    WITH matched AS (
      SELECT
        ${ratioExpr} AS ratio,
        CASE WHEN e.median_ratio IS NOT NULL THEN ${ratioExpr} - e.median_ratio ELSE NULL END AS ratio_vs_zip
      ${baseFrom}
    )
    SELECT COUNT(*)::int AS total FROM matched
    WHERE ratio BETWEEN 0.1 AND 5.0
      ${deviationFilter}
  `;

  params.push(limit, offset);

  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query(dataSql, params),
    pool.query(countSql, params.slice(0, -2)),
  ]);

  return {
    parcels: rows.map((r) => {
      const ratio = Number(r.ratio);
      const zipMedian = r.zip_median_ratio != null ? Number(r.zip_median_ratio) : null;
      const ratioVsZip = r.ratio_vs_zip != null ? Number(r.ratio_vs_zip) : null;
      const owner = String(r.owner_name ?? "");
      return {
        pin: String(r.pin),
        address: String(r.address ?? ""),
        owner,
        zip: String(r.postal_code ?? ""),
        neighborhood: r.neighborhood != null ? String(r.neighborhood) : null,
        subdivision: r.subdivision != null ? String(r.subdivision) : null,
        assessed: Number(r.assessed),
        salePrice: Number(r.sale_price),
        sellDate: formatSellDate(r.sell_date),
        ratio: +ratio.toFixed(4),
        ratioPct: +(ratio * 100).toFixed(1),
        zipMedianRatio: zipMedian != null ? +zipMedian.toFixed(4) : null,
        zipMedianRatioPct: zipMedian != null ? +(zipMedian * 100).toFixed(1) : null,
        deviationFromZip: ratioVsZip != null ? +(ratioVsZip * 100).toFixed(1) : null,
        reappraisalChangePct: r.reappraisal_change_pct != null ? Number(r.reappraisal_change_pct) : null,
        reappraisalZipMedianPct:
          r.reappraisal_zip_median_pct != null ? Number(r.reappraisal_zip_median_pct) : null,
        likelyCommercial:
          /LLC|INC\.?|CORP|L\.?P\.?|TRUST|PARTNERS|HOLDINGS|PROPERTIES|REALTY|DEVELOPMENT|ENTERPRISES|ASSOCIATES|COMPANY|CO\./i.test(
            owner,
          ),
        reviewHint:
          ratioVsZip != null && ratioVsZip < -0.12
            ? "Below ZIP norm — possible under-assessment vs. peers"
            : ratioVsZip != null && ratioVsZip > 0.12
              ? "Above ZIP norm — appeal / equity review candidate"
              : "Near ZIP median ratio",
      };
    }),
    total: Number(countRows[0]?.total ?? 0),
  };
}
