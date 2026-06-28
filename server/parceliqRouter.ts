import { z } from "zod";
import { router, publicProcedure } from "./_core/trpc.js";
import { pool, ensureTables } from "./db.js";
import { nanoid } from "nanoid";
import {
  modelValue, modelBreakdown, equityScore,
  type ParcelAttrs,
} from "./valuation.js";

const GIS_URL = "https://services.arcgis.com/aJ16ENn1AaqdFlqx/arcgis/rest/services/Buncombe_Parcels/FeatureServer/0/query";

async function queryGis(params: Record<string, string>) {
  const qs = new URLSearchParams({ ...params, f: "json" }).toString();
  const res = await fetch(`${GIS_URL}?${qs}`, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`GIS HTTP ${res.status}`);
  const data = await res.json() as { features?: { attributes: Record<string, unknown> }[]; error?: { message: string }; exceededTransferLimit?: boolean };
  if (data.error) throw new Error(data.error.message);
  return data;
}

function enrichParcel(attrs: Record<string, unknown>) {
  const a = attrs as ParcelAttrs & Record<string, unknown>;
  const mv = modelValue(a);
  const cv = Number(a.TOTALVALUE ?? 0);
  const vp = mv && cv ? +((cv - mv) / mv * 100).toFixed(1) : null;
  return {
    PIN: String(a.PIN ?? ""), SITEADDRESS: String(a.SITEADDRESS ?? ""),
    OWNER: String(a.OWNER ?? ""), CALCACREAGE: a.CALCACREAGE != null ? Number(a.CALCACREAGE) : null,
    TOTALVALUE: a.TOTALVALUE != null ? Number(a.TOTALVALUE) : null,
    LANDVALUE: a.LANDVALUE != null ? Number(a.LANDVALUE) : null,
    CLASSCD: String(a.CLASSCD ?? ""), model_value: mv, variance_pct: vp,
    equity_score: vp != null ? equityScore(vp) : null, flagged: vp != null && Math.abs(vp) > 15,
  };
}

async function logEvent(eventType: string, parcelPin: string | null, userName: string, description: string, metadata: Record<string, unknown> = {}) {
  await ensureTables();
  await pool.query("INSERT INTO parceliq_audit (id,event_type,parcel_pin,user_name,description,metadata) VALUES ($1,$2,$3,$4,$5,$6)",
    [nanoid(), eventType, parcelPin, userName, description, JSON.stringify(metadata)]);
}

export const parceliqRouter = router({
  searchParcels: publicProcedure
    .input(z.object({ q: z.string().optional(), classCd: z.string().optional(), limit: z.number().min(1).max(200).default(25), offset: z.number().min(0).default(0) }))
    .query(async ({ input }) => {
      const conds: string[] = [];
      if (input.q) { const safe = input.q.replace(/'/g, "''").toUpperCase(); conds.push(`(UPPER(SITEADDRESS) LIKE '%${safe}%' OR UPPER(OWNER) LIKE '%${safe}%')`); }
      if (input.classCd) conds.push(`CLASSCD='${input.classCd.toUpperCase()}'`);
      const data = await queryGis({ where: conds.length ? conds.join(" AND ") : "1=1", outFields: "PIN,SITEADDRESS,OWNER,CALCACREAGE,TOTALVALUE,LANDVALUE,CLASSCD", returnGeometry: "false", resultRecordCount: String(input.limit), resultOffset: String(input.offset), orderByFields: "TOTALVALUE DESC" });
      return { parcels: (data.features ?? []).map(f => enrichParcel(f.attributes)), count: (data.features ?? []).length, exceededLimit: data.exceededTransferLimit ?? false };
    }),

  getParcel: publicProcedure
    .input(z.object({ pin: z.string().min(1) }))
    .query(async ({ input }) => {
      const data = await queryGis({ where: `PIN='${input.pin.replace(/'/g, "''")}'`, outFields: "*", returnGeometry: "false", resultRecordCount: "1" });
      const feat = data.features?.[0];
      if (!feat) throw new Error(`Parcel ${input.pin} not found`);
      const attrs = feat.attributes as ParcelAttrs & Record<string, unknown>;
      const mv = modelValue(attrs); const cv = Number(attrs.TOTALVALUE ?? 0);
      const vp = mv && cv ? +((cv - mv) / mv * 100).toFixed(1) : null;
      return { ...attrs, model_value: mv, model_breakdown: mv ? modelBreakdown(attrs, mv) : null, variance_pct: vp, equity_score: vp != null ? equityScore(vp) : null, flagged: vp != null && Math.abs(vp) > 15 };
    }),

  valueProperty: publicProcedure
    .input(z.object({ acres: z.number().optional(), landValue: z.number().optional(), totalValue: z.number().optional(), classCd: z.string().optional(), zip: z.string().optional(), address: z.string().optional() }))
    .mutation(async ({ input }) => {
      const attrs: ParcelAttrs = { CALCACREAGE: input.acres, LANDVALUE: input.landValue, TOTALVALUE: input.totalValue, CLASSCD: input.classCd, ZIP: input.zip, SITEADDRESS: input.address };
      const mv = modelValue(attrs);
      return { model_value: mv, breakdown: mv ? modelBreakdown(attrs, mv) : null };
    }),

  calcRevenue: publicProcedure
    .input(z.object({ targetRevenue: z.number().positive(), totalAssessedValue: z.number().positive().default(24_300_000_000), exemptions: z.number().min(0).default(1_200_000_000), collectionRate: z.number().min(0).max(1).default(0.97) }))
    .mutation(async ({ input }) => {
      const taxable = input.totalAssessedValue - input.exemptions;
      if (taxable <= 0) throw new Error("Exemptions exceed total assessed value");
      const millage = (input.targetRevenue / taxable) * 100;
      const projected = taxable * (millage / 100) * input.collectionRate;
      const avgBill = (214_500 / 100) * millage;
      const classes = { Residential: { share: 0.71, parcels: 89_412 }, Commercial: { share: 0.21, parcels: 14_220 }, Agricultural: { share: 0.06, parcels: 6_804 }, Industrial: { share: 0.02, parcels: 2_411 } };
      const classBreakdown = Object.fromEntries(Object.entries(classes).map(([cls, info]) => { const av = taxable * info.share; return [cls, { parcels: info.parcels, assessedValue: Math.round(av), estimatedRevenue: Math.round(av * (millage / 100) * input.collectionRate), sharePct: +(info.share * 100).toFixed(1) }]; }));
      return { targetRevenue: input.targetRevenue, taxableValue: Math.round(taxable), millageRateCents: +millage.toFixed(4), projectedCollection: Math.round(projected), gap: Math.round(projected - input.targetRevenue), avgTaxBillMedianHome: Math.round(avgBill), classBreakdown };
    }),

  equitySummary: publicProcedure.query(async () => {
    const data = await queryGis({ where: "1=1", outFields: "PIN,SITEADDRESS,TOTALVALUE,LANDVALUE,CLASSCD,CALCACREAGE", returnGeometry: "false", resultRecordCount: "200" }).catch(() => ({ features: [] as { attributes: Record<string, unknown> }[] }));
    const buckets: Record<string, { name: string; items: { curr: number; mv: number; v: number }[]; flags: number }> = {
      "28801": { name: "Downtown Asheville", items: [], flags: 0 }, "28803": { name: "Biltmore / South", items: [], flags: 0 },
      "28804": { name: "North Asheville", items: [], flags: 0 }, "28805": { name: "East Asheville", items: [], flags: 0 },
      "28806": { name: "West Asheville", items: [], flags: 0 }, "28711": { name: "Black Mountain", items: [], flags: 0 },
    };
    const keys = Object.keys(buckets);
    (data.features ?? []).forEach((f, i) => { const a = f.attributes as ParcelAttrs; const zk = keys[i % keys.length]; const mv = modelValue(a) ?? 0; const cv = Number(a.TOTALVALUE ?? 0); const v = mv ? (cv - mv) / mv * 100 : 0; buckets[zk].items.push({ curr: cv, mv, v }); if (Math.abs(v) > 15) buckets[zk].flags++; });
    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const med = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };
    return { zipCodes: Object.entries(buckets).map(([zip, b]) => { const flagRate = b.items.length ? b.flags / b.items.length * 100 : 0; return { zip, name: b.name, parcelCount: b.items.length, avgAssessment: Math.round(avg(b.items.map(x => x.curr))), avgModelValue: Math.round(avg(b.items.map(x => x.mv))), medianVariancePct: +med(b.items.map(x => x.v)).toFixed(1), flagCount: b.flags, flagRatePct: +flagRate.toFixed(1), riskLevel: flagRate > 20 ? "high" : flagRate > 10 ? "moderate" : "healthy" }; }) };
  }),

  listOverrides: publicProcedure
    .input(z.object({ status: z.string().optional() }))
    .query(async ({ input }) => {
      await ensureTables();
      const result = input.status ? await pool.query("SELECT * FROM parceliq_overrides WHERE status=$1 ORDER BY created_at DESC", [input.status]) : await pool.query("SELECT * FROM parceliq_overrides ORDER BY created_at DESC");
      return { overrides: result.rows };
    }),

  submitOverride: publicProcedure
    .input(z.object({ parcelPin: z.string().min(1), address: z.string().optional(), currentVal: z.number().optional(), proposedVal: z.number().optional(), modelVal: z.number().optional(), reason: z.string().optional(), submittedBy: z.string().default("Assessor") }))
    .mutation(async ({ input }) => {
      await ensureTables();
      const id = nanoid();
      await pool.query("INSERT INTO parceliq_overrides (id,parcel_pin,address,current_val,proposed_val,model_val,reason,submitted_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [id, input.parcelPin, input.address ?? null, input.currentVal ?? null, input.proposedVal ?? null, input.modelVal ?? null, input.reason ?? null, input.submittedBy]);
      await logEvent("override_submitted", input.parcelPin, input.submittedBy, `Override: $${input.currentVal?.toLocaleString()} → $${input.proposedVal?.toLocaleString()}`, { overrideId: id });
      return { id, status: "pending" as const };
    }),

  reviewOverride: publicProcedure
    .input(z.object({ id: z.string().min(1), action: z.enum(["approve", "reject"]), reviewedBy: z.string().default("Supervisor"), note: z.string().optional() }))
    .mutation(async ({ input }) => {
      await ensureTables();
      const status = input.action === "approve" ? "approved" : "rejected";
      const { rows } = await pool.query("SELECT parcel_pin FROM parceliq_overrides WHERE id=$1 LIMIT 1", [input.id]);
      if (!rows.length) throw new Error("Override not found");
      const pin = rows[0].parcel_pin as string;
      await pool.query("UPDATE parceliq_overrides SET status=$1,reviewed_by=$2,review_note=$3,reviewed_at=NOW() WHERE id=$4", [status, input.reviewedBy, input.note ?? "", input.id]);
      await logEvent(`override_${status}`, pin, input.reviewedBy, `Override ${status}. ${input.note ?? ""}`, { overrideId: input.id });
      return { id: input.id, status };
    }),

  getAudit: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      await ensureTables();
      const { rows } = await pool.query("SELECT * FROM parceliq_audit ORDER BY created_at DESC LIMIT $1", [input.limit]);
      return { events: rows };
    }),

  listCounties: publicProcedure.query(async () => {
    await ensureTables();
    const { rows } = await pool.query("SELECT * FROM parceliq_counties WHERE active=1 ORDER BY name ASC");
    return { counties: rows };
  }),
});

export type ParceliqRouter = typeof parceliqRouter;
