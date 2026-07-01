/**
 * Parcelogik.com — Assessment Dashboard
 */

import { useState, useRef } from "react";
import { trpc } from "../../lib/trpc";           // adjust path to match your trpc client
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Badge }    from "@/components/ui/badge";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea }  from "@/components/ui/textarea";
import { Label }     from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import {
  Building2, Search, Target, Scale,
  ClipboardList, AlertTriangle, CheckCircle2,
  TrendingUp, TrendingDown, RefreshCw, Plus, Info, ExternalLink,
  ArrowLeft, BookOpen,
} from "lucide-react";
import { Link } from "wouter";

// ── nav tabs ─────────────────────────────────────────────────────────
type Tab = "dashboard" | "explorer" | "revenue" | "equity" | "overrides" | "audit";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "dashboard", label: "Dashboard",       icon: <Building2 className="w-4 h-4" /> },
  { id: "explorer",  label: "Property Search",  icon: <Search className="w-4 h-4" /> },
  { id: "revenue",   label: "Revenue Targeting",icon: <Target className="w-4 h-4" /> },
  { id: "equity",    label: "Equity Analysis",  icon: <Scale className="w-4 h-4" /> },
  { id: "overrides", label: "Overrides",        icon: <ClipboardList className="w-4 h-4" /> },
  { id: "audit",     label: "Audit Log",        icon: <ClipboardList className="w-4 h-4" /> },
];

// ── helpers ───────────────────────────────────────────────────────────
const fmt = (n: number | null | undefined) =>
  n == null ? "—" : `$${n.toLocaleString("en-US")}`;

const fmtB = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toLocaleString("en-US", { maximumFractionDigits: 1 })}B`
  : n >= 1e6 ? `$${(n / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`
  : `$${Math.round(n).toLocaleString("en-US")}`;

const fmtNum = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US");

function parseAmountInput(raw: string): number {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const fmtDate = (d: unknown) => {
  if (d == null || d === "") return "—";
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d === "string") return d.slice(0, 10);
  return String(d);
};

const fmtCell = (v: unknown) =>
  v instanceof Date ? fmtDate(v) : v == null ? "—" : String(v);

const normalizePin = (pin: string) => pin.replace(/-/g, "").trim().toUpperCase();

const pinsMatch = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && normalizePin(a) === normalizePin(b);

const formatAsOf = (value: string | null | undefined) => {
  if (!value) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return fmtDate(value);
  return value;
};

/** Equity-study label: assessment vs qualified sales in the ZIP sample — not a market-appraisal verdict. */
function zipEquityRatioStatus(ratio: number): { label: string; badgeClass: string } {
  if (ratio > 1.1) {
    return { label: "Above sale prices", badgeClass: "bg-red-100 text-red-800 border-red-200" };
  }
  if (ratio >= 0.88) {
    return { label: "Near parity", badgeClass: "bg-green-100 text-green-800 border-green-200" };
  }
  if (ratio >= 0.75) {
    return { label: "Below sale prices", badgeClass: "bg-amber-100 text-amber-800 border-amber-200" };
  }
  return { label: "Well below sales", badgeClass: "bg-amber-200 text-amber-900 border-amber-300" };
}

function equityRiskLabel(riskLevel: string): string {
  if (riskLevel === "high") return "Low ratio";
  if (riskLevel === "moderate") return "Moderate gap";
  return "Near parity";
}

/** Plain-English summary of the headline market estimate (comps / own sale — not ZIP ratio). */
function marketEstimateExplainer(v: Record<string, any> | undefined): string {
  const me = v?.market_estimate;
  if (!me?.value) {
    return "We don't have enough parcel-specific sales or comparable evidence to produce a market estimate. Compare the county assessment to nearby sales below, or consult a licensed appraiser.";
  }

  const range =
    me.range_low != null && me.range_high != null && me.range_low !== me.range_high
      ? ` We show a rough range of ${fmt(me.range_low)}–${fmt(me.range_high)} from the methods that applied.`
      : "";

  if (me.method === "own_sale") {
    return (
      `Our market estimate (${fmt(me.value)}) is anchored on this parcel's own qualified Register of Deeds sale` +
      `${me.confidence === "high" ? " — the strongest evidence we have" : ", with time adjustment where the sale is older"}.` +
      ` We do not scale the county assessment by a ZIP-wide ratio to guess market value.${range}`
    );
  }

  if (me.method === "comparable_sales") {
    return (
      `Our market estimate (${fmt(me.value)}) is the median of qualified sales of similar properties in the same ZIP` +
      ` — matched by finished square footage, property type, and year built when county data is available.` +
      ` This is the sales-comparison approach appraisers use — not an extrapolation from county under-assessment.${range}`
    );
  }

  return (
    `With limited sales for this parcel, our market estimate (${fmt(me.value)}) comes from property characteristics` +
    ` (lot, location, class). Treat it as directional only — not an appraisal.${range}`
  );
}

function equityExtrapolationExplainer(v: Record<string, any> | undefined): string {
  const ex = v?.equity_extrapolation;
  if (!ex?.value) {
    return "ZIP equity ratio data is not available for this parcel.";
  }
  const ratioPct = ex.zip_median_ratio != null ? (ex.zip_median_ratio * 100).toFixed(1) : null;
  return (
    `If this property were taxed like the typical sale in its ZIP (${ratioPct}% assessment-to-sale ratio),` +
    ` the math yields ${fmt(ex.value)} — but that assumes this parcel is "under-assessed" in the same way as the ZIP average.` +
    ` ${ex.disclaimer ?? ""}` +
    (ex.parcel_ratio_vs_zip != null
      ? ` This parcel's own sale ratio differs from the ZIP median by ${ex.parcel_ratio_vs_zip > 0 ? "+" : ""}${ex.parcel_ratio_vs_zip} percentage points.`
      : "")
  );
}

const MARKET_METHOD_PRIORITY = [
  { priority: 1, method: "own_sale", title: "This parcel's qualified sale", hint: "Strongest — a verified sale on this PIN" },
  { priority: 2, method: "comparable_sales", title: "Nearby comparable sales", hint: "Median of sales matched by sq ft, type, and age" },
  { priority: 3, method: "gradient_model", title: "Property characteristics", hint: "Fallback from lot, location, and class" },
] as const;

function ConfidenceBadge({ level }: { level: string }) {
  const styles =
    level === "high" ? "bg-green-100 text-green-800 border-green-200"
      : level === "medium" ? "bg-amber-100 text-amber-800 border-amber-200"
        : "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded border ${styles}`}>
      {level} confidence
    </span>
  );
}

function MarketEstimatePriorityPanel({
  marketEst,
  fairValue,
}: {
  marketEst: Record<string, any> | undefined;
  fairValue: number | null | undefined;
}) {
  const estimates: Array<Record<string, any>> = marketEst?.estimates ?? [];
  const byMethod = Object.fromEntries(estimates.map((e) => [e.method, e]));

  return (
    <Card className="border-slate-300 bg-gradient-to-br from-slate-50 to-white">
      <CardHeader className="py-3 px-4 pb-2">
        <CardTitle className="text-sm font-semibold">How the market estimate is chosen</CardTitle>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          {marketEst?.selection_rule ?? marketEstimateExplainer({ market_estimate: marketEst, fair_market_value: fairValue })}
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {MARKET_METHOD_PRIORITY.map(({ priority, method, title, hint }) => {
          const line = byMethod[method];
          const selected = line?.selected === true;
          return (
            <div
              key={method}
              className={`relative flex items-start gap-3 rounded-lg border px-3 py-3 transition-colors ${
                selected
                  ? "border-slate-800 bg-slate-900 text-white shadow-md"
                  : line
                    ? "border-slate-200 bg-white"
                    : "border-dashed border-slate-200 bg-slate-50/50 opacity-60"
              }`}
            >
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                selected ? "bg-amber-400 text-slate-900" : "bg-slate-200 text-slate-600"
              }`}>
                {selected ? "✓" : priority}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm font-semibold ${selected ? "text-white" : "text-slate-900"}`}>{title}</span>
                  {selected && (
                    <span className="text-[10px] uppercase tracking-wide bg-amber-400 text-slate-900 px-2 py-0.5 rounded font-bold">
                      Selected method
                    </span>
                  )}
                  {line && !selected && (
                    <span className="text-[10px] text-muted-foreground">available — lower priority</span>
                  )}
                  {!line && (
                    <span className="text-[10px] text-muted-foreground">not available</span>
                  )}
                </div>
                <p className={`text-xs mt-0.5 ${selected ? "text-slate-300" : "text-muted-foreground"}`}>{hint}</p>
                {line && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={`font-serif text-lg font-semibold ${selected ? "text-amber-300" : "text-slate-800"}`}>
                      {fmt(line.value)}
                    </span>
                    <ConfidenceBadge level={line.confidence} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {marketEst?.range_low != null && marketEst?.range_high != null && (
          <p className="text-xs text-muted-foreground pt-2 border-t">
            Sensitivity range across available methods: {fmt(marketEst.range_low)}–{fmt(marketEst.range_high)}
            {" "}(not a weighted blend).
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ValuationTimeline({ steps }: { steps: Array<Record<string, any>> }) {
  if (!steps?.length) return null;

  const marketSteps = steps.filter((s) => (s.kind ?? "market") === "market");
  const contextSteps = steps.filter((s) => s.kind === "context");
  const inputSteps = steps.filter((s) => s.kind === "input");

  const renderStep = (step: Record<string, any>, lineColor: string, dotBorder: string) => (
    <div key={step.step} className="relative pl-8 pb-6 last:pb-0">
      <div className={`absolute left-[11px] top-7 bottom-0 w-0.5 ${lineColor}`} />
      <div className={`absolute left-0 top-0.5 h-6 w-6 rounded-full border-2 ${dotBorder} bg-white flex items-center justify-center text-[10px] font-bold text-slate-700`}>
        {step.step}
      </div>
      <div className="rounded-lg border bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-900">{step.title}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{step.source}</p>
          </div>
          {step.result_label && (
            <p className="font-mono text-sm font-semibold text-slate-800 shrink-0">{step.result_label}</p>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{step.detail}</p>
        {step.formula && (
          <p className="text-xs font-mono bg-slate-50 border rounded px-2 py-1 mt-2 inline-block">{step.formula}</p>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {inputSteps.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">County record</p>
          <div className="relative">{inputSteps.map((s) => renderStep(s, "bg-slate-200", "border-slate-400"))}</div>
        </div>
      )}
      {marketSteps.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-700 mb-3">Market estimate path</p>
          <div className="relative">{marketSteps.map((s) => renderStep(s, "bg-slate-300", "border-slate-800"))}</div>
        </div>
      )}
      {contextSteps.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 mb-3">Equity context (not the selected market method)</p>
          <div className="relative">{contextSteps.map((s) => renderStep(s, "bg-amber-200", "border-amber-500"))}</div>
        </div>
      )}
    </div>
  );
}

function DataFreshnessPanel({ freshness }: { freshness: Record<string, any> }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-slate-800">Data sources &amp; freshness</div>
          <p className="text-xs text-muted-foreground mt-1">
            {freshness.prc_connected
              ? "Live Spatialest PRC data is incorporated into this analysis."
              : "Bulk tax roll data — live PRC fetch unavailable for this parcel."}
          </p>
        </div>
        {freshness.prc_url && (
          <a
            href={freshness.prc_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 shrink-0 text-xs font-medium text-slate-700 border border-slate-300 bg-white rounded-md px-2.5 py-1.5 hover:bg-slate-100"
          >
            Spatialest PRC <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        {[
          ["County assessment", formatAsOf(freshness.prc_as_of ?? freshness.assessment_as_of), freshness.assessment_source],
          ["Register of Deeds sales", formatAsOf(freshness.sales_data_as_of), "Qualified sales sync"],
          ["ZIP equity ratios", formatAsOf(freshness.zip_equity_as_of), "Uniformity study by ZIP"],
          ["Zillow metro index", formatAsOf(freshness.zillow_as_of), "Regional trend (ZHVI)"],
          ["Deed on file", formatAsOf(freshness.deed_date), freshness.levy_year ? `Levy year ${freshness.levy_year}` : "—"],
        ].map(([label, asOf, sub]) => (
          <div key={label} className="bg-white rounded border px-2.5 py-2">
            <div className="text-muted-foreground">{label}</div>
            <div className="font-medium text-slate-800 mt-0.5">As of {asOf}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PrcRecordCard({ prc, taxRollAssessment }: { prc: Record<string, any>; taxRollAssessment?: number | null }) {
  return (
    <Card className="border-2 border-blue-300 bg-blue-50/30">
      <CardHeader className="py-3 px-4 pb-1">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Building2 className="w-4 h-4 text-blue-800" />
          Buncombe Spatialest PRC · Official County Record
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded border bg-white p-3 text-center">
            <div className="text-xs text-muted-foreground">Land</div>
            <div className="font-serif font-semibold mt-1">{fmt(prc.land_value)}</div>
          </div>
          <div className="rounded border bg-white p-3 text-center">
            <div className="text-xs text-muted-foreground">Building</div>
            <div className="font-serif font-semibold mt-1">{fmt(prc.building_value)}</div>
          </div>
          <div className="rounded border-2 border-blue-400 bg-white p-3 text-center">
            <div className="text-xs text-blue-800 font-medium">Total Appraised</div>
            <div className="font-serif font-semibold mt-1 text-lg">{fmt(prc.total_appraised)}</div>
            {prc.latest_value_year && (
              <div className="text-[10px] text-muted-foreground mt-1">{prc.latest_value_year} tax year</div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {[
            ["Zoning", prc.zoning],
            ["Land use", prc.land_use],
            ["Neighborhood", prc.neighborhood],
            ["Deed date", prc.deed_date ? fmtDate(prc.deed_date) : "—"],
            ["Year built", prc.building?.year_built ?? "—"],
            ["Living area", prc.building?.sqft ? `${Number(prc.building.sqft).toLocaleString()} sqft` : "—"],
            ["Beds / baths", prc.building?.bedrooms
              ? `${prc.building.bedrooms} bed · ${prc.building.full_bath ?? 0}${prc.building.half_bath ? `/${prc.building.half_bath}` : ""} bath`
              : "—"],
            ["Style", prc.building?.building_type ?? "—"],
          ].map(([label, value]) => (
            <div key={label} className="bg-white rounded border px-2 py-1.5">
              <div className="text-muted-foreground">{label}</div>
              <div className="font-medium truncate">{fmtCell(value)}</div>
            </div>
          ))}
        </div>
        {taxRollAssessment != null && taxRollAssessment !== prc.total_appraised && (
          <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Bulk tax roll snapshot: {fmt(taxRollAssessment)} — superseded by live PRC {fmt(prc.total_appraised)} in this analysis.
          </p>
        )}
        {prc.value_history?.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Value change history</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prc.value_history.slice(-4).map((h: Record<string, any>, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs">{fmtDate(h.date)}</TableCell>
                    <TableCell className="text-xs">{h.description}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmt(h.total_value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VarianceBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <Badge variant="outline">—</Badge>;
  const abs = Math.abs(pct);
  if (abs > 15) return <Badge variant="destructive">{pct > 0 ? "+" : ""}{pct}%</Badge>;
  if (abs > 5)  return <Badge className="bg-amber-100 text-amber-800 border-amber-200">{pct > 0 ? "+" : ""}{pct}%</Badge>;
  return <Badge className="bg-green-100 text-green-800 border-green-200">{pct > 0 ? "+" : ""}{pct}%</Badge>;
}

function alignmentScoreHint(score: number | null): string {
  if (score == null) return "";
  if (score >= 80) return "County assessment is close to our market estimate (within ~8%).";
  if (score >= 60) return "County assessment differs moderately from our market estimate (~9–16% gap).";
  return `County assessment differs substantially from our market estimate (score ${score}/100 — larger gaps score lower).`;
}

function ScorePill({ score }: { score: number | null }) {
  if (score == null) return null;
  const color = score >= 80 ? "bg-green-100 text-green-800"
    : score >= 60 ? "bg-amber-100 text-amber-800"
    : "bg-red-100 text-red-800";
  return (
    <span
      className={`inline-flex items-center justify-center w-9 h-9 rounded-full text-xs font-bold border ${color}`}
      title={alignmentScoreHint(score)}
    >
      {score}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  MAIN PAGE
// ════════════════════════════════════════════════════════════════════════
export default function ParcelogikPage() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [zipSample, setZipSample] = useState<string | null>(null);

  const openZipSample = (zip: string) => {
    setZipSample(zip);
    setTab("explorer");
  };

  const clearZipSample = () => setZipSample(null);

  return (
    <div className="flex flex-col min-h-screen bg-neutral-50">
      {/* Header */}
      <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-serif font-semibold tracking-tight">
            <a href="https://parcelogik.com" className="hover:opacity-90 transition-opacity">
              Parcel<span className="text-amber-400">ogik</span>
              <span className="text-slate-400 font-sans text-sm font-normal">.com</span>
            </a>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            <Link href="/" className="hover:text-slate-300">Parcelogik</Link>
            {" · "}Buncombe County, NC
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="hidden sm:inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-3 h-3" /> All counties
          </Link>
          <span className="flex items-center gap-1.5 text-xs bg-slate-800 text-green-400 px-3 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Live · Buncombe GIS
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b bg-white px-6 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.id
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 p-6">
        {tab === "dashboard"  && <DashboardTab onOpenZip={openZipSample} />}
        {tab === "explorer"   && (
          <ExplorerTab
            zipSample={zipSample}
            onClearZipSample={clearZipSample}
          />
        )}
        {tab === "revenue"    && <RevenueTab />}
        {tab === "equity"     && <EquityTab onOpenZip={openZipSample} />}
        {tab === "overrides"  && <OverridesTab />}
        {tab === "audit"      && <AuditTab />}
      </div>
    </div>
  );
}

function ZipLink({
  zip,
  onOpenZip,
  className = "",
}: {
  zip: string;
  onOpenZip: (zip: string) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpenZip(zip)}
      className={`font-mono font-semibold text-amber-800 hover:text-amber-950 hover:underline inline-flex items-center gap-1 ${className}`}
      title={`View ${zip} equity sample properties`}
    >
      {zip}
      <ExternalLink className="w-3 h-3 opacity-60" />
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ════════════════════════════════════════════════════════════════════════
function DashboardTab({ onOpenZip }: { onOpenZip: (zip: string) => void }) {
  const { data, isLoading, refetch } = trpc.parceliq.searchParcels.useQuery({ limit: 5 });
  const { data: ratios, isLoading: ratiosLoading } = trpc.parceliq.assessmentRatios.useQuery();
  const { data: reappraisal, isLoading: reappraisalLoading } = trpc.parceliq.reappraisalSummary.useQuery();

  const zipRatios = ratios?.zipCodes ?? [];
  const countyPct = ratios?.countyMedianPct;
  const chartData = zipRatios.map((z) => ({
    name: z.zip,
    ratio: Math.round(z.ratio * 1000) / 10,
  }));
  const chartRatios = chartData.map((d) => d.ratio);
  const yMin = chartRatios.length
    ? Math.floor(Math.min(...chartRatios) - 2)
    : 65;
  const yMax = chartRatios.length
    ? Math.ceil(Math.max(...chartRatios) + 2)
    : 80;

  const stats = [
    { label: "Assessment Ratio",   value: countyPct != null ? `${countyPct.toFixed(1)}%` : "—", sub: "Median assessment ÷ sale (equity study)", color: "border-t-amber-500" },
    { label: "Total Parcels",      value: "112,847",  sub: "Buncombe County",               color: "border-t-slate-500" },
    { label: "Total Assessed",     value: "$24.3B",   sub: "Model-derived",                  color: "border-t-green-500" },
    { label: "Equity Flags",       value: "4,219",    sub: "Properties ±15% off",            color: "border-t-red-500" },
  ];

  return (
    <div className="space-y-6">
      {/* Assessment-to-market ratio — featured at top */}
      <Card className="border-2 border-amber-400 bg-amber-50/50">
        <CardHeader className="py-3 px-4 pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <TrendingDown className="w-5 h-5 text-amber-700" />
            Assessment-to-Market Ratio · Buncombe County
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-4 pb-4">
          {ratiosLoading ? (
            <div className="space-y-4">
              <p className="text-sm text-amber-950/70">Loading assessment ratios from deed sales…</p>
              <div className="h-80 rounded-lg border bg-white animate-pulse" />
            </div>
          ) : zipRatios.length === 0 ? (
            <p className="text-sm text-amber-950">
              No ZIP equity data yet. Run{" "}
              <code className="font-mono text-xs">npm run sync:rod</code> to populate from deed sales.
            </p>
          ) : (
            <>
              <p className="text-sm text-amber-950 leading-relaxed">
                Buncombe County&apos;s median assessment-to-sale ratio is{" "}
                <strong className="text-lg">{countyPct!.toFixed(1)}%</strong>{" "}
                across qualified deed sales since 2020. This measures how assessments compare to
                actual sale prices <em>by ZIP</em> — useful for uniformity and equity analysis, not as a
                per-parcel market appraisal.
              </p>

              <div className="h-80 rounded-lg border bg-white p-2 pt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    margin={{ top: 4, right: 8, left: 0, bottom: 48 }}
                  >
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10 }}
                      angle={-45}
                      textAnchor="end"
                      height={56}
                      interval={0}
                    />
                    <YAxis
                      domain={[yMin, yMax]}
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip formatter={(v: number) => [`${v}%`, "Median Ratio"]} />
                    <Bar dataKey="ratio" fill="#b45309" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <Table>
                <TableHeader>
                  <TableRow className="bg-white/80 hover:bg-white/80">
                    <TableHead>ZIP</TableHead>
                    <TableHead>Area</TableHead>
                    <TableHead className="text-right">Median Ratio</TableHead>
                    <TableHead>vs. sales sample</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {zipRatios.map((z) => {
                    const status = zipEquityRatioStatus(z.ratio);
                    return (
                      <TableRow key={z.zip} className="bg-white/60">
                        <TableCell>
                          <ZipLink zip={z.zip} onOpenZip={onOpenZip} className="text-xs" />
                        </TableCell>
                        <TableCell className="text-sm">{z.area}</TableCell>
                        <TableCell className="text-right font-mono text-sm font-medium">
                          {z.ratio.toFixed(3)}
                        </TableCell>
                        <TableCell>
                          <Badge className={status.badgeClass}>
                            {status.label}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      {/* 2021 → 2026 reappraisal cycle */}
      <Card className="border-2 border-indigo-300 bg-indigo-50/20">
        <CardHeader className="py-3 px-4 pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-indigo-700" />
            2021 → 2026 Reappraisal · Buncombe County
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-4 pb-4">
          {reappraisalLoading ? (
            <p className="text-sm text-muted-foreground">Loading reappraisal cycle data…</p>
          ) : !reappraisal?.county ? (
            <p className="text-sm text-muted-foreground">
              Reappraisal comparison not loaded. Run{" "}
              <code className="font-mono text-xs">node loadProperty2026.mjs</code> to populate 2026 values.
            </p>
          ) : (
            <>
              <p className="text-sm text-indigo-950 leading-relaxed">
                Across <strong>{reappraisal.county.matched_parcels.toLocaleString()}</strong> matched parcels,
                the county-wide <strong>median assessment increase is +{reappraisal.county.county_median_change_pct.toFixed(1)}%</strong>{" "}
                (avg ${(reappraisal.county.avg_2021 / 1e6).toFixed(2)}M → ${(reappraisal.county.avg_2026 / 1e6).toFixed(2)}M).
                Open any parcel in Property Search to see its 2021 baseline and 2026 value side by side.
              </p>
              {reappraisal.zips.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-white/80 hover:bg-white/80">
                      <TableHead>ZIP</TableHead>
                      <TableHead>Area</TableHead>
                      <TableHead className="text-right">Parcels</TableHead>
                      <TableHead className="text-right">Median change</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reappraisal.zips.map((z) => (
                      <TableRow key={z.zip} className="bg-white/60">
                        <TableCell>
                          <ZipLink zip={z.zip} onOpenZip={onOpenZip} className="text-xs" />
                        </TableCell>
                        <TableCell className="text-sm">{z.name}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{z.parcel_count.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-sm font-medium">
                          +{z.median_change_pct.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {reappraisal.tax_equity && (
                <div className="rounded-lg border-2 border-indigo-300 bg-white p-4 space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-indigo-950">
                      Imputed tax impact of reappraisal disparity
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {reappraisal.tax_equity.methodology}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                      {
                        label: "ZIP median spread",
                        value: `${reappraisal.tax_equity.zip_median_spread_pts.toFixed(1)} pts`,
                        sub: reappraisal.tax_equity.lowest_zip && reappraisal.tax_equity.highest_zip
                          ? `${reappraisal.tax_equity.lowest_zip.name} → ${reappraisal.tax_equity.highest_zip.name}`
                          : "Lowest vs highest ZIP",
                      },
                      {
                        label: "Under-shifted value",
                        value: fmtB(reappraisal.tax_equity.under_assessed_value),
                        sub: `${reappraisal.tax_equity.under_assessed_share_pct}% of 2026 tax base`,
                      },
                      {
                        label: "Imputed annual tax gap",
                        value: fmtB(reappraisal.tax_equity.imputed_annual_tax_shortfall),
                        sub: `At ${reappraisal.tax_equity.effective_tax_rate_pct}% effective levy rate`,
                      },
                      {
                        label: "Value-weighted gap",
                        value: `${reappraisal.tax_equity.value_weighted_median_gap_pts > 0 ? "+" : ""}${reappraisal.tax_equity.value_weighted_median_gap_pts} pts`,
                        sub: "ZIP median vs county, weighted by 2026 value",
                      },
                    ].map(({ label, value, sub }) => (
                      <div key={label} className="rounded border bg-indigo-50/50 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
                        <p className="text-lg font-serif font-semibold mt-0.5">{value}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
                      </div>
                    ))}
                  </div>

                  <p className="text-xs text-indigo-900 leading-relaxed">
                    Parcels that received a <strong>smaller % increase than the county median</strong>{" "}
                    (+{reappraisal.tax_equity.county_median_change_pct.toFixed(1)}%) hold roughly{" "}
                    <strong>{fmtB(reappraisal.tax_equity.under_assessed_value)}</strong> in assessed value
                    that would be higher under a uniform median increase — imputing about{" "}
                    <strong>{fmtB(reappraisal.tax_equity.imputed_annual_tax_shortfall)}/year</strong> in
                    property taxes not captured vs. that counterfactual. ZIPs with steeper increases carry
                    the offsetting surplus (~{fmtB(reappraisal.tax_equity.imputed_annual_tax_surplus)}/yr).
                  </p>

                  {reappraisal.tax_equity.zips.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-indigo-50/80 hover:bg-indigo-50/80">
                          <TableHead>ZIP</TableHead>
                          <TableHead className="text-right">Med. Δ</TableHead>
                          <TableHead className="text-right">vs county</TableHead>
                          <TableHead className="text-right">% of base</TableHead>
                          <TableHead className="text-right">Under-shifted</TableHead>
                          <TableHead className="text-right">Imputed tax/yr</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reappraisal.tax_equity.zips.map((z: Record<string, number | string>) => (
                          <TableRow key={String(z.zip)}>
                            <TableCell>
                              <ZipLink zip={String(z.zip)} onOpenZip={onOpenZip} className="text-xs" />
                              <span className="text-[10px] text-muted-foreground ml-1">{z.name}</span>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">+{Number(z.median_change_pct).toFixed(1)}%</TableCell>
                            <TableCell className={`text-right font-mono text-xs ${
                              Number(z.vs_county_median_pts) > 0 ? "text-amber-800" : "text-green-800"
                            }`}>
                              {Number(z.vs_county_median_pts) > 0 ? "+" : ""}{Number(z.vs_county_median_pts).toFixed(1)} pts
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">{Number(z.share_of_county_value_pct).toFixed(1)}%</TableCell>
                            <TableCell className="text-right font-mono text-xs">{fmtB(Number(z.under_assessed_value))}</TableCell>
                            <TableCell className="text-right font-mono text-xs font-medium">
                              {fmtB(Number(z.imputed_annual_tax_shortfall))}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className={`border-t-4 ${s.color}`}>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{s.label}</p>
              <p className="text-2xl font-serif font-semibold mt-1">{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent parcels */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-3 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            🏠 Recently Loaded Parcels
            <Badge className="bg-green-100 text-green-700 text-[10px]">Live GIS</Badge>
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="w-3 h-3 mr-1" /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PIN</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Assessed</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Loading live parcel data…
                  </TableCell>
                </TableRow>
              )}
              {data?.parcels.map((p) => (
                <TableRow key={p.PIN}>
                  <TableCell className="font-mono text-xs">{p.PIN}</TableCell>
                  <TableCell className="text-sm font-medium">{p.SITEADDRESS}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.OWNER?.slice(0, 28)}</TableCell>
                  <TableCell className="font-mono text-sm">{fmt(p.TOTALVALUE)}</TableCell>
                  <TableCell className="font-mono text-sm">{fmt(p.model_value)}</TableCell>
                  <TableCell><VarianceBadge pct={p.variance_pct} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Data source status */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-semibold">📡 Data Source Status</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead><TableHead>Type</TableHead>
                <TableHead>Status</TableHead><TableHead>Refresh</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { name: "Buncombe County ArcGIS",    sub: "arcgis.ashevillenc.gov",     type: "ArcGIS REST",   status: "Connected",    refresh: "Daily 6am" },
                { name: "Spatialest PRC System",     sub: "prc-buncombe.spatialest.com", type: "Vendor",        status: "Connected",    refresh: "Live on View" },
                { name: "NC Register of Deeds",       sub: "Sale comps / deed stamps",   type: "Public Records", status: "Available",   refresh: "Weekly" },
                { name: "US Census ACS",              sub: "Demographics layer",          type: "Public API",    status: "Available",    refresh: "Annual" },
              ].map((s) => (
                <TableRow key={s.name}>
                  <TableCell>
                    <div className="font-medium text-sm">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.sub}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{s.type}</Badge></TableCell>
                  <TableCell>
                    <Badge className={s.status === "Connected" || s.status === "Available"
                      ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}>
                      {s.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.refresh}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  ZIP EQUITY SAMPLE (drill-down from Equity / Dashboard)
// ════════════════════════════════════════════════════════════════════════
function ZipEquitySampleView({ zip, onBack }: { zip: string; onBack: () => void }) {
  type SampleSort = "ratio_asc" | "ratio_desc" | "assessed_desc" | "sale_desc";
  const [sort, setSort] = useState<SampleSort>("ratio_asc");
  const [detailPin, setDetailPin] = useState<string | null>(null);
  const [detailAddress, setDetailAddress] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = trpc.parceliq.zipEquitySample.useQuery({ zip, sort, limit: 200 });

  const commercialCount = data?.parcels.filter((p) => p.likelyCommercial).length ?? 0;
  const commercialPct = data?.parcels.length
    ? Math.round((commercialCount / data.parcels.length) * 100)
    : 0;

  const openDetail = (pin: string, address: string) => {
    setDetailPin(pin);
    setDetailAddress(address);
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button size="sm" variant="ghost" className="-ml-2 mb-2" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Property Explorer
          </Button>
          <h2 className="text-lg font-semibold">
            ZIP {zip} · {data?.zipName ?? "…"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Properties with qualified Register of Deeds sales since 2020 that feed the ZIP median ratio.
            These are the evidence behind the equity study — open any row for a parcel-specific market estimate.
          </p>
        </div>
        {data?.summary && (
          <div className="text-right shrink-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Median ratio</p>
            <p className="text-2xl font-serif font-semibold">{data.summary.medianRatioPct}%</p>
            <p className="text-xs text-muted-foreground">{data.total} matched parcels</p>
          </div>
        )}
      </div>

      {zip === "28801" && data && (
        <Card className="border border-slate-300 bg-slate-50">
          <CardContent className="pt-4 text-sm text-slate-800 space-y-2">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 mt-0.5 shrink-0 text-slate-500" />
              <div>
                <p className="font-medium">Downtown mix: commercial vs residential</p>
                <p className="text-muted-foreground mt-1 leading-relaxed">
                  ZIP 28801 is heavily commercial. About{" "}
                  <strong>{commercialCount} of {data.parcels.length}</strong> sample properties
                  ({commercialPct}%) have owner names suggesting a business entity (LLC, Inc., etc.).
                  A low median assessment ratio here may reflect commercial valuation methods,
                  post–Hurricane Helene recovery policies, or which properties happened to sell
                  recently — not necessarily the same pattern as residential neighborhoods.
                  Review individual parcels below to see what is driving the ZIP median.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-3">
        <Label className="text-xs text-muted-foreground shrink-0">Sort by</Label>
        <Select value={sort} onValueChange={(v) => setSort(v as SampleSort)}>
          <SelectTrigger className="w-56 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ratio_asc">Assessment ratio (lowest first)</SelectItem>
            <SelectItem value="ratio_desc">Assessment ratio (highest first)</SelectItem>
            <SelectItem value="assessed_desc">Assessed value (highest first)</SelectItem>
            <SelectItem value="sale_desc">Sale price (highest first)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-semibold">
            {isLoading ? "Loading…" : `${data?.total ?? 0} properties in equity sample`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Address</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Assessed</TableHead>
                <TableHead className="text-right">Sale price</TableHead>
                <TableHead className="text-right">Sale date</TableHead>
                <TableHead className="text-right">Ratio</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                    Loading equity sample…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && !data?.parcels.length && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                    No matched sales found for this ZIP.
                  </TableCell>
                </TableRow>
              )}
              {data?.parcels.map((p) => (
                <TableRow key={p.pin} className={p.ratio < 0.7 ? "bg-amber-50/50" : ""}>
                  <TableCell className="text-sm font-medium max-w-[200px]">
                    <div className="truncate">{p.address || "—"}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{p.pin}</div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[160px]">
                    <div className="truncate">{p.owner || "—"}</div>
                    {p.likelyCommercial && (
                      <Badge variant="outline" className="mt-1 text-[10px] py-0">Likely commercial</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmt(p.assessed)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmt(p.salePrice)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{p.sellDate ?? "—"}</TableCell>
                  <TableCell className={`text-right font-mono text-sm font-semibold ${
                    p.ratioPct < 70 ? "text-amber-700" : p.ratioPct > 100 ? "text-red-700" : "text-green-700"
                  }`}>
                    {p.ratioPct}%
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => openDetail(p.pin, p.address)}>
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {detailPin && (
        <div ref={detailRef} className="scroll-mt-4">
          <Card className="border-2 border-slate-800 shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between py-4 px-4">
              <div>
                <CardTitle className="text-lg font-serif">{detailAddress}</CardTitle>
                <p className="text-xs text-muted-foreground mt-1 font-mono">{detailPin}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => { setDetailPin(null); setDetailAddress(null); }}>
                Close
              </Button>
            </CardHeader>
            <CardContent className="px-4 pb-6">
              <ParcelDetailFetcher key={detailPin} pin={detailPin} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  PROPERTY EXPLORER
// ════════════════════════════════════════════════════════════════════════
function ExplorerTab({
  zipSample,
  onClearZipSample,
}: {
  zipSample: string | null;
  onClearZipSample: () => void;
}) {
  if (zipSample) {
    return <ZipEquitySampleView zip={zipSample} onBack={onClearZipSample} />;
  }

  return <ExplorerSearchView />;
}

function ExplorerSearchView() {
  const [q, setQ]         = useState("");
  const [classCd, setCls] = useState<string>("");
  const [search, setSearch] = useState("");
  const [detailPin, setDetailPin] = useState<string | null>(null);
  const [detailAddress, setDetailAddress] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isFetching } = trpc.parceliq.searchParcels.useQuery(
    { q: search || undefined, classCd: classCd || undefined, limit: 25 },
    { keepPreviousData: true }
  );

  const openDetail = (pin: string, address: string) => {
    setDetailPin(pin);
    setDetailAddress(address);
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const closeDetail = () => {
    setDetailPin(null);
    setDetailAddress(null);
  };

  const runSearch = () => {
    closeDetail();
    setSearch(q);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Property Explorer</h2>
        <p className="text-sm text-muted-foreground">Live search across Buncombe County's 112,847 parcels.</p>
      </div>

      {/* Search bar */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search address or owner name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
          />
        </div>
        <Select value={classCd} onValueChange={setCls}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All classes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All classes</SelectItem>
            <SelectItem value="R">Residential</SelectItem>
            <SelectItem value="C">Commercial</SelectItem>
            <SelectItem value="A">Agricultural</SelectItem>
            <SelectItem value="I">Industrial</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={runSearch} disabled={isFetching}>
          {isFetching ? "Searching…" : "Search"}
        </Button>
      </div>

      <Card>
        <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold">
            {data ? `${data.count} Result${data.count !== 1 ? "s" : ""}` : "Results"}
            {data?.exceededLimit && " (showing first 25)"}
          </CardTitle>
          <Badge className="bg-green-100 text-green-700 text-[10px]">Live GIS</Badge>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PIN</TableHead><TableHead>Address</TableHead>
                <TableHead>Owner</TableHead><TableHead>Acres</TableHead>
                <TableHead>County Assessed</TableHead><TableHead>Model Value</TableHead>
                <TableHead>Variance</TableHead>
                <TableHead title="How closely county assessment aligns with market estimate (100 = match)">Alignment</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                    Querying Buncombe County GIS…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && !data?.parcels.length && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                    No parcels found. Try a different search.
                  </TableCell>
                </TableRow>
              )}
              {data?.parcels.map((p) => (
                <TableRow
                  key={p.PIN}
                  className={`${p.flagged ? "bg-red-50/40" : ""} ${detailPin === p.PIN ? "bg-slate-100" : ""}`}
                >
                  <TableCell className="font-mono text-[11px]">{p.PIN}</TableCell>
                  <TableCell className="font-medium text-sm max-w-[180px] truncate">{p.SITEADDRESS}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">{p.OWNER}</TableCell>
                  <TableCell className="font-mono text-xs">{p.CALCACREAGE?.toFixed(2) ?? "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{fmt(p.TOTALVALUE)}</TableCell>
                  <TableCell className="font-mono text-sm">{fmt(p.model_value)}</TableCell>
                  <TableCell><VarianceBadge pct={p.variance_pct} /></TableCell>
                  <TableCell><ScorePill score={p.equity_score} /></TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant={detailPin === p.PIN ? "default" : "outline"}
                      onClick={() => openDetail(p.PIN, p.SITEADDRESS)}
                    >
                      {detailPin === p.PIN ? "Selected" : "View"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {detailPin && (
        <div ref={detailRef} className="scroll-mt-4">
        <Card className="border-2 border-slate-800 shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between py-4 px-4">
            <div>
              <CardTitle className="text-lg font-serif">{detailAddress}</CardTitle>
              <p className="text-xs text-muted-foreground mt-1 font-mono">{detailPin}</p>
            </div>
            <Button size="sm" variant="outline" onClick={closeDetail}>
              Close
            </Button>
          </CardHeader>
          <CardContent className="px-4 pb-6">
            <ParcelDetailFetcher key={detailPin} pin={detailPin} />
          </CardContent>
        </Card>
        </div>
      )}
    </div>
  );
}

function ParcelDetailFetcher({ pin }: { pin: string }) {
  const { data, isLoading, isError, error, isFetching } =
    trpc.parceliq.getParcel.useQuery({ pin }, { retry: 1 });

  const dataMatchesPin = data ? pinsMatch(data.PIN, pin) : false;

  if (isError && !isFetching) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        <p className="font-semibold">Could not load property detail</p>
        <p className="mt-1">{error.message}</p>
      </div>
    );
  }
  if (isLoading || isFetching || !dataMatchesPin) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Loading valuation detail… fetching live Spatialest PRC when available.</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No detail returned for this parcel.</p>;
  }
  return <ParcelDetailBody data={data as Record<string, any>} />;
}

function ParcelNarrativePanel({ narrative }: { narrative: Record<string, any> }) {
  const sections = (narrative.sections as Array<Record<string, any>>) ?? [];
  const tldr = (narrative.tldr as string[]) ?? [];

  return (
    <Card className="border-2 border-amber-400 bg-gradient-to-br from-amber-50 to-white shadow-sm">
      <CardHeader className="py-3 px-4 pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-amber-950">
          <BookOpen className="w-4 h-4 text-amber-700" />
          Plain-English summary
        </CardTitle>
        <p className="text-sm font-serif text-slate-900 mt-2 leading-relaxed">
          {narrative.headline}
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        {tldr.length > 0 && (
          <ul className="space-y-1.5 text-sm text-slate-800 bg-white/80 rounded-lg border border-amber-200 px-4 py-3">
            {tldr.map((line) => (
              <li key={line} className="flex items-start gap-2">
                <span className="text-amber-600 mt-0.5">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-4">
          {sections.map((section) => (
            <div key={section.id} className="border-t border-amber-100 pt-3 first:border-0 first:pt-0">
              <h4 className="text-xs font-bold uppercase tracking-wide text-amber-900 mb-2">
                {section.title}
              </h4>
              {section.paragraphs?.map((p: string) => (
                <p key={p.slice(0, 40)} className="text-sm text-slate-700 leading-relaxed mb-2">
                  {p}
                </p>
              ))}
              {section.bullets?.length > 0 && (
                <ul className="space-y-1.5 text-sm text-slate-700 list-disc list-inside">
                  {section.bullets.map((b: string) => (
                    <li key={b.slice(0, 48)} className="leading-relaxed">{b}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        <p className="text-[10px] text-muted-foreground border-t border-amber-100 pt-3 leading-relaxed">
          {narrative.disclaimer}
        </p>
      </CardContent>
    </Card>
  );
}

function ReappraisalYoYPanel({ yoy }: { yoy: Record<string, any> }) {
  const pct = Number(yoy.change_pct);
  const pctLabel = `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
  const vsZip = yoy.vs_zip_median_pts as number | null;
  const vsZipLabel =
    vsZip == null
      ? null
      : vsZip > 2
        ? `${vsZip.toFixed(1)} pts above ZIP median`
        : vsZip < -2
          ? `${Math.abs(vsZip).toFixed(1)} pts below ZIP median`
          : "Near ZIP median";

  return (
    <Card className="border-2 border-indigo-200 bg-indigo-50/30">
      <CardHeader className="py-3 px-4 pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-indigo-700" />
          2021 → 2026 Reappraisal
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Buncombe County tax roll baseline (2021 cycle) vs. 2026 reappraisal file — separate from market estimate.
        </p>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-stretch">
          <div className="rounded-lg border bg-white p-4 text-center">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">2021 baseline</div>
            <div className="text-xl font-serif font-semibold mt-1">{fmt(yoy.value_2021)}</div>
            <div className="text-[10px] text-muted-foreground mt-1">Prior cycle tax roll</div>
          </div>
          <div className="rounded-lg border-2 border-indigo-300 bg-indigo-50 p-4 text-center flex flex-col justify-center">
            <div className="text-[10px] uppercase tracking-wide text-indigo-800 font-medium">Change</div>
            <div className="text-2xl font-serif font-semibold mt-1 text-indigo-950">{pctLabel}</div>
            <div className="text-xs text-indigo-800 mt-1">
              {yoy.change_amt > 0 ? "+" : ""}{fmt(yoy.change_amt)}
            </div>
          </div>
          <div className="rounded-lg border bg-white p-4 text-center">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">2026 reappraisal</div>
            <div className="text-xl font-serif font-semibold mt-1">{fmt(yoy.value_2026)}</div>
            <div className="text-[10px] text-muted-foreground mt-1">2026 county file</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-[11px]">
          {yoy.zip_name && (
            <span className="bg-white border rounded px-2 py-1">
              ZIP {yoy.zipcode} ({yoy.zip_name})
              {yoy.zip_median_change_pct != null && (
                <> · median <strong>+{Number(yoy.zip_median_change_pct).toFixed(1)}%</strong></>
              )}
            </span>
          )}
          {yoy.county_median_change_pct != null && (
            <span className="bg-white border rounded px-2 py-1">
              County median <strong>+{Number(yoy.county_median_change_pct).toFixed(1)}%</strong>
            </span>
          )}
          {vsZipLabel && (
            <span className={`border rounded px-2 py-1 ${
              vsZip != null && vsZip > 2
                ? "bg-amber-50 border-amber-200 text-amber-900"
                : vsZip != null && vsZip < -2
                  ? "bg-green-50 border-green-200 text-green-900"
                  : "bg-white"
            }`}>
              This parcel: {vsZipLabel}
            </span>
          )}
          {yoy.neighborhood_code && (
            <span className="bg-white border rounded px-2 py-1 text-muted-foreground">
              Neighborhood {yoy.neighborhood_code}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ParcelDetailBody({ data }: { data: Record<string, any> }) {
  const v = data.valuation as Record<string, any> | undefined;
  const freshness = data.data_freshness as Record<string, any> | undefined;
  const prc = (v?.prc ?? data.prc) as Record<string, any> | undefined;
  const taxRoll = v?.tax_roll_assessment ?? data.TOTALVALUE;
  const fairValue = v?.market_estimate?.value ?? v?.fair_market_value ?? data.model_value;
  const equityExtrap = v?.equity_extrapolation?.value as number | undefined;
  const marketEst = v?.market_estimate as Record<string, any> | undefined;
  const assessed = v?.county_assessment ?? v?.prc_assessment ?? data.TOTALVALUE;
  const varPct = v?.variance_pct ?? data.variance_pct;
  const verdict = v?.verdict as string | undefined;

  const verdictStyles =
    verdict === "over_assessed"
      ? "bg-red-50 border-red-200 text-red-900"
      : verdict === "under_assessed"
        ? "bg-amber-50 border-amber-200 text-amber-900"
        : "bg-green-50 border-green-200 text-green-900";

  const warnings = (freshness?.warnings as Array<Record<string, string>> | undefined) ?? [];
  const reappraisalYoY = data.reappraisal_yoy as Record<string, any> | null | undefined;
  const narrative = data.narrative as Record<string, any> | undefined;

  return (
    <div className="space-y-5">
      {/* Headline — three boxes first */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border-2 border-blue-200 bg-blue-50/40 p-4 text-center">
          <div className="text-xs text-blue-900 font-medium uppercase tracking-wide">County Assessment</div>
          <div className="text-2xl font-serif font-semibold mt-1 text-blue-950">{fmt(assessed)}</div>
          <div className="text-[10px] text-muted-foreground mt-1">
            {prc ? "Spatialest PRC (live)" : "Tax roll snapshot"}
          </div>
          {prc && taxRoll != null && taxRoll !== assessed && (
            <div className="text-[10px] text-amber-700 mt-0.5">Roll: {fmt(taxRoll)}</div>
          )}
        </div>
        <div className="rounded-lg border-2 border-slate-800 p-4 text-center bg-slate-900 text-white shadow-lg">
          <div className="text-xs text-amber-300 font-medium uppercase tracking-wide">Market Estimate</div>
          <div className="text-2xl font-serif font-semibold mt-1">{fmt(fairValue)}</div>
          <div className="text-[10px] text-slate-300 mt-1">
            {marketEst?.method_label ?? "Parcel-specific evidence"}
            {marketEst?.confidence && (
              <span> · {marketEst.confidence} confidence</span>
            )}
          </div>
          {marketEst?.range_low != null && marketEst?.range_high != null && fairValue != null && (
            <div className="text-[10px] text-slate-400 mt-1">
              Range: {fmt(marketEst.range_low)}–{fmt(marketEst.range_high)}
            </div>
          )}
        </div>
        <div className={`rounded-lg border-2 p-4 text-center ${
          Math.abs(varPct ?? 0) > 15 ? "bg-red-50 border-red-300" : "bg-green-50 border-green-300"
        }`}>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">vs. Market Estimate</div>
          <div className={`text-2xl font-serif font-semibold mt-1 ${
            Math.abs(varPct ?? 0) > 15 ? "text-red-700" : "text-green-700"
          }`}>
            {varPct != null ? `${varPct > 0 ? "+" : ""}${varPct}%` : "—"}
          </div>
          {v?.gap_dollars != null && (
            <div className="text-[10px] text-muted-foreground mt-1">
              {v.gap_dollars > 0 ? "+" : ""}{fmt(v.gap_dollars)} vs estimate
            </div>
          )}
        </div>
      </div>

      {narrative && <ParcelNarrativePanel narrative={narrative} />}

      {reappraisalYoY && <ReappraisalYoYPanel yoy={reappraisalYoY} />}

      {v?.verdict_label && (
        <div className={`rounded-lg border px-4 py-3 ${verdictStyles}`}>
          <div className="flex items-center gap-2 font-semibold">
            {verdict === "over_assessed" ? (
              <AlertTriangle className="w-4 h-4" />
            ) : verdict === "under_assessed" ? (
              <TrendingDown className="w-4 h-4" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            {v.verdict_label}
          </div>
          <p className="text-sm mt-1 opacity-90">{v.verdict_summary}</p>
        </div>
      )}

      <MarketEstimatePriorityPanel marketEst={marketEst} fairValue={fairValue} />

      {fairValue != null && (
        <p className="text-sm text-slate-600 leading-relaxed px-1">
          {marketEstimateExplainer(v)}
        </p>
      )}

      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((w) => (
            <div
              key={w.code}
              className={`rounded-lg border px-4 py-3 text-sm ${
                w.severity === "warning"
                  ? "bg-amber-50 border-amber-300 text-amber-950"
                  : "bg-blue-50 border-blue-200 text-blue-950"
              }`}
            >
              <div className="flex items-start gap-2 font-semibold">
                {w.severity === "warning" ? (
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                {w.title}
              </div>
              <p className="mt-1 text-xs leading-relaxed opacity-90">{w.detail}</p>
            </div>
          ))}
        </div>
      )}

      {/* Supporting evidence */}
      {v?.comparable_sales?.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            This parcel&apos;s qualified sales
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sale Date</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">vs Assessment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {v.comparable_sales.map((sale: Record<string, any>, i: number) => {
                const ratio = assessed && sale.selling_price
                  ? (assessed / sale.selling_price) * 100
                  : null;
                return (
                  <TableRow key={i}>
                    <TableCell className="text-sm">{fmtDate(sale.sell_date)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmt(sale.selling_price)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {ratio != null ? `${ratio.toFixed(1)}%` : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {v?.nearby_comps?.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Nearby comparable sales · same ZIP
            </p>
            {v?.comp_matching?.summary && (
              <span className="text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200">
                {v.comp_matching.summary}
              </span>
            )}
          </div>
          {v?.comp_matching?.filters_applied?.length > 0 && (
            <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc list-inside">
              {v.comp_matching.filters_applied.map((f: string) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Address</TableHead>
                <TableHead>Sale Date</TableHead>
                <TableHead className="text-right">Sale Price</TableHead>
                <TableHead className="text-right">Sq Ft</TableHead>
                <TableHead className="text-right">Year</TableHead>
                <TableHead className="text-right">Assessed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {v.nearby_comps.map((comp: Record<string, any>) => (
                <TableRow key={comp.pin}>
                  <TableCell className="text-sm max-w-[200px] truncate">{comp.address ?? comp.pin}</TableCell>
                  <TableCell className="text-sm">{fmtDate(comp.sell_date)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmt(comp.selling_price)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{comp.sqft != null ? comp.sqft.toLocaleString() : "—"}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{comp.year_built ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmt(comp.assessed)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {equityExtrap != null && (
        <div className="rounded-lg border border-amber-300 bg-amber-50/60 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-900 mb-2">
            ZIP equity extrapolation (uniformity only — not the market estimate)
          </p>
          <div className="flex flex-wrap items-baseline gap-3 mb-2">
            <span className="text-2xl font-serif font-semibold text-amber-950">{fmt(equityExtrap)}</span>
            {v?.equity_extrapolation?.metro_adjusted_value != null &&
              v.equity_extrapolation.metro_adjusted_value !== equityExtrap && (
              <span className="text-sm text-amber-800">
                Metro-adjusted: {fmt(v.equity_extrapolation.metro_adjusted_value)}
              </span>
            )}
          </div>
          <p className="text-sm text-amber-950/90 leading-relaxed">{equityExtrapolationExplainer(v)}</p>
        </div>
      )}

      {/* Property facts */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
        {[
          ["PIN", data.PIN],
          ["Owner", data.OWNER],
          ["ZIP", data.POSTAL_CODE],
          ["Class", data.CLASSCD],
          ["Acres", data.CALCACREAGE != null ? (+data.CALCACREAGE).toFixed(3) + " ac" : "—"],
          ["City", data.CITY ?? "—"],
        ].map(([label, value]) => (
          <div key={label} className="bg-neutral-50 rounded border px-3 py-2">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
            <div className="font-medium mt-0.5 truncate text-sm">{fmtCell(value)}</div>
          </div>
        ))}
      </div>

      {/* 4. PRC official record */}
      {prc && <PrcRecordCard prc={prc} taxRollAssessment={v?.tax_roll_assessment} />}

      {/* 5. Data sources */}
      {freshness && <DataFreshnessPanel freshness={freshness} />}

      {/* 6. Calculation timeline */}
      {v?.steps?.length > 0 && (
        <Card>
          <CardHeader className="py-3 px-4 pb-2">
            <CardTitle className="text-sm font-semibold">Valuation timeline</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Step-by-step record of inputs, the market estimate path, and equity context shown separately.
            </p>
          </CardHeader>
          <CardContent className="px-4 pb-5">
            <ValuationTimeline steps={v.steps} />
          </CardContent>
        </Card>
      )}

      {v?.zip_equity && (
        <Card className="border-amber-200">
          <CardHeader className="py-3 px-4 pb-1">
            <CardTitle className="text-sm font-semibold">
              ZIP {v.zip_equity.zip_code} · {v.zip_equity.zip_name} · equity study
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2 text-sm">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Median assessment-to-sale ratio from {v.zip_equity.sample_count} matched deed sales — uniformity analysis only.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <div className="text-xs text-muted-foreground">Median ratio</div>
                <div className="font-mono font-semibold">{Number(v.zip_equity.median_ratio).toFixed(3)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Samples</div>
                <div className="font-semibold">{v.zip_equity.sample_count}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Avg assessed</div>
                <div className="font-semibold">{fmt(v.zip_equity.avg_assessed)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Avg sale</div>
                <div className="font-semibold">{fmt(v.zip_equity.avg_sale_price)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {v?.zillow && (
        <Card className="border-blue-200 bg-blue-50/40">
          <CardHeader className="py-3 px-4 pb-1">
            <CardTitle className="text-sm font-semibold">Metro price trend · {v.zillow.metro_name}</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3 text-sm">
            <p className="text-xs text-blue-900 leading-relaxed">
              ZHVI is a regional index — not a Zestimate for this address. Used only for time-adjusting old sales or equity extrapolation.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-muted-foreground">ZHVI</div>
                <div className="font-medium">
                  ${Number(v.zillow.zhvi_base ?? 0).toLocaleString()} → ${Number(v.zillow.zhvi_current ?? 0).toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Median sale</div>
                <div className="font-medium">
                  ${Number(v.zillow.median_sale_base ?? 0).toLocaleString()} → ${Number(v.zillow.median_sale_current ?? 0).toLocaleString()}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!v?.zillow && !v?.zip_equity && (
        <p className="text-xs text-muted-foreground bg-neutral-50 rounded p-3">
          Run <code className="font-mono">npm run sync:rod</code> to populate deed sales and ZIP equity ratios.
        </p>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  REVENUE TARGETING
// ════════════════════════════════════════════════════════════════════════
function RevenueTab() {
  const [target,     setTarget]     = useState(285_000_000);
  const [totalAV,    setTotalAV]    = useState(24_300_000_000);
  const [exemptions, setExemptions] = useState(1_200_000_000);
  const [rate,       setRate]       = useState(0.97);

  const calc = trpc.parceliq.calcRevenue.useMutation();

  const run = () => calc.mutate({
    targetRevenue:      target,
    totalAssessedValue: totalAV,
    exemptions,
    collectionRate:     rate,
  });

  const r = calc.data;

  const chartData = r ? Object.entries(r.classBreakdown).map(([cls, v]) => ({
    name: cls, revenue: Math.round(v.estimatedRevenue / 1e6),
  })) : [];

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold">Revenue Targeting</h2>
        <p className="text-sm text-muted-foreground">
          Input your county's budget goal — Parcelogik derives a scientifically fair millage rate.
        </p>
      </div>

      <Card className="bg-slate-900 text-white border-0">
        <CardContent className="pt-6 space-y-6">
          <div>
            <h3 className="text-lg font-serif text-white">Budget & Millage Calculator</h3>
            <p className="text-sm text-slate-400 mt-1">Enter target revenue, exemptions, and collection rate.</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Target Revenue ($)", val: target, set: setTarget, currency: true },
              { label: "Total Assessed Value ($)", val: totalAV, set: setTotalAV, currency: true },
              { label: "Exemptions ($)", val: exemptions, set: setExemptions, currency: true },
              { label: "Collection Rate (0-1)", val: rate, set: setRate, currency: false },
            ].map(({ label, val, set, currency }) => (
              <div key={label}>
                <Label className="text-xs text-slate-400 uppercase tracking-wide">{label}</Label>
                <Input
                  type={currency ? "text" : "number"}
                  inputMode={currency ? "numeric" : "decimal"}
                  value={currency ? fmtNum(val) : val}
                  onChange={(e) => set(currency ? parseAmountInput(e.target.value) : Number(e.target.value))}
                  className="mt-1 bg-slate-800 border-slate-700 text-white"
                />
              </div>
            ))}
          </div>

          <Button onClick={run} disabled={calc.isLoading} className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold">
            {calc.isLoading ? "Calculating…" : "Calculate Millage Rate ↗"}
          </Button>

          {r && (
            <>
              <Separator className="border-slate-700" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Taxable Value", val: fmt(r.taxableValue) },
                  { label: "Millage Rate", val: `${r.millageRateCents.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}¢` },
                  { label: "Avg Tax Bill", val: fmt(r.avgTaxBillMedianHome) },
                  { label: "Projected Collection", val: fmt(r.projectedCollection) },
                  { label: "Target Revenue", val: fmt(r.targetRevenue) },
                  { label: "Gap vs Target", val: fmt(r.gap) },
                ].map(({ label, val }) => (
                  <div key={label}>
                    <div className="text-xs text-slate-400 uppercase tracking-wide">{label}</div>
                    <div className="text-xl sm:text-2xl font-serif text-amber-300 mt-1">{val}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {r && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-semibold">Tax Burden by Property Class</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48 mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${Number(v).toLocaleString("en-US")}M`} />
                  <Tooltip formatter={(v: number) => [fmt(v * 1_000_000), "Est. Revenue"]} />
                  <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={["#1e3a5f","#c9a84c","#1a6b4a","#b8640a"][i % 4]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Class</TableHead><TableHead>Parcels</TableHead>
                  <TableHead>Assessed Value</TableHead><TableHead>Est. Revenue</TableHead>
                  <TableHead>Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(r.classBreakdown).map(([cls, v]) => (
                  <TableRow key={cls}>
                    <TableCell><Badge variant="outline">{cls}</Badge></TableCell>
                    <TableCell>{fmtNum(v.parcels)}</TableCell>
                    <TableCell className="font-mono">{fmt(v.assessedValue)}</TableCell>
                    <TableCell className="font-mono">{fmt(v.estimatedRevenue)}</TableCell>
                    <TableCell>{v.sharePct.toLocaleString("en-US", { maximumFractionDigits: 0 })}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  EQUITY ANALYSIS
// ════════════════════════════════════════════════════════════════════════
function EquityTab({ onOpenZip }: { onOpenZip: (zip: string) => void }) {
  const { data, isLoading } = trpc.parceliq.equitySummary.useQuery();
  type SortKey = "medianVariancePct" | "zip" | "parcelCount" | "medianRatio" | "flagRatePct";
  const [sortKey, setSortKey] = useState<SortKey>("medianVariancePct");
  const [sortAsc, setSortAsc] = useState(true);

  const sortedZips = [...(data?.zipCodes ?? [])].sort((a, b) => {
    const av = a[sortKey] as number | string;
    const bv = b[sortKey] as number | string;
    if (typeof av === "string" && typeof bv === "string") {
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sortAsc ? Number(av) - Number(bv) : Number(bv) - Number(av);
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(key === "medianVariancePct");
    }
  };

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Equity Analysis</h2>
        <p className="text-sm text-muted-foreground">
          Sales ratio study by ZIP — measures whether assessments are applied uniformly relative to
          qualified deed sales. This is an <strong>equity / uniformity</strong> view, not a per-parcel
          market appraisal. Click a ZIP to inspect the matched properties.
        </p>
      </div>

      {data?.summary && (
        <Card className="border-2 border-amber-400 bg-amber-50/50">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Assessment equity spread</p>
            <p className="text-2xl font-serif font-semibold mt-1 text-amber-950">
              {data.summary.ratioSpreadPct} percentage point gap
            </p>
            <p className="text-sm text-amber-900 mt-2 leading-relaxed">
              Between ZIPs, the median assessment-to-sale ratio varies by{" "}
              <strong>{data.summary.ratioSpreadPct} percentage points</strong> — from{" "}
              {(data.summary.minRatio * 100).toFixed(1)}% ({data.summary.minRatio.toFixed(3)}) to{" "}
              {(data.summary.maxRatio * 100).toFixed(1)}% ({data.summary.maxRatio.toFixed(3)}).
              A wider spread suggests assessments may not be applied uniformly across neighborhoods.
              Parcel detail pages use comparable sales for market estimates — not this ZIP-wide extrapolation.
            </p>
          </CardContent>
        </Card>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading equity data…</p>}

      {!isLoading && data?.zipCodes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No ZIP equity data yet. Run <code className="font-mono text-xs">npm run sync:rod</code> to populate from deed sales.
        </p>
      )}

      {sortedZips.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button type="button" className="font-semibold hover:underline" onClick={() => toggleSort("zip")}>
                      ZIP{sortIndicator("zip")}
                    </button>
                  </TableHead>
                  <TableHead>Area</TableHead>
                  <TableHead className="text-right">
                    <button type="button" className="font-semibold hover:underline ml-auto" onClick={() => toggleSort("parcelCount")}>
                      Samples{sortIndicator("parcelCount")}
                    </button>
                  </TableHead>
                  <TableHead className="text-right">Avg assessed</TableHead>
                  <TableHead className="text-right">Implied market</TableHead>
                  <TableHead className="text-right">
                    <button type="button" className="font-semibold hover:underline ml-auto" onClick={() => toggleSort("medianRatio")}>
                      Median ratio{sortIndicator("medianRatio")}
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button type="button" className="font-semibold hover:underline ml-auto" onClick={() => toggleSort("medianVariancePct")}>
                      Variance{sortIndicator("medianVariancePct")}
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button type="button" className="font-semibold hover:underline ml-auto" onClick={() => toggleSort("flagRatePct")}>
                      Flagged %{sortIndicator("flagRatePct")}
                    </button>
                  </TableHead>
                  <TableHead>vs. sales sample</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedZips.map((z) => (
                  <TableRow key={z.zip}>
                    <TableCell>
                      <ZipLink zip={z.zip} onOpenZip={onOpenZip} className="text-sm" />
                    </TableCell>
                    <TableCell className="text-sm max-w-[180px] truncate">{z.name}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      <button
                        type="button"
                        className="hover:underline text-amber-800"
                        onClick={() => onOpenZip(z.zip)}
                        title={`View ${z.parcelCount} sample properties`}
                      >
                        {z.parcelCount.toLocaleString()}
                      </button>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmt(z.avgAssessment)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmt(z.avgModelValue)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {(z.medianRatio * 100).toFixed(1)}%
                    </TableCell>
                    <TableCell className={`text-right font-mono text-sm font-semibold ${
                      z.medianVariancePct < -15 ? "text-amber-700"
                        : z.medianVariancePct > 15 ? "text-red-700"
                          : "text-green-700"
                    }`}>
                      {z.medianVariancePct > 0 ? "+" : ""}{z.medianVariancePct}%
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{z.flagRatePct.toFixed(1)}%</TableCell>
                    <TableCell>
                      <Badge className={
                        z.riskLevel === "high" ? "bg-red-100 text-red-800"
                          : z.riskLevel === "moderate" ? "bg-amber-100 text-amber-800"
                            : "bg-green-100 text-green-800"
                      }>
                        {equityRiskLabel(z.riskLevel)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  OVERRIDES
// ════════════════════════════════════════════════════════════════════════
function OverridesTab() {
  const { data, refetch } = trpc.parceliq.listOverrides.useQuery({ status: undefined });
  const review = trpc.parceliq.reviewOverride.useMutation({ onSuccess: () => refetch() });
  

  const pending = data?.overrides.filter((o) => o.status === "pending") ?? [];
  const resolved = data?.overrides.filter((o) => o.status !== "pending") ?? [];

  const act = (id: string, action: "approve" | "reject") => {
    review.mutate(
      { id, action, reviewedBy: "Supervisor", note: "" },
      { onSuccess: () => toast({ title: `Override ${action}d`, description: "Recorded in audit log." }) }
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Override Requests</h2>
          <p className="text-sm text-muted-foreground">All changes require supervisor approval and are permanently logged.</p>
        </div>
        <SubmitOverrideDialog onSuccess={refetch} />
      </div>

      <div className="flex gap-2">
        <Badge className="bg-amber-100 text-amber-800 text-xs px-3 py-1">⏳ {pending.length} Pending</Badge>
        <Badge className="bg-green-100 text-green-800 text-xs px-3 py-1">✓ {resolved.filter(o=>o.status==="approved").length} Approved</Badge>
        <Badge className="bg-red-100 text-red-800 text-xs px-3 py-1">✗ {resolved.filter(o=>o.status==="rejected").length} Rejected</Badge>
      </div>

      {pending.length === 0 && (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No pending overrides.</CardContent></Card>
      )}

      {pending.map((o) => (
        <Card key={o.id} className="border-l-4 border-l-amber-400">
          <CardContent className="pt-4">
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="font-mono text-xs text-muted-foreground">PIN: {o.parcel_pin} · {o.submitted_by} · {new Date(o.created_at as string).toLocaleDateString()}</div>
                <div className="font-semibold mt-0.5">{o.address ?? o.parcel_pin}</div>
              </div>
              <Badge className="bg-amber-100 text-amber-800">Pending</Badge>
            </div>
            <div className="flex gap-6 my-3 text-sm">
              <div><div className="text-xs text-muted-foreground">Current</div><div className="text-lg font-serif">{fmt(o.current_val)}</div></div>
              <div className="self-end text-muted-foreground">→</div>
              <div><div className="text-xs text-muted-foreground">Proposed</div><div className="text-lg font-serif text-slate-700">{fmt(o.proposed_val)}</div></div>
              <div className="self-end text-muted-foreground">vs.</div>
              <div><div className="text-xs text-muted-foreground">Model</div><div className="text-lg font-serif text-muted-foreground">{fmt(o.model_val)}</div></div>
            </div>
            {o.reason && <p className="text-sm text-muted-foreground italic bg-neutral-50 rounded p-2 mb-3">"{o.reason}"</p>}
            <div className="flex gap-2">
              <Button size="sm" className="bg-green-100 text-green-800 hover:bg-green-200 border border-green-200" onClick={() => act(o.id, "approve")}>✓ Approve</Button>
              <Button size="sm" className="bg-red-100 text-red-800 hover:bg-red-200 border border-red-200" onClick={() => act(o.id, "reject")}>✗ Reject</Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SubmitOverrideDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin]   = useState("");
  const [curr, setCurr] = useState("");
  const [prop, setProp] = useState("");
  const [reason, setReason] = useState("");
  

  const submit = trpc.parceliq.submitOverride.useMutation({
    onSuccess: () => {
      toast({ title: "Override submitted", description: "Pending supervisor approval." });
      setOpen(false); onSuccess();
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Override Request</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Submit Override Request</DialogTitle></DialogHeader>
        <div className="rounded bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 mb-4">
          ⚠ Requires supervisor approval. Permanently logged.
        </div>
        <div className="space-y-3">
          <div><Label>Parcel PIN</Label><Input value={pin} onChange={(e)=>setPin(e.target.value)} placeholder="e.g. 9634528801" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Current Assessment ($)</Label><Input type="number" value={curr} onChange={(e)=>setCurr(e.target.value)} /></div>
            <div><Label>Proposed Value ($)</Label><Input type="number" value={prop} onChange={(e)=>setProp(e.target.value)} /></div>
          </div>
          <div><Label>Justification</Label><Textarea value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="Supporting evidence…" /></div>
          <Button
            className="w-full"
            disabled={!pin || submit.isLoading}
            onClick={() => submit.mutate({ parcelPin: pin, currentVal: Number(curr), proposedVal: Number(prop), reason })}
          >
            {submit.isLoading ? "Submitting…" : "Submit for Approval"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  AUDIT LOG
// ════════════════════════════════════════════════════════════════════════
function AuditTab() {
  const { data, isLoading } = trpc.parceliq.getAudit.useQuery({ limit: 50 });

  const dotColor: Record<string, string> = {
    override_submitted: "bg-amber-400",
    override_approved:  "bg-green-500",
    override_rejected:  "bg-red-500",
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold">Audit Log</h2>
        <p className="text-sm text-muted-foreground">Every change is permanently recorded.</p>
      </div>
      <Card>
        <CardContent className="pt-4 divide-y">
          {isLoading && <p className="text-sm text-muted-foreground py-4">Loading…</p>}
          {!isLoading && !data?.events.length && (
            <p className="text-sm text-muted-foreground py-4">No audit events yet.</p>
          )}
          {data?.events.map((e: any) => (
            <div key={e.id} className="flex gap-3 py-3">
              <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${dotColor[e.event_type] ?? "bg-slate-400"}`} />
              <span className="font-mono text-[11px] text-muted-foreground w-20 flex-shrink-0 pt-0.5">
                {new Date(e.created_at).toLocaleString("en-US",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}
              </span>
              <div className="text-sm leading-relaxed">
                <span className="font-semibold text-slate-700">{e.user_name}</span>
                {" "}{e.description}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
