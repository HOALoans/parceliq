/**
 * ParcelIQ — Spatialest Property Card Scraper
 * Fetches beds, baths, sqft, year built for each PIN
 * from community.spatialest.com/nc/buncombe (public portal)
 *
 * Usage: node --experimental-specifier-resolution=node scrapeProps.mjs
 *
 * Polite scraping: 1 request/second, resumable (skips already-fetched PINs)
 */

import "dotenv/config";
import pkg from "pg";
import https from "https";
import { setTimeout as sleep } from "timers/promises";

const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const BASE = "https://community.spatialest.com/nc/buncombe";

// ── Add property detail columns if they don't exist ──────────────────
async function ensureColumns() {
  const cols = [
    ["sqft",       "INTEGER"],
    ["bedrooms",   "SMALLINT"],
    ["bathrooms",  "NUMERIC(4,1)"],
    ["year_built", "SMALLINT"],
    ["prop_class", "VARCHAR(64)"],
    ["sale_price", "INTEGER"],
    ["sale_date",  "VARCHAR(20)"],
    ["detail_fetched", "BOOLEAN DEFAULT FALSE"],
  ];
  for (const [col, type] of cols) {
    await pool.query(
      `ALTER TABLE parceliq_parcels ADD COLUMN IF NOT EXISTS ${col} ${type}`
    ).catch(() => {});
  }
  console.log("✅ Columns ready");
}

// ── Fetch one property card ───────────────────────────────────────────
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ParcelIQ/1.0)",
        "Accept": "application/json, text/html",
        "Referer": BASE,
      },
      timeout: 15_000,
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

async function fetchPropertyCard(pin) {
  // Try the search API endpoint
  const cleanPin = pin.replace(/-/g, "").replace(/\s/g, "");
  
  // Method 1: Search by PIN
  const searchUrl = `${BASE}/api/search?query=${encodeURIComponent(pin)}&type=pin`;
  try {
    const { body } = await fetchUrl(searchUrl);
    const data = JSON.parse(body);
    if (data && (data.results || data.properties || Array.isArray(data))) {
      const items = data.results || data.properties || data;
      if (items.length > 0) return parseSearchResult(items[0]);
    }
  } catch {}

  // Method 2: Direct property endpoint
  const propUrl = `${BASE}/property/${encodeURIComponent(pin)}`;
  try {
    const { body } = await fetchUrl(propUrl);
    return parseHtmlCard(body);
  } catch {}

  return null;
}

function parseSearchResult(item) {
  return {
    sqft:       parseInt(item.living_area || item.sqft || item.sq_ft || 0) || null,
    bedrooms:   parseInt(item.bedrooms || item.beds || 0) || null,
    bathrooms:  parseFloat(item.bathrooms || item.baths || 0) || null,
    year_built: parseInt(item.year_built || item.yearbuilt || 0) || null,
    prop_class: item.property_class || item.class || null,
    sale_price: parseInt(item.sale_price || item.last_sale_price || 0) || null,
    sale_date:  item.sale_date || item.last_sale_date || null,
  };
}

function parseHtmlCard(html) {
  const get = (patterns) => {
    for (const p of patterns) {
      const m = html.match(p);
      if (m && m[1]) return m[1].trim();
    }
    return null;
  };

  const sqftRaw = get([
    /Living Area[^:]*:?\s*<[^>]+>([0-9,]+)/i,
    /Heated Area[^:]*:?\s*<[^>]+>([0-9,]+)/i,
    /Total Sq\.?\s*Ft\.?[^:]*:?\s*<[^>]+>([0-9,]+)/i,
    /"living_area"\s*:\s*"?([0-9,]+)/i,
    /"sqft"\s*:\s*"?([0-9,]+)/i,
  ]);

  const bedsRaw = get([
    /Bedrooms?[^:]*:?\s*<[^>]+>([0-9]+)/i,
    /"bedrooms?"\s*:\s*"?([0-9]+)/i,
    /Beds?\s*:?\s*<[^>]+>([0-9]+)/i,
  ]);

  const bathsRaw = get([
    /Bathrooms?[^:]*:?\s*<[^>]+>([0-9.]+)/i,
    /"bathrooms?"\s*:\s*"?([0-9.]+)/i,
    /Baths?\s*:?\s*<[^>]+>([0-9.]+)/i,
    /Full Bath[^:]*:?\s*<[^>]+>([0-9]+)/i,
  ]);

  const yearRaw = get([
    /Year Built[^:]*:?\s*<[^>]+>([0-9]{4})/i,
    /"year_built"\s*:\s*"?([0-9]{4})/i,
    /Year\s+of\s+Const[^:]*:?\s*<[^>]+>([0-9]{4})/i,
  ]);

  const saleRaw = get([
    /Sale Price[^:]*:?\s*<[^>]+>\$?([\d,]+)/i,
    /"sale_price"\s*:\s*"?([\d,]+)/i,
  ]);

  const saleDateRaw = get([
    /Sale Date[^:]*:?\s*<[^>]+>([0-9/\-]+)/i,
    /"sale_date"\s*:\s*"([^"]+)"/i,
  ]);

  const sqft = sqftRaw ? parseInt(sqftRaw.replace(/,/g, "")) : null;
  const beds = bedsRaw ? parseInt(bedsRaw) : null;
  const baths = bathsRaw ? parseFloat(bathsRaw) : null;
  const year = yearRaw ? parseInt(yearRaw) : null;
  const sale = saleRaw ? parseInt(saleRaw.replace(/,/g, "")) : null;

  if (!sqft && !beds && !baths && !year) return null;

  return {
    sqft:       sqft || null,
    bedrooms:   beds || null,
    bathrooms:  baths || null,
    year_built: year || null,
    prop_class: null,
    sale_price: sale || null,
    sale_date:  saleDateRaw || null,
  };
}

// ── Main loop ─────────────────────────────────────────────────────────
async function run() {
  console.log("🏛  ParcelIQ Property Scraper — Spatialest");
  await ensureColumns();

  // First test one PIN to see what we get
  console.log("\n🔍 Testing API with sample PIN...");
  const testPin = "9742-27-4075-00000";
  
  // Try multiple URL patterns
  const testUrls = [
    `${BASE}/api/search?query=${testPin}`,
    `${BASE}/api/property/${testPin}`,
    `${BASE}/api/v1/property/${testPin}`,
    `https://prc-buncombe.spatialest.com/api/v1/property/search?q=${testPin}`,
    `https://prc-buncombe.spatialest.com/search?pin=${testPin}`,
  ];

  for (const url of testUrls) {
    try {
      console.log(`  Trying: ${url}`);
      const { status, body } = await fetchUrl(url);
      console.log(`  Status: ${status}`);
      if (status === 200 && body.length > 100) {
        console.log(`  Response (first 500 chars):\n${body.slice(0, 500)}`);
        console.log("\n✅ Found working endpoint!");
        break;
      } else {
        console.log(`  Response: ${body.slice(0, 100)}`);
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
    await sleep(500);
  }

  await pool.end();
}

run().catch(e => { console.error("Fatal:", e); process.exit(1); });
