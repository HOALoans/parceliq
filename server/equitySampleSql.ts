/** SQL fragments shared with jobs/lib/equityCompute.mjs cohort logic. */
export const EQUITY_SAMPLE_SALES_SUBQUERY = `
  SELECT DISTINCT ON (pin) pin, selling_price, sell_date
  FROM parceliq_sales
  WHERE sell_date >= '2020-01-01' AND selling_price > 50000
    AND qualified = TRUE AND vacant_lot = FALSE
  ORDER BY pin, sell_date DESC
`;

export const EQUITY_SAMPLE_JOIN = `
  FROM parceliq_parcels p
  INNER JOIN (${EQUITY_SAMPLE_SALES_SUBQUERY}) s ON s.pin = p.pin
  WHERE p.total_value > 10000
    AND p.postal_code IS NOT NULL AND p.postal_code != ''
    AND CAST(p.total_value AS FLOAT) / NULLIF(s.selling_price, 0) BETWEEN 0.1 AND 5.0
`;
