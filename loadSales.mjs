/**
 * Parcelogik.com — Sales Data Loader (legacy entry point)
 *
 * Delegates to the incremental Register of Deeds sync job.
 * Use --full-reload for a clean TRUNCATE + reload (first-time setup).
 *
 *   node loadSales.mjs
 *   node loadSales.mjs --full-reload
 *   node loadSales.mjs ./Buncombe_County_Property_Sales_Data.csv
 */

import { syncRegisterOfDeeds } from "./jobs/syncRegisterOfDeeds.mjs";

const csvArg = process.argv.find((a) => !a.startsWith("-") && a.endsWith(".csv"));

syncRegisterOfDeeds({
  fullReload: process.argv.includes("--full-reload"),
  csvPath: csvArg,
}).catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
