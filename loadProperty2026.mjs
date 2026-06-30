/**
 * Parcelogik.com — 2026 Reappraisal Data Loader
 * 
 * Loads Property.csv (2026 reappraisal values) into a new
 * parceliq_parcels_2026 table, preserving 2021 baseline data.
 * Also computes year-over-year change by parcel and by ZIP.
 * 
 * Usage: node --experimental-specifier-resolution=node loadProperty2026.mjs
 */

import "dotenv/config";
import fs from "fs";
import readline from "readline";
import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const CSV_PATH = process.argv[2] || "./Property.csv";

function parseCSVLine(line) {
  const result = []; let current = ""; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { result.push(current); current = ""; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

function normalizePin(pin) {
  // 2026 format: 963470749800000 -> 9634-70-7498-00000
  const p = pin.replace(/-/g, "").trim();
  if (p.length === 15) return `${p.slice(0,4)}-${p.slice(4,6)}-${p.slice(6,10)}-${p.slice(10,15)}`;
  return pin;
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS parceliq_parcels_2026 (
      pin                VARCHAR(32) PRIMARY KEY,
      owner              VARCHAR(255),
      address            VARCHAR(255),
      city               VARCHAR(64),
      zipcode            VARCHAR(10),
      acreage            NUMERIC(10,4),
      tax_year           SMALLINT,
      neighborhood_code  VARCHAR(20),
      land_use           VARCHAR(64),
      class              VARCHAR(10),
      total_market_value INTEGER,
      appraised_value    INTEGER,
      tax_value          INTEGER,
      land_value         INTEGER,
      building_value     INTEGER,
      sale_price         INTEGER,
      deed_date          VARCHAR(20),
      instrument         VARCHAR(20),
      prop_card_url      VARCHAR(512),
      update_date        VARCHAR(20),
      created_at         TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_2026_zip ON parceliq_parcels_2026(zipcode)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_2026_neighborhood ON parceliq_parcels_2026(neighborhood_code)`);

  // YoY change table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS parceliq_yoy_change (
      pin                VARCHAR(32) PRIMARY KEY,
      address            VARCHAR(255),
      zipcode            VARCHAR(10),
      neighborhood_code  VARCHAR(20),
      value_2021         INTEGER,
      value_2026         INTEGER,
      change_amt         BIGINT,
      change_pct         NUMERIC(8,2),
      land_use           VARCHAR(64),
      updated_at         TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_yoy_zip ON parceliq_yoy_change(zipcode)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_yoy_pct ON parceliq_yoy_change(change_pct)`);
  await pool.query(`
    ALTER TABLE parceliq_yoy_change
    ALTER COLUMN change_amt TYPE BIGINT
  `).catch(() => {});

  console.log("✅ Tables ready");
}

function dedupeBatchByPin(batch) {
  const byPin = new Map();
  for (const row of batch) byPin.set(row[0], row);
  return [...byPin.values()];
}

async function insertBatch(batch) {
  const unique = dedupeBatchByPin(batch);
  if (!unique.length) return 0;

  const ph = unique.map((_, i) => {
    const b = i * 20;
    return "(" + Array.from({ length: 20 }, (_, j) => "$" + (b + j + 1)).join(",") + ")";
  }).join(",");

  await pool.query(
    `INSERT INTO parceliq_parcels_2026
      (pin,owner,address,city,zipcode,acreage,tax_year,neighborhood_code,land_use,class,
       total_market_value,appraised_value,tax_value,land_value,building_value,sale_price,
       deed_date,instrument,prop_card_url,update_date)
     VALUES ${ph}
     ON CONFLICT (pin) DO UPDATE SET
       owner=EXCLUDED.owner,
       address=EXCLUDED.address,
       city=EXCLUDED.city,
       zipcode=EXCLUDED.zipcode,
       acreage=EXCLUDED.acreage,
       tax_year=EXCLUDED.tax_year,
       neighborhood_code=EXCLUDED.neighborhood_code,
       land_use=EXCLUDED.land_use,
       class=EXCLUDED.class,
       total_market_value=EXCLUDED.total_market_value,
       appraised_value=EXCLUDED.appraised_value,
       tax_value=EXCLUDED.tax_value,
       land_value=EXCLUDED.land_value,
       building_value=EXCLUDED.building_value,
       sale_price=EXCLUDED.sale_price,
       deed_date=EXCLUDED.deed_date,
       instrument=EXCLUDED.instrument,
       prop_card_url=EXCLUDED.prop_card_url,
       update_date=EXCLUDED.update_date`,
    unique.flat(),
  );
  return unique.length;
}

async function load2026() {
  console.log("📂 Loading: " + CSV_PATH);
  if (!fs.existsSync(CSV_PATH)) {
    console.error("❌ File not found: " + CSV_PATH); process.exit(1);
  }

  await pool.query("TRUNCATE parceliq_parcels_2026");

  const rl = readline.createInterface({
    input: fs.createReadStream(CSV_PATH, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let headers = null;
  let lineCount = 0;
  const batch = [];
  let inserted = 0;

  for await (const line of rl) {
    lineCount++;
    if (lineCount === 1) {
      headers = line.replace(/^\uFEFF/, "").split(",").map(h => h.trim());
      continue;
    }
    const vals = parseCSVLine(line);
    if (vals.length < 10) continue;
    const row = {};
    headers.forEach((h, i) => { row[h] = (vals[i] || "").trim(); });

    const pin = normalizePin(row.PIN || "");
    if (!pin) continue;

    const mv = parseInt(row.TotalMarketValue || "0") || 0;
    const av = parseInt(row.AppraisedValue || "0") || 0;
    const tv = parseInt(row.TaxValue || "0") || 0;
    const lv = parseInt(row.LandValue || "0") || 0;
    const bv = parseInt(row.BuildingValue || "0") || 0;
    const sp = parseInt(row.SalePrice || "0") || 0;

    // Build address from components
    const addr = [
      row.HouseNumber?.trim(),
      row.StreetPrefix?.trim(),
      row.StreetName?.trim(),
      row.StreetType?.trim(),
    ].filter(Boolean).join(" ") || row.Address?.trim() || null;

    batch.push([
      pin,
      row.Owner?.trim() || null,
      addr,
      row.CityName?.trim() || null,
      row.Zipcode?.trim() || null,
      parseFloat(row.Acreage || "0") || null,
      parseInt(row.TaxYear || "26") || 26,
      row.NeighborhoodCode?.trim() || null,
      row.LandUse?.trim() || null,
      row.Class?.trim() || null,
      mv || null,
      av || null,
      tv || null,
      lv || null,
      bv || null,
      sp || null,
      row.DeedDate?.trim() || null,
      row.Instrument?.trim() || null,
      row.PropCard?.trim() || null,
      row.UpdateDate?.trim() || null,
    ]);

    if (batch.length >= 500) {
      try {
        inserted += await insertBatch(batch);
      } catch (e) {
        console.error("Batch err:", e.message);
      }
      batch.length = 0;
      if (inserted % 10000 < 500) process.stdout.write("\r  Loaded: " + inserted.toLocaleString());
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    try {
      inserted += await insertBatch(batch);
    } catch (e) {
      console.error("Final batch err:", e.message);
    }
  }

  console.log("\n✅ Loaded " + inserted.toLocaleString() + " parcels into parceliq_parcels_2026");
  return inserted;
}

async function computeYoY() {
  console.log("\n📊 Computing year-over-year changes (2021 → 2026)...");

  await pool.query("TRUNCATE parceliq_yoy_change");

  const { rowCount } = await pool.query(`
    INSERT INTO parceliq_yoy_change
      (pin, address, zipcode, neighborhood_code, value_2021, value_2026,
       change_amt, change_pct, land_use)
    SELECT
      p26.pin,
      COALESCE(p26.address, p21.address)         as address,
      COALESCE(p26.zipcode, p21.postal_code)      as zipcode,
      p26.neighborhood_code,
      p21.total_value                             as value_2021,
      p26.total_market_value                      as value_2026,
      (p26.total_market_value::bigint - p21.total_value::bigint)  as change_amt,
      ROUND(((p26.total_market_value::numeric - p21.total_value::numeric)
        / NULLIF(p21.total_value::numeric, 0)) * 100, 2) as change_pct,
      p26.land_use
    FROM parceliq_parcels_2026 p26
    INNER JOIN parceliq_parcels p21 ON p21.pin = p26.pin
    WHERE p26.total_market_value > 0
      AND p21.total_value > 0
      AND p26.total_market_value::bigint < p21.total_value::bigint * 10
    ON CONFLICT (pin) DO UPDATE SET
      value_2026=EXCLUDED.value_2026, change_amt=EXCLUDED.change_amt,
      change_pct=EXCLUDED.change_pct, updated_at=NOW()
  `);

  console.log("✅ Year-over-year computed for " + (rowCount||0).toLocaleString() + " matched parcels");

  // Print equity findings
  const { rows } = await pool.query(`
    SELECT
      zipcode,
      COUNT(*)::integer                           as parcel_count,
      ROUND(AVG(value_2021))::integer             as avg_2021,
      ROUND(AVG(value_2026))::integer             as avg_2026,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP
        (ORDER BY change_pct)::numeric, 1)        as median_change_pct,
      ROUND(MIN(change_pct)::numeric, 1)          as min_change_pct,
      ROUND(MAX(change_pct)::numeric, 1)          as max_change_pct
    FROM parceliq_yoy_change
    WHERE change_pct BETWEEN -10 AND 400
      AND zipcode IN (
        '28801','28803','28804','28805','28806',
        '28711','28715','28704','28730','28748','28778','28787'
      )
    GROUP BY zipcode
    ORDER BY median_change_pct ASC
  `);

  const ZIP_NAMES = {
    '28801':'Downtown Asheville','28803':'Biltmore/South','28804':'North Asheville',
    '28805':'East Asheville','28806':'West Asheville','28711':'Black Mountain',
    '28715':'Candler','28704':'Arden','28730':'Fairview','28748':'Leicester',
    '28778':'Weaverville','28787':'N Weaverville',
  };

  console.log("\n📈 2021 → 2026 Assessment Change by ZIP (sorted by median increase):");
  console.log("ZIP      Area                       Count    Med 2021    Med 2026  Med Change  Story");
  console.log("─".repeat(90));

  for (const r of rows) {
    const name = (ZIP_NAMES[r.zipcode] || "").padEnd(26);
    const med = parseFloat(r.median_change_pct);
    const flag = med > 70 ? "⬆ DISPROPORTIONATE" : med < 55 ? "⬇ LOWER BURDEN" : "  Typical";
    console.log(
      r.zipcode + "  " + name + " " +
      r.parcel_count.toString().padStart(6) + "  $" +
      Number(r.avg_2021).toLocaleString().padStart(9) + "  $" +
      Number(r.avg_2026).toLocaleString().padStart(9) + "  " +
      (med + "%").padStart(9) + "  " + flag
    );
  }

  // Overall stats
  const { rows: totals } = await pool.query(`
    SELECT
      COUNT(*)::integer as total,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY change_pct)::numeric,1) as county_median,
      ROUND(AVG(value_2021))::integer as avg_2021,
      ROUND(AVG(value_2026))::integer as avg_2026,
      SUM(change_amt)::bigint as total_new_value
    FROM parceliq_yoy_change
    WHERE change_pct BETWEEN -10 AND 400
  `);

  const t = totals[0];
  console.log("\n🏛  County-Wide Summary:");
  console.log("   Matched parcels:       " + Number(t.total).toLocaleString());
  console.log("   County median change:  +" + t.county_median + "%");
  console.log("   Avg assessment 2021:   $" + Number(t.avg_2021).toLocaleString());
  console.log("   Avg assessment 2026:   $" + Number(t.avg_2026).toLocaleString());
  console.log("   New tax base added:    $" + (Number(t.total_new_value)/1e9).toFixed(2) + "B");
}

async function run() {
  console.log("🏛  Parcelogik.com — 2026 Reappraisal Loader");
  console.log("═".repeat(50));
  await ensureTables();
  await load2026();
  await computeYoY();
  await pool.end();
  console.log("\n🏁 Done! 2026 data loaded. Both years now live in the database.");
  console.log("   Tables: parceliq_parcels (2021) | parceliq_parcels_2026 (2026) | parceliq_yoy_change (delta)");
}

run().catch(e => { console.error("Fatal:", e); process.exit(1); });
