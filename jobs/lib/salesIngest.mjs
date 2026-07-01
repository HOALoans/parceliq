import fs from "fs";
import readline from "readline";

export function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else current += ch;
  }
  result.push(current);
  return result;
}

export function parseDate(str) {
  if (!str) return null;
  const d = str.slice(0, 10).replace(/\//g, "-");
  return d.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function parseSalesRow(headers, vals) {
  const row = {};
  headers.forEach((h, i) => {
    row[h] = (vals[i] || "").trim();
  });

  const pin = row.PINN?.trim();
  const price = parseInt(row.SellingPrice || "0", 10) || 0;
  const sellDate = parseDate(row.SellDate);
  const qualified = row.QualifiedSale?.trim().toUpperCase();

  if (!pin || price < 10000 || !sellDate || sellDate < "2015-01-01") return null;
  // Buncombe CSV uses Y / N / P — only arm's-length qualified sales belong in comps & fair value.
  if (qualified !== "Y") return null;

  return [
    pin,
    row.Address?.trim() || null,
    row.City?.trim() || null,
    sellDate,
    price,
    parseInt(row.AdjustedSalePrice || "0", 10) || null,
    true,
    row.DeedBook?.trim() || null,
    parseDate(row.DeedDate),
    row.VacantLot === "True",
  ];
}

const BATCH_UPSERT_SQL = `
  WITH upserted AS (
    INSERT INTO parceliq_sales (
      pin, address, city, sell_date, selling_price, adj_price,
      qualified, deed_book, deed_date, vacant_lot
    )
    SELECT * FROM UNNEST(
      $1::varchar[],
      $2::varchar[],
      $3::varchar[],
      $4::date[],
      $5::int[],
      $6::int[],
      $7::bool[],
      $8::varchar[],
      $9::date[],
      $10::bool[]
    )
    ON CONFLICT (pin, sell_date, selling_price, (COALESCE(deed_book, '')))
    DO UPDATE SET
      address = EXCLUDED.address,
      city = EXCLUDED.city,
      adj_price = EXCLUDED.adj_price,
      qualified = EXCLUDED.qualified,
      deed_date = EXCLUDED.deed_date,
      vacant_lot = EXCLUDED.vacant_lot
    RETURNING (xmax = 0) AS inserted
  )
  SELECT
    COUNT(*) FILTER (WHERE inserted) AS inserted,
    COUNT(*) FILTER (WHERE NOT inserted) AS updated
  FROM upserted
`;

export async function upsertSalesBatch(pool, batch) {
  if (!batch.length) return { inserted: 0, updated: 0 };

  // CSV may contain duplicate keys within a batch — keep last occurrence.
  const deduped = new Map();
  for (const row of batch) {
    const key = `${row[0]}|${row[3]}|${row[4]}|${row[7] ?? ""}`;
    deduped.set(key, row);
  }
  const uniqueRows = [...deduped.values()];
  if (!uniqueRows.length) return { inserted: 0, updated: 0 };

  const cols = Array.from({ length: 10 }, () => []);
  for (const row of uniqueRows) {
    for (let i = 0; i < 10; i++) cols[i].push(row[i]);
  }

  const { rows: counts } = await pool.query(BATCH_UPSERT_SQL, cols);
  return {
    inserted: Number(counts[0]?.inserted ?? 0),
    updated: Number(counts[0]?.updated ?? 0),
  };
}

/**
 * @param {import("pg").Pool} pool
 * @param {{ csvPath: string, fullReload?: boolean }} opts
 */
export async function ingestSalesCsv(pool, { csvPath, fullReload = false }) {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Sales CSV not found: ${csvPath}`);
  }

  console.log(`📂 ${fullReload ? "Full reload" : "Incremental sync"}: ${csvPath}`);

  if (fullReload) {
    await pool.query("TRUNCATE parceliq_sales");
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(csvPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let headers = null;
  let lineCount = 0;
  const batch = [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for await (const line of rl) {
    lineCount++;
    if (lineCount === 1) {
      headers = line.replace(/^\uFEFF/, "").split(",").map((h) => h.trim());
      continue;
    }

    const vals = parseCSVLine(line);
    if (vals.length < 5) {
      skipped++;
      continue;
    }

    const row = parseSalesRow(headers, vals);
    if (!row) {
      skipped++;
      continue;
    }

    batch.push(row);

    if (batch.length >= 500) {
      const counts = await upsertSalesBatch(pool, batch);
      inserted += counts.inserted;
      updated += counts.updated;
      batch.length = 0;
      const total = inserted + updated;
      if (total % 10000 < 500) {
        process.stdout.write(`\r  Upserted: ${total.toLocaleString()}`);
      }
    }
  }

  if (batch.length > 0) {
    const counts = await upsertSalesBatch(pool, batch);
    inserted += counts.inserted;
    updated += counts.updated;
  }

  console.log(
    `\n✅ Sales ingest: ${inserted.toLocaleString()} new, ${updated.toLocaleString()} updated, ${skipped.toLocaleString()} skipped`
  );

  return { inserted, updated, skipped, rowsProcessed: inserted + updated };
}
