import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Layers } from "lucide-react";

/** 2026 reappraisal cycle — moved from site homepage to Buncombe county dashboard. */
export function ReappraisalCycleCard() {
  return (
    <Card className="border-slate-200">
      <CardHeader className="py-3 px-4 pb-1">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Layers className="w-4 h-4 text-amber-600" />
          2026 reappraisal cycle
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed">
        2021 tax roll baseline vs. 2026 county reappraisal values — parcel by parcel and ZIP by ZIP,
        for uniformity analysis across the cycle.
      </CardContent>
    </Card>
  );
}

/** Light blue 2021 → 2026 equity summary — moved from site homepage. */
export function ReappraisalEquitySection() {
  return (
    <section className="rounded-xl bg-indigo-50 border border-indigo-100 px-5 py-6 sm:px-6">
      <h3 className="text-xl sm:text-2xl font-serif font-semibold text-slate-900 mb-3">
        2021 → 2026 reappraisal equity
      </h3>
      <p className="text-slate-600 leading-relaxed max-w-3xl mb-6 text-sm sm:text-base">
        Buncombe&apos;s 2026 reappraisal is live in Parcelogik. Compare the prior-cycle tax roll to
        the new county file for any parcel, and see how your neighborhood&apos;s median increase
        compares to the county — a separate lens from market value or deed-sale equity.
      </p>
      <div className="grid sm:grid-cols-3 gap-4 text-center">
        {[
          { label: "Matched parcels", value: "112k+", sub: "2021 & 2026 on file" },
          { label: "County median increase", value: "+61%", sub: "Across matched parcels" },
          { label: "ZIP spread", value: "28 pts", sub: "Lowest vs. highest median ZIP" },
        ].map(({ label, value, sub }) => (
          <div key={label} className="rounded-lg border border-indigo-200 bg-white p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-2xl font-serif font-semibold mt-1 text-indigo-950">{value}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
