import { modelValue, modelBreakdown, type ParcelAttrs } from "./valuation.js";
import type { PrcRecord } from "./spatialestPrc.js";

export type ComparableSale = {
  sell_date: string | null;
  selling_price: number;
  adj_price: number | null;
  qualified: boolean;
};

export type NearbyComp = {
  pin: string;
  address: string | null;
  sell_date: string | null;
  selling_price: number;
  assessed: number | null;
  sqft?: number | null;
  year_built?: number | null;
};

export type CompMatching = {
  level: "strict" | "relaxed" | "zip_wide";
  summary: string;
  filters_applied: string[];
};

export type ZipEquityRow = {
  zip_code: string;
  zip_name: string | null;
  median_ratio: number;
  sample_count: number;
  avg_assessed: number | null;
  avg_sale_price: number | null;
};

export type MarketIndexRow = {
  metro_name: string;
  as_of_date: string | null;
  zhvi_current: number | null;
  zhvi_base: number | null;
  zhvi_base_date: string | null;
  median_sale_current: number | null;
  median_sale_base: number | null;
  appreciation_factor: number;
  source: string | null;
};

export type ValuationStep = {
  step: number;
  title: string;
  source: string;
  detail: string;
  formula?: string;
  result: number | null;
  result_label?: string;
  /** input = county record; market = feeds headline estimate; context = equity / metro only */
  kind: "input" | "market" | "context";
};

export type EstimateLine = {
  method: string;
  label: string;
  value: number | null;
  confidence: "high" | "medium" | "low";
  detail: string;
  priority: number;
  selected: boolean;
};

export type ValuationDetail = {
  /** Headline market estimate — comps / own sale / characteristics; NOT deed-ratio extrapolation. */
  fair_market_value: number | null;
  market_estimate: {
    value: number | null;
    method: "own_sale" | "comparable_sales" | "gradient_model" | "insufficient";
    method_label: string;
    confidence: "high" | "medium" | "low";
    range_low: number | null;
    range_high: number | null;
    estimates: EstimateLine[];
    selection_rule: string;
  };
  /** ZIP sales-ratio study extrapolation — equity uniformity only, not a market appraisal. */
  equity_extrapolation: {
    value: number | null;
    metro_adjusted_value: number | null;
    zip_median_ratio: number | null;
    parcel_ratio_vs_zip: number | null;
    disclaimer: string;
  };
  county_assessment: number;
  tax_roll_assessment: number | null;
  prc_assessment: number | null;
  variance_pct: number | null;
  gap_dollars: number | null;
  verdict: "over_assessed" | "under_assessed" | "fair" | "unknown";
  verdict_label: string;
  verdict_summary: string;
  /** @deprecated Use market_estimate.method — kept for compatibility */
  primary_method: "own_sale" | "comparable_sales" | "gradient_model" | "insufficient" | "deed_ratio" | "zillow_adjusted" | "prc_current";
  steps: ValuationStep[];
  zip_equity: ZipEquityRow | null;
  zillow: MarketIndexRow | null;
  comparable_sales: ComparableSale[];
  nearby_comps: NearbyComp[];
  comp_matching: CompMatching | null;
  model_breakdown: ReturnType<typeof modelBreakdown> | null;
  prc: PrcRecord | null;
};

function roundDollars(n: number) {
  return Math.round(n);
}

function median(arr: number[]) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function isLandSale(assessed: number, salePrice: number) {
  return salePrice > 0 && assessed / salePrice >= 2;
}

function saleAgeDays(sellDate: string | null): number | null {
  if (!sellDate) return null;
  const d = new Date(sellDate);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function likelyCommercial(prc: PrcRecord | null, ownerName: string): boolean {
  const landUse = (prc?.land_use ?? "").toLowerCase();
  if (/commercial|retail|office|industrial|mixed|hotel|restaurant/.test(landUse)) return true;
  return /LLC|INC\.?|CORP|L\.?P\.?|TRUST|PARTNERS|HOLDINGS|PROPERTIES|REALTY|DEVELOPMENT|ENTERPRISES|ASSOCIATES|COMPANY|CO\./i.test(ownerName);
}

export function buildValuationDetail(
  row: Record<string, unknown>,
  attrs: ParcelAttrs,
  zipEquity: ZipEquityRow | null,
  marketIndex: MarketIndexRow | null,
  sales: ComparableSale[],
  nearbyComps: NearbyComp[],
  prc: PrcRecord | null = null,
  compMatching: CompMatching | null = null,
): ValuationDetail {
  const taxRollAssessed = Number(row.total_value ?? 0);
  const prcAssessed = prc?.total_appraised && prc.total_appraised > 0 ? prc.total_appraised : null;
  const assessed = prcAssessed ?? taxRollAssessed;
  const ownerName = String(row.owner_name ?? "");

  const medianRatio = zipEquity?.median_ratio ?? null;
  const appreciation = marketIndex?.appreciation_factor ?? null;

  const deedExtrapolation =
    medianRatio && assessed > 0 ? roundDollars(assessed / medianRatio) : null;

  const metroAdjustedExtrapolation =
    deedExtrapolation && appreciation
      ? roundDollars(deedExtrapolation * appreciation)
      : null;

  const gradientEstimate = modelValue(attrs);

  const latestSale = sales[0];
  let ownSaleEstimate: number | null = null;
  let ownSaleDetail = "";
  if (latestSale && latestSale.selling_price > 0 && !isLandSale(assessed, latestSale.selling_price)) {
    const ageDays = saleAgeDays(latestSale.sell_date);
    if (ageDays != null && ageDays > 540 && appreciation && appreciation > 1) {
      ownSaleEstimate = roundDollars(latestSale.selling_price * appreciation);
      ownSaleDetail = `Most recent qualified sale (${latestSale.sell_date}) for $${latestSale.selling_price.toLocaleString()}, time-adjusted using metro appreciation since that sale.`;
    } else {
      ownSaleEstimate = latestSale.selling_price;
      ownSaleDetail = `Most recent qualified sale (${latestSale.sell_date ?? "—"}) for $${latestSale.selling_price.toLocaleString()}.`;
    }
  }

  const compPrices = nearbyComps
    .map((c) => c.selling_price)
    .filter((p) => p > 50_000);
  const compMedian = compPrices.length ? median(compPrices) : null;
  const compEstimate = compMedian != null ? roundDollars(compMedian) : null;

  const estimateLines: EstimateLine[] = [];

  if (ownSaleEstimate != null) {
    estimateLines.push({
      method: "own_sale",
      label: "This parcel's recent sale",
      value: ownSaleEstimate,
      confidence: saleAgeDays(latestSale?.sell_date ?? null) != null && saleAgeDays(latestSale!.sell_date)! < 730 ? "high" : "medium",
      detail: ownSaleDetail,
      priority: 1,
      selected: false,
    });
  }

  if (compEstimate != null) {
    const compDetail = compMatching?.summary
      ? `${compMatching.summary} Median of ${compPrices.length} qualified sale${compPrices.length !== 1 ? "s" : ""} (Register of Deeds, since 2020).`
      : `Median of ${compPrices.length} qualified sale${compPrices.length !== 1 ? "s" : ""} in the same ZIP with prices in a similar range to this assessment (Register of Deeds, since 2020).`;
    estimateLines.push({
      method: "comparable_sales",
      label: `Nearby sales in ZIP ${zipEquity?.zip_code ?? attrs.ZIP ?? "—"}`,
      value: compEstimate,
      confidence: compPrices.length >= 5 ? "medium" : compPrices.length >= 3 ? "medium" : "low",
      detail: compDetail,
      priority: 2,
      selected: false,
    });
  }

  if (gradientEstimate != null) {
    estimateLines.push({
      method: "gradient_model",
      label: "Property characteristics model",
      value: gradientEstimate,
      confidence: "low",
      detail: "Estimated from lot size, location premium, and property class benchmarks when parcel-specific sales are thin.",
      priority: 3,
      selected: false,
    });
  }

  let marketValue: number | null = null;
  let marketMethod: ValuationDetail["market_estimate"]["method"] = "insufficient";
  let marketConfidence: ValuationDetail["market_estimate"]["confidence"] = "low";
  let marketMethodLabel = "Insufficient data";

  const ownLine = estimateLines.find((e) => e.method === "own_sale");
  const compLine = estimateLines.find((e) => e.method === "comparable_sales");
  const gradLine = estimateLines.find((e) => e.method === "gradient_model");

  if (ownLine?.value && ownLine.confidence === "high") {
    marketValue = ownLine.value;
    marketMethod = "own_sale";
    marketConfidence = "high";
    marketMethodLabel = "Recent qualified sale";
  } else if (compLine?.value && compPrices.length >= 3) {
    marketValue = compLine.value;
    marketMethod = "comparable_sales";
    marketConfidence = compPrices.length >= 5 ? "medium" : "low";
    marketMethodLabel = "Nearby comparable sales";
  } else if (ownLine?.value) {
    marketValue = ownLine.value;
    marketMethod = "own_sale";
    marketConfidence = "medium";
    marketMethodLabel = "Qualified sale (time-adjusted)";
  } else if (compLine?.value) {
    marketValue = compLine.value;
    marketMethod = "comparable_sales";
    marketConfidence = "low";
    marketMethodLabel = "Limited comparable sales";
  } else if (gradLine?.value) {
    marketValue = gradLine.value;
    marketMethod = "gradient_model";
    marketConfidence = "low";
    marketMethodLabel = "Characteristics model";
  }

  const rangeValues = estimateLines.map((e) => e.value).filter((v): v is number => v != null && v > 0);
  const rangeLow = rangeValues.length ? roundDollars(Math.min(...rangeValues) * 0.92) : null;
  const rangeHigh = rangeValues.length ? roundDollars(Math.max(...rangeValues) * 1.08) : null;

  for (const line of estimateLines) {
    line.selected = line.method === marketMethod;
  }

  const parcelRatio =
    latestSale && latestSale.selling_price > 0 && !isLandSale(assessed, latestSale.selling_price)
      ? assessed / latestSale.selling_price
      : null;

  const parcelRatioVsZip =
    parcelRatio != null && medianRatio != null
      ? +((parcelRatio - medianRatio) * 100).toFixed(1)
      : null;

  const isCommercialContext = likelyCommercial(prc, ownerName) || zipEquity?.zip_code === "28801";

  const equityDisclaimer =
    "This applies the ZIP-wide median assessment-to-sale ratio to this parcel's assessment. " +
    "It measures uniformity vs. neighbors in the equity study — not a property-specific market appraisal. " +
    (isCommercialContext
      ? "Mixed-use and downtown ZIPs blend commercial and residential sales; do not treat this as what the property would sell for."
      : "Use comparable sales or a licensed appraisal for market value.");

  const variancePct =
    marketValue && assessed
      ? +(((assessed - marketValue) / marketValue) * 100).toFixed(1)
      : null;

  const gapDollars = marketValue != null ? assessed - marketValue : null;

  let verdict: ValuationDetail["verdict"] = "unknown";
  if (variancePct != null) {
    if (variancePct > 15) verdict = "over_assessed";
    else if (variancePct < -15) verdict = "under_assessed";
    else verdict = "fair";
  }

  const verdictLabel =
    verdict === "over_assessed"
      ? "Over-assessed vs. market estimate"
      : verdict === "under_assessed"
        ? "Under-assessed vs. market estimate"
        : verdict === "fair"
          ? "Within equity band"
          : "Insufficient data";

  const verdictSummary =
    verdict === "over_assessed" && gapDollars != null
      ? `County assessment is $${Math.abs(gapDollars).toLocaleString()} above our market estimate (${variancePct! > 0 ? "+" : ""}${variancePct}%) — based on comparable sales and parcel-specific data, not ZIP ratio extrapolation.`
      : verdict === "under_assessed" && gapDollars != null
        ? `County assessment is $${Math.abs(gapDollars).toLocaleString()} below our market estimate (${variancePct}%).`
        : verdict === "fair"
          ? "County assessment is within ±15% of our market estimate (comps / own sale / characteristics model)."
          : "Not enough parcel-specific sales data to compare assessment to market.";

  const steps: ValuationStep[] = [];
  let step = 1;

  if (prcAssessed) {
    steps.push({
      step: step++,
      title: "County appraised value",
      source: "Buncombe County · Spatialest PRC",
      detail: `Official record: $${prcAssessed.toLocaleString()} total appraised${prc?.latest_value_year ? ` (${prc.latest_value_year} tax year)` : ""}.`,
      result: prcAssessed,
      result_label: `$${prcAssessed.toLocaleString()}`,
      kind: "input",
    });
  } else if (assessed > 0) {
    steps.push({
      step: step++,
      title: "County assessed value",
      source: "Buncombe County tax roll",
      detail: `Tax roll total value: $${assessed.toLocaleString()}.`,
      result: assessed,
      result_label: `$${assessed.toLocaleString()}`,
      kind: "input",
    });
  }

  if (ownLine) {
    steps.push({
      step: step++,
      title: "This parcel's qualified sale",
      source: "NC Register of Deeds",
      detail: ownLine.detail,
      result: ownLine.value,
      result_label: ownLine.value ? `$${ownLine.value.toLocaleString()}` : undefined,
      kind: "market",
    });
  }

  if (compLine && compPrices.length > 0) {
    steps.push({
      step: step++,
      title: "Nearby comparable sales",
      source: "NC Register of Deeds · same ZIP",
      detail: compLine.detail,
      result: compLine.value,
      result_label: compLine.value ? `$${compLine.value.toLocaleString()}` : undefined,
      kind: "market",
    });
  }

  if (gradLine) {
    steps.push({
      step: step++,
      title: "Characteristics-based estimate",
      source: "Parcelogik gradient model",
      detail: gradLine.detail,
      result: gradLine.value,
      result_label: gradLine.value ? `$${gradLine.value.toLocaleString()}` : undefined,
      kind: "market",
    });
  }

  steps.push({
    step: step++,
    title: "Market estimate (headline)",
    source: marketMethodLabel,
    detail:
      marketValue != null
        ? `We pick the single best evidence source below — not a weighted average. Confidence: ${marketConfidence}.`
        : "Insufficient parcel-specific evidence for a market estimate.",
    result: marketValue,
    result_label: marketValue ? `$${marketValue.toLocaleString()}` : undefined,
    kind: "market",
  });

  if (zipEquity && medianRatio) {
    steps.push({
      step: step++,
      title: "ZIP equity context",
      source: "NC Register of Deeds · qualified sales since 2020",
      detail: `In ${zipEquity.zip_name ?? zipEquity.zip_code}, the median assessment-to-sale ratio is ${(medianRatio * 100).toFixed(1)}% across ${zipEquity.sample_count} matched parcels — used for uniformity analysis, not as this parcel's market value.`,
      result: medianRatio,
      result_label: `${(medianRatio * 100).toFixed(1)}% of sale price`,
      kind: "context",
    });
  }

  if (deedExtrapolation && medianRatio) {
    steps.push({
      step: step++,
      title: "ZIP ratio extrapolation (equity study only)",
      source: "Parcelogik uniformity metric",
      detail: equityDisclaimer,
      formula: `$${assessed.toLocaleString()} ÷ ${medianRatio.toFixed(3)}`,
      result: deedExtrapolation,
      result_label: `$${deedExtrapolation.toLocaleString()} — not a market appraisal`,
      kind: "context",
    });
  }

  if (metroAdjustedExtrapolation && marketIndex && deedExtrapolation !== metroAdjustedExtrapolation) {
    const pctUp = appreciation ? ((appreciation - 1) * 100).toFixed(1) : "0";
    steps.push({
      step: step++,
      title: "Metro trend adjustment on extrapolation",
      source: marketIndex.source ?? "Zillow Research · ZHVI index",
      detail: `Asheville metro home values rose ~${pctUp}% since ${marketIndex.zhvi_base_date ?? "2021"} per ZHVI. Applied only to the equity extrapolation above — not to the headline market estimate. ZHVI is a regional index, not a Zestimate for this address.`,
      formula: `$${deedExtrapolation!.toLocaleString()} × ${Number(appreciation).toFixed(4)}`,
      result: metroAdjustedExtrapolation,
      result_label: `$${metroAdjustedExtrapolation.toLocaleString()}`,
      kind: "context",
    });
  }

  return {
    fair_market_value: marketValue,
    market_estimate: {
      value: marketValue,
      method: marketMethod,
      method_label: marketMethodLabel,
      confidence: marketConfidence,
      range_low: rangeLow,
      range_high: rangeHigh,
      estimates: estimateLines,
      selection_rule:
        "We do not blend or weight these values. The market estimate uses the first method with enough evidence: (1) this parcel's qualified sale, (2) median of nearby comps matched by size, property type, and age when data allows (3+ sales preferred), (3) characteristics model as fallback. Other figures shown are context only.",
    },
    equity_extrapolation: {
      value: deedExtrapolation,
      metro_adjusted_value: metroAdjustedExtrapolation,
      zip_median_ratio: medianRatio,
      parcel_ratio_vs_zip: parcelRatioVsZip,
      disclaimer: equityDisclaimer,
    },
    county_assessment: assessed,
    tax_roll_assessment: taxRollAssessed > 0 ? taxRollAssessed : null,
    prc_assessment: prcAssessed,
    variance_pct: variancePct,
    gap_dollars: gapDollars,
    verdict,
    verdict_label: verdictLabel,
    verdict_summary: verdictSummary,
    primary_method: marketMethod,
    steps,
    zip_equity: zipEquity,
    zillow: marketIndex,
    comparable_sales: sales,
    nearby_comps: nearbyComps,
    comp_matching: compMatching,
    model_breakdown: marketValue ? modelBreakdown(attrs, marketValue) : null,
    prc,
  };
}
