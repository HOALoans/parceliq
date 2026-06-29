import type { ComparableSale } from "./valuationDetail.js";
import type { PrcRecord } from "./spatialestPrc.js";
import { spatialestPrcUrl } from "./spatialestPrc.js";

export type FreshnessWarning = {
  code: string;
  severity: "info" | "warning";
  title: string;
  detail: string;
};

export type DataFreshness = {
  assessment_source: string;
  assessment_as_of: string | null;
  prc_as_of: string | null;
  prc_connected: boolean;
  deed_date: string | null;
  levy_year: number | null;
  sales_data_as_of: string | null;
  zip_equity_as_of: string | null;
  zillow_as_of: string | null;
  prc_url: string;
  warnings: FreshnessWarning[];
};

function toIsoDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function yearsAgo(isoDate: string, years: number) {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return false;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years);
  return d >= cutoff;
}

export function buildDataFreshness(
  row: Record<string, unknown>,
  pin: string,
  sales: ComparableSale[],
  opts: {
    salesDataAsOf?: string | null;
    zipEquityAsOf?: string | null;
    zillowAsOf?: string | null;
    prc?: PrcRecord | null;
  } = {},
): DataFreshness {
  const taxRollAssessed = Number(row.total_value ?? 0);
  const prc = opts.prc ?? null;
  const prcAssessed = prc?.total_appraised && prc.total_appraised > 0 ? prc.total_appraised : null;
  const assessed = prcAssessed ?? taxRollAssessed;
  const deedDate = toIsoDate(prc?.deed_date ?? row.deed_date);
  const levyYear = row.levy_year != null ? Number(row.levy_year) : null;
  const parcelUpdated = toIsoDate(row.updated_at);
  const currentYear = new Date().getFullYear();

  const warnings: FreshnessWarning[] = [];
  const latestSale = sales[0];

  if (prcAssessed && taxRollAssessed > 0 && Math.abs(prcAssessed - taxRollAssessed) > taxRollAssessed * 0.05) {
    warnings.push({
      code: "tax_roll_prc_mismatch",
      severity: "warning",
      title: "Tax roll updated via live Spatialest PRC",
      detail: `Our bulk tax roll had $${taxRollAssessed.toLocaleString()}, but the live county PRC shows $${prcAssessed.toLocaleString()}. This analysis now uses the official PRC appraised value.`,
    });
  }

  if (!prc && deedDate && yearsAgo(deedDate, 3)) {
    warnings.push({
      code: "recent_deed",
      severity: "warning",
      title: "Recent deed on file",
      detail: `A deed was recorded ${deedDate}. The county may have updated the appraised value on Spatialest PRC since our tax-roll snapshot ($${taxRollAssessed.toLocaleString()}).`,
    });
  }

  if (latestSale && assessed > 0 && latestSale.selling_price > 0) {
    const saleToAssessed = assessed / latestSale.selling_price;
    if (saleToAssessed >= 2 && latestSale.selling_price < assessed * 0.6) {
      warnings.push({
        code: "land_sale_before_improvement",
        severity: "warning",
        title: "Recorded sale likely predates current improvements",
        detail: `The most recent qualified sale was $${latestSale.selling_price.toLocaleString()}${latestSale.sell_date ? ` (${toIsoDate(latestSale.sell_date) ?? latestSale.sell_date})` : ""}. That land sale is not a reliable comp for the current improved property.`,
      });
    }
  }

  if (!prc && levyYear != null && levyYear < currentYear - 1) {
    warnings.push({
      code: "stale_levy_year",
      severity: "info",
      title: "Tax roll may not reflect the current levy year",
      detail: `Our bulk data is tied to levy year ${levyYear}. Connect to Spatialest PRC for the current appraised value.`,
    });
  }

  if (!prc && warnings.length > 0) {
    warnings.push({
      code: "verify_prc",
      severity: "info",
      title: "PRC data unavailable",
      detail: "Could not load live Spatialest data for this parcel. Values may rely on the bulk tax roll only.",
    });
  }

  return {
    assessment_source: prc
      ? "Spatialest PRC (live) + tax roll snapshot"
      : "Buncombe County tax roll (bulk CSV import)",
    assessment_as_of: parcelUpdated ?? (levyYear ? `${levyYear} levy year` : null),
    prc_as_of: prc ? toIsoDate(prc.fetched_at) : null,
    prc_connected: !!prc,
    deed_date: deedDate,
    levy_year: levyYear,
    sales_data_as_of: opts.salesDataAsOf ?? null,
    zip_equity_as_of: opts.zipEquityAsOf ?? null,
    zillow_as_of: opts.zillowAsOf ?? null,
    prc_url: spatialestPrcUrl(pin),
    warnings,
  };
}
