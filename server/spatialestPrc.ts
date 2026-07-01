/**
 * Buncombe County Spatialest PRC — live record card fetch + parse.
 * API: GET /api/v1/recordcard/{pin} (requires Laravel session + CSRF)
 */

export type PrcValueChange = {
  date: string;
  year: number;
  description: string;
  land_value: number;
  building_value: number;
  total_value: number;
};

export type PrcTransfer = {
  date: string;
  price: number;
  qualified: boolean;
  deed_book: string | null;
  instrument: string | null;
};

export type PrcBuilding = {
  year_built: number | null;
  sqft: number | null;
  bedrooms: number | null;
  full_bath: number | null;
  half_bath: number | null;
  building_type: string | null;
  quality: string | null;
  building_value: number | null;
};

export type PrcRecord = {
  pin: string;
  formatted_pin: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  owners: string;
  total_appraised: number;
  land_value: number;
  building_value: number;
  zoning: string | null;
  land_use: string | null;
  neighborhood: string | null;
  legal_description: string | null;
  deed_date: string | null;
  building: PrcBuilding | null;
  value_history: PrcValueChange[];
  transfers: PrcTransfer[];
  latest_value_year: number | null;
  fetched_at: string;
};

const PRC_BASE = "https://prc-buncombe.spatialest.com";
const CACHE_MS = 24 * 60 * 60 * 1000;
const PRC_SESSION_MS = 10 * 60 * 1000;

let prcSession: { cookie: string; csrfToken: string; expires: number } | null = null;
let prcColumnsEnsured = false;

export function spatialestPrcUrl(pin: string) {
  return `${PRC_BASE}/#/property/${pin.replace(/-/g, "").trim()}`;
}

function normalizePin(pin: string) {
  return pin.replace(/-/g, "").trim();
}

function parseMoney(value: unknown): number {
  if (value == null) return 0;
  const n = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parsePrcDate(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const mdy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1]}-${mdy[2]}`;
  return null;
}

function mergeCookies(existing: string, setCookie: string[] | undefined) {
  const jar = new Map<string, string>();
  for (const part of existing.split("; ").filter(Boolean)) {
    const eq = part.indexOf("=");
    if (eq > 0) jar.set(part.slice(0, eq), part.slice(eq + 1));
  }
  for (const c of setCookie ?? []) {
    const [kv] = c.split(";");
    const eq = kv.indexOf("=");
    if (eq > 0) jar.set(kv.slice(0, eq), kv.slice(eq + 1));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function getSetCookie(headers: Headers): string[] {
  const any = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof any.getSetCookie === "function") return any.getSetCookie();
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

async function prcRequest(path: string, cookie: string, csrfToken: string) {
  const res = await fetch(`${PRC_BASE}/${path}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Parcelogik/1.0 (Buncombe assessment research)",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${PRC_BASE}/`,
      Cookie: cookie,
      "X-CSRF-TOKEN": csrfToken,
    },
  });
  const body = await res.text();
  return { status: res.status, headers: res.headers, body };
}

async function getPrcSession() {
  if (prcSession && Date.now() < prcSession.expires) {
    return { cookie: prcSession.cookie, csrfToken: prcSession.csrfToken };
  }
  const session = await establishPrcSession();
  prcSession = { ...session, expires: Date.now() + PRC_SESSION_MS };
  return session;
}

async function establishPrcSession() {
  const homeRes = await fetch(`${PRC_BASE}/`, {
    headers: { Accept: "text/html", "User-Agent": "Parcelogik/1.0" },
  });
  let cookie = mergeCookies("", getSetCookie(homeRes.headers));
  const html = await homeRes.text();
  let csrfToken = html.match(/name="csrf-token" content="([^"]+)"/)?.[1] ?? "";

  const csrfRes = await prcRequest("csrf-cookie", cookie, csrfToken);
  cookie = mergeCookies(cookie, getSetCookie(csrfRes.headers));
  try {
    const parsed = JSON.parse(csrfRes.body) as { token?: string };
    if (parsed.token) csrfToken = parsed.token;
  } catch {
    // keep meta token
  }

  return { cookie, csrfToken };
}

export function parsePrcRecord(raw: Record<string, unknown>, pin: string): PrcRecord | null {
  const parcel = raw.parcel as Record<string, unknown> | undefined;
  const header = parcel?.header as Record<string, unknown> | undefined;
  if (!header) return null;

  const sections = (parcel?.sections ?? []) as unknown[];
  const keyInfo = (sections?.[0] as unknown[][])?.[0]?.[0] as Record<string, string> | undefined;
  const values = (sections?.[0] as unknown[][])?.[1]?.[0] as Record<string, string> | undefined;
  const landInfo = (sections?.[1] as unknown[][])?.[0]?.[0] as Record<string, string> | undefined;
  const buildings = (sections?.[2] as Record<string, unknown[]>)?.["1"] as Record<string, unknown>[] | undefined;
  const transfersRaw = (sections?.[3] as unknown[][])?.[0] as Record<string, string>[] | undefined;
  const historyRaw = (sections?.[4] as unknown[][])?.[0] as Record<string, string>[] | undefined;

  const b0 = buildings?.[0] as Record<string, unknown> | undefined;
  const legal = keyInfo?.LegalDescription ?? "";
  const deedFromLegal = legal.match(/Deed date:\s*(\d{4}-\d{2}-\d{2})/i)?.[1] ?? null;

  const value_history: PrcValueChange[] = (historyRaw ?? []).map((h) => ({
    date: parsePrcDate(h.DateOfChange) ?? String(h.DateOfChange ?? ""),
    year: Number(h.YearID) || 0,
    description: String(h.ShortDescription ?? ""),
    land_value: parseMoney(h.LandValue),
    building_value: parseMoney(h.BuildingValue),
    total_value: parseMoney(h.TotalAppraisedValue),
  }));

  const transfers: PrcTransfer[] = (transfersRaw ?? []).map((t) => ({
    date: parsePrcDate(t.saledate) ?? String(t.saledate ?? ""),
    price: parseMoney(t.saleprice),
    qualified: String(t.salesvalidity ?? "").toLowerCase().includes("qualified"),
    deed_book: t.book ? `${t.book}-${t.page}` : null,
    instrument: t.DeedInstrument ?? null,
  }));

  const latest_value_year = value_history.length
    ? Math.max(...value_history.map((v) => v.year))
    : null;

  const fullBath = b0 ? Number(b0.FullBath) || 0 : 0;
  const halfBath = b0 ? Number(b0.HalfBath) || 0 : 0;

  return {
    pin: normalizePin(String(raw.id ?? pin)),
    formatted_pin: String(header.FormattedParcelID ?? pin),
    address: String(header.StreetAddress1 ?? header.PropertyLocation ?? ""),
    city: String(header.City ?? ""),
    state: String(header.StateProvince ?? "NC"),
    zip: String(header.PostalCode ?? ""),
    owners: String(header.Owners ?? ""),
    total_appraised: parseMoney(header.Total ?? values?.Total),
    land_value: parseMoney(values?.LandValue ?? landInfo?.TotalAssessedLandValue),
    building_value: parseMoney(values?.BuildingValue),
    zoning: keyInfo?.Zoning ?? landInfo?.Zoning ?? null,
    land_use: keyInfo?.LandUse ?? landInfo?.LandUse ?? null,
    neighborhood: String(header.Neighborhood ?? keyInfo?.Neighborhood ?? ""),
    legal_description: legal || null,
    deed_date: deedFromLegal,
    building: b0
      ? {
          year_built: b0.YearBuilt != null ? Number(b0.YearBuilt) : null,
          sqft: b0.TotalFinishedArea != null ? Number(String(b0.TotalFinishedArea).replace(/,/g, "")) : null,
          bedrooms: b0.Bedrooms != null ? Number(b0.Bedrooms) : null,
          full_bath: fullBath || null,
          half_bath: halfBath || null,
          building_type: b0.BuildingType != null ? String(b0.BuildingType) : null,
          quality: b0.Quality != null ? String(b0.Quality) : null,
          building_value: parseMoney(b0.BuildingAssessedValue),
        }
      : null,
    value_history,
    transfers,
    latest_value_year,
    fetched_at: new Date().toISOString(),
  };
}

export async function fetchPrcRecord(pin: string): Promise<PrcRecord | null> {
  const id = normalizePin(pin);
  let { cookie, csrfToken } = await getPrcSession();
  let { status, body } = await prcRequest(`api/v1/recordcard/${id}`, cookie, csrfToken);
  if (status === 401 || status === 419) {
    prcSession = null;
    ({ cookie, csrfToken } = await getPrcSession());
    ({ status, body } = await prcRequest(`api/v1/recordcard/${id}`, cookie, csrfToken));
  }
  if (status !== 200) return null;
  try {
    const raw = JSON.parse(body) as Record<string, unknown>;
    return parsePrcRecord(raw, pin);
  } catch {
    return null;
  }
}

export function prcRecordFromDbRow(row: Record<string, unknown>): PrcRecord | null {
  if (row.prc_total_value == null) return null;
  return {
    pin: normalizePin(String(row.pin)),
    formatted_pin: String(row.pin),
    address: String(row.address ?? ""),
    city: String(row.city ?? ""),
    state: "NC",
    zip: String(row.postal_code ?? ""),
    owners: String(row.prc_owners ?? row.owner_name ?? ""),
    total_appraised: Number(row.prc_total_value),
    land_value: Number(row.prc_land_value ?? 0),
    building_value: Number(row.prc_building_value ?? 0),
    zoning: row.prc_zoning != null ? String(row.prc_zoning) : null,
    land_use: row.prc_land_use != null ? String(row.prc_land_use) : null,
    neighborhood: row.prc_neighborhood != null ? String(row.prc_neighborhood) : null,
    legal_description: null,
    deed_date: row.prc_deed_date != null ? String(row.prc_deed_date).slice(0, 10) : null,
    building: row.prc_sqft != null
      ? {
          year_built: row.prc_year_built != null ? Number(row.prc_year_built) : null,
          sqft: Number(row.prc_sqft),
          bedrooms: row.prc_bedrooms != null ? Number(row.prc_bedrooms) : null,
          full_bath: null,
          half_bath: null,
          building_type: row.prc_building_type != null ? String(row.prc_building_type) : null,
          quality: null,
          building_value: row.prc_building_value != null ? Number(row.prc_building_value) : null,
        }
      : null,
    value_history: [],
    transfers: [],
    latest_value_year: row.prc_value_year != null ? Number(row.prc_value_year) : null,
    fetched_at: row.prc_fetched_at ? String(row.prc_fetched_at) : new Date().toISOString(),
  };
}

export function isPrcCacheFresh(row: Record<string, unknown>): boolean {
  if (!row.prc_fetched_at) return false;
  const t = new Date(String(row.prc_fetched_at)).getTime();
  return Date.now() - t < CACHE_MS;
}

export const PRC_COLUMN_DDL = [
  `ALTER TABLE parceliq_parcels ADD COLUMN IF NOT EXISTS prc_total_value INTEGER`,
  `ALTER TABLE parceliq_parcels ADD COLUMN IF NOT EXISTS prc_land_value INTEGER`,
  `ALTER TABLE parceliq_parcels ADD COLUMN IF NOT EXISTS prc_building_value INTEGER`,
  `ALTER TABLE parceliq_parcels ADD COLUMN IF NOT EXISTS prc_sqft INTEGER`,
  `ALTER TABLE parceliq_parcels ADD COLUMN IF NOT EXISTS prc_year_built SMALLINT`,
  `ALTER TABLE parceliq_parcels ADD COLUMN IF NOT EXISTS prc_bedrooms SMALLINT`,
  `ALTER TABLE parceliq_parcels ADD COLUMN IF NOT EXISTS prc_zoning VARCHAR(32)`,
  `ALTER TABLE parceliq_parcels ADD COLUMN IF NOT EXISTS prc_land_use VARCHAR(64)`,
  `ALTER TABLE parceliq_parcels ADD COLUMN IF NOT EXISTS prc_building_type VARCHAR(64)`,
  `ALTER TABLE parceliq_parcels ADD COLUMN IF NOT EXISTS prc_neighborhood VARCHAR(64)`,
  `ALTER TABLE parceliq_parcels ADD COLUMN IF NOT EXISTS prc_owners VARCHAR(512)`,
  `ALTER TABLE parceliq_parcels ADD COLUMN IF NOT EXISTS prc_deed_date DATE`,
  `ALTER TABLE parceliq_parcels ADD COLUMN IF NOT EXISTS prc_value_year SMALLINT`,
  `ALTER TABLE parceliq_parcels ADD COLUMN IF NOT EXISTS prc_fetched_at TIMESTAMP`,
];

type PgPool = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

export async function ensurePrcColumns(pool: PgPool) {
  if (prcColumnsEnsured) return;
  for (const sql of PRC_COLUMN_DDL) {
    await pool.query(sql).catch(() => {});
  }
  prcColumnsEnsured = true;
}

export async function savePrcToDb(pool: PgPool, pin: string, prc: PrcRecord) {
  await pool.query(
    `UPDATE parceliq_parcels SET
      prc_total_value = $2,
      prc_land_value = $3,
      prc_building_value = $4,
      prc_sqft = $5,
      prc_year_built = $6,
      prc_bedrooms = $7,
      prc_zoning = $8,
      prc_land_use = $9,
      prc_building_type = $10,
      prc_neighborhood = $11,
      prc_owners = $12,
      prc_deed_date = $13,
      prc_value_year = $14,
      prc_fetched_at = NOW(),
      sqft = COALESCE($5, sqft),
      year_built = COALESCE($6, year_built),
      bedrooms = COALESCE($7, bedrooms)
     WHERE pin = $1 OR REPLACE(pin, '-', '') = REPLACE($1, '-', '')`,
    [
      pin,
      prc.total_appraised,
      prc.land_value,
      prc.building_value,
      prc.building?.sqft ?? null,
      prc.building?.year_built ?? null,
      prc.building?.bedrooms ?? null,
      prc.zoning,
      prc.land_use,
      prc.building?.building_type ?? null,
      prc.neighborhood || null,
      prc.owners,
      prc.deed_date,
      prc.latest_value_year,
    ],
  );
}

export async function loadPrcForParcel(pool: PgPool, pin: string, row: Record<string, unknown>): Promise<PrcRecord | null> {
  await ensurePrcColumns(pool);

  if (isPrcCacheFresh(row) && row.prc_total_value != null) {
    return prcRecordFromDbRow(row);
  }

  const live = await fetchPrcRecord(pin);
  if (!live) {
    return row.prc_total_value != null ? prcRecordFromDbRow(row) : null;
  }

  await savePrcToDb(pool, pin, live);
  return live;
}
