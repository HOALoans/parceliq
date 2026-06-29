export async function ensureRodSchema(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS parceliq_sales (
    id SERIAL PRIMARY KEY,
    pin VARCHAR(32) NOT NULL,
    address VARCHAR(255),
    city VARCHAR(64),
    sell_date DATE,
    selling_price INTEGER NOT NULL,
    adj_price INTEGER,
    qualified BOOLEAN DEFAULT TRUE,
    deed_book VARCHAR(20),
    deed_date DATE,
    vacant_lot BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_pin ON parceliq_sales(pin)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_date ON parceliq_sales(sell_date)`);

  await pool.query(`CREATE TABLE IF NOT EXISTS parceliq_zip_equity (
    zip_code VARCHAR(10) PRIMARY KEY,
    zip_name VARCHAR(64),
    median_ratio NUMERIC(6,4),
    sample_count INTEGER,
    avg_assessed INTEGER,
    avg_sale_price INTEGER,
    flag_rate_pct NUMERIC(5,2),
    risk_level VARCHAR(20),
    updated_at TIMESTAMP DEFAULT NOW()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS parceliq_ingest_runs (
    id SERIAL PRIMARY KEY,
    job_name VARCHAR(64) NOT NULL,
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMP,
    status VARCHAR(16) NOT NULL DEFAULT 'running',
    rows_inserted INTEGER DEFAULT 0,
    rows_updated INTEGER DEFAULT 0,
    source_file VARCHAR(512),
    error_message TEXT,
    metadata JSONB
  )`);

  await pool.query(`
    ALTER TABLE parceliq_parcels ADD COLUMN IF NOT EXISTS model_value INTEGER
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE parceliq_parcels ADD COLUMN IF NOT EXISTS variance_pct NUMERIC(6,1)
  `).catch(() => {});
  await pool.query(`
    ALTER TABLE parceliq_parcels ADD COLUMN IF NOT EXISTS zillow_adjusted_value INTEGER
  `).catch(() => {});

  // Remove duplicates before adding unique index (safe to re-run).
  await pool.query(`
    DELETE FROM parceliq_sales a
    USING parceliq_sales b
    WHERE a.id > b.id
      AND a.pin = b.pin
      AND a.sell_date IS NOT DISTINCT FROM b.sell_date
      AND a.selling_price = b.selling_price
      AND COALESCE(a.deed_book, '') = COALESCE(b.deed_book, '')
  `).catch(() => {});

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_dedup
    ON parceliq_sales (pin, sell_date, selling_price, COALESCE(deed_book, ''))
  `).catch(() => {});
}
