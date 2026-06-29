/**
 * ParcelIQ — Weekly NC Register of Deeds sales sync
 *
 * Incremental upsert of qualified sales, ZIP equity recompute, deed-ratio model refresh.
 *
 * Usage:
 *   node jobs/syncRegisterOfDeeds.mjs
 *   node jobs/syncRegisterOfDeeds.mjs --full-reload
 *   node jobs/syncRegisterOfDeeds.mjs ./path/to/sales.csv
 *
 * Env:
 *   DATABASE_URL   — Postgres connection (required)
 *   ROD_CSV_URL    — optional HTTP(S) URL to download latest sales CSV
 *   ROD_CSV_PATH   — default local CSV path if no arg/URL
 */

import fs from "fs";
import os from "os";
import path from "path";
import { createPool } from "./lib/db.mjs";
import { ensureRodSchema } from "./lib/ensureSchema.mjs";
import { ingestSalesCsv } from "./lib/salesIngest.mjs";
import { computeEquity, updateParcelModelValues } from "./lib/equityCompute.mjs";
import { startIngestRun, finishIngestRun } from "./lib/ingestLog.mjs";

const JOB_NAME = "register_of_deeds";

async function downloadCsv(url) {
  console.log(`⬇️  Downloading sales CSV from ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ROD_CSV_URL fetch failed: ${res.status} ${res.statusText}`);
  }
  const dest = path.join(os.tmpdir(), `parceliq-rod-${Date.now()}.csv`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`   Saved to ${dest} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
  return dest;
}

function resolveCsvPath(argv) {
  const fileArg = argv.find((a) => !a.startsWith("-") && a.endsWith(".csv"));
  if (fileArg) return path.resolve(fileArg);

  return (
    process.env.ROD_CSV_PATH ||
    "./Buncombe_County_Property_Sales_Data.csv"
  );
}

/**
 * @param {{ fullReload?: boolean, csvPath?: string }} [options]
 */
export async function syncRegisterOfDeeds(options = {}) {
  const fullReload =
    options.fullReload ?? process.argv.includes("--full-reload");

  let csvPath = options.csvPath;
  if (!csvPath) {
    if (process.env.ROD_CSV_URL) {
      csvPath = await downloadCsv(process.env.ROD_CSV_URL);
    } else {
      csvPath = resolveCsvPath(process.argv.slice(2));
    }
  }

  const pool = createPool();
  let runId = null;

  try {
    await ensureRodSchema(pool);
    runId = await startIngestRun(pool, JOB_NAME, csvPath);

    const sales = await ingestSalesCsv(pool, { csvPath, fullReload });
    const equity = await computeEquity(pool);
    const models = await updateParcelModelValues(pool);

    await finishIngestRun(pool, runId, {
      status: "success",
      rowsInserted: sales.inserted,
      rowsUpdated: sales.updated,
      metadata: {
        fullReload,
        skipped: sales.skipped,
        zipsUpdated: equity.zipsUpdated,
        countyMedian: equity.countyMedian,
        parcelsUpdated: models.parcelsUpdated,
      },
    });

    console.log("\n🏁 Register of Deeds sync complete");
    return { sales, equity, models };
  } catch (err) {
    if (runId != null) {
      await finishIngestRun(pool, runId, {
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
      }).catch(() => {});
    }
    throw err;
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1]?.endsWith("syncRegisterOfDeeds.mjs");
if (isMain) {
  syncRegisterOfDeeds().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
  });
}
