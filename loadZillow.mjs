/**
 * ParcelIQ — Zillow Metro Data Integrator
 * 
 * Blends Zillow metro-level median sale price and ZHVI data
 * with our deed-based zip ratios to create a more accurate
 * market-adjusted valuation model.
 * 
 * Key insight: Buncombe last revalued in 2021. Asheville
 * home prices have risen 46% since then. This script applies
 * a Zillow-calibrated appreciation factor to each parcel's
 * model value to reflect TODAY'S market.
 * 
 * Usage: node --experimental-specifier-resolution=node loadZillow.mjs
 */

import "dotenv/config";
import fs from "fs";
import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const ZHVI_CSV   = "./Metro_zhvi_uc_sfrcondo_tier_0_33_0_67_month.csv";
const MEDIAN_CSV = "./Metro_median_sale_price_uc_sfr_month.csv";

// ── Parse CSV ─────────────────────────────────────────────────────────
function parseCSV(path) {
  const text = fs.readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split("\n").filter(l => l.trim());
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(",");
    const row = {};
    headers.forEach((h, i) => { row[h] = (vals[i] || "").trim(); });
    return row;
  });
}

// ── Extract Asheville metro data ──────────────────────────────────────
function getAsheville(rows) {
  return rows.find(r =>
    (r.RegionName || "").toLowerCase().includes("asheville")
  );
}

function getDateValue(row, dateStr) {
  const val = row[dateStr];
  return val ? parseFloat(val) : null;
}

function getLatestValue(row, headers) {
  const dateCols = headers.filter(h => h.match(/^\d{4}-\d{2}-\d{2}$/))
    .sort().reverse();
  for (const d of dateCols) {
    const v = row[d];
    if (v && v !== "") return { date: d, value: parseFloat(v) };
  }
  return null;
}

async function run() {
  console.log("🏛  ParcelIQ — Zillow Metro Data Integrator");
  console.log("═".repeat(50));

  // ── Load Zillow files ───────────────────────────────────────────
  if (!fs.existsSync(ZHVI_CSV) || !fs.existsSync(MEDIAN_CSV)) {
    console.error("❌ Missing CSV files. Place these in project root:");
    console.error("   " + ZHVI_CSV);
    console.error("   " + MEDIAN_CSV);
    process.exit(1);
  }

  const zhviRows   = parseCSV(ZHVI_CSV);
  const medianRows = parseCSV(MEDIAN_CSV);

  const zhviHeaders   = Object.keys(zhviRows[0]);
  const medianHeaders = Object.keys(medianRows[0]);

  const ashZhvi   = getAsheville(zhviRows);
  const ashMedian = getAsheville(medianRows);

  if (!ashZhvi || !ashMedian) {
    console.error("❌ Could not find Asheville row in CSV files");
    process.exit(1);
  }

  console.log("✅ Found Asheville, NC metro data");

  // ── Key data points ─────────────────────────────────────────────
  // Last revaluation: January 2021
  const REVAL_DATE = "2021-01-31";

  const zhvi2021   = getDateValue(ashZhvi,   REVAL_DATE);
  const median2021 = getDateValue(ashMedian, REVAL_DATE);

  const zhviNow   = getLatestValue(ashZhvi,   zhviHeaders);
  const medianNow = getLatestValue(ashMedian, medianHeaders);

  const zhviAppreciation   = zhviNow.value   / zhvi2021;
  const medianAppreciation = medianNow.value / median2021;

  // Blended appreciation factor (weight ZHVI more — it's smoother)
  const blendedAppreciation = (zhviAppreciation * 0.6) + (medianAppreciation * 0.4);

  console.log("\n📈 Asheville Metro Market Analysis:");
  console.log("   Since last Buncombe revaluation (Jan 2021):");
  console.log("   ZHVI:          $" + zhvi2021.toLocaleString() + " → $" + zhviNow.value.toLocaleString() + " (" + ((zhviAppreciation-1)*100).toFixed(1) + "% up)  as of " + zhviNow.date);
  console.log("   Median Sale:   $" + median2021.toLocaleString() + " → $" + medianNow.value.toLocaleString() + " (" + ((medianAppreciation-1)*100).toFixed(1) + "% up)  as of " + medianNow.date);
  console.log("   Blended factor: " + blendedAppreciation.toFixed(4) + "x  (" + ((blendedAppreciation-1)*100).toFixed(1) + "% total appreciation)");

  // ── Store Zillow metro stats ────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS parceliq_market_index (
      id                    SERIAL PRIMARY KEY,
      metro_name            VARCHAR(128),
      as_of_date            DATE,
      zhvi_current          INTEGER,
      zhvi_base             INTEGER,
      zhvi_base_date        DATE,
      median_sale_current   INTEGER,
      median_sale_base      INTEGER,
      appreciation_factor   NUMERIC(8,4),
      source                VARCHAR(64),
      created_at            TIMESTAMP DEFAULT NOW()
    )
  `).catch(() => {});

  await pool.query(`
    INSERT INTO parceliq_market_index
      (metro_name, as_of_date, zhvi_current, zhvi_base, zhvi_base_date,
       median_sale_current, median_sale_base, appreciation_factor, source)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT DO NOTHING
  `, [
    "Asheville, NC",
    zhviNow.date,
    Math.round(zhviNow.value),
    Math.round(zhvi2021),
    REVAL_DATE,
    Math.round(medianNow.value),
    Math.round(median2021),
    blendedAppreciation.toFixed(4),
    "Zillow Research",
  ]).catch(() => {});

  console.log("\n✅ Market index stored in database");

  // ── Apply appreciation to model values ──────────────────────────
  console.log("\n🧠 Applying Zillow appreciation factor to all parcel model values...");
  console.log("   Formula: Zillow-Adjusted Value = (Assessed ÷ Deed Ratio) × Appreciation Factor");
  console.log("   This gives today's estimated fair market value, not just 2021 value");

  await pool.query(`
    ALTER TABLE parceliq_parcels
    ADD COLUMN IF NOT EXISTS zillow_adjusted_value INTEGER,
    ADD COLUMN IF NOT EXISTS market_appreciation NUMERIC(6,4)
  `).catch(() => {});

  const { rowCount } = await pool.query(`
    UPDATE parceliq_parcels p
    SET
      zillow_adjusted_value = (
        (p.total_value::numeric / NULLIF(e.median_ratio, 0)) * $1
      )::integer,
      market_appreciation = $1,
      variance_pct = (
        (p.total_value::numeric - ((p.total_value::numeric / NULLIF(e.median_ratio, 0)) * $1))
        / NULLIF(((p.total_value::numeric / NULLIF(e.median_ratio, 0)) * $1), 0) * 100
      )::numeric(6,1)
    FROM parceliq_zip_equity e
    WHERE p.postal_code = e.zip_code
      AND p.total_value > 0
      AND e.median_ratio > 0
  `, [blendedAppreciation.toFixed(4)]);

  console.log("✅ Updated " + rowCount + " parcels with Zillow-adjusted values");

  // ── Sample results ───────────────────────────────────────────────
  const { rows: samples } = await pool.query(`
    SELECT
      address, postal_code, total_value,
      model_value, zillow_adjusted_value, variance_pct
    FROM parceliq_parcels
    WHERE zillow_adjusted_value IS NOT NULL
      AND postal_code IN ('28801','28803','28804','28805','28806')
      AND total_value BETWEEN 200000 AND 800000
    ORDER BY total_value DESC
    LIMIT 10
  `);

  console.log("\n📊 Sample Results — Blended Model:");
  console.log("Address                              ZIP    County Assessed  Deed Model  Zillow Model  Gap");
  console.log("─".repeat(100));
  for (const r of samples) {
    const addr = (r.address || "").slice(0, 35).padEnd(35);
    const gap = r.zillow_adjusted_value - r.total_value;
    const pct = ((gap / r.total_value) * 100).toFixed(0);
    console.log(
      addr + " " + r.postal_code + "  $" +
      Number(r.total_value).toLocaleString().padStart(9) + "  $" +
      Number(r.model_value).toLocaleString().padStart(9) + "  $" +
      Number(r.zillow_adjusted_value).toLocaleString().padStart(10) + "  +" + pct + "%"
    );
  }

  // ── Summary stats ────────────────────────────────────────────────
  const { rows: stats } = await pool.query(`
    SELECT
      COUNT(*) as total,
      AVG(total_value)::integer as avg_assessed,
      AVG(model_value)::integer as avg_deed_model,
      AVG(zillow_adjusted_value)::integer as avg_zillow_model,
      SUM(zillow_adjusted_value - total_value)::bigint as total_underassessment
    FROM parceliq_parcels
    WHERE zillow_adjusted_value IS NOT NULL AND total_value > 0
  `);

  const s = stats[0];
  const underassess = Number(s.total_underassessment);
  console.log("\n🏛  County-Wide Summary:");
  console.log("   Parcels analyzed:        " + Number(s.total).toLocaleString());
  console.log("   Avg county assessment:   $" + Number(s.avg_assessed).toLocaleString());
  console.log("   Avg deed-based model:    $" + Number(s.avg_deed_model).toLocaleString());
  console.log("   Avg Zillow-adj model:    $" + Number(s.avg_zillow_model).toLocaleString());
  console.log("   Total underassessment:   $" + (underassess/1e9).toFixed(2) + "B");
  console.log("   (This is the total market value not captured in the tax base)");

  await pool.end();
  console.log("\n🏁 Done! ParcelIQ now uses Zillow-calibrated market values.");
  console.log("   Push to GitHub and redeploy to see updated model values in the app.");
}

run().catch(e => { console.error("Fatal:", e); process.exit(1); });
