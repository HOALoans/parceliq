import type { ValuationDetail } from "./valuationDetail.js";
import type { ReappraisalYoY } from "./reappraisalYoY.js";
import type { DataFreshness } from "./assessmentFreshness.js";

export type NarrativeSection = {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

export type ParcelNarrative = {
  headline: string;
  tldr: string[];
  sections: NarrativeSection[];
  disclaimer: string;
};

function money(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function pct(n: number | null | undefined, signed = false): string {
  if (n == null) return "—";
  const v = signed && n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
  return `${v}%`;
}

export function buildParcelNarrative(opts: {
  address: string;
  pin: string;
  zip: string;
  owner?: string;
  valuation: ValuationDetail;
  reappraisalYoY: ReappraisalYoY | null;
  dataFreshness: DataFreshness;
}): ParcelNarrative {
  const { address, pin, zip, valuation: v, reappraisalYoY: yoy, dataFreshness: fresh } = opts;
  const me = v.market_estimate;
  const assessed = v.county_assessment;
  const market = me.value;
  const method = me.method;
  const comps = v.nearby_comps ?? [];
  const ownSales = v.comparable_sales ?? [];
  const compMatch = v.comp_matching;
  const prc = v.prc;

  const tldr: string[] = [
    `County assessment (what you're taxed on): ${money(assessed)}.`,
    market != null
      ? `Our market estimate (what similar sales suggest): ${money(market)} — via ${me.method_label.toLowerCase()}.`
      : "We don't have enough sales evidence for a market estimate on this parcel.",
    yoy
      ? `2026 reappraisal vs 2021 tax roll: ${money(yoy.value_2021)} → ${money(yoy.value_2026)} (${pct(yoy.change_pct, true)}).`
      : null,
    "These are separate questions — we do not blend them into one 'true value.'",
  ].filter((s): s is string => !!s);

  let headline: string;
  if (market == null) {
    headline = `${address} — county assessment is ${money(assessed)}; we need more sales data to estimate market value.`;
  } else if (v.verdict === "over_assessed") {
    headline = `${address} — the county assessment (${money(assessed)}) is about ${pct(v.variance_pct, true)} above our market estimate (${money(market)}).`;
  } else if (v.verdict === "under_assessed") {
    headline = `${address} — the county assessment (${money(assessed)}) is about ${Math.abs(v.variance_pct ?? 0).toFixed(1)}% below our market estimate (${money(market)}).`;
  } else if (v.verdict === "fair") {
    headline = `${address} — county assessment and market estimate are within 15% of each other (${money(assessed)} vs ${money(market)}).`;
  } else {
    headline = `${address} — county assessment ${money(assessed)}; market estimate ${money(market)}.`;
  }

  const sections: NarrativeSection[] = [];

  sections.push({
    id: "three_numbers",
    title: "Start here: three different numbers",
    paragraphs: [
      "Property analysis on Parcelogik answers three different questions. They often disagree — that is expected, not a bug.",
    ],
    bullets: [
      `County assessment (${money(assessed)}) — Buncombe's official appraised value for property tax. This is what your bill is based on.`,
      market != null
        ? `Market estimate (${money(market)}) — What qualified deed sales suggest this property might sell for today. Built from evidence on this parcel and similar sales — not a Zestimate.`
        : "Market estimate — Not enough comparable sales to produce a reliable figure for this parcel.",
      yoy
        ? `2026 reappraisal (${money(yoy.value_2026)}) — How this parcel's assessment changed from the 2021 tax cycle to the 2026 county reappraisal file.`
        : "2026 reappraisal — No matched 2021→2026 record for this PIN.",
      v.equity_extrapolation?.value
        ? `ZIP equity extrapolation (${money(v.equity_extrapolation.value)}) — A uniformity metric only. It spreads the ZIP's typical assessment-to-sale ratio across parcels. It is not a market appraisal.`
        : undefined,
    ].filter((b): b is string => !!b),
  });

  sections.push({
    id: "county",
    title: "What the county says",
    paragraphs: [
      prc
        ? `We pulled the live Spatialest property record card (PRC). Total appraised value: ${money(prc.total_appraised)}${prc.latest_value_year ? ` (${prc.latest_value_year} tax year)` : ""}.`
        : `We are using the bulk tax roll snapshot: ${money(assessed)}. Live PRC data was not available for this parcel.`,
      v.tax_roll_assessment != null &&
      v.prc_assessment != null &&
      v.tax_roll_assessment !== v.prc_assessment
        ? `Note: the older tax roll had ${money(v.tax_roll_assessment)}; the live PRC is higher at ${money(v.prc_assessment)}. We use the PRC figure in this analysis.`
        : "",
    ].filter(Boolean),
    bullets: prc?.building?.sqft
      ? [
          `Living area: ${Number(prc.building.sqft).toLocaleString()} sq ft`,
          prc.building.year_built ? `Year built: ${prc.building.year_built}` : undefined,
          prc.building.building_type ? `Style: ${prc.building.building_type}` : undefined,
        ].filter((b): b is string => !!b)
      : undefined,
  });

  const marketParagraphs: string[] = [
    "We do not average every number on the page. We pick one market method using a priority ladder — the first source with enough evidence wins.",
  ];

  if (method === "own_sale" && ownSales[0]) {
    const s = ownSales[0];
    marketParagraphs.push(
      `This parcel's own qualified Register of Deeds sale (${money(s.selling_price)}${s.sell_date ? ` on ${s.sell_date}` : ""}) is the strongest evidence, so it drives the market estimate at ${money(market)}.`,
    );
  } else if (method === "comparable_sales" && comps.length > 0) {
    const prices = comps.map((c) => c.selling_price).sort((a, b) => a - b);
    const med = prices[Math.floor(prices.length / 2)];
    marketParagraphs.push(
      `No recent on-parcel sale was used (or the recorded sale was too old, land-only, or unreliable). Instead we use ${comps.length} comparable sales in ZIP ${zip}.`,
      compMatch?.summary ?? "",
      `The median sale price among those comps is ${money(med)}, which becomes the headline market estimate of ${money(market)}.`,
      compMatch?.level === "relaxed" || compMatch?.level === "zip_wide"
        ? "Match quality: we relaxed size/type filters because few sales matched strictly — treat the estimate with extra caution."
        : "Comps were filtered by square footage, property type, and year built when county data allowed.",
    );
  } else if (method === "gradient_model") {
    marketParagraphs.push(
      `Sales evidence is thin, so the market estimate (${money(market)}) comes from a characteristics model (lot size, location, property class). This is directional only — not an appraisal.`,
    );
  } else {
    marketParagraphs.push("We could not apply any market method with sufficient evidence.");
  }

  if (me.range_low != null && me.range_high != null && market != null) {
    marketParagraphs.push(
      `Where multiple methods applied, we show a rough sensitivity range of ${money(me.range_low)}–${money(me.range_high)} — but the headline stays ${money(market)}.`,
    );
  }

  sections.push({
    id: "market",
    title: "What sales evidence suggests",
    paragraphs: marketParagraphs.filter(Boolean),
    bullets: me.estimates.map((e) =>
      `${e.selected ? "→ " : "  "}${e.label}: ${money(e.value)} (${e.confidence} confidence)${e.selected ? " — selected method" : ""}`,
    ),
  });

  if (yoy) {
    const vsCounty =
      yoy.vs_zip_median_pts != null
        ? yoy.vs_zip_median_pts > 2
          ? `This parcel's ${pct(yoy.change_pct, true)} increase is ${yoy.vs_zip_median_pts.toFixed(1)} points above its ZIP median — a steeper reappraisal bump than neighbors on average.`
          : yoy.vs_zip_median_pts < -2
            ? `This parcel's increase is ${Math.abs(yoy.vs_zip_median_pts).toFixed(1)} points below its ZIP median — a smaller reappraisal bump than neighbors on average.`
            : "This parcel's reappraisal increase is close to its ZIP median."
        : "";
    sections.push({
      id: "reappraisal",
      title: "2021 → 2026 reappraisal (separate from market value)",
      paragraphs: [
        `Buncombe's 2026 reappraisal raised this parcel from ${money(yoy.value_2021)} (2021-cycle tax roll) to ${money(yoy.value_2026)} (${pct(yoy.change_pct, true)}).`,
        `County-wide median increase is about +${pct(yoy.county_median_change_pct)}. ZIP ${zip}${yoy.zip_name ? ` (${yoy.zip_name})` : ""} median is about +${pct(yoy.zip_median_change_pct)}.`,
        vsCounty,
        "Reappraisal equity measures whether the county applied increases uniformly. It does not tell you what a buyer would pay today — that is the market estimate section above.",
      ].filter(Boolean),
    });
  }

  if (v.verdict !== "unknown" && market != null) {
    sections.push({
      id: "comparison",
      title: "County assessment vs. market estimate",
      paragraphs: [v.verdict_summary],
      bullets: [
        `Difference: ${money(v.gap_dollars)} (${pct(v.variance_pct, true)}).`,
        "Flagged when the gap exceeds ±15%. This compares county value to sales-based evidence — not to the reappraisal percentage alone.",
        v.variance_pct != null
          ? `Alignment score: ${Math.max(0, Math.round(100 - Math.min(Math.abs(v.variance_pct) * 2.5, 100)))}/100 — how closely the county assessment matches the market estimate (100 = same; lower = larger gap).`
          : undefined,
      ].filter((b): b is string => !!b),
    });
  }

  const caveatBullets: string[] = [];
  for (const w of fresh.warnings) {
    caveatBullets.push(`${w.title}: ${w.detail}`);
  }
  caveatBullets.push(
    "Parcelogik is not a licensed appraisal. Use this for research, appeals preparation, and policy analysis — not as a single 'true value.'",
  );

  sections.push({
    id: "caveats",
    title: "Important caveats",
    paragraphs: fresh.warnings.length
      ? ["Pay attention to these data quality notes for this parcel:"]
      : ["No special data warnings for this parcel."],
    bullets: caveatBullets,
  });

  return {
    headline,
    tldr,
    sections,
    disclaimer:
      `Narrative generated from Buncombe County public records for PIN ${pin}. ` +
      "All dollar figures trace to Spatialest PRC, tax roll, Register of Deeds sales, or the 2026 reappraisal file.",
  };
}
