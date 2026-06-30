/**
 * Parcelogik.com — Buncombe County Data Loader
 * Run: node --experimental-specifier-resolution=node loadParcels.mjs
 *
 * Loads Buncombe_County_All_Property_Bills_from_2025.csv into Postgres.
 * Deduplicates by PIN keeping the highest total_value row.
 */

import "dotenv/config";
import fs from "fs";

import pkg from "pg";
import readline from "readline";
import path from "path";

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const CSV_PATH = process.argv[2] || "./Buncombe_County_All_Property_Bills_from_2025.csv";

async function run() {
  console.log("🏛  Parcelogik.com Data Loader — Buncombe County 2025");
  console.log(`📂 Reading: ${CSV_PATH}`);

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌ File not found: ${CSV_PATH}`);
    process.exit(1);
  }

  // Create parcel table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS parceliq_parcels (
      pin            VARCHAR(32)  PRIMARY KEY,
      address        VARCHAR(255),
      city           VARCHAR(64),
      postal_code    VARCHAR(10),
      owner_name     VARCHAR(255),
      acres          NUMERIC(10,4),
      total_value    INTEGER,
      real_value     INTEGER,
      exempt_value   INTEGER,
      levy_due       NUMERIC(12,2),
      tax_due        NUMERIC(12,2),
      subdivision    VARCHAR(128),
      township       VARCHAR(64),
      deed_date      VARCHAR(20),
      levy_year      INTEGER,
      street_name    VARCHAR(128),
      street_type    VARCHAR(32),
      house_num      VARCHAR(20),
      updated_at     TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log("✅ Table ready");

  // Read and parse CSV
  const fileStream = fs.createReadStream(CSV_PATH, { encoding: "utf8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let headers = null;
  const parcels = new Map(); // PIN -> best row
  let lineCount = 0;
  let skipped = 0;

  for await (const line of rl) {
    lineCount++;
    if (lineCount === 1) {
      // Parse headers (remove BOM)
      headers = line.replace(/^\uFEFF/, "").split(",").map(h => h.trim());
      continue;
    }

    // Simple CSV parse (handles basic cases)
    const values = parseCSVLine(line);
    if (values.length < headers.length) { skipped++; continue; }

    const row = {};
    headers.forEach((h, i) => { row[h] = (values[i] || "").trim(); });

    const pin = row.pin;
    if (!pin) { skipped++; continue; }

    const val = parseInt(row.total_value) || 0;

    // Keep highest-value row per PIN (deduplication)
    if (!parcels.has(pin) || val > (parseInt(parcels.get(pin).total_value) || 0)) {
      parcels.set(pin, row);
    }
  }

  console.log(`📊 Read ${lineCount.toLocaleString()} rows → ${parcels.size.toLocaleString()} unique PINs (${skipped} skipped)`);
  console.log("⬆️  Loading into Postgres…");

  // Batch insert
  const rows = Array.from(parcels.values());
  const BATCH = 500;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values = [];
    const placeholders = batch.map((row, idx) => {
      const base = idx * 17;
      const owner = [row.owner1_first_name, row.owner1_last_name]
        .filter(Boolean).join(" ").trim() || null;
      const addr = buildAddress(row);

      values.push(
        row.pin,
        addr,
        row.city || null,
        row.postal_code || null,
        owner,
        parseFloat(row.acres) || null,
        parseInt(row.total_value) || null,
        parseInt(row.real_value) || null,
        parseInt(row.exempt_value) || null,
        parseFloat(row.levy_due) || null,
        parseFloat(row.tax_due) || null,
        row.subdivision?.trim() || null,
        row.township?.trim() || null,
        row.deed_date || null,
        parseInt(row.levy_year) || null,
        row.street_name?.trim() || null,
        row.street_type?.trim() || null
      );

      return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11},$${base+12},$${base+13},$${base+14},$${base+15},$${base+16},$${base+17})`;
    });

    try {
      await pool.query(
        `INSERT INTO parceliq_parcels
          (pin,address,city,postal_code,owner_name,acres,total_value,real_value,exempt_value,levy_due,tax_due,subdivision,township,deed_date,levy_year,street_name,street_type)
         VALUES ${placeholders.join(",")}
         ON CONFLICT (pin) DO UPDATE SET
           total_value = GREATEST(parceliq_parcels.total_value, EXCLUDED.total_value),
           address = EXCLUDED.address,
           owner_name = EXCLUDED.owner_name,
           updated_at = NOW()`,
        values
      );
      inserted += batch.length;
    } catch (e) {
      errors++;
      console.error(`Batch error at ${i}:`, e.message);
    }

    if (inserted % 10000 < BATCH) {
      process.stdout.write(`\r  Progress: ${inserted.toLocaleString()} / ${rows.length.toLocaleString()}`);
    }
  }

  console.log(`\n✅ Loaded ${inserted.toLocaleString()} parcels (${errors} batch errors)`);

  // Verify
  const { rows: countRows } = await pool.query("SELECT COUNT(*) as c, AVG(total_value)::int as avg_val FROM parceliq_parcels WHERE total_value > 0");
  console.log(`📈 DB has ${parseInt(countRows[0].c).toLocaleString()} parcels, avg value $${parseInt(countRows[0].avg_val).toLocaleString()}`);

  // Sample
  const { rows: samples } = await pool.query(
    "SELECT pin, address, owner_name, total_value, postal_code FROM parceliq_parcels WHERE address ILIKE '%MERRIMON%' LIMIT 5"
  );
  console.log("\n🔍 Sample — MERRIMON results:");
  samples.forEach(r => console.log(`  ${r.pin} | ${r.address} | ${r.owner_name} | $${r.total_value?.toLocaleString()}`));

  await pool.end();
  console.log("\n🏁 Done!");
}

function buildAddress(row) {
  const parts = [
    row.house_num?.trim(),
    row.street_direction?.trim(),
    row.street_name?.trim(),
    row.street_type?.trim(),
  ].filter(Boolean);
  return parts.join(" ") || row.address_line1?.trim() || null;
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

run().catch(e => { console.error("Fatal:", e); process.exit(1); });
