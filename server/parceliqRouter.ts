import { z } from "zod";
import { router, publicProcedure } from "./_core/trpc.js";
import { pool, ensureTables } from "./db.js";
import { nanoid } from "nanoid";
import {
  modelValue, modelBreakdown, equityScore,
  type ParcelAttrs,
} from "./valuation.js";
import { buildValuationDetail, type ComparableSale, type ZipEquityRow, type MarketIndexRow, type NearbyComp } from "./valuationDetail.js";
import { buildDataFreshness } from "./assessmentFreshness.js";
import { loadPrcForParcel } from "./spatialestPrc.js";
import { buildSubjectProfile, fetchComparableSales } from "./comparableSales.js";
import { fetchReappraisalYoY, fetchReappraisalSummary } from "./reappraisalYoY.js";
import { fetchReappraisalTaxEquity } from "./reappraisalTaxEquity.js";
import { buildParcelNarrative } from "./parcelNarrative.js";
import { BUNCOMBE_ZIPS } from "./buncombeZips.js";
import { EQUITY_SAMPLE_JOIN } from "./equitySampleSql.js";

function toDateLabel(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function fairValueFromRow(row: Record<string, unknown>, attrs: ParcelAttrs): number | null {
  if (row.zillow_adjusted_value != null) return Number(row.zillow_adjusted_value);
  if (row.model_value != null) return Number(row.model_value);
  return modelValue(attrs);
}

function effectiveAssessed(row: Record<string, unknown>): number {
  const prc = row.prc_total_value != null ? Number(row.prc_total_value) : 0;
  const roll = Number(row.total_value ?? 0);
  return prc > 0 ? prc : roll;
}

function enrichRow(row: Record<string, unknown>) {
  const taxRoll = row.total_value != null ? Number(row.total_value) : null;
  const assessed = effectiveAssessed(row);
  const hasLivePrc = row.prc_total_value != null && Number(row.prc_total_value) > 0;
  const attrs: ParcelAttrs = {
    CALCACREAGE:  row.acres   != null ? Number(row.acres)        : null,
    LANDVALUE:    null,
    TOTALVALUE:   assessed > 0 ? assessed : null,
    CLASSCD:      "R",
    ZIP:          row.postal_code as string ?? null,
    SITEADDRESS:  row.address as string ?? null,
  };
  const prcRollMismatch =
    hasLivePrc && taxRoll != null && taxRoll > 0 && Math.abs(assessed - taxRoll) > taxRoll * 0.05;
  const fairValue = prcRollMismatch
    ? row.zillow_adjusted_value != null
      ? Number(row.zillow_adjusted_value)
      : null
    : fairValueFromRow(row, attrs);
  const cv = assessed;
  const vp =
    fairValue && cv
      ? +(((cv - fairValue) / fairValue) * 100).toFixed(1)
      : row.variance_pct != null && !prcRollMismatch
        ? Number(row.variance_pct)
        : null;
  return {
    PIN:          String(row.pin ?? ""),
    SITEADDRESS:  String(row.address ?? ""),
    OWNER:        String(row.owner_name ?? ""),
    CALCACREAGE:  row.acres != null ? Number(row.acres) : null,
    TOTALVALUE:   assessed > 0 ? assessed : null,
    tax_roll_value: taxRoll,
    assessment_source: hasLivePrc ? "prc" as const : "tax_roll" as const,
    LANDVALUE:    null as number | null,
    CLASSCD:      "R",
    POSTAL_CODE:  String(row.postal_code ?? ""),
    CITY:         String(row.city ?? ""),
    SUBDIVISION:  String(row.subdivision ?? ""),
    LEVY_DUE:     row.levy_due != null ? Number(row.levy_due) : null,
    model_value:  fairValue,
    estimate_stale: prcRollMismatch,
    zillow_adjusted_value: row.zillow_adjusted_value != null ? Number(row.zillow_adjusted_value) : null,
    variance_pct: vp,
    equity_score: vp != null ? equityScore(vp) : null,
    flagged:      vp != null && Math.abs(vp) > 15,
  };
}

async function logEvent(
  eventType: string, parcelPin: string | null, userName: string,
  description: string, metadata: Record<string, unknown> = {}
) {
  await ensureTables();
  await pool.query(
    "INSERT INTO parceliq_audit (id,event_type,parcel_pin,user_name,description,metadata) VALUES ($1,$2,$3,$4,$5,$6)",
    [nanoid(), eventType, parcelPin, userName, description, JSON.stringify(metadata)]
  );
}

export const parceliqRouter = router({

  searchParcels: publicProcedure
    .input(z.object({
      q:       z.string().optional(),
      classCd: z.string().optional(),
      limit:   z.number().min(1).max(200).default(25),
      offset:  z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      await ensureTables();

      const { rows: tableCheck } = await pool.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name='parceliq_parcels') as exists"
      );

      if (!tableCheck[0].exists) {
        return { parcels: [], count: 0, exceededLimit: false, source: "Database empty — run data loader" };
      }

      let query = "SELECT * FROM parceliq_parcels WHERE total_value > 0";
      const params: unknown[] = [];

      if (input.q) {
        params.push(`%${input.q.toUpperCase()}%`);
        query += ` AND (UPPER(address) LIKE $${params.length} OR UPPER(owner_name) LIKE $${params.length})`;
      }

      query += ` ORDER BY total_value DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(input.limit, input.offset);

      const { rows } = await pool.query(query, params);
      return {
        parcels:       rows.map(enrichRow),
        count:         rows.length,
        exceededLimit: rows.length === input.limit,
        source:        "Parcelogik Database (Buncombe County 2025)",
      };
    }),

  getParcel: publicProcedure
    .input(z.object({ pin: z.string().min(1) }))
    .query(async ({ input }) => {
      const pin = input.pin.trim();
      let { rows } = await pool.query(
        "SELECT * FROM parceliq_parcels WHERE pin=$1 LIMIT 1", [pin]
      );
      if (!rows.length) {
        const normalized = pin.replace(/-/g, "");
        ({ rows } = await pool.query(
          "SELECT * FROM parceliq_parcels WHERE REPLACE(pin, '-', '')=$1 LIMIT 1",
          [normalized]
        ));
      }
      if (!rows.length) throw new Error(`Parcel ${pin} not found`);
      const row = rows[0];

      const prc = await loadPrcForParcel(pool, String(row.pin), row).catch(() => null);

      const enriched = enrichRow(row);
      const attrs: ParcelAttrs = {
        CALCACREAGE: enriched.CALCACREAGE, LANDVALUE: null,
        TOTALVALUE: enriched.TOTALVALUE, CLASSCD: "R",
        ZIP: enriched.POSTAL_CODE, SITEADDRESS: enriched.SITEADDRESS,
      };

      const zip = enriched.POSTAL_CODE;
      const subject = buildSubjectProfile(row, prc);
      const [zipEquityRes, marketRes, salesRes, compMatch, reappraisalYoY, rodSyncRes] = await Promise.all([
        pool.query(
          "SELECT zip_code, zip_name, median_ratio, sample_count, avg_assessed, avg_sale_price, updated_at FROM parceliq_zip_equity WHERE zip_code=$1 LIMIT 1",
          [zip]
        ).catch(() => ({ rows: [] as Record<string, unknown>[] })),
        pool.query(
          "SELECT metro_name, as_of_date, zhvi_current, zhvi_base, zhvi_base_date, median_sale_current, median_sale_base, appreciation_factor, source FROM parceliq_market_index ORDER BY created_at DESC LIMIT 1"
        ).catch(() => ({ rows: [] as Record<string, unknown>[] })),
        pool.query(
          `SELECT sell_date, selling_price, adj_price, qualified
           FROM parceliq_sales WHERE pin=$1 AND qualified=TRUE
           ORDER BY sell_date DESC LIMIT 5`,
          [String(row.pin)]
        ).catch(() => ({ rows: [] as Record<string, unknown>[] })),
        fetchComparableSales(pool, subject),
        fetchReappraisalYoY(pool, String(row.pin)),
        pool.query(
          `SELECT finished_at FROM parceliq_ingest_runs
           WHERE job_name='register_of_deeds' AND status='success'
           ORDER BY finished_at DESC LIMIT 1`
        ).catch(() => ({ rows: [] as Record<string, unknown>[] })),
      ]);

      const zipEquity = zipEquityRes.rows[0] as ZipEquityRow | undefined;
      const marketIndex = marketRes.rows[0] as MarketIndexRow | undefined;
      const sales = salesRes.rows.map((s) => ({
        sell_date: s.sell_date ? String(s.sell_date).slice(0, 10) : null,
        selling_price: Number(s.selling_price),
        adj_price: s.adj_price != null ? Number(s.adj_price) : null,
        qualified: Boolean(s.qualified),
      })) as ComparableSale[];

      const nearbyComps = compMatch.comps;

      const valuation = buildValuationDetail(
        row,
        attrs,
        zipEquity
          ? {
              ...zipEquity,
              median_ratio: Number(zipEquity.median_ratio),
              sample_count: Number(zipEquity.sample_count),
              avg_assessed: zipEquity.avg_assessed != null ? Number(zipEquity.avg_assessed) : null,
              avg_sale_price: zipEquity.avg_sale_price != null ? Number(zipEquity.avg_sale_price) : null,
            }
          : null,
        marketIndex
          ? {
              ...marketIndex,
              zhvi_current: marketIndex.zhvi_current != null ? Number(marketIndex.zhvi_current) : null,
              zhvi_base: marketIndex.zhvi_base != null ? Number(marketIndex.zhvi_base) : null,
              median_sale_current: marketIndex.median_sale_current != null ? Number(marketIndex.median_sale_current) : null,
              median_sale_base: marketIndex.median_sale_base != null ? Number(marketIndex.median_sale_base) : null,
              appreciation_factor: Number(marketIndex.appreciation_factor),
            }
          : null,
        sales,
        nearbyComps,
        prc,
        {
          level: compMatch.matchLevel,
          summary: compMatch.matchSummary,
          filters_applied: compMatch.filtersApplied,
        },
      );

      const zipEquityUpdated = zipEquityRes.rows[0]?.updated_at;
      const rodSyncAt = rodSyncRes.rows[0]?.finished_at;
      const zillowAsOf = marketIndex?.as_of_date ?? marketRes.rows[0]?.as_of_date;

      const dataFreshness = buildDataFreshness(row, String(row.pin), sales, {
        salesDataAsOf: toDateLabel(rodSyncAt),
        zipEquityAsOf: toDateLabel(zipEquityUpdated),
        zillowAsOf: toDateLabel(zillowAsOf),
        prc,
      });

      const narrative = buildParcelNarrative({
        address: enriched.SITEADDRESS,
        pin: enriched.PIN,
        zip: enriched.POSTAL_CODE,
        owner: enriched.OWNER,
        valuation,
        reappraisalYoY,
        dataFreshness,
      });

      return {
        ...enriched,
        model_value: valuation.fair_market_value,
        variance_pct: valuation.variance_pct,
        equity_score: valuation.variance_pct != null ? equityScore(valuation.variance_pct) : null,
        flagged: valuation.variance_pct != null && Math.abs(valuation.variance_pct) > 15,
        model_breakdown: valuation.model_breakdown,
        valuation,
        data_freshness: dataFreshness,
        reappraisal_yoy: reappraisalYoY,
        narrative,
        levy_due:    row.levy_due,
        subdivision: row.subdivision,
        township:    row.township,
        deed_date:   row.deed_date,
        levy_year:   row.levy_year,
      };
    }),

  valueProperty: publicProcedure
    .input(z.object({
      acres: z.number().optional(), landValue: z.number().optional(),
      totalValue: z.number().optional(), classCd: z.string().optional(),
      zip: z.string().optional(), address: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const attrs: ParcelAttrs = {
        CALCACREAGE: input.acres, LANDVALUE: input.landValue,
        TOTALVALUE: input.totalValue, CLASSCD: input.classCd,
        ZIP: input.zip, SITEADDRESS: input.address,
      };
      const mv = modelValue(attrs);
      return { model_value: mv, breakdown: mv ? modelBreakdown(attrs, mv) : null };
    }),

  calcRevenue: publicProcedure
    .input(z.object({
      targetRevenue:      z.number().positive(),
      totalAssessedValue: z.number().positive().default(24_300_000_000),
      exemptions:         z.number().min(0).default(1_200_000_000),
      collectionRate:     z.number().min(0).max(1).default(0.97),
    }))
    .mutation(async ({ input }) => {
      const { rows } = await pool.query(
        "SELECT COALESCE(SUM(total_value),0)::bigint as total FROM parceliq_parcels WHERE total_value > 0"
      ).catch(() => ({ rows: [{ total: 0 }] }));
      const realTotal = Number(rows[0].total) || input.totalAssessedValue;
      const taxable = realTotal - input.exemptions;
      if (taxable <= 0) throw new Error("Exemptions exceed total assessed value");
      const millage   = (input.targetRevenue / taxable) * 100;
      const projected = taxable * (millage / 100) * input.collectionRate;
      const avgBill   = (214_500 / 100) * millage;
      const classes = {
        Residential: { share: 0.71, parcels: 89_412 },
        Commercial:  { share: 0.21, parcels: 14_220 },
        Agricultural:{ share: 0.06, parcels:  6_804 },
        Industrial:  { share: 0.02, parcels:  2_411 },
      };
      const classBreakdown = Object.fromEntries(
        Object.entries(classes).map(([cls, info]) => {
          const av = taxable * info.share;
          return [cls, { parcels: info.parcels, assessedValue: Math.round(av),
            estimatedRevenue: Math.round(av * (millage / 100) * input.collectionRate),
            sharePct: +(info.share * 100).toFixed(1) }];
        })
      );
      return {
        targetRevenue: input.targetRevenue, taxableValue: Math.round(taxable),
        totalAssessedValue: realTotal, millageRateCents: +millage.toFixed(4),
        projectedCollection: Math.round(projected),
        gap: Math.round(projected - input.targetRevenue),
        avgTaxBillMedianHome: Math.round(avgBill), classBreakdown,
      };
    }),

  equitySummary: publicProcedure.query(async () => {
    const { rows } = await pool.query(`
      SELECT zip_code, zip_name, median_ratio, sample_count,
             avg_assessed, avg_sale_price, flag_rate_pct, risk_level
      FROM parceliq_zip_equity
      WHERE zip_code = ANY($1)
      ORDER BY zip_code ASC
    `, [Object.keys(BUNCOMBE_ZIPS)]);

    const zipCodes = rows.map(r => ({
      zip:                r.zip_code,
      name:               BUNCOMBE_ZIPS[r.zip_code as string] || r.zip_name || r.zip_code,
      parcelCount:        Number(r.sample_count),
      avgAssessment:      Number(r.avg_assessed),
      avgModelValue:      Math.round(Number(r.avg_assessed) / Number(r.median_ratio)),
      medianVariancePct:  +(((1 / Number(r.median_ratio)) - 1) * -100).toFixed(1),
      medianRatio:        Number(r.median_ratio),
      flagCount:          Math.round(Number(r.sample_count) * Number(r.flag_rate_pct) / 100),
      flagRatePct:        Number(r.flag_rate_pct),
      riskLevel:          r.risk_level,
    }));

    const ratios = zipCodes.map(z => z.medianRatio).filter(r => r > 0);
    const minRatio = Math.min(...ratios);
    const maxRatio = Math.max(...ratios);
    const spread = +((maxRatio - minRatio) * 100).toFixed(1);

    return {
      zipCodes,
      summary: {
        zipCount: zipCodes.length,
        minRatio: +minRatio.toFixed(3),
        maxRatio: +maxRatio.toFixed(3),
        ratioSpreadPct: spread,
      },
    };
  }),

  listOverrides: publicProcedure
    .input(z.object({ status: z.string().optional() }))
    .query(async ({ input }) => {
      await ensureTables();
      const result = input.status
        ? await pool.query("SELECT * FROM parceliq_overrides WHERE status=$1 ORDER BY created_at DESC", [input.status])
        : await pool.query("SELECT * FROM parceliq_overrides ORDER BY created_at DESC");
      return { overrides: result.rows };
    }),

  submitOverride: publicProcedure
    .input(z.object({
      parcelPin: z.string().min(1), address: z.string().optional(),
      currentVal: z.number().optional(), proposedVal: z.number().optional(),
      modelVal: z.number().optional(), reason: z.string().optional(),
      submittedBy: z.string().default("Assessor"),
    }))
    .mutation(async ({ input }) => {
      await ensureTables();
      const id = nanoid();
      await pool.query(
        "INSERT INTO parceliq_overrides (id,parcel_pin,address,current_val,proposed_val,model_val,reason,submitted_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [id, input.parcelPin, input.address??null, input.currentVal??null,
         input.proposedVal??null, input.modelVal??null, input.reason??null, input.submittedBy]
      );
      await logEvent("override_submitted", input.parcelPin, input.submittedBy,
        `Override: $${input.currentVal?.toLocaleString()} → $${input.proposedVal?.toLocaleString()}`, { overrideId: id });
      return { id, status: "pending" as const };
    }),

  reviewOverride: publicProcedure
    .input(z.object({
      id: z.string().min(1), action: z.enum(["approve","reject"]),
      reviewedBy: z.string().default("Supervisor"), note: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await ensureTables();
      const status = input.action === "approve" ? "approved" : "rejected";
      const { rows } = await pool.query("SELECT parcel_pin FROM parceliq_overrides WHERE id=$1 LIMIT 1", [input.id]);
      if (!rows.length) throw new Error("Override not found");
      const pin = rows[0].parcel_pin as string;
      await pool.query(
        "UPDATE parceliq_overrides SET status=$1,reviewed_by=$2,review_note=$3,reviewed_at=NOW() WHERE id=$4",
        [status, input.reviewedBy, input.note??"", input.id]
      );
      await logEvent(`override_${status}`, pin, input.reviewedBy,
        `Override ${status}. ${input.note??""}`, { overrideId: input.id });
      return { id: input.id, status };
    }),

  getAudit: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      await ensureTables();
      const { rows } = await pool.query(
        "SELECT * FROM parceliq_audit ORDER BY created_at DESC LIMIT $1", [input.limit]
      );
      return { events: rows };
    }),

  zipEquitySample: publicProcedure
    .input(z.object({
      zip:    z.string().length(5),
      limit:  z.number().min(1).max(200).default(200),
      offset: z.number().min(0).default(0),
      sort:   z.enum(["ratio_asc", "ratio_desc", "assessed_desc", "sale_desc"]).default("ratio_asc"),
    }))
    .query(async ({ input }) => {
      if (!(input.zip in BUNCOMBE_ZIPS)) {
        throw new Error(`ZIP ${input.zip} is not in the Buncombe County analysis set`);
      }

      const orderBy = {
        ratio_asc:     "ratio ASC",
        ratio_desc:    "ratio DESC",
        assessed_desc: "assessed DESC",
        sale_desc:     "sale_price DESC",
      }[input.sort];

      const zipFilter = `AND p.postal_code = $1`;

      const [{ rows: summaryRows }, { rows }, { rows: countRows }] = await Promise.all([
        pool.query(
          `SELECT zip_code, zip_name, median_ratio, sample_count, avg_assessed, avg_sale_price, flag_rate_pct, risk_level
           FROM parceliq_zip_equity WHERE zip_code = $1 LIMIT 1`,
          [input.zip],
        ),
        pool.query(
          `SELECT p.pin, p.address, p.owner_name, p.postal_code, p.total_value AS assessed,
                  s.selling_price AS sale_price, s.sell_date,
                  CAST(p.total_value AS FLOAT) / NULLIF(s.selling_price, 0) AS ratio
           ${EQUITY_SAMPLE_JOIN}
           ${zipFilter}
           ORDER BY ${orderBy}
           LIMIT $2 OFFSET $3`,
          [input.zip, input.limit, input.offset],
        ),
        pool.query(
          `SELECT COUNT(*)::int AS total
           ${EQUITY_SAMPLE_JOIN}
           ${zipFilter}`,
          [input.zip],
        ),
      ]);

      const summary = summaryRows[0] as Record<string, unknown> | undefined;
      const medianRatio = summary ? Number(summary.median_ratio) : null;

      return {
        zip:     input.zip,
        zipName: BUNCOMBE_ZIPS[input.zip] || String(summary?.zip_name ?? input.zip),
        summary: summary
          ? {
              medianRatio,
              medianRatioPct: medianRatio != null ? +(medianRatio * 100).toFixed(1) : null,
              sampleCount:    Number(summary.sample_count),
              avgAssessed:    Number(summary.avg_assessed),
              avgSalePrice:   Number(summary.avg_sale_price),
              flagRatePct:    Number(summary.flag_rate_pct),
              riskLevel:      String(summary.risk_level),
            }
          : null,
        parcels: rows.map((r) => {
          const ratio = Number(r.ratio);
          const assessed = Number(r.assessed);
          const salePrice = Number(r.sale_price);
          const owner = String(r.owner_name ?? "");
          return {
            pin:         String(r.pin),
            address:     String(r.address ?? ""),
            owner,
            assessed,
            salePrice,
            sellDate:    r.sell_date ? String(r.sell_date).slice(0, 10) : null,
            ratio:       +ratio.toFixed(4),
            ratioPct:    +(ratio * 100).toFixed(1),
            variancePct: +((ratio - 1) * 100).toFixed(1),
            likelyCommercial: /LLC|INC\.?|CORP|L\.?P\.?|TRUST|PARTNERS|HOLDINGS|PROPERTIES|REALTY|DEVELOPMENT|ENTERPRISES|ASSOCIATES|COMPANY|CO\./i.test(owner),
          };
        }),
        total:         Number(countRows[0]?.total ?? 0),
        methodology:
          "Parcels with a qualified Register of Deeds sale since 2020 (most recent sale per PIN, excluding vacant lots). Same cohort used to compute ZIP median ratios.",
      };
    }),

  assessmentRatios: publicProcedure.query(async () => {
    const { rows } = await pool.query(
      `SELECT zip_code, zip_name, median_ratio, sample_count
       FROM parceliq_zip_equity
       WHERE zip_code = ANY($1)
       ORDER BY zip_code`,
      [Object.keys(BUNCOMBE_ZIPS)],
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));

    const zipCodes = rows.map((row) => ({
      zip: String(row.zip_code),
      area: BUNCOMBE_ZIPS[String(row.zip_code)] || String(row.zip_name ?? row.zip_code),
      ratio: Number(row.median_ratio),
      sampleCount: Number(row.sample_count ?? 0),
    }));

    const countyMedianRatio = zipCodes.length
      ? zipCodes.reduce((sum, z) => sum + z.ratio, 0) / zipCodes.length
      : 0.725;

    return {
      countyMedianRatio: +countyMedianRatio.toFixed(3),
      countyMedianPct: +(countyMedianRatio * 100).toFixed(1),
      zipCodes,
      source: rows.length ? "parceliq_zip_equity" : "reference",
    };
  }),

  reappraisalSummary: publicProcedure.query(async () => {
    const [summary, taxEquity] = await Promise.all([
      fetchReappraisalSummary(pool),
      fetchReappraisalTaxEquity(pool),
    ]);
    return {
      ...summary,
      tax_equity: taxEquity,
      source: "parceliq_yoy_change",
      cycle: "2021 → 2026",
    };
  }),

  listCounties: publicProcedure.query(async () => {
    await ensureTables();
    const { rows } = await pool.query("SELECT * FROM parceliq_counties WHERE active=1 ORDER BY name ASC");
    return { counties: rows };
  }),
});

export type ParceliqRouter = typeof parceliqRouter;