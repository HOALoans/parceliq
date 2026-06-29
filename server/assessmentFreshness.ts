import type { ComparableSale } from "./valuationDetail.js";

export type FreshnessWarning = {
  code: string;
  severity: "info" | "warning";
  title: string;
  detail: string;
};

export type DataFreshness = {
  assessment_source: string;
  assessment_as_of: string | null;
  deed_date: string | null;
  levy_year: number | null;
  sales_data_as_of: string | null;
  zip_equity_as_of: string | null;
  zillow_as_of: string | null;
  prc_url: string;
  warnings: FreshnessWarning[];
};

function normalizePin(pin: string) {
  return pin.replace(/-/g, "").trim();
}

export function spatialestPrcUrl(pin: string) {
  return `https://prc-buncombe.spatialest.com/#/property/${normalizePin(pin)}`;
}

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
  } = {},
): DataFreshness {
  const assessed = Number(row.total_value ?? 0);
  const deedDate = toIsoDate(row.deed_date);
  const levyYear = row.levy_year != null ? Number(row.levy_year) : null;
  const parcelUpdated = toIsoDate(row.updated_at);
  const currentYear = new Date().getFullYear();

  const warnings: FreshnessWarning[] = [];
  const latestSale = sales[0];

  if (deedDate && yearsAgo(deedDate, 3)) {
    warnings.push({
      code: "recent_deed",
      severity: "warning",
      title: "Recent deed on file",
      detail: `A deed was recorded ${deedDate}. Buncombe may have updated the appraised value on Spatialest PRC since our tax-roll snapshot. The county assessment shown here ($${assessed.toLocaleString()}) may be lower than the live PRC value.`,
    });
  }

  if (latestSale && assessed > 0 && latestSale.selling_price > 0) {
    const saleToAssessed = assessed / latestSale.selling_price;
    if (saleToAssessed >= 2 && latestSale.selling_price < assessed * 0.6) {
      warnings.push({
        code: "land_sale_before_improvement",
        severity: "warning",
        title: "Recorded sale likely predates current improvements",
        detail: `The most recent qualified sale was $${latestSale.selling_price.toLocaleString()}${latestSale.sell_date ? ` (${toIsoDate(latestSale.sell_date) ?? latestSale.sell_date})` : ""}, but our county assessment is $${assessed.toLocaleString()} (${saleToAssessed.toFixed(1)}× the sale price). This often means the lot sold before a new home was built — the sale is not a reliable comp for today's value.`,
      });
    }
  }

  if (levyYear != null && levyYear < currentYear - 1) {
    warnings.push({
      code: "stale_levy_year",
      severity: "info",
      title: "Tax roll may not reflect the current levy year",
      detail: `Our bulk data is tied to levy year ${levyYear}. The county PRC may show a more recent appraised value for the current tax year.`,
    });
  }

  if (warnings.length > 0) {
    warnings.push({
      code: "verify_prc",
      severity: "info",
      title: "Compare with official county records",
      detail:
        "ParcelIQ uses a downloaded tax roll plus statistical models. For the authoritative appraised value (land + building breakdown), open this parcel on Buncombe's Spatialest Property Record Card.",
    });
  }

  return {
    assessment_source: "Buncombe County tax roll (bulk CSV import)",
    assessment_as_of: parcelUpdated ?? (levyYear ? `${levyYear} levy year` : null),
    deed_date: deedDate,
    levy_year: levyYear,
    sales_data_as_of: opts.salesDataAsOf ?? null,
    zip_equity_as_of: opts.zipEquityAsOf ?? null,
    zillow_as_of: opts.zillowAsOf ?? null,
    prc_url: spatialestPrcUrl(pin),
    warnings,
  };
}
