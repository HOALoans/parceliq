import type { Pool } from "pg";
import type { PrcRecord } from "./spatialestPrc.js";

/** Buncombe mailing / PO Box ZIPs on tax rolls — not situs for comp searches. */
export const MAILING_ZIPS = new Set(["28813", "28814", "28815", "28816"]);

export function isMailingZip(zip: string | null | undefined): boolean {
  if (!zip) return false;
  return MAILING_ZIPS.has(zip.trim());
}

/** Pick the best situs ZIP from available sources (never prefer PO Box zips). */
export function resolveSitusZip(opts: {
  rollZip?: string | null;
  prcZip?: string | null;
  yoyZip?: string | null;
}): string | null {
  for (const z of [opts.prcZip, opts.yoyZip, opts.rollZip]) {
    const t = z?.trim();
    if (t && !isMailingZip(t)) return t;
  }
  return null;
}

/** Situs ZIP for comps — falls back to same-street consensus when tax roll has a PO Box ZIP. */
export async function resolveSitusZipForParcel(
  pool: Pool,
  row: Record<string, unknown>,
  prc: PrcRecord | null,
  yoyZip?: string | null,
): Promise<string> {
  const fromSources = resolveSitusZip({
    rollZip: row.postal_code != null ? String(row.postal_code) : null,
    prcZip: prc?.zip,
    yoyZip,
  });
  if (fromSources) return fromSources;

  const street = row.street_name != null ? String(row.street_name).trim() : "";
  if (street) {
    const { rows } = await pool.query<{ postal_code: string }>(
      `SELECT postal_code
       FROM parceliq_parcels
       WHERE street_name = $1
         AND postal_code IS NOT NULL
         AND postal_code != ''
         AND postal_code NOT IN ('28813', '28814', '28815', '28816')
       GROUP BY postal_code
       ORDER BY COUNT(*) DESC
       LIMIT 1`,
      [street],
    ).catch(() => ({ rows: [] as { postal_code: string }[] }));
    if (rows[0]?.postal_code) return String(rows[0].postal_code);
  }

  return row.postal_code != null ? String(row.postal_code) : "";
}
