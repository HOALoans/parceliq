import { z } from "zod";
import { router, publicProcedure } from "./_core/trpc.js";
import { pool, ensureTables } from "./db.js";
import { nanoid } from "nanoid";
import {
  modelValue, modelBreakdown, equityScore,
  type ParcelAttrs,
} from "./valuation.js";
import { buildValuationDetail, type ComparableSale, type ZipEquityRow, type MarketIndexRow } from "./valuationDetail.js";
import { buildDataFreshness } from "./assessmentFreshness.js";
import { loadPrcForParcel } from "./spatialestPrc.js";

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
  const assessed = Number(row.total_value ?? 0);
  if (row.zillow_adjusted_value != null) return Number(row.zillow_adjusted_value);
  if (row.model_value != null) return Number(row.model_value);
  return modelValue(attrs);
}

function enrichRow(row: Record<string, unknown>) {
  const attrs: ParcelAttrs = {
    CALCACREAGE:  row.acres   != null ? Number(row.acres)        : null,
    LANDVALUE:    null,
    TOTALVALUE:   row.total_value != null ? Number(row.total_value) : null,
    CLASSCD:      "R",
    ZIP:          row.postal_code as string ?? null,
    SITEADDRESS:  row.address as string ?? null,
  };
  const fairValue = fairValueFromRow(row, attrs);
  const cv = Number(row.total_value ?? 0);
  const vp =
    row.variance_pct != null
      ? Number(row.variance_pct)
      : fairValue && cv
        ? +(((cv - fairValue) / fairValue) * 100).toFixed(1)
        : null;
  return {
    PIN:          String(row.pin ?? ""),
    SITEADDRESS:  String(row.address ?? ""),
    OWNER:        String(row.owner_name ?? ""),
    CALCACREAGE:  row.acres != null ? Number(row.acres) : null,
    TOTALVALUE:   row.total_value != null ? Number(row.total_value) : null,
    LANDVALUE:    null as number | null,
    CLASSCD:      "R",
    POSTAL_CODE:  String(row.postal_code ?? ""),
    CITY:         String(row.city ?? ""),
    SUBDIVISION:  String(row.subdivision ?? ""),
    LEVY_DUE:     row.levy_due != null ? Number(row.levy_due) : null,
    model_value:  fairValue,
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
        source:        "ParcelIQ Database (Buncombe County 2025)",
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
      const [zipEquityRes, marketRes, salesRes, rodSyncRes] = await Promise.all([
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
        prc,
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

      return {
        ...enriched,
        model_value: valuation.fair_market_value,
        variance_pct: valuation.variance_pct,
        equity_score: valuation.variance_pct != null ? equityScore(valuation.variance_pct) : null,
        flagged: valuation.variance_pct != null && Math.abs(valuation.variance_pct) > 15,
        model_breakdown: valuation.model_breakdown,
        valuation,
        data_freshness: dataFreshness,
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
    const { rows } = await pool.query(
      "SELECT postal_code, total_value, acres FROM parceliq_parcels WHERE total_value > 0 ORDER BY RANDOM() LIMIT 500"
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));

    const buckets: Record<string, { name: string; items: { curr: number; mv: number; v: number }[]; flags: number }> = {
      "28801": { name: "Downtown Asheville", items: [], flags: 0 },
      "28803": { name: "Biltmore / South",   items: [], flags: 0 },
      "28804": { name: "North Asheville",    items: [], flags: 0 },
      "28805": { name: "East Asheville",     items: [], flags: 0 },
      "28806": { name: "West Asheville",     items: [], flags: 0 },
      "28711": { name: "Black Mountain",     items: [], flags: 0 },
    };
    const keys = Object.keys(buckets);

    rows.forEach((row, i) => {
      const zk = (row.postal_code as string) in buckets
        ? (row.postal_code as string)
        : keys[i % keys.length];
      const attrs: ParcelAttrs = { CALCACREAGE: Number(row.acres)||0.2, TOTALVALUE: Number(row.total_value), ZIP: zk };
      const mv = modelValue(attrs) ?? 0;
      const cv = Number(row.total_value ?? 0);
      const v  = mv ? (cv - mv) / mv * 100 : 0;
      buckets[zk].items.push({ curr: cv, mv, v });
      if (Math.abs(v) > 15) buckets[zk].flags++;
    });

    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const med = (arr: number[]) => { const s = [...arr].sort((a,b)=>a-b); return s[Math.floor(s.length/2)] ?? 0; };
    return {
      zipCodes: Object.entries(buckets).map(([zip, b]) => {
        const flagRate = b.items.length ? b.flags / b.items.length * 100 : 0;
        return { zip, name: b.name, parcelCount: b.items.length,
          avgAssessment: Math.round(avg(b.items.map(x => x.curr))),
          avgModelValue: Math.round(avg(b.items.map(x => x.mv))),
          medianVariancePct: +med(b.items.map(x => x.v)).toFixed(1),
          flagCount: b.flags, flagRatePct: +flagRate.toFixed(1),
          riskLevel: flagRate > 20 ? "high" : flagRate > 10 ? "moderate" : "healthy" };
      }),
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

  assessmentRatios: publicProcedure.query(async () => {
    const fallback = [
      { zip: "28801", area: "Downtown Asheville", ratio: 0.749 },
      { zip: "28803", area: "Biltmore/South",     ratio: 0.719 },
      { zip: "28804", area: "North Asheville",    ratio: 0.723 },
      { zip: "28805", area: "East Asheville",     ratio: 0.746 },
      { zip: "28806", area: "West Asheville",     ratio: 0.721 },
      { zip: "28711", area: "Black Mountain",     ratio: 0.727 },
    ];

    const { rows } = await pool.query(
      `SELECT zip_code, zip_name, median_ratio, sample_count
       FROM parceliq_zip_equity
       WHERE zip_code IN ('28801','28803','28804','28805','28806','28711')
       ORDER BY zip_code`
    ).catch(() => ({ rows: [] as Record<string, unknown>[] }));

    const zipCodes = rows.length
      ? rows.map((row) => ({
          zip: String(row.zip_code),
          area: String(row.zip_name ?? row.zip_code),
          ratio: Number(row.median_ratio),
          sampleCount: Number(row.sample_count ?? 0),
        }))
      : fallback;

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

  listCounties: publicProcedure.query(async () => {
    await ensureTables();
    const { rows } = await pool.query("SELECT * FROM parceliq_counties WHERE active=1 ORDER BY name ASC");
    return { counties: rows };
  }),
});

export type ParceliqRouter = typeof parceliqRouter;