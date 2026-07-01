import type { Pool } from "pg";
import type { PrcRecord } from "./spatialestPrc.js";
import type { NearbyComp } from "./valuationDetail.js";

export type PropertyType = "condo" | "sfr" | "unknown";

export type SubjectProfile = {
  pin: string;
  zip: string;
  /** Best available assessed value for price-band filtering */
  assessed: number;
  sqft: number | null;
  yearBuilt: number | null;
  propertyType: PropertyType;
};

export type CompMatchLevel = "strict" | "relaxed" | "zip_wide";

export type ComparableMatchResult = {
  comps: NearbyComp[];
  matchLevel: CompMatchLevel;
  matchSummary: string;
  filtersApplied: string[];
  avgMatchScore: number;
};

type RawCompRow = {
  pin: string;
  address: string | null;
  sell_date: Date | string | null;
  selling_price: number;
  assessed: number | null;
  sqft: number | null;
  year_built: number | null;
  building_type: string | null;
};

const SQFT_STRICT_PCT = 0.25;
const SQFT_RELAXED_PCT = 0.4;
const YEAR_STRICT = 15;
const YEAR_RELAXED = 30;
const MIN_COMPS = 3;
const TARGET_COMPS = 12;

export function inferPropertyType(
  address: string | null | undefined,
  buildingType: string | null | undefined,
): PropertyType {
  const a = (address ?? "").toUpperCase();
  if (/\bUNIT\b/.test(a) || /#\s*\d/.test(a) || /\bAPT\b/.test(a)) return "condo";
  const bt = (buildingType ?? "").toLowerCase();
  if (/condo|condominium|apartment|co-op|coop/.test(bt)) return "condo";
  if (/townhouse|town house|row house/.test(bt)) return "condo";
  if (/single|residence|dwelling|detached|sfr|1 family|one family/.test(bt)) return "sfr";
  return "unknown";
}

export function buildSubjectProfile(
  row: Record<string, unknown>,
  prc: PrcRecord | null,
): SubjectProfile {
  const assessed =
    prc?.total_appraised && prc.total_appraised > 0
      ? prc.total_appraised
      : Math.max(50_000, Number(row.total_value ?? 0));

  const sqft =
    prc?.building?.sqft ??
    (row.prc_sqft != null ? Number(row.prc_sqft) : null) ??
    (row.sqft != null ? Number(row.sqft) : null);

  const yearBuilt =
    prc?.building?.year_built ??
    (row.prc_year_built != null ? Number(row.prc_year_built) : null) ??
    (row.year_built != null ? Number(row.year_built) : null);

  let propertyType = inferPropertyType(
    String(row.address ?? ""),
    prc?.building?.building_type ?? (row.prc_building_type != null ? String(row.prc_building_type) : null),
  );

  if (propertyType === "unknown" && sqft && sqft >= 1_200) {
    propertyType = "sfr";
  }

  return {
    pin: String(row.pin),
    zip: String(row.postal_code ?? ""),
    assessed,
    sqft: sqft && sqft > 0 ? sqft : null,
    yearBuilt: yearBuilt && yearBuilt > 1800 ? yearBuilt : null,
    propertyType,
  };
}

function toIsoDate(value: Date | string | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function sqftWithinBand(subject: number, comp: number, pct: number) {
  const lo = subject * (1 - pct);
  const hi = subject * (1 + pct);
  return comp >= lo && comp <= hi;
}

function yearWithinBand(subject: number, comp: number, years: number) {
  return Math.abs(subject - comp) <= years;
}

type ScoredComp = NearbyComp & {
  property_type: PropertyType;
  match_score: number;
};

function scoreComp(
  subject: SubjectProfile,
  comp: RawCompRow,
  level: CompMatchLevel,
): ScoredComp | null {
  const propertyType = inferPropertyType(comp.address, comp.building_type);
  const sqft = comp.sqft != null && comp.sqft > 0 ? Number(comp.sqft) : null;
  const yearBuilt = comp.year_built != null && comp.year_built > 1800 ? Number(comp.year_built) : null;
  const assessed = comp.assessed != null ? Number(comp.assessed) : null;

  if (level !== "zip_wide") {
    if (subject.propertyType === "sfr" && propertyType === "condo") return null;
    if (subject.propertyType === "condo" && propertyType === "sfr") return null;
  }

  const sqftPct = level === "strict" ? SQFT_STRICT_PCT : SQFT_RELAXED_PCT;
  const yearBand = level === "strict" ? YEAR_STRICT : YEAR_RELAXED;

  if (subject.sqft) {
    if (!sqft) {
      if (level === "strict") return null;
    } else if (!sqftWithinBand(subject.sqft, sqft, sqftPct)) {
      return null;
    }
  }

  if (subject.yearBuilt) {
    if (!yearBuilt) {
      if (level === "strict") return null;
    } else if (!yearWithinBand(subject.yearBuilt, yearBuilt, yearBand)) {
      return null;
    }
  }

  let score = 0;

  if (subject.sqft && sqft) {
    const ratio = sqft / subject.sqft;
    const dist = Math.abs(1 - ratio);
    if (dist <= SQFT_STRICT_PCT) score += 100;
    else if (dist <= SQFT_RELAXED_PCT) score += 55;
    else if (level === "zip_wide") score += 10;
    else return null;
  } else if (subject.sqft && !sqft) {
    score += level === "zip_wide" ? 15 : 25;
  } else {
    score += 30;
  }

  if (subject.yearBuilt && yearBuilt) {
    const ageGap = Math.abs(subject.yearBuilt - yearBuilt);
    if (ageGap <= YEAR_STRICT) score += 60;
    else if (ageGap <= YEAR_RELAXED) score += 30;
    else if (level === "zip_wide") score += 5;
    else score += 10;
  } else {
    score += 15;
  }

  if (assessed && subject.assessed > 0) {
    const ratio = assessed / subject.assessed;
    if (ratio >= 0.6 && ratio <= 1.6) score += 40;
    else if (ratio >= 0.4 && ratio <= 2.2) score += 20;
    else if (level === "zip_wide") score += 5;
  }

  if (propertyType !== "unknown" && propertyType === subject.propertyType) score += 35;
  else if (propertyType === "unknown" || subject.propertyType === "unknown") score += 10;

  const sellDate = toIsoDate(comp.sell_date);
  if (sellDate) {
    const ageDays = Math.floor((Date.now() - new Date(sellDate).getTime()) / (1000 * 60 * 60 * 24));
    score += Math.max(0, 30 - Math.floor(ageDays / 120));
  }

  return {
    pin: comp.pin,
    address: comp.address,
    sell_date: sellDate,
    selling_price: Number(comp.selling_price),
    assessed,
    sqft,
    year_built: yearBuilt,
    property_type: propertyType,
    match_score: score,
  };
}

function selectComps(subject: SubjectProfile, candidates: RawCompRow[]): ComparableMatchResult {
  const levels: CompMatchLevel[] = ["strict", "relaxed", "zip_wide"];
  const filtersByLevel: Record<CompMatchLevel, string[]> = {
    strict: [
      "Same ZIP, qualified sales since 2020",
      subject.sqft ? `Finished sq ft within ±${SQFT_STRICT_PCT * 100}%` : null,
      subject.yearBuilt ? `Year built within ±${YEAR_STRICT} years` : null,
      subject.propertyType !== "unknown"
        ? `Property type: ${subject.propertyType === "condo" ? "condo/townhouse" : "single-family"}`
        : "Exclude obvious condo vs. house mismatches",
      `Sale price ${Math.round(subject.assessed * 0.35).toLocaleString()}–${Math.round(subject.assessed * 2.5).toLocaleString()} (vs. county value)`,
    ].filter((s): s is string => !!s),
    relaxed: [
      "Same ZIP, qualified sales since 2020",
      subject.sqft ? `Prefer sq ft within ±${SQFT_RELAXED_PCT * 100}%` : null,
      subject.yearBuilt ? `Prefer year built within ±${YEAR_RELAXED} years` : null,
      "Matched property type when known",
    ].filter((s): s is string => !!s),
    zip_wide: [
      "Same ZIP, qualified sales since 2020",
      "Broad price band — size and age not required",
    ],
  };

  for (const level of levels) {
    const scored = candidates
      .map((c) => scoreComp(subject, c, level))
      .filter((c): c is ScoredComp => c != null)
      .sort((a, b) => b.match_score - a.match_score || String(b.sell_date).localeCompare(String(a.sell_date)));

    if (scored.length >= MIN_COMPS || level === "zip_wide") {
      const picked = scored.slice(0, TARGET_COMPS);
      const withSqft = picked.filter((c) => c.sqft != null).length;
      const withYear = picked.filter((c) => c.year_built != null).length;
      const dataNote =
        subject.sqft && withSqft < MIN_COMPS
          ? " Many matched sales lack sq ft on file — we also weight sale price and assessed value."
          : subject.yearBuilt && withYear < MIN_COMPS
            ? " Year built is missing on several comps — sale price and size used where available."
            : "";

      const summary =
        level === "strict"
          ? `Matched ${picked.length} sales by size${subject.sqft ? ` (±${SQFT_STRICT_PCT * 100}% sq ft)` : ""}${subject.yearBuilt ? `, age (±${YEAR_STRICT} yr)` : ""}, and property type.${dataNote}`
          : level === "relaxed"
            ? `Relaxed match: ${picked.length} sales with similar size, age, and property type in the ZIP.${dataNote}`
            : `ZIP-wide sample: ${picked.length} recent sales (limited size/type matches available).`;

      const avgMatchScore =
        picked.length > 0
          ? picked.reduce((sum, c) => sum + c.match_score, 0) / picked.length
          : 0;

      return {
        comps: picked.map(({ match_score: _m, property_type: _p, ...rest }) => rest),
        matchLevel: level,
        matchSummary: summary,
        filtersApplied: filtersByLevel[level],
        avgMatchScore,
      };
    }
  }

  return {
    comps: [],
    matchLevel: "zip_wide",
    matchSummary: "No comparable sales found in this ZIP.",
    filtersApplied: filtersByLevel.zip_wide,
    avgMatchScore: 0,
  };
}

export async function fetchComparableSales(
  pool: Pool,
  subject: SubjectProfile,
): Promise<ComparableMatchResult> {
  const priceLo = Math.round(subject.assessed * 0.35);
  const priceHi = Math.round(subject.assessed * 2.5);

  const { rows } = await pool.query<RawCompRow>(
    `SELECT s.pin, s.address, s.sell_date, s.selling_price,
            COALESCE(NULLIF(p.prc_total_value, 0), p.total_value) AS assessed,
            COALESCE(p.prc_sqft, p.sqft) AS sqft,
            COALESCE(p.prc_year_built, p.year_built) AS year_built,
            p.prc_building_type AS building_type
     FROM parceliq_sales s
     INNER JOIN parceliq_parcels p ON p.pin = s.pin
     WHERE p.postal_code = $1
       AND s.pin != $2
       AND s.qualified = TRUE AND s.vacant_lot = FALSE
       AND s.sell_date >= '2020-01-01' AND s.selling_price > 50000
       AND s.selling_price BETWEEN $3 AND $4
     ORDER BY s.sell_date DESC
     LIMIT 400`,
    [subject.zip, subject.pin, priceLo, priceHi],
  ).catch(() => ({ rows: [] as RawCompRow[] }));

  return selectComps(subject, rows);
}
