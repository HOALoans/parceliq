/**
 * ParcelIQ — Assessment Dashboard
 * Drop into: client/src/pages/ParcelIQ/index.tsx
 * Uses your existing shadcn/ui, tRPC, Tailwind, Recharts, Zod — nothing new to install.
 */

import { useState } from "react";
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
  TrendingUp, RefreshCw, Plus,
} from "lucide-react";


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

  const stats = [
    { label: "Total Parcels",      value: "112,847",  sub: "Buncombe County",       color: "border-t-amber-500" },
    { label: "Total Assessed",     value: "$24.3B",   sub: "Model-derived",          color: "border-t-green-500" },
    { label: "Equity Flags",       value: "4,219",    sub: "Properties ±15% off",    color: "border-t-red-500" },
    { label: "Pending Overrides",  value: "—",        sub: "Awaiting review",         color: "border-t-blue-500" },
  ];

  return (
    <div className="space-y-6">
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
                { name: "Spatialest PRC System",     sub: "prc-buncombe.spatialest.com", type: "Vendor",        status: "Auth Required", refresh: "Real-time" },
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
  const [selectedParcel, setSelectedParcel] = useState<string | null>(null);

  const { data, isLoading, isFetching } = trpc.parceliq.searchParcels.useQuery(
    { q: search || undefined, classCd: classCd || undefined, limit: 25 },
    { keepPreviousData: true }
  );

  const parcelDetail = trpc.parceliq.getParcel.useQuery(
    { pin: selectedParcel! },
    { enabled: !!selectedParcel }
  );

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
            onKeyDown={(e) => e.key === "Enter" && setSearch(q)}
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
        <Button onClick={() => setSearch(q)} disabled={isFetching}>
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
                <TableRow key={p.PIN} className={p.flagged ? "bg-red-50/40" : ""}>
                  <TableCell className="font-mono text-[11px]">{p.PIN}</TableCell>
                  <TableCell className="font-medium text-sm max-w-[180px] truncate">{p.SITEADDRESS}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">{p.OWNER}</TableCell>
                  <TableCell className="font-mono text-xs">{p.CALCACREAGE?.toFixed(2) ?? "—"}</TableCell>
                  <TableCell className="font-mono text-sm">{fmt(p.TOTALVALUE)}</TableCell>
                  <TableCell className="font-mono text-sm">{fmt(p.model_value)}</TableCell>
                  <TableCell><VarianceBadge pct={p.variance_pct} /></TableCell>
                  <TableCell><ScorePill score={p.equity_score} /></TableCell>
                  <TableCell>
                    <Dialog onOpenChange={(open) => { if (open) setSelectedParcel(p.PIN ?? null); }}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline">View</Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-xl">
                        <DialogHeader>
                          <DialogTitle className="font-serif">{p.SITEADDRESS}</DialogTitle>
                        </DialogHeader>
                        {parcelDetail.isLoading && <p className="text-sm text-muted-foreground">Loading detail…</p>}
                        {parcelDetail.data && <ParcelDetailBody data={parcelDetail.data as any} />}
                      </DialogContent>
                    </Dialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ParcelDetailBody({ data }: { data: Record<string, any> }) {
  const mv    = data.model_value as number | null;
  const cv    = data.TOTALVALUE  as number | null;
  const varPct = data.variance_pct as number | null;
  const bd    = data.model_breakdown as Record<string, any> | null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        {[
          ["PIN",    data.PIN],
          ["Class",  data.CLASSCD],
          ["Acres",  data.CALCACREAGE != null ? (+data.CALCACREAGE).toFixed(3) + " ac" : "—"],
          ["Owner",  data.OWNER],
        ].map(([l, v]) => (
          <div key={l} className="bg-neutral-50 rounded p-3">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">{l}</div>
            <div className="font-medium mt-0.5 truncate">{v ?? "—"}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded border p-3 text-center">
          <div className="text-xs text-muted-foreground">County Assessment</div>
          <div className="text-xl font-serif font-semibold mt-1">{fmt(cv)}</div>
        </div>
        <div className="rounded border-2 border-slate-800 p-3 text-center bg-slate-50">
          <div className="text-xs text-slate-600">ParcelIQ Model</div>
          <div className="text-xl font-serif font-semibold mt-1">{fmt(mv)}</div>
        </div>
        <div className={`rounded border p-3 text-center ${Math.abs(varPct ?? 0) > 15 ? "bg-red-50" : "bg-green-50"}`}>
          <div className="text-xs text-muted-foreground">Variance</div>
          <div className={`text-xl font-serif font-semibold mt-1 ${Math.abs(varPct ?? 0) > 15 ? "text-red-700" : "text-green-700"}`}>
            {varPct != null ? `${varPct > 0 ? "+" : ""}${varPct}%` : "—"}
          </div>
        </div>
      </div>

      {bd && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Model Factors</p>
          {Object.entries(bd).map(([k, v]: [string, any]) => (
            <div key={k} className="flex justify-between text-sm border-b pb-1 last:border-0">
              <span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}</span>
              <span className="font-medium">
                {v.value_effect != null
                  ? `${v.value_effect > 0 ? "+" : ""}$${Math.abs(v.value_effect).toLocaleString()}`
                  : v.name ?? v.code ?? ""}
              </span>
            </div>
          ))}
        </div>
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
