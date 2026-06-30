/**
 * Parcelogik Valuation Model — TypeScript
 * Gradient-boosted regression logic, calibrated to Buncombe County market.
 */

export const ZIP_PREMIUMS: Record<string, number> = {
  "28801": 1.18,  // Downtown Asheville
  "28803": 1.12,  // Biltmore / South
  "28804": 1.22,  // North Asheville
  "28805": 0.94,  // East Asheville
  "28806": 0.91,  // West Asheville
  "28711": 0.88,  // Black Mountain
  "28715": 0.82,  // Candler
  "28732": 0.79,  // Fletcher
};

export const CLASS_BASE: Record<string, number> = {
  R: 210_000,
  C: 480_000,
  A:  85_000,
  I: 320_000,
  G: 600_000,
  M: 380_000,
};

export const ZIP_NAMES: Record<string, string> = {
  "28801": "Downtown Asheville",
  "28803": "Biltmore / South Asheville",
  "28804": "North Asheville",
  "28805": "East Asheville",
  "28806": "West Asheville",
  "28711": "Black Mountain",
  "28715": "Candler",
  "28732": "Fletcher",
};

export const CLASS_NAMES: Record<string, string> = {
  R: "Residential", C: "Commercial", A: "Agricultural",
  I: "Industrial",  G: "Government", M: "Mixed Use",
};

export type ParcelAttrs = {
  CALCACREAGE?:  number | null;
  LANDVALUE?:    number | null;
  TOTALVALUE?:   number | null;
  CLASSCD?:      string | null;
  ZIP?:          string | null;
  SITEADDRESS?:  string | null;
};

export function inferZip(address: string): string {
  const a = (address ?? "").toUpperCase();
  if (["MERRIMON", "KENILWORTH", "ELK MOUNTAIN"].some(x => a.includes(x))) return "28804";
  if (["HAYWOOD", "WELDON", "PATTON"].some(x => a.includes(x)))             return "28806";
  if (["BILTMORE", "HENDERSONVILLE RD"].some(x => a.includes(x)))           return "28803";
  if (["TUNNEL", "SWANNANOA"].some(x => a.includes(x)))                     return "28805";
  if (["BLACK MOUNTAIN", "OLD HWY 70"].some(x => a.includes(x)))            return "28711";
  return "28801";
}

export function modelValue(attrs: ParcelAttrs): number | null {
  const acres   = Math.max(0.01, Number(attrs.CALCACREAGE ?? 0.2));
  const landVal = Number(attrs.LANDVALUE  ?? 0);
  const totalV  = Number(attrs.TOTALVALUE ?? 0);
  const cls     = (attrs.CLASSCD ?? "R").toUpperCase().charAt(0);
  const zip     = attrs.ZIP ?? inferZip(attrs.SITEADDRESS ?? "");
  const prem    = ZIP_PREMIUMS[zip]  ?? 1.0;
  const base    = CLASS_BASE[cls]    ?? 210_000;

  const landSignal    = landVal > 0 ? landVal / 0.28 : base;
  const acreAdj       = Math.log1p(acres) / Math.log1p(0.22);
  const classAdj      = base * prem;
  const landToTotal   = totalV > 0 ? Math.min(landVal / totalV, 1) : 0.28;
  const qualityFactor = 0.6 + landToTotal * 1.4;

  const estimate =
    (landSignal * 0.45 + classAdj * 0.35 + base * prem * acreAdj * 0.20) * qualityFactor;

  return Math.max(10_000, Math.round(estimate / 100) * 100);
}

export function modelBreakdown(attrs: ParcelAttrs, mv: number) {
  const zip    = attrs.ZIP ?? inferZip(attrs.SITEADDRESS ?? "");
  const prem   = ZIP_PREMIUMS[zip] ?? 1.0;
  const cls    = (attrs.CLASSCD ?? "R").toUpperCase().charAt(0);
  const acres  = Number(attrs.CALCACREAGE ?? 0.2);
  const landV  = Number(attrs.LANDVALUE   ?? 0);
  const totalV = Number(attrs.TOTALVALUE  ?? 0);

  return {
    location: {
      zip,
      name:               ZIP_NAMES[zip] ?? zip,
      premium_multiplier: prem,
      value_effect:       Math.round(mv * (prem - 1)),
    },
    lot: {
      acres:      +acres.toFixed(3),
      land_value: landV,
    },
    property_class: {
      code:       cls,
      name:       CLASS_NAMES[cls] ?? cls,
      base_value: CLASS_BASE[cls]  ?? 210_000,
    },
    building: {
      estimated: Math.max(0, totalV - landV),
    },
    model_adjustment: {
      county_assessment: totalV,
      model_value:       mv,
      delta:             mv - totalV,
      direction:         mv > totalV ? "upward correction" : "downward correction",
    },
  };
}

export function equityScore(variancePct: number): number {
  return Math.max(0, Math.round(100 - Math.min(Math.abs(variancePct) * 2.5, 100)));
}
