import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import type { Pool } from "pg";
import { BUNCOMBE_ZIPS } from "./buncombeZips.js";
import { EFFECTIVE_ASSESSED_SQL } from "./equitySampleSql.js";

const COUNTY_MEDIAN_CHANGE_PCT = 61.3;
const REPORTS_DIR = "/tmp/reports";

export type ReportData = {
  reportId: string;
  generatedAt: string;
  pin: string;
  address: string;
  owner: string;
  zip: string;
  zipName: string;
  value2021: number | null;
  value2026: number | null;
  changeAmt: number | null;
  changePct: number | null;
  vsZipMedianPts: number | null;
  zipMedianChangePct: number | null;
  countyMedianChangePct: number;
  verdict: string;
  zipMedianRatio: number | null;
  zipSampleCount: number | null;
  impliedFairValue: number | null;
  countyMedianRatio: number | null;
  appreciationFactor: number | null;
  zillowBaseDate: string | null;
  zillowAdjustedValue: number | null;
  assessmentGapPct: number | null;
  comps: Array<{
    address: string;
    sellDate: string;
    salePrice: number;
    assessed: number;
    ratioPct: number;
  }>;
};

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function fetchReportData(pool: Pool, pin: string, reportId: string): Promise<ReportData> {
  const { rows: parcelRows } = await pool.query(
    `SELECT * FROM parceliq_parcels WHERE pin = $1 OR REPLACE(pin, '-', '') = REPLACE($1, '-', '') LIMIT 1`,
    [pin],
  );
  const parcel = parcelRows[0] as Record<string, unknown> | undefined;
  if (!parcel) throw new Error(`Parcel ${pin} not found`);

  const zip = String(parcel.postal_code ?? "");
  const assessed = Number(parcel.prc_total_value ?? parcel.total_value ?? 0);

  const yoyRes = await pool.query(
    `SELECT value_2021, value_2026, change_amt, change_pct, zipcode, vs_zip_median_pts,
            zip_median_change_pct, county_median_change_pct
     FROM parceliq_yoy_change WHERE pin = $1 LIMIT 1`,
    [String(parcel.pin)],
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }));

  const yoy = yoyRes.rows[0] as Record<string, unknown> | undefined;

  const zipEquityRes = await pool.query(
    `SELECT zip_code, zip_name, median_ratio, sample_count, avg_assessed, avg_sale_price
     FROM parceliq_zip_equity WHERE zip_code = $1 LIMIT 1`,
    [zip],
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
  const zipEq = zipEquityRes.rows[0] as Record<string, unknown> | undefined;

  const marketRes = await pool.query(
    `SELECT appreciation_factor, zhvi_base_date, metro_name
     FROM parceliq_market_index ORDER BY created_at DESC LIMIT 1`,
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }));
  const market = marketRes.rows[0] as Record<string, unknown> | undefined;

  const compsRes = await pool.query(
    `SELECT s.address, s.sell_date, s.selling_price,
            ${EFFECTIVE_ASSESSED_SQL.replace(/p\./g, "p.")} AS assessed
     FROM parceliq_sales s
     INNER JOIN parceliq_parcels p ON p.pin = s.pin
     WHERE p.postal_code = $1
       AND s.pin != $2
       AND s.qualified = TRUE AND s.vacant_lot = FALSE
       AND s.sell_date >= '2020-01-01' AND s.selling_price > 0
     ORDER BY s.sell_date DESC
     LIMIT 8`,
    [zip, String(parcel.pin)],
  );

  const zipMedianRatio = zipEq?.median_ratio != null ? Number(zipEq.median_ratio) : null;
  const impliedFairValue =
    zipMedianRatio && assessed > 0 ? Math.round(assessed / zipMedianRatio) : null;
  const appreciationFactor = market?.appreciation_factor != null
    ? Number(market.appreciation_factor)
    : null;
  const zillowAdjustedValue =
    impliedFairValue && appreciationFactor
      ? Math.round(impliedFairValue * appreciationFactor)
      : null;

  const value2026 = yoy?.value_2026 != null
    ? Number(yoy.value_2026)
    : Number(parcel.prc_total_value ?? parcel.total_value ?? 0);
  const value2021 = yoy?.value_2021 != null ? Number(yoy.value_2021) : null;
  const changePct = yoy?.change_pct != null ? Number(yoy.change_pct) : null;
  const vsZip = yoy?.vs_zip_median_pts != null ? Number(yoy.vs_zip_median_pts) : null;

  let verdict = "Your assessment change appears in line with county and ZIP benchmarks.";
  if (vsZip != null && vsZip > 10) {
    verdict =
      "Your property's value review increase runs ahead of the typical home in your ZIP — a strong talking point if you believe the new value overshoots market evidence.";
  } else if (vsZip != null && vsZip < -10) {
    verdict =
      "Your property's value review increase trails the typical home in your ZIP — you may still appeal if market sales suggest the absolute value is too high.";
  } else if (changePct != null && changePct > COUNTY_MEDIAN_CHANGE_PCT + 15) {
    verdict =
      "Your percentage increase exceeds the county's typical reappraisal uplift — consider citing comparable sales that support a lower market value.";
  }

  const assessmentGapPct =
    zillowAdjustedValue && value2026
      ? +(((value2026 - zillowAdjustedValue) / zillowAdjustedValue) * 100).toFixed(1)
      : null;

  return {
    reportId,
    generatedAt: new Date().toISOString().slice(0, 10),
    pin: String(parcel.pin),
    address: String(parcel.address ?? ""),
    owner: String(parcel.owner_name ?? ""),
    zip,
    zipName: BUNCOMBE_ZIPS[zip] || String(zipEq?.zip_name ?? zip),
    value2021,
    value2026,
    changeAmt: yoy?.change_amt != null ? Number(yoy.change_amt) : null,
    changePct,
    vsZipMedianPts: vsZip,
    zipMedianChangePct: yoy?.zip_median_change_pct != null ? Number(yoy.zip_median_change_pct) : null,
    countyMedianChangePct: yoy?.county_median_change_pct != null
      ? Number(yoy.county_median_change_pct)
      : COUNTY_MEDIAN_CHANGE_PCT,
    verdict,
    zipMedianRatio,
    zipSampleCount: zipEq?.sample_count != null ? Number(zipEq.sample_count) : null,
    impliedFairValue,
    countyMedianRatio: 0.745,
    appreciationFactor,
    zillowBaseDate: market?.zhvi_base_date != null ? String(market.zhvi_base_date).slice(0, 10) : "2021-01-01",
    zillowAdjustedValue,
    assessmentGapPct,
    comps: compsRes.rows.map((r) => {
      const sale = Number(r.selling_price);
      const ass = Number(r.assessed ?? 0);
      return {
        address: String(r.address ?? "—"),
        sellDate: r.sell_date ? String(r.sell_date).slice(0, 10) : "—",
        salePrice: sale,
        assessed: ass,
        ratioPct: sale > 0 ? +((ass / sale) * 100).toFixed(1) : 0,
      };
    }),
  };
}

function reportStyles(): string {
  return `
    @page { size: letter; margin: 0.55in 0.6in; }
    * { box-sizing: border-box; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #1e293b; font-size: 11pt; line-height: 1.45; margin: 0; }
    .page { page-break-after: always; min-height: 9.5in; position: relative; }
    .page:last-child { page-break-after: auto; }
    .header { background: #0f172a; color: #fff; padding: 22px 28px; margin: -0.55in -0.6in 24px -0.6in; }
    .header h1 { margin: 0; font-size: 22pt; font-weight: 600; letter-spacing: -0.02em; }
    .header h1 span { color: #fbbf24; }
    .header .sub { color: #94a3b8; font-size: 9pt; margin-top: 6px; font-family: Arial, sans-serif; }
    h2 { font-size: 14pt; color: #0f172a; border-bottom: 2px solid #fbbf24; padding-bottom: 6px; margin: 0 0 14px; }
    h3 { font-size: 11pt; color: #334155; margin: 16px 0 8px; font-family: Arial, sans-serif; }
    p { margin: 0 0 10px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
    .stat { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 14px; }
    .stat label { display: block; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; font-family: Arial, sans-serif; }
    .stat .val { font-size: 16pt; font-weight: 700; color: #0f172a; margin-top: 4px; }
    .verdict { background: #fffbeb; border-left: 4px solid #f59e0b; padding: 14px 16px; margin: 16px 0; font-size: 10.5pt; }
    table { width: 100%; border-collapse: collapse; font-size: 9.5pt; font-family: Arial, sans-serif; margin: 12px 0; }
    th { background: #0f172a; color: #fff; text-align: left; padding: 8px 10px; font-weight: 600; }
    td { border-bottom: 1px solid #e2e8f0; padding: 8px 10px; vertical-align: top; }
    tr:nth-child(even) td { background: #f8fafc; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    ol.steps { padding-left: 20px; }
    ol.steps li { margin-bottom: 10px; }
    .footer { position: absolute; bottom: 0; left: 0; right: 0; font-size: 8pt; color: #94a3b8; font-family: Arial, sans-serif; border-top: 1px solid #e2e8f0; padding-top: 8px; }
    .disclaimer { font-size: 8.5pt; color: #64748b; line-height: 1.4; }
    .badge { display: inline-block; background: #fbbf24; color: #0f172a; font-size: 8pt; font-weight: 700; padding: 2px 8px; border-radius: 4px; font-family: Arial, sans-serif; }
  `;
}

export function buildReportHtml(data: ReportData): string {
  const appPct = data.appreciationFactor
    ? +((data.appreciationFactor - 1) * 100).toFixed(1)
    : 36.7;

  const compRows = data.comps.length
    ? data.comps
        .map(
          (c) => `<tr>
        <td>${esc(c.address)}</td>
        <td>${esc(c.sellDate)}</td>
        <td class="num">${money(c.salePrice)}</td>
        <td class="num">${money(c.assessed)}</td>
        <td class="num">${c.ratioPct}%</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="5">No qualified comparable sales found in ZIP ${esc(data.zip)}.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Parcelogik Appeal Report — ${esc(data.address)}</title>
  <style>${reportStyles()}</style>
</head>
<body>
  <!-- Page 1 -->
  <section class="page">
    <div class="header">
      <h1>Parcel<span>ogik</span> Appeal Report</h1>
      <div class="sub">Buncombe County Property Tax Appeal Evidence · Report ${esc(data.reportId)}</div>
    </div>
    <p><span class="badge">CONFIDENTIAL</span> Prepared for property owner review — not a licensed appraisal.</p>
    <h2>1. Property Summary</h2>
    <div class="grid">
      <div class="stat"><label>Address</label><div class="val" style="font-size:12pt">${esc(data.address)}</div></div>
      <div class="stat"><label>PIN</label><div class="val" style="font-size:12pt">${esc(data.pin)}</div></div>
      <div class="stat"><label>Owner of record</label><div class="val" style="font-size:11pt">${esc(data.owner)}</div></div>
      <div class="stat"><label>ZIP / Area</label><div class="val" style="font-size:11pt">${esc(data.zip)} · ${esc(data.zipName)}</div></div>
      <div class="stat"><label>2021 assessed value</label><div class="val">${money(data.value2021)}</div></div>
      <div class="stat"><label>2026 assessed value</label><div class="val">${money(data.value2026)}</div></div>
      <div class="stat"><label>Change ($)</label><div class="val">${money(data.changeAmt)}</div></div>
      <div class="stat"><label>Change (%)</label><div class="val">${pct(data.changePct)}</div></div>
      <div class="stat"><label>vs. ZIP median change</label><div class="val">${data.vsZipMedianPts != null ? `${data.vsZipMedianPts > 0 ? "+" : ""}${data.vsZipMedianPts.toFixed(1)} pts` : "—"}</div></div>
      <div class="stat"><label>vs. county median (+${COUNTY_MEDIAN_CHANGE_PCT}%)</label><div class="val">${data.changePct != null ? `${(data.changePct - COUNTY_MEDIAN_CHANGE_PCT).toFixed(1)} pts` : "—"}</div></div>
    </div>
    <div class="verdict"><strong>Plain-English verdict:</strong> ${esc(data.verdict)}</div>
    <div class="footer">Parcelogik.com · Page 1 of 6 · Generated ${esc(data.generatedAt)}</div>
  </section>

  <!-- Page 2 -->
  <section class="page">
    <div class="header">
      <h1>Comparable <span>Sales</span></h1>
      <div class="sub">${esc(data.address)} · PIN ${esc(data.pin)}</div>
    </div>
    <h2>2. Nearby Qualified Sales</h2>
    <p>Up to eight recent qualified Register of Deeds sales in ZIP ${esc(data.zip)} (same cohort used in Parcelogik equity studies). Use these to show whether your assessment aligns with real market transactions.</p>
    <table>
      <thead><tr><th>Address</th><th>Sale date</th><th class="num">Sale price</th><th class="num">Assessed</th><th class="num">Ratio</th></tr></thead>
      <tbody>${compRows}</tbody>
    </table>
    <p class="disclaimer">Ratio = county assessment ÷ sale price. Lower ratios often indicate assessments below market; higher ratios may support an over-assessment argument.</p>
    <div class="footer">Parcelogik.com · Page 2 of 6</div>
  </section>

  <!-- Page 3 -->
  <section class="page">
    <div class="header">
      <h1>ZIP <span>Equity</span></h1>
      <div class="sub">Uniformity context · ${esc(data.zipName)}</div>
    </div>
    <h2>3. ZIP Equity Context</h2>
    <div class="grid">
      <div class="stat"><label>ZIP median assessment-to-sale ratio</label><div class="val">${data.zipMedianRatio != null ? `${(data.zipMedianRatio * 100).toFixed(1)}%` : "—"}</div></div>
      <div class="stat"><label>Sales in ZIP equity sample</label><div class="val">${data.zipSampleCount ?? "—"}</div></div>
      <div class="stat"><label>Implied fair value (ratio method)</label><div class="val">${money(data.impliedFairValue)}</div></div>
      <div class="stat"><label>Your 2026 assessment</label><div class="val">${money(data.value2026)}</div></div>
    </div>
    <p>Applying the ZIP median ratio to your assessment yields an implied market value of <strong>${money(data.impliedFairValue)}</strong>. Compare this to your 2026 value of <strong>${money(data.value2026)}</strong> when arguing uniformity with neighbors.</p>
    <p>County-wide median ratio is approximately <strong>${data.countyMedianRatio != null ? `${(data.countyMedianRatio * 100).toFixed(1)}%` : "74.5%"}</strong> — your ZIP ${data.zipMedianRatio && data.countyMedianRatio && data.zipMedianRatio < data.countyMedianRatio ? "assesses lower relative to sales than" : "compares to"} the county average.</p>
    <div class="footer">Parcelogik.com · Page 3 of 6</div>
  </section>

  <!-- Page 4 -->
  <section class="page">
    <div class="header">
      <h1>Market <span>Trend</span></h1>
      <div class="sub">Regional appreciation context (ZHVI)</div>
    </div>
    <h2>4. Market Trend Adjustment</h2>
    <p>Asheville metro home values (Zillow Home Value Index) rose approximately <strong>+${appPct}%</strong> since ${esc(data.zillowBaseDate ?? "Jan 2021")} per Zillow Research data synced in Parcelogik.</p>
    <div class="grid">
      <div class="stat"><label>Ratio-implied base value</label><div class="val">${money(data.impliedFairValue)}</div></div>
      <div class="stat"><label>Zillow-adjusted estimate</label><div class="val">${money(data.zillowAdjustedValue)}</div></div>
      <div class="stat"><label>2026 county assessment</label><div class="val">${money(data.value2026)}</div></div>
      <div class="stat"><label>Gap vs. trend-adjusted estimate</label><div class="val">${data.assessmentGapPct != null ? pct(data.assessmentGapPct) : "—"}</div></div>
    </div>
    <p class="disclaimer">ZHVI is a regional index — not a Zestimate for this address. Use as supporting context alongside deed sales, not as a standalone appraisal.</p>
    <div class="footer">Parcelogik.com · Page 4 of 6</div>
  </section>

  <!-- Page 5 -->
  <section class="page">
    <div class="header">
      <h1>How to <span>Appeal</span></h1>
      <div class="sub">Buncombe County, North Carolina</div>
    </div>
    <h2>5. Buncombe County Appeal Process</h2>
    <ol class="steps">
      <li><strong>Review your Notice of Value</strong> — Confirm the 2026 assessed value and deadline printed on your county notice.</li>
      <li><strong>Gather evidence</strong> — Attach this report, qualified comparable sales, photos, and any recent appraisal or listing data.</li>
      <li><strong>File informally first</strong> — Contact Buncombe County Tax Assessment or use the online portal to request a review with the assessor's office.</li>
      <li><strong>Board of Equalization &amp; Review</strong> — If informal review is unsuccessful, appeal to the Board of Equalization and Review (BER) by the published deadline.</li>
      <li><strong>Present your case clearly</strong> — Focus on market evidence: "My assessment of ${money(data.value2026)} exceeds qualified sales of similar properties" or "My increase of ${pct(data.changePct)} exceeds my ZIP median of ${pct(data.zipMedianChangePct)}."</li>
      <li><strong>Submit forms</strong> — Use the county appeal resources at <strong>https://tax.buncombenc.gov</strong> (Appeals &amp; Exemptions section).</li>
    </ol>
    <div class="footer">Parcelogik.com · Page 5 of 6</div>
  </section>

  <!-- Page 6 -->
  <section class="page">
    <div class="header">
      <h1>Data &amp; <span>Methodology</span></h1>
      <div class="sub">Report ${esc(data.reportId)} · ${esc(data.generatedAt)}</div>
    </div>
    <h2>6. Data Sources &amp; Disclaimer</h2>
    <table>
      <thead><tr><th>Source</th><th>Use in this report</th></tr></thead>
      <tbody>
        <tr><td>Buncombe County tax roll / Spatialest PRC</td><td>2021 &amp; 2026 assessed values, owner, PIN</td></tr>
        <tr><td>NC Register of Deeds (qualified sales)</td><td>Comparable sales table, ZIP equity ratios</td></tr>
        <tr><td>Parcelogik reappraisal YoY dataset</td><td>Then vs. now change, ZIP/county medians</td></tr>
        <tr><td>Zillow Research (ZHVI)</td><td>Metro appreciation trend adjustment</td></tr>
        <tr><td>Parcelogik analytics engine</td><td>Ratio studies, comp selection, report assembly</td></tr>
      </tbody>
    </table>
    <p class="disclaimer" style="margin-top:16px">
      <strong>Disclaimer:</strong> Parcelogik provides research and analytical tools for property tax education and appeal preparation.
      This report is not a certified appraisal, legal advice, or guarantee of appeal outcome. Values and ratios reflect data available
      at generation time and may differ from the assessor's CAMA records. Verify all figures with official county sources before filing.
    </p>
    <p style="margin-top:24px;font-family:Arial,sans-serif;font-size:9pt;color:#64748b">
      © Parcelogik.com · Buncombe County, NC · Report ID ${esc(data.reportId)}
    </p>
    <div class="footer">Parcelogik.com · Page 6 of 6 · End of report</div>
  </section>
</body>
</html>`;
}

export async function generateReport(
  pool: Pool,
  pin: string,
  reportId: string,
): Promise<string> {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const data = await fetchReportData(pool, pin, reportId);
  const html = buildReportHtml(data);
  const safePin = pin.replace(/[^a-zA-Z0-9-]/g, "");
  const ts = Date.now();
  const pdfPath = path.join(REPORTS_DIR, `${safePin}-${ts}.pdf`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({
      path: pdfPath,
      format: "letter",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
  } finally {
    await browser.close();
  }

  return pdfPath;
}
