import { modelValue, modelBreakdown, equityScore, type ParcelAttrs } from "./valuation.js";

export type ComparableSale = {
  sell_date: string | null;
  selling_price: number;
  adj_price: number | null;
  qualified: boolean;
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
};

export type ValuationDetail = {
  fair_market_value: number | null;
  county_assessment: number;
  variance_pct: number | null;
  gap_dollars: number | null;
  verdict: "over_assessed" | "under_assessed" | "fair" | "unknown";
  verdict_label: string;
  verdict_summary: string;
  primary_method: "zillow_adjusted" | "deed_ratio" | "gradient_model";
  steps: ValuationStep[];
  zip_equity: ZipEquityRow | null;
  zillow: MarketIndexRow | null;
  comparable_sales: ComparableSale[];
  model_breakdown: ReturnType<typeof modelBreakdown> | null;
};

function roundDollars(n: number) {
  return Math.round(n);
}

export function buildValuationDetail(
  row: Record<string, unknown>,
  attrs: ParcelAttrs,
  zipEquity: ZipEquityRow | null,
  marketIndex: MarketIndexRow | null,
  sales: ComparableSale[],
): ValuationDetail {
  const assessed = Number(row.total_value ?? 0);
  const medianRatio = zipEquity?.median_ratio ?? null;
  const appreciation =
    marketIndex?.appreciation_factor ??
    (row.market_appreciation != null ? Number(row.market_appreciation) : null);

  const dbDeedModel = row.model_value != null ? Number(row.model_value) : null;
  const dbZillowFair =
    row.zillow_adjusted_value != null ? Number(row.zillow_adjusted_value) : null;

  const deedImpliedMarket =
    dbDeedModel ??
    (medianRatio && assessed > 0 ? roundDollars(assessed / medianRatio) : null);

  const zillowFair =
    dbZillowFair ??
    (deedImpliedMarket && appreciation
      ? roundDollars(deedImpliedMarket * appreciation)
      : null);

  let fairValue: number | null = zillowFair ?? deedImpliedMarket ?? dbDeedModel;
  let primaryMethod: ValuationDetail["primary_method"] = zillowFair
    ? "zillow_adjusted"
    : deedImpliedMarket
      ? "deed_ratio"
      : "gradient_model";

  if (!fairValue) {
    fairValue = modelValue(attrs);
    primaryMethod = "gradient_model";
  }

  const variancePct =
    row.variance_pct != null
      ? Number(row.variance_pct)
      : fairValue && assessed
        ? +(((assessed - fairValue) / fairValue) * 100).toFixed(1)
        : null;

  const gapDollars = fairValue != null ? assessed - fairValue : null;

  let verdict: ValuationDetail["verdict"] = "unknown";
  if (variancePct != null) {
    if (variancePct > 15) verdict = "over_assessed";
    else if (variancePct < -15) verdict = "under_assessed";
    else verdict = "fair";
  }

  const verdictLabel =
    verdict === "over_assessed"
      ? "Over-assessed"
      : verdict === "under_assessed"
        ? "Under-assessed"
        : verdict === "fair"
          ? "Within equity band"
          : "Insufficient data";

  const verdictSummary =
    verdict === "over_assessed" && gapDollars != null
      ? `The county assessment is $${Math.abs(gapDollars).toLocaleString()} above our fair market estimate (${variancePct! > 0 ? "+" : ""}${variancePct}%).`
      : verdict === "under_assessed" && gapDollars != null
        ? `The county assessment is $${Math.abs(gapDollars).toLocaleString()} below our fair market estimate (${variancePct}%).`
        : verdict === "fair"
          ? "The county assessment is within ±15% of our fair market estimate."
          : "Not enough sales or market data to produce a confident fair value.";

  const steps: ValuationStep[] = [];
  let step = 1;

  if (zipEquity && medianRatio) {
    steps.push({
      step: step++,
      title: "ZIP assessment-to-sale ratio",
      source: "NC Register of Deeds · qualified sales since 2020",
      detail: `In ${zipEquity.zip_name ?? zipEquity.zip_code}, Buncombe assessments average ${(medianRatio * 100).toFixed(1)}% of recent sale prices across ${zipEquity.sample_count} matched parcels.`,
      result: medianRatio,
      result_label: `${(medianRatio * 100).toFixed(1)}% of market`,
    });
  }

  if (deedImpliedMarket && medianRatio && assessed > 0) {
    steps.push({
      step: step++,
      title: "Deed-implied market value (at last revaluation)",
      source: "ParcelIQ deed-ratio model",
      detail:
        "Dividing the county assessment by the ZIP median ratio estimates what the property would sell for if the county's relative accuracy holds.",
      formula: `$${assessed.toLocaleString()} ÷ ${medianRatio.toFixed(3)}`,
      result: deedImpliedMarket,
      result_label: `$${deedImpliedMarket.toLocaleString()}`,
    });
  }

  if (marketIndex && appreciation && deedImpliedMarket) {
    const pctUp = ((appreciation - 1) * 100).toFixed(1);
    steps.push({
      step: step++,
      title: "Zillow metro appreciation adjustment",
      source: marketIndex.source ?? "Zillow Research",
      detail: `Since Buncombe's ${marketIndex.zhvi_base_date ?? "2021"} revaluation, Asheville metro ZHVI rose from $${Number(marketIndex.zhvi_base ?? 0).toLocaleString()} to $${Number(marketIndex.zhvi_current ?? 0).toLocaleString()} (+${pctUp}%). Median sale price: $${Number(marketIndex.median_sale_base ?? 0).toLocaleString()} → $${Number(marketIndex.median_sale_current ?? 0).toLocaleString()}.`,
      formula: `$${deedImpliedMarket.toLocaleString()} × ${Number(appreciation).toFixed(4)}`,
      result: zillowFair,
      result_label: zillowFair ? `$${zillowFair.toLocaleString()}` : undefined,
    });
  }

  if (sales.length > 0) {
    const latest = sales[0];
    const pinRatio =
      latest.selling_price > 0 ? assessed / latest.selling_price : null;
    steps.push({
      step: step++,
      title: "This parcel's most recent qualified sale",
      source: "NC Register of Deeds",
      detail: `Recorded ${latest.sell_date ?? "—"} for $${latest.selling_price.toLocaleString()}. County assesses at ${pinRatio != null ? `${(pinRatio * 100).toFixed(1)}%` : "—"} of that sale price.`,
      result: latest.selling_price,
      result_label: `$${latest.selling_price.toLocaleString()}`,
    });
  }

  steps.push({
    step: step++,
    title: "ParcelIQ fair market value",
    source:
      primaryMethod === "zillow_adjusted"
        ? "Deed ratio + Zillow metro appreciation"
        : primaryMethod === "deed_ratio"
          ? "Deed ratio by ZIP"
          : "Gradient valuation model",
    detail: verdictSummary,
    result: fairValue,
    result_label: fairValue ? `$${fairValue.toLocaleString()}` : undefined,
  });

  return {
    fair_market_value: fairValue,
    county_assessment: assessed,
    variance_pct: variancePct,
    gap_dollars: gapDollars,
    verdict,
    verdict_label: verdictLabel,
    verdict_summary: verdictSummary,
    primary_method: primaryMethod,
    steps,
    zip_equity: zipEquity,
    zillow: marketIndex,
    comparable_sales: sales,
    model_breakdown: fairValue ? modelBreakdown(attrs, fairValue) : null,
  };
}
