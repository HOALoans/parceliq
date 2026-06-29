export const ZIP_NAMES = {
  "28801": "Downtown Asheville",
  "28803": "Biltmore/South",
  "28804": "North Asheville",
  "28805": "East Asheville",
  "28806": "West Asheville",
  "28711": "Black Mountain",
  "28715": "Candler",
  "28730": "Fairview",
  "28732": "Fletcher",
  "28748": "Leicester",
  "28778": "Weaverville",
  "28787": "North Weaverville",
  "28704": "Arden",
};

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** @param {import("pg").Pool} pool */
export async function computeEquity(pool) {
  console.log("\n📊 Computing equity ratios by zip code...");
  const { rows } = await pool.query(`
    SELECT p.postal_code, p.total_value AS assessed, s.selling_price AS sale_price,
      CAST(p.total_value AS FLOAT) / NULLIF(s.selling_price, 0) AS ratio
    FROM parceliq_parcels p
    INNER JOIN (
      SELECT DISTINCT ON (pin) pin, selling_price, sell_date
      FROM parceliq_sales
      WHERE sell_date >= '2020-01-01' AND selling_price > 50000
        AND qualified = TRUE AND vacant_lot = FALSE
      ORDER BY pin, sell_date DESC
    ) s ON s.pin = p.pin
    WHERE p.total_value > 10000 AND p.postal_code IS NOT NULL AND p.postal_code != ''
      AND CAST(p.total_value AS FLOAT) / NULLIF(s.selling_price, 0) BETWEEN 0.1 AND 5.0
  `);
  console.log(`  Matched ${rows.length.toLocaleString()} parcels with recent sales`);

  const zipMap = new Map();
  for (const row of rows) {
    const zip = row.postal_code;
    if (!zipMap.has(zip)) zipMap.set(zip, []);
    zipMap.get(zip).push({
      assessed: Number(row.assessed),
      sale_price: Number(row.sale_price),
      ratio: Number(row.ratio),
    });
  }

  const buncombeZips = [...zipMap.entries()]
    .filter(([zip, items]) => zip.startsWith("28") && items.length >= 10)
    .sort((a, b) => a[0].localeCompare(b[0]));

  console.log("\n📈 Assessment Equity by ZIP Code:");
  console.log("ZIP      Name                         Median   Samples  Status");
  console.log("─".repeat(70));

  let zipsUpdated = 0;
  for (const [zip, items] of buncombeZips) {
    const ratios = items.map((x) => x.ratio);
    const med = median(ratios);
    const avgAssessed = Math.round(avg(items.map((x) => x.assessed)));
    const avgSale = Math.round(avg(items.map((x) => x.sale_price)));
    const flags = items.filter((x) => Math.abs(x.ratio - med) > 0.15).length;
    const flagRate = (flags / items.length) * 100;
    const risk = med < 0.75 ? "high" : med < 0.88 ? "moderate" : "healthy";
    const status = med < 0.75 ? "⬇ UNDER" : med > 1.1 ? "⬆ OVER" : "✓ Fair";
    const name = (ZIP_NAMES[zip] || "").padEnd(28);
    console.log(
      `${zip}  ${name} ${med.toFixed(3).padEnd(9)}${String(items.length).padStart(6)}  ${status}`
    );

    await pool.query(
      `INSERT INTO parceliq_zip_equity
        (zip_code, zip_name, median_ratio, sample_count, avg_assessed, avg_sale_price, flag_rate_pct, risk_level)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (zip_code) DO UPDATE SET
         zip_name = EXCLUDED.zip_name,
         median_ratio = EXCLUDED.median_ratio,
         sample_count = EXCLUDED.sample_count,
         avg_assessed = EXCLUDED.avg_assessed,
         avg_sale_price = EXCLUDED.avg_sale_price,
         flag_rate_pct = EXCLUDED.flag_rate_pct,
         risk_level = EXCLUDED.risk_level,
         updated_at = NOW()`,
      [zip, ZIP_NAMES[zip] || null, med.toFixed(4), items.length, avgAssessed, avgSale, flagRate.toFixed(2), risk]
    );
    zipsUpdated++;
  }

  const allRatios = rows.map((r) => Number(r.ratio)).filter((r) => r > 0.1 && r < 5);
  const countyMedian = allRatios.length ? median(allRatios) : null;
  if (countyMedian != null) {
    console.log(`\n🏛  County-wide median ratio: ${countyMedian.toFixed(3)}`);
    console.log(`   = County assesses at ${(countyMedian * 100).toFixed(1)}% of actual market value`);
  }

  return { zipsUpdated, countyMedian, matchedParcels: rows.length };
}

/** @param {import("pg").Pool} pool */
export async function updateParcelModelValues(pool) {
  console.log("\n🧠 Updating deed-ratio model values for all parcels...");
  const { rowCount } = await pool.query(`
    UPDATE parceliq_parcels p
    SET model_value = ROUND((p.total_value::NUMERIC / NULLIF(e.median_ratio, 0)))::INTEGER,
        variance_pct = ROUND(
          ((p.total_value::NUMERIC - (p.total_value::NUMERIC / NULLIF(e.median_ratio, 0)))
            / NULLIF((p.total_value::NUMERIC / NULLIF(e.median_ratio, 0)), 0)) * 100, 1)
    FROM parceliq_zip_equity e
    WHERE p.postal_code = e.zip_code AND p.total_value > 0 AND e.median_ratio > 0
  `);
  console.log(`✅ Updated ${(rowCount || 0).toLocaleString()} parcels with model values`);

  const { rows: samples } = await pool.query(`
    SELECT address, postal_code, total_value, model_value, variance_pct
    FROM parceliq_parcels
    WHERE model_value IS NOT NULL AND postal_code IN ('28801','28803','28804','28805','28806')
    ORDER BY ABS(variance_pct) DESC
    LIMIT 6
  `);
  console.log("\n🔍 Sample results:");
  for (const r of samples) {
    console.log(
      `  ${(r.address || "").slice(0, 35).padEnd(35)} Assessed:$${Number(r.total_value).toLocaleString().padStart(8)} Model:$${Number(r.model_value).toLocaleString().padStart(9)} Var:${r.variance_pct}%`
    );
  }

  return { parcelsUpdated: rowCount || 0 };
}
