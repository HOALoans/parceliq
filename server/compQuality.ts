import type { CompMatchLevel } from "./comparableSales.js";

export type CompQuality = {
  level: CompMatchLevel;
  count: number;
  avgMatchScore: number;
  priceCv: number | null;
  weak: boolean;
  weakReason: string | null;
};

function priceCoefficientOfVariation(prices: number[]): number | null {
  if (prices.length < 2) return null;
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  if (mean <= 0) return null;
  const variance = prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / prices.length;
  return Math.sqrt(variance) / mean;
}

/** True when comp median is likely a poor market anchor for this parcel. */
export function assessCompQuality(
  level: CompMatchLevel,
  compPrices: number[],
  avgMatchScore: number,
): CompQuality {
  const priceCv = priceCoefficientOfVariation(compPrices);
  let weak = false;
  let weakReason: string | null = null;

  if (compPrices.length < 3) {
    weak = true;
    weakReason = "Fewer than 3 comparable sales matched.";
  } else if (level === "zip_wide") {
    if (avgMatchScore < 55) {
      weak = true;
      weakReason = "ZIP-wide matches lack size, type, or age similarity (low match score).";
    } else if (priceCv != null && priceCv > 0.42) {
      weak = true;
      weakReason = "Matched sale prices vary widely — weak correlation to this parcel.";
    } else if (compPrices.length < 5) {
      weak = true;
      weakReason = "Only a thin ZIP-wide sample after relaxing match rules.";
    }
  } else if (level === "relaxed" && avgMatchScore < 48 && compPrices.length < 4) {
    weak = true;
    weakReason = "Relaxed matches are thin and low-scoring for this parcel.";
  } else if (priceCv != null && priceCv > 0.55) {
    weak = true;
    weakReason = "Comparable sale prices are highly dispersed.";
  }

  return {
    level,
    count: compPrices.length,
    avgMatchScore: +avgMatchScore.toFixed(1),
    priceCv: priceCv != null ? +priceCv.toFixed(3) : null,
    weak,
    weakReason,
  };
}
