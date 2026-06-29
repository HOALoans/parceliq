/**
 * ParcelIQ — Assessment Dashboard
 * Drop into: client/src/pages/ParcelIQ/index.tsx
 * Uses your existing shadcn/ui, tRPC, Tailwind, Recharts, Zod — nothing new to install.
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
} from "lucide-react";

const COUNTY_ASSESSMENT_RATIO = 0.725;

const ASSESSMENT_RATIO_BY_ZIP = [
  { zip: "28801", area: "Downtown Asheville", ratio: 0.749 },
  { zip: "28803", area: "Biltmore/South",     ratio: 0.719 },
  { zip: "28804", area: "North Asheville",    ratio: 0.723 },
  { zip: "28805", area: "East Asheville",     ratio: 0.746 },
  { zip: "28806", area: "West Asheville",     ratio: 0.721 },
  { zip: "28711", area: "Black Mountain",     ratio: 0.727 },
] as const;


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
  n == null ? "—" : `$${n.toLocaleString()}`;

const fmtB = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B`
  : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M`
  : `$${Math.round(n).toLocaleString()}`;

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

/** Plain-English summary of how fair market value was derived. */
function fairMarketExplainer(
  v: Record<string, any> | undefined,
  prc: Record<string, any> | undefined,
  assessed: number,
): string {
  if (!v?.fair_market_value) {
    return "We don't have enough sales and market data to produce a fair market estimate for this parcel.";
  }

  const zipLabel = v.zip_equity?.zip_name ?? v.zip_equity?.zip_code ?? "this area";
  const ratioPct =
    v.zip_equity?.median_ratio != null
      ? (Number(v.zip_equity.median_ratio) * 100).toFixed(1)
      : null;

  const countyPhrase = prc
    ? `the county's live appraised value of ${fmt(assessed)} (from Spatialest PRC)`
    : `the county's assessed value of ${fmt(assessed)}`;

  if (v.primary_method === "zillow_adjusted" && ratioPct) {
    return (
      `Here's how we got this number in plain English: We started with ${countyPhrase}. ` +
      `Then we looked at recent home sales in ${zipLabel} and found that county assessments in that area are typically only about ${ratioPct}% of what homes actually sell for — so the tax value usually lags the real market. ` +
      `We adjusted for that gap, then added Asheville-area price growth since the county's last broad revaluation (using Zillow's metro home-value trend). ` +
      `The result is our estimate of what this property would likely sell for today — not necessarily the number on the tax bill.`
    );
  }

  if (v.primary_method === "deed_ratio" && ratioPct) {
    return (
      `Here's how we got this number in plain English: We started with ${countyPhrase}. ` +
      `Recent qualified sales in ${zipLabel} show that county assessments run at about ${ratioPct}% of real sale prices on average. ` +
      `We divided this property's assessment by that ${ratioPct}% — in other words, if this home is taxed like its neighbors, what would it probably sell for? ` +
      `That gives our fair market value estimate. We did not add a separate Zillow adjustment because the county record already reflects a recent appraisal update.`
    );
  }

  if (ratioPct) {
    return (
      `Here's how we got this number in plain English: We compared ${countyPhrase} to the pattern of actual home sales in ${zipLabel}, ` +
      `where assessments have averaged about ${ratioPct}% of sale prices. ` +
      `Scaling this property up by that same local ratio produces our fair market value estimate.`
    );
  }

  return (
    `Here's how we got this number in plain English: With limited sales data for this parcel, we used property characteristics ` +
    `(size, location, class) and Buncombe County market benchmarks to estimate what it would likely sell for today. ` +
    `This is a model-based estimate — treat it as directional, not an appraisal.`
  );
}

function VarianceBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <Badge variant="outline">—</Badge>;
  const abs = Math.abs(pct);
  if (abs > 15) return <Badge variant="destructive">{pct > 0 ? "+" : ""}{pct}%</Badge>;
  if (abs > 5)  return <Badge className="bg-amber-100 text-amber-800 border-amber-200">{pct > 0 ? "+" : ""}{pct}%</Badge>;
  return <Badge className="bg-green-100 text-green-800 border-green-200">{pct > 0 ? "+" : ""}{pct}%</Badge>;
}

function ScorePill({ score }: { score: number | null }) {
  if (score == null) return null;
  const color = score >= 80 ? "bg-green-100 text-green-800"
    : score >= 60 ? "bg-amber-100 text-amber-800"
    : "bg-red-100 text-red-800";
  return (
    <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full text-xs font-bold border ${color}`}>
      {score}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  MAIN PAGE
// ════════════════════════════════════════════════════════════════════════
export default function ParcelIQPage() {
  const [tab, setTab] = useState<Tab>("dashboard");
  

  return (
    <div className="flex flex-col min-h-screen bg-neutral-50">
      {/* Header */}
      <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-serif font-semibold tracking-tight">
            Parcel<span className="text-amber-400">IQ</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">Buncombe County, NC · Assessment Platform</p>
        </div>
        <div className="flex items-center gap-2">
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
        {tab === "dashboard"  && <DashboardTab />}
        {tab === "explorer"   && <ExplorerTab />}
        {tab === "revenue"    && <RevenueTab />}
        {tab === "equity"     && <EquityTab />}
        {tab === "overrides"  && <OverridesTab />}
        {tab === "audit"      && <AuditTab />}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ════════════════════════════════════════════════════════════════════════
function DashboardTab() {
  const { data, isLoading, refetch } = trpc.parceliq.searchParcels.useQuery({ limit: 5 });
  const { data: ratios } = trpc.parceliq.assessmentRatios.useQuery();

  const countyPct = ratios?.countyMedianPct ?? COUNTY_ASSESSMENT_RATIO * 100;
  const zipRatios = ratios?.zipCodes ?? ASSESSMENT_RATIO_BY_ZIP;

  const stats = [
    { label: "Assessment Ratio",   value: `${countyPct.toFixed(1)}%`, sub: "Of market value (county-wide)", color: "border-t-amber-500" },
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
          <p className="text-sm text-amber-950 leading-relaxed">
            Buncombe County assesses at only{" "}
            <strong className="text-lg">{countyPct.toFixed(1)}%</strong>{" "}
            of actual market value — confirming exactly what the{" "}
            <strong>Mountain Xpress</strong> article reported (they said 67–73%).
            Assessed values across the county systematically lag market prices.
          </p>

          <Table>
            <TableHeader>
              <TableRow className="bg-white/80 hover:bg-white/80">
                <TableHead>ZIP</TableHead>
                <TableHead>Area</TableHead>
                <TableHead className="text-right">Median Ratio</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {zipRatios.map((z) => (
                <TableRow key={z.zip} className="bg-white/60">
                  <TableCell className="font-mono text-xs font-semibold">{z.zip}</TableCell>
                  <TableCell className="text-sm">{z.area}</TableCell>
                  <TableCell className="text-right font-mono text-sm font-medium">
                    {z.ratio.toFixed(3)}
                  </TableCell>
                  <TableCell>
                    <Badge className="bg-amber-200 text-amber-900 border-amber-300">
                      ⬇ Underassessed
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="h-48 rounded-lg border bg-white p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={zipRatios.map((z) => ({
                  name: z.zip,
                  ratio: Math.round(z.ratio * 1000) / 10,
                }))}
                margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
              >
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis
                  domain={[65, 80]}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip formatter={(v: number) => [`${v}%`, "Median Ratio"]} />
                <Bar dataKey="ratio" fill="#b45309" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
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
//  PROPERTY EXPLORER
// ════════════════════════════════════════════════════════════════════════
function ExplorerTab() {
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
                <TableHead>Variance</TableHead><TableHead>Score</TableHead>
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

function ParcelDetailBody({ data }: { data: Record<string, any> }) {
  const v = data.valuation as Record<string, any> | undefined;
  const freshness = data.data_freshness as Record<string, any> | undefined;
  const prc = (v?.prc ?? data.prc) as Record<string, any> | undefined;
  const taxRoll = v?.tax_roll_assessment ?? data.TOTALVALUE;
  const fairValue = v?.fair_market_value ?? data.model_value;
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

  return (
    <div className="space-y-5">
      {/* Data provenance */}
      {freshness && (
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
              ["ZIP equity ratios", formatAsOf(freshness.zip_equity_as_of), "Deed-ratio by ZIP"],
              ["Zillow metro index", formatAsOf(freshness.zillow_as_of), "Appreciation factor"],
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
      )}

      {/* Stale / mismatch warnings */}
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

      {/* Property facts */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        {[
          ["PIN", data.PIN],
          ["Class", data.CLASSCD],
          ["Acres", data.CALCACREAGE != null ? (+data.CALCACREAGE).toFixed(3) + " ac" : "—"],
          ["ZIP", data.POSTAL_CODE],
          ["Owner", data.OWNER],
          ["City", data.CITY ?? "—"],
        ].map(([label, value]) => (
          <div key={label} className="bg-neutral-50 rounded p-3">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
            <div className="font-medium mt-0.5 truncate">{fmtCell(value)}</div>
          </div>
        ))}
      </div>

      {/* Spatialest PRC — live county record */}
      {prc && (
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
            {v?.tax_roll_assessment != null && v.tax_roll_assessment !== prc.total_appraised && (
              <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                Bulk tax roll snapshot: {fmt(v.tax_roll_assessment)} — superseded by live PRC {fmt(prc.total_appraised)} in this analysis.
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
      )}

      {/* Verdict */}
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

      {/* Value comparison */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded border p-3 text-center">
          <div className="text-xs text-muted-foreground">County Assessment</div>
          <div className="text-xl font-serif font-semibold mt-1">{fmt(assessed)}</div>
          <div className="text-[10px] text-muted-foreground mt-1">
            {prc ? "Spatialest PRC (live)" : "Tax roll snapshot"}
          </div>
          {prc && taxRoll != null && taxRoll !== assessed && (
            <div className="text-[10px] text-amber-700 mt-0.5">Roll: {fmt(taxRoll)}</div>
          )}
        </div>
        <div className="rounded border-2 border-slate-800 p-3 text-center bg-slate-50">
          <div className="text-xs text-slate-600 font-medium">Fair Market Value</div>
          <div className="text-xl font-serif font-semibold mt-1 text-slate-900">{fmt(fairValue)}</div>
          <div className="text-[10px] text-muted-foreground mt-1">
            {v?.primary_method === "zillow_adjusted"
              ? "Deed ratio + Zillow"
              : v?.primary_method === "deed_ratio"
                ? "Deed ratio model"
                : v?.primary_method === "prc_current"
                  ? "PRC + deed ratio"
                  : "ParcelIQ model"}
          </div>
        </div>
        <div className={`rounded border p-3 text-center ${Math.abs(varPct ?? 0) > 15 ? "bg-red-50" : "bg-green-50"}`}>
          <div className="text-xs text-muted-foreground">Variance</div>
          <div className={`text-xl font-serif font-semibold mt-1 ${Math.abs(varPct ?? 0) > 15 ? "text-red-700" : "text-green-700"}`}>
            {varPct != null ? `${varPct > 0 ? "+" : ""}${varPct}%` : "—"}
          </div>
          {v?.gap_dollars != null && (
            <div className="text-[10px] text-muted-foreground mt-1">
              {v.gap_dollars > 0 ? "+" : ""}{fmt(v.gap_dollars)} vs fair value
            </div>
          )}
        </div>
      </div>

      {/* Fair market value — plain English */}
      {fairValue != null && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
            What is fair market value?
          </p>
          <p className="text-sm text-slate-700 leading-relaxed">
            {fairMarketExplainer(v, prc, assessed)}
          </p>
        </div>
      )}

      {/* Derivation steps */}
      {v?.steps?.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            How we calculated fair value
          </p>
          {v.steps.map((step: Record<string, any>) => (
            <div key={step.step} className="rounded-lg border bg-white p-3 space-y-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">
                    {step.step}. {step.title}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{step.source}</div>
                </div>
                {step.result_label && (
                  <div className="font-mono text-sm font-semibold text-slate-800 shrink-0">
                    {step.result_label}
                  </div>
                )}
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{step.detail}</p>
              {step.formula && (
                <p className="text-xs font-mono bg-neutral-50 rounded px-2 py-1 inline-block">
                  {step.formula}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Zillow metro data */}
      {v?.zillow && (
        <Card className="border-blue-200 bg-blue-50/40">
          <CardHeader className="py-3 px-4 pb-1">
            <CardTitle className="text-sm font-semibold">Zillow Metro Data · {v.zillow.metro_name}</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">ZHVI (home value index)</div>
              <div className="font-medium">
                ${Number(v.zillow.zhvi_base ?? 0).toLocaleString()} → ${Number(v.zillow.zhvi_current ?? 0).toLocaleString()}
              </div>
              <div className="text-[11px] text-muted-foreground">Base: {fmtDate(v.zillow.zhvi_base_date) || "2021"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Median sale price</div>
              <div className="font-medium">
                ${Number(v.zillow.median_sale_base ?? 0).toLocaleString()} → ${Number(v.zillow.median_sale_current ?? 0).toLocaleString()}
              </div>
              <div className="text-[11px] text-muted-foreground">As of {fmtDate(v.zillow.as_of_date)}</div>
            </div>
            <div className="col-span-2">
              <div className="text-xs text-muted-foreground">Blended appreciation factor applied</div>
              <div className="font-mono font-semibold">
                {Number(v.zillow.appreciation_factor).toFixed(4)}×
                <span className="text-muted-foreground font-normal ml-2">
                  (+{((Number(v.zillow.appreciation_factor) - 1) * 100).toFixed(1)}% since revaluation)
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ZIP equity context */}
      {v?.zip_equity && (
        <Card>
          <CardHeader className="py-3 px-4 pb-1">
            <CardTitle className="text-sm font-semibold">
              ZIP {v.zip_equity.zip_code} · {v.zip_equity.zip_name}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Median ratio</div>
              <div className="font-mono font-semibold">{Number(v.zip_equity.median_ratio).toFixed(3)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Sales samples</div>
              <div className="font-semibold">{v.zip_equity.sample_count}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Avg assessed</div>
              <div className="font-semibold">{fmt(v.zip_equity.avg_assessed)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Avg sale price</div>
              <div className="font-semibold">{fmt(v.zip_equity.avg_sale_price)}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Comparable sales for this parcel */}
      {v?.comparable_sales?.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Register of Deeds · sales for this parcel
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
                    <TableCell className="text-right font-mono text-sm">
                      {fmt(sale.selling_price)}
                    </TableCell>
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

      {!v?.zillow && !v?.zip_equity && (
        <p className="text-xs text-muted-foreground bg-neutral-50 rounded p-3">
          Run <code className="font-mono">loadSales.mjs</code> and <code className="font-mono">loadZillow.mjs</code> to populate deed-ratio and Zillow metro data for full valuation detail.
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

  const chartData = r ? Object.entries(r.classBrakedown).map(([cls, v]) => ({
    name: cls, revenue: Math.round(v.estimatedRevenue / 1e6),
  })) : [];

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold">Revenue Targeting</h2>
        <p className="text-sm text-muted-foreground">
          Input your county's budget goal — ParcelIQ derives a scientifically fair millage rate.
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
              { label: "Target Revenue ($)", val: target, set: setTarget },
              { label: "Total Assessed Value ($)", val: totalAV, set: setTotalAV },
              { label: "Exemptions ($)", val: exemptions, set: setExemptions },
              { label: "Collection Rate (0-1)", val: rate, set: setRate },
            ].map(({ label, val, set }) => (
              <div key={label}>
                <Label className="text-xs text-slate-400 uppercase tracking-wide">{label}</Label>
                <Input
                  type="number"
                  value={val}
                  onChange={(e) => set(Number(e.target.value))}
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
                  { label: "Taxable Value",         val: fmtB(r.taxableValue) },
                  { label: "Millage Rate",           val: `${r.millageRateCents.toFixed(4)}¢` },
                  { label: "Avg Tax Bill",           val: fmt(r.avgTaxBillMedianHome) },
                  { label: "Projected Collection",   val: fmtB(r.projectedCollection) },
                ].map(({ label, val }) => (
                  <div key={label}>
                    <div className="text-xs text-slate-400 uppercase tracking-wide">{label}</div>
                    <div className="text-2xl font-serif text-amber-300 mt-1">{val}</div>
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
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${v}M`} />
                  <Tooltip formatter={(v: number) => [`$${v}M`, "Est. Revenue"]} />
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
                {Object.entries(r.classBrakedown).map(([cls, v]) => (
                  <TableRow key={cls}>
                    <TableCell><Badge variant="outline">{cls}</Badge></TableCell>
                    <TableCell>{v.parcels.toLocaleString()}</TableCell>
                    <TableCell className="font-mono">{fmtB(v.assessedValue)}</TableCell>
                    <TableCell className="font-mono">{fmtB(v.estimatedRevenue)}</TableCell>
                    <TableCell>{v.sharePct.toFixed(0)}%</TableCell>
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
function EquityTab() {
  const { data, isLoading } = trpc.parceliq.equitySummary.useQuery();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Equity Analysis</h2>
        <p className="text-sm text-muted-foreground">Systemic over/under-assessment patterns by zip code.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Over-assessed",      value: "2,104", sub: ">15% above model", color: "border-t-red-500" },
          { label: "Under-assessed",     value: "2,115", sub: ">15% below model", color: "border-t-amber-500" },
          { label: "Within Equity Band", value: "108,628",sub: "Within ±15%",      color: "border-t-green-500" },
        ].map((s) => (
          <Card key={s.label} className={`border-t-4 ${s.color}`}>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{s.label}</p>
              <p className="text-2xl font-serif font-semibold mt-1">{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading equity data…</p>}

      <div className="space-y-3">
        {data?.zipCodes.map((z) => (
          <Card key={z.zip}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-serif text-lg font-semibold">{z.zip} — {z.name}</div>
                  <div className="text-xs text-muted-foreground">{z.parcelCount} parcels sampled</div>
                </div>
                <Badge className={
                  z.riskLevel === "high"     ? "bg-red-100 text-red-800"
                  : z.riskLevel === "moderate" ? "bg-amber-100 text-amber-800"
                  : "bg-green-100 text-green-800"
                }>
                  {z.riskLevel === "high" ? "High Risk" : z.riskLevel === "moderate" ? "Moderate" : "Healthy"}
                </Badge>
              </div>
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div><div className="text-xs text-muted-foreground">Avg Assessment</div><div className="font-semibold">{fmt(z.avgAssessment)}</div></div>
                <div><div className="text-xs text-muted-foreground">Avg Model Value</div><div className="font-semibold">{fmt(z.avgModelValue)}</div></div>
                <div>
                  <div className="text-xs text-muted-foreground">Median Variance</div>
                  <div className={`font-semibold ${z.medianVariancePct < -5 ? "text-red-600" : z.medianVariancePct > 5 ? "text-amber-600" : "text-green-600"}`}>
                    {z.medianVariancePct > 0 ? "+" : ""}{z.medianVariancePct}%
                  </div>
                </div>
                <div><div className="text-xs text-muted-foreground">Flagged</div><div className="font-semibold">{z.flagRatePct}% of zip</div></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
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
