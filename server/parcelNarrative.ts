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

function fairnessVerdict(yoy: ReappraisalYoY): { emoji: string; label: string; detail: string } {
  const home = yoy.change_pct;
  const county = yoy.county_median_change_pct;
  if (county == null) {
    return {
      emoji: "ℹ️",
      label: "County comparison unavailable",
      detail: "We could not load the county-wide average for this review period.",
    };
  }
  const diff = +(home - county).toFixed(1);
  if (Math.abs(diff) <= 2) {
    return {
      emoji: "🟢",
      label: "Right on track",
      detail:
        `Your home value grew at about the same speed as the average home in Buncombe County (+${pct(county)}). ` +
        `Your share of the county's "pizza" — your piece of the total tax bill — should stay roughly the same.`,
    };
  }
  if (diff > 2) {
    const zipNote =
      yoy.zip_name && yoy.zip_median_change_pct != null
        ? ` Your area (${yoy.zip_name}) saw a typical increase of about +${pct(yoy.zip_median_change_pct)}.`
        : "";
    return {
      emoji: "⚠️",
      label: "Faster than average",
      detail:
        `Your property value grew faster than the county average by about ${diff} percentage points ` +
        `(your home: +${pct(home, true)} vs county average: +${pct(county)}).${zipNote} ` +
        `That can mean your share of the county tax bill grew more than many neighbors — worth a closer look.`,
    };
  }
  return {
    emoji: "🟢",
    label: "Slower than average",
    detail:
      `Your property value grew slower than the county average by about ${Math.abs(diff)} percentage points ` +
      `(your home: +${pct(home, true)} vs county average: +${pct(county)}). ` +
      `Your share of the county tax bill may have shrunk relative to owners whose values jumped more.`,
  };
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
  const { address, pin, valuation: v, reappraisalYoY: yoy, dataFreshness: fresh } = opts;
  const me = v.market_estimate;
  const assessed = v.county_assessment;
  const market = me.value;
  const method = me.method;
  const comps = v.nearby_comps ?? [];
  const ownSales = v.comparable_sales ?? [];
  const compMatch = v.comp_matching;
  const prc = v.prc;

  const tldr: string[] = [
    `What the county says you're taxed on: ${money(assessed)}.`,
    market != null
      ? `What similar home sales suggest today: ${money(market)}.`
      : "We need more nearby sale data to estimate what this home might sell for today.",
    yoy
      ? `New value review: ${money(yoy.value_2021)} in 2021 → ${money(yoy.value_2026)} now (+${pct(yoy.change_pct, true)}).`
      : null,
    "These are separate questions — we show each one clearly instead of blending them into one magic number.",
  ].filter((s): s is string => !!s);

  let headline: string;
  if (yoy) {
    headline = `${address} — the county raised its value from ${money(yoy.value_2021)} to ${money(yoy.value_2026)} (+${pct(yoy.change_pct, true)}).`;
  } else if (market == null) {
    headline = `${address} — county value is ${money(assessed)}; we need more sale data to estimate market price.`;
  } else if (v.verdict === "over_assessed") {
    headline = `${address} — the county says ${money(assessed)}, but similar sales suggest about ${money(market)} (a ${pct(Math.abs(v.variance_pct ?? 0))} gap).`;
  } else if (v.verdict === "under_assessed") {
    headline = `${address} — the county value (${money(assessed)}) is below what similar sales suggest (${money(market)}).`;
  } else {
    headline = `${address} — county value and sale-based estimate are close (${money(assessed)} vs ${money(market)}).`;
  }

  const sections: NarrativeSection[] = [];

  sections.push({
    id: "why",
    title: "Why property values change (the pizza slice)",
    paragraphs: [
      "Think of the county budget like a giant pizza ordered for a party, and your tax bill is your share of the cost. " +
        "The county isn't trying to make the pizza bigger to trick you — it's trying to figure out how big your slice should be " +
        "based on how your home compares to everyone else's.",
      "If your neighborhood suddenly became the most popular spot in town, your slice got bigger — you pay a bit more of the total bill. " +
        "Someone in a neighborhood that didn't change as much pays less.",
    ],
  });

  if (yoy) {
    const perHundred = Math.round(100 + yoy.change_pct);
    const verdict = fairnessVerdict(yoy);
    sections.push({
      id: "then_now",
      title: "What changed",
      paragraphs: [
        `What the county said your home was worth in 2021: ${money(yoy.value_2021)}.`,
        `What the county says it is worth now: ${money(yoy.value_2026)}.`,
        `The difference: ${yoy.change_amt > 0 ? "+" : ""}${money(yoy.change_amt)} (your property value went up by ${pct(yoy.change_pct, true)}).`,
        `According to the county's math, for every $100 your home was worth five years ago, it is now worth about $${perHundred}. ` +
          `That mirrors what has been happening in the housing market across our area.`,
      ],
    });

    sections.push({
      id: "fairness",
      title: "Is it fair compared to everyone else?",
      paragraphs: [
        `${verdict.emoji} ${verdict.label}. ${verdict.detail}`,
        `Your home's growth: +${pct(yoy.change_pct)}. County average: +${pct(yoy.county_median_change_pct)}.`,
        yoy.zip_name && yoy.zip_median_change_pct != null
          ? `Typical growth in ${yoy.zip_name} (ZIP ${yoy.zipcode}): +${pct(yoy.zip_median_change_pct)}.`
          : "",
      ].filter(Boolean),
    });
  }

  sections.push({
    id: "county",
    title: "What the county says today",
    paragraphs: [
      prc
        ? `We pulled the live county property record. Total value on file: ${money(prc.total_appraised)}${prc.latest_value_year ? ` (${prc.latest_value_year} tax year)` : ""}.`
        : `We're using the county's bulk tax file: ${money(assessed)}.`,
      v.tax_roll_assessment != null &&
      v.prc_assessment != null &&
      v.tax_roll_assessment !== v.prc_assessment
        ? `An older county file had ${money(v.tax_roll_assessment)}; the live record is now ${money(v.prc_assessment)}. We use the newer figure.`
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

  const marketParagraphs: string[] = [];

  if (method === "own_sale" && ownSales[0]) {
    const s = ownSales[0];
    marketParagraphs.push(
      `This home's own recent sale (${money(s.selling_price)}${s.sell_date ? ` on ${s.sell_date}` : ""}) is the strongest clue for what it might sell for today: about ${money(market)}.`,
    );
  } else if (method === "comparable_sales" && comps.length > 0) {
    const prices = comps.map((c) => c.selling_price).sort((a, b) => a - b);
    const med = prices[Math.floor(prices.length / 2)];
    marketParagraphs.push(
      `We compared this home to ${comps.length} similar properties that actually sold nearby.`,
      compMatch?.summary ?? "",
      `The middle sale price among those homes is ${money(med)}, so we estimate about ${money(market)} for this property.`,
    );
  } else if (method === "gradient_model" && market != null) {
    marketParagraphs.push(
      `Not many recent sales nearby, so we used home size, location, and type to estimate about ${money(market)}. Treat this as a rough guide — not an official appraisal.`,
    );
  } else {
    marketParagraphs.push("We don't have enough nearby sale data to estimate a market price for this home.");
  }

  sections.push({
    id: "market",
    title: "What real sales suggest",
    paragraphs: marketParagraphs.filter(Boolean),
  });

  if (v.verdict !== "unknown" && market != null) {
    const gapLabel =
      v.verdict === "over_assessed"
        ? "County value is higher than sale evidence suggests"
        : v.verdict === "under_assessed"
          ? "County value is lower than sale evidence suggests"
          : "County value and sale evidence are close";
    sections.push({
      id: "gap",
      title: "The gap",
      paragraphs: [
        gapLabel + ".",
        v.verdict_summary,
        v.gap_dollars != null
          ? `Dollar difference: ${v.gap_dollars > 0 ? "+" : ""}${money(v.gap_dollars)} (${pct(v.variance_pct, true)}).`
          : "",
      ].filter(Boolean),
    });
  }

  sections.push({
    id: "how",
    title: "How Parcelogik does the math",
    paragraphs: [],
    bullets: [
      "We look at real sales — actual prices from homes bought and sold in Buncombe County.",
      "We check trusted market trackers to see how fast prices are moving in your neighborhood.",
      "We compare the county's old values (2021) to the new values (2026) to see who is carrying the heaviest share of growth.",
    ],
  });

  const caveatBullets: string[] = fresh.warnings.map((w) => `${w.title}: ${w.detail}`);
  caveatBullets.push(
    "Parcelogik is not a licensed appraisal. Use this for research and appeals — not as the one true price.",
  );

  sections.push({
    id: "caveats",
    title: "Good to know",
    paragraphs: fresh.warnings.length
      ? ["A few data notes for this property:"]
      : ["No special warnings for this property."],
    bullets: caveatBullets,
  });

  return {
    headline,
    tldr,
    sections,
    disclaimer:
      `Summary from Buncombe County public records for property ID ${pin}. ` +
      "Dollar figures come from county records, deed sales, or the 2026 new value review file.",
  };
}
