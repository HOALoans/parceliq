import "dotenv/config";
import pkg from "pg";
const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let tablesEnsured = false;
export async function ensureTables(): Promise<void> {
  if (tablesEnsured) return;
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS parceliq_overrides (
      id VARCHAR(36) PRIMARY KEY, parcel_pin VARCHAR(64) NOT NULL,
      address VARCHAR(255), current_val INTEGER, proposed_val INTEGER,
      model_val INTEGER, reason TEXT, submitted_by VARCHAR(128),
      status VARCHAR(32) NOT NULL DEFAULT 'pending', reviewed_by VARCHAR(128),
      review_note TEXT, reviewed_at TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS parceliq_audit (
      id VARCHAR(36) PRIMARY KEY, event_type VARCHAR(64) NOT NULL,
      parcel_pin VARCHAR(64), user_name VARCHAR(128), description TEXT,
      metadata JSONB, created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS parceliq_counties (
      id SERIAL PRIMARY KEY, name VARCHAR(128) NOT NULL, state VARCHAR(2) NOT NULL,
      fips_code VARCHAR(10), gis_feature_url VARCHAR(512),
      total_assessed_value_millions INTEGER, target_revenue INTEGER,
      total_parcels INTEGER, active SMALLINT NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
    const { rows } = await pool.query("SELECT COUNT(*) as c FROM parceliq_counties");
    if (Number(rows[0].c) === 0) {
      await pool.query(
        `INSERT INTO parceliq_counties
          (name,state,fips_code,gis_feature_url,total_assessed_value_millions,target_revenue,total_parcels)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        ["Buncombe County","NC","37021",
         "https://arcgis.ashevillenc.gov/arcgis/rest/services/PlanningParcel/Parcels/FeatureServer/0",
         24300,285000000,112847]
      );
    }
    tablesEnsured = true;
    console.log("✅ ParcelIQ tables ready");
  } catch (e) {
    console.error("ensureTables failed:", e);
  }
}