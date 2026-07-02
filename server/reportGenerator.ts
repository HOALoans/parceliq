import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import type { Pool } from "pg";
import { BUNCOMBE_ZIPS } from "./buncombeZips.js";
import { EFFECTIVE_ASSESSED_SQL } from "./equitySampleSql.js";
import { fetchReappraisalYoY } from "./reappraisalYoY.js";

const COUNTY_MEDIAN_CHANGE_PCT = 61.3;
const REPORTS_DIR = "/tmp/reports";

function formatReportDate(value: unknown): string {
  if (value == null || value === "") return "—";
  const dt = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

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
  medianCompSale: number | null;
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

  const yoy = await fetchReappraisalYoY(pool, String(parcel.pin));

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

  const value2026 = yoy?.value_2026 ?? Number(parcel.prc_total_value ?? parcel.total_value ?? 0);
  const value2021 = yoy?.value_2021 ?? null;
  const changeAmt =
    yoy?.change_amt ??
    (value2021 != null && value2026 ? value2026 - value2021 : null);
  const changePct =
    yoy?.change_pct ??
    (value2021 != null && value2021 > 0 && value2026
      ? +(((value2026 - value2021) / value2021) * 100).toFixed(1)
      : null);
  const vsZip = yoy?.vs_zip_median_pts ?? null;

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

  const compPrices = compsRes.rows
    .map((r) => Number(r.selling_price))
    .filter((p) => p > 0)
    .sort((a, b) => a - b);
  const medianCompSale =
    compPrices.length > 0
      ? compPrices[Math.floor(compPrices.length / 2)]
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
    changeAmt,
    changePct,
    vsZipMedianPts: vsZip,
    zipMedianChangePct: yoy?.zip_median_change_pct ?? null,
    countyMedianChangePct: yoy?.county_median_change_pct ?? COUNTY_MEDIAN_CHANGE_PCT,
    verdict,
    zipMedianRatio,
    zipSampleCount: zipEq?.sample_count != null ? Number(zipEq.sample_count) : null,
    impliedFairValue,
    countyMedianRatio: 0.745,
    appreciationFactor,
    zillowBaseDate: market?.zhvi_base_date != null ? formatReportDate(market.zhvi_base_date) : "Jan 2021",
    zillowAdjustedValue,
    assessmentGapPct,
    medianCompSale,
    comps: compsRes.rows.map((r) => {
      const sale = Number(r.selling_price);
      const ass = Number(r.assessed ?? 0);
      return {
        address: String(r.address ?? "—"),
        sellDate: formatReportDate(r.sell_date),
        salePrice: sale,
        assessed: ass,
        ratioPct: sale > 0 ? +((ass / sale) * 100).toFixed(1) : 0,
      };
    }),
  };
}

function reportStyles(): string {
  return `
    @page { size: letter; margin: 0; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; font-size: 10.5pt; line-height: 1.5; margin: 0; }
    .page { page-break-after: always; position: relative; min-height: 9.5in; }
    .page:last-child { page-break-after: auto; }
    .cover { border: 2px solid #0f172a; border-radius: 8px; overflow: hidden; margin-bottom: 20px; }
    .cover-top { background: #0f172a; color: #fff; padding: 28px 32px; }
    .cover-top .brand { font-size: 26pt; font-weight: 700; letter-spacing: -0.03em; font-family: Georgia, serif; }
    .cover-top .brand span { color: #fbbf24; }
    .cover-top .tagline { color: #94a3b8; font-size: 9.5pt; margin-top: 8px; }
    .cover-body { padding: 24px 32px; background: #f8fafc; }
    .cover-address { font-family: Georgia, serif; font-size: 20pt; font-weight: 600; color: #0f172a; margin: 0 0 4px; }
    .cover-meta { font-size: 9.5pt; color: #64748b; margin-bottom: 20px; }
    .section-head { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; padding-bottom: 10px; border-bottom: 3px solid #fbbf24; }
    .section-num { background: #0f172a; color: #fbbf24; font-size: 11pt; font-weight: 700; width: 32px; height: 32px; line-height: 32px; text-align: center; border-radius: 4px; flex-shrink: 0; }
    .section-title { font-family: Georgia, serif; font-size: 16pt; font-weight: 600; color: #0f172a; margin: 0; }
    h2 { font-size: 12pt; color: #334155; margin: 0 0 12px; font-weight: 600; }
    p { margin: 0 0 10px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
    .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 14px; }
    .stat { background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; }
    .stat label { display: block; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.07em; color: #64748b; font-weight: 600; }
    .stat .val { font-size: 14pt; font-weight: 700; color: #0f172a; margin-top: 3px; line-height: 1.2; }
    .stat .val.sm { font-size: 11pt; font-weight: 600; }
    .highlight { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 6px; padding: 14px 16px; margin: 14px 0; }
    .highlight strong { color: #92400e; }
    .verdict { background: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px 14px; margin: 14px 0; font-size: 10pt; }
    table { width: 100%; border-collapse: collapse; font-size: 9pt; margin: 10px 0 14px; }
    th { background: #0f172a; color: #fff; text-align: left; padding: 7px 9px; font-weight: 600; font-size: 8.5pt; }
    td { border-bottom: 1px solid #e2e8f0; padding: 7px 9px; vertical-align: top; }
    tr:nth-child(even) td { background: #f8fafc; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    ol.steps { padding-left: 18px; margin: 0; }
    ol.steps li { margin-bottom: 9px; }
    .footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 8pt; color: #94a3b8; }
    .disclaimer { font-size: 8.5pt; color: #64748b; line-height: 1.45; }
    .badge { display: inline-block; background: #fbbf24; color: #0f172a; font-size: 7.5pt; font-weight: 700; padding: 2px 7px; border-radius: 3px; letter-spacing: 0.04em; }
    .arrow-row { display: flex; align-items: center; justify-content: center; gap: 16px; margin: 16px 0; }
    .arrow-box { text-align: center; flex: 1; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; }
    .arrow-box .yr { font-size: 8pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; }
    .arrow-box .amt { font-size: 18pt; font-weight: 700; color: #0f172a; margin-top: 4px; }
    .arrow { font-size: 20pt; color: #f59e0b; font-weight: 700; }
  `;
}

function sectionHead(num: string, title: string): string {
  return `<div class="section-head"><div class="section-num">${num}</div><h1 class="section-title">${title}</h1></div>`;
}

function pageFooter(page: number, total: number, extra = ""): string {
  return `<div class="footer">Parcelogik.com · Buncombe County, NC · Page ${page} of ${total}${extra ? ` · ${extra}` : ""}</div>`;
}

function equityNarrative(data: ReportData): string {
  const parts: string[] = [];
  if (data.medianCompSale && data.value2026) {
    const gap = data.value2026 - data.medianCompSale;
    if (gap > 0) {
      parts.push(
        `Recent qualified sales in ZIP ${esc(data.zip)} median <strong>${money(data.medianCompSale)}</strong> — your 2026 assessment of <strong>${money(data.value2026)}</strong> is <strong>${money(gap)} higher</strong>. Cite the comparable sales table when arguing the assessed value exceeds market transactions.`,
      );
    }
  }
  if (data.impliedFairValue && data.value2026) {
    if (data.value2026 > data.impliedFairValue) {
      parts.push(
        `Your assessment exceeds the ZIP median ratio-implied value of <strong>${money(data.impliedFairValue)}</strong>, which may support an over-assessment uniformity argument.`,
      );
    } else {
      parts.push(
        `Your assessment of <strong>${money(data.value2026)}</strong> is below the ZIP ratio-implied value of <strong>${money(data.impliedFairValue)}</strong> — focus on specific comparable sales and property differences rather than ratio extrapolation alone.`,
      );
    }
  }
  return parts.join(" ");
}

export function buildReportHtml(data: ReportData): string {
  const appPct = data.appreciationFactor
    ? +((data.appreciationFactor - 1) * 100).toFixed(1)
    : 36.7;
  const totalPages = 6;
  const equityText = equityNarrative(data);

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

  const appealLine =
    data.changePct != null && data.zipMedianChangePct != null
      ? ` or "My increase of ${pct(data.changePct)} exceeds my ZIP median of ${pct(data.zipMedianChangePct)}."`
      : ".";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Parcelogik Appeal Report — ${esc(data.address)}</title>
  <style>${reportStyles()}</style>
</head>
<body>
  <section class="page">
    <div class="cover">
      <div class="cover-top">
        <div class="brand">Parcel<span>ogik</span></div>
        <div class="tagline">Buncombe County Property Tax Appeal Evidence · Report ${esc(data.reportId)}</div>
      </div>
      <div class="cover-body">
        <p class="cover-address">${esc(data.address)}</p>
        <p class="cover-meta">PIN ${esc(data.pin)} · ${esc(data.zip)} ${esc(data.zipName)} · Generated ${esc(data.generatedAt)}</p>
        <p style="margin-bottom:16px"><span class="badge">CONFIDENTIAL</span> <span style="font-size:9pt;color:#64748b">Prepared for property owner review — not a licensed appraisal.</span></p>
        <div class="arrow-row">
          <div class="arrow-box"><div class="yr">2021 assessed</div><div class="amt">${money(data.value2021)}</div></div>
          <div class="arrow">→</div>
          <div class="arrow-box"><div class="yr">2026 assessed</div><div class="amt">${money(data.value2026)}</div></div>
          <div class="arrow-box" style="border-color:#fcd34d;background:#fffbeb"><div class="yr">Change</div><div class="amt" style="color:#b45309">${pct(data.changePct)}</div></div>
        </div>
      </div>
    </div>
    <div class="grid-2">
      <div class="stat"><label>Owner of record</label><div class="val sm">${esc(data.owner)}</div></div>
      <div class="stat"><label>vs. ZIP median change</label><div class="val">${data.vsZipMedianPts != null ? `${data.vsZipMedianPts > 0 ? "+" : ""}${data.vsZipMedianPts.toFixed(1)} pts` : "—"}</div></div>
      <div class="stat"><label>ZIP median reappraisal</label><div class="val">${pct(data.zipMedianChangePct)}</div></div>
      <div class="stat"><label>vs. county median (+${data.countyMedianChangePct}%)</label><div class="val">${data.changePct != null ? `${(data.changePct - data.countyMedianChangePct).toFixed(1)} pts` : "—"}</div></div>
    </div>
    ${data.medianCompSale ? `<div class="highlight"><strong>Key finding:</strong> Median qualified sale in your ZIP is <strong>${money(data.medianCompSale)}</strong> vs. your assessment of <strong>${money(data.value2026)}</strong>.</div>` : ""}
    <div class="verdict"><strong>Summary:</strong> ${esc(data.verdict)}</div>
    ${pageFooter(1, totalPages, `Report ${esc(data.reportId)}`)}
  </section>

  <section class="page">
    ${sectionHead("2", "Comparable Sales")}
    <p>Eight recent qualified Register of Deeds sales in ZIP ${esc(data.zip)}. Use these to show whether your assessment aligns with real market transactions.</p>
    ${data.medianCompSale ? `<p><strong>Median sale price in table:</strong> ${money(data.medianCompSale)} · <strong>Your 2026 assessment:</strong> ${money(data.value2026)}</p>` : ""}
    <table>
      <thead><tr><th>Address</th><th>Sale date</th><th class="num">Sale price</th><th class="num">Assessed</th><th class="num">Ratio</th></tr></thead>
      <tbody>${compRows}</tbody>
    </table>
    <p class="disclaimer">Ratio = county assessment ÷ sale price. Compare properties similar in size, location, and condition to your home.</p>
    ${pageFooter(2, totalPages)}
  </section>

  <section class="page">
    ${sectionHead("3", "ZIP Equity Analysis")}
    <div class="grid-2">
      <div class="stat"><label>ZIP median assessment-to-sale ratio</label><div class="val">${data.zipMedianRatio != null ? `${(data.zipMedianRatio * 100).toFixed(1)}%` : "—"}</div></div>
      <div class="stat"><label>Sales in ZIP equity sample</label><div class="val">${data.zipSampleCount ?? "—"}</div></div>
      <div class="stat"><label>Ratio-implied market value</label><div class="val">${money(data.impliedFairValue)}</div></div>
      <div class="stat"><label>Your 2026 assessment</label><div class="val">${money(data.value2026)}</div></div>
    </div>
    ${equityText ? `<div class="highlight">${equityText}</div>` : ""}
    <p>County-wide median ratio is approximately <strong>${data.countyMedianRatio != null ? `${(data.countyMedianRatio * 100).toFixed(1)}%` : "74.5%"}</strong>.</p>
    ${pageFooter(3, totalPages)}
  </section>

  <section class="page">
    ${sectionHead("4", "Market Trend Context")}
    <p>Asheville metro home values (Zillow Home Value Index) rose approximately <strong>+${appPct}%</strong> since ${esc(data.zillowBaseDate ?? "Jan 2021")} per Zillow Research data in Parcelogik.</p>
    <div class="grid-2">
      <div class="stat"><label>Ratio-implied base value</label><div class="val">${money(data.impliedFairValue)}</div></div>
      <div class="stat"><label>Zillow-adjusted estimate</label><div class="val">${money(data.zillowAdjustedValue)}</div></div>
      <div class="stat"><label>2026 county assessment</label><div class="val">${money(data.value2026)}</div></div>
      <div class="stat"><label>Gap vs. trend-adjusted estimate</label><div class="val">${data.assessmentGapPct != null ? pct(data.assessmentGapPct) : "—"}</div></div>
    </div>
    <p class="disclaimer">ZHVI is a regional index — not a Zestimate for this address. Use as supporting context alongside deed sales, not as a standalone appraisal.</p>
    ${pageFooter(4, totalPages)}
  </section>

  <section class="page">
    ${sectionHead("5", "How to Appeal in Buncombe County")}
    <ol class="steps">
      <li><strong>Review your Notice of Value</strong> — Confirm the 2026 assessed value and deadline on your county notice.</li>
      <li><strong>Gather evidence</strong> — Attach this report, comparable sales, photos, and any recent appraisal or listing data.</li>
      <li><strong>File informally first</strong> — Contact Buncombe County Tax Assessment or use the online portal for an assessor review.</li>
      <li><strong>Board of Equalization &amp; Review</strong> — If informal review fails, appeal to the BER by the published deadline.</li>
      <li><strong>Present your case clearly</strong> — Focus on market evidence: "My assessment of ${money(data.value2026)} exceeds qualified sales of similar properties"${appealLine}</li>
      <li><strong>Submit forms</strong> — County resources: <strong>https://tax.buncombenc.gov</strong> (Appeals &amp; Exemptions).</li>
    </ol>
    ${pageFooter(5, totalPages)}
  </section>

  <section class="page">
    ${sectionHead("6", "Data Sources &amp; Disclaimer")}
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
    <p class="disclaimer" style="margin-top:14px">
      <strong>Disclaimer:</strong> Parcelogik provides research and analytical tools for property tax education and appeal preparation.
      This report is not a certified appraisal, legal advice, or guarantee of appeal outcome. Verify all figures with official county sources before filing.
    </p>
    <p style="margin-top:16px;font-size:9pt;color:#64748b">© Parcelogik.com · Report ID ${esc(data.reportId)}</p>
    ${pageFooter(6, totalPages, "End of report")}
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
      margin: { top: "0.65in", right: "0.7in", bottom: "0.7in", left: "0.7in" },
    });
  } finally {
    await browser.close();
  }

  return pdfPath;
}
