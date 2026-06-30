import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowRight,
  Building2,
  Scale,
  FileSearch,
  Layers,
  MapPin,
  CheckCircle2,
} from "lucide-react";

const DATA_SOURCES = [
  {
    title: "Live county records",
    detail: "Spatialest property record cards and tax roll data — land, building, and total appraised values.",
  },
  {
    title: "Qualified deed sales",
    detail: "Register of Deeds transactions matched to parcels, powering comparable sales and ZIP equity studies.",
  },
  {
    title: "Parcel-specific comps",
    detail: "Recent sales in the same ZIP, prioritized over county-wide ratio extrapolation.",
  },
  {
    title: "Metro trend context",
    detail: "Regional price indices for time-adjusting older sales — clearly separated from headline estimates.",
  },
];

const COUNTIES = [
  {
    slug: "buncombe",
    name: "Buncombe County",
    state: "North Carolina",
    status: "live" as const,
    blurb: "112,000+ parcels · Asheville metro · 2026 reappraisal data",
    stats: ["Equity by ZIP", "Live PRC", "85k+ deed sales"],
  },
  {
    slug: "coming-soon",
    name: "Your county",
    state: "Coming soon",
    status: "planned" as const,
    blurb: "Parcelogik is built to onboard new counties with the same transparent methodology.",
    stats: ["Multi-county ready", "Contact us"],
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      {/* Nav */}
      <header className="bg-slate-900 text-white px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-serif font-semibold tracking-tight">
              Parcel<span className="text-amber-400">ogik</span>
              <span className="text-slate-400 font-sans text-sm font-normal">.com</span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">Property assessment intelligence</p>
          </div>
          <Link href="/buncombe">
            <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold">
              Buncombe County <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-slate-900 text-white px-6 py-16 sm:py-20">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <p className="text-amber-400 text-sm font-medium uppercase tracking-widest">
            Fair assessments · Funded communities
          </p>
          <h2 className="text-3xl sm:text-4xl font-serif font-semibold leading-tight tracking-tight">
            Real estate value is only proven when a buyer and seller agree on a price.
          </h2>
          <p className="text-slate-300 text-lg leading-relaxed">
            Everything else — county assessments, automated estimates, appraisal models — is an
            informed guess. Parcelogik doesn&apos;t pretend one number is the truth. We bring
            multiple independent sources together, show our work, and let you see where the county,
            the market, and equity fairness diverge.
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <Link href="/buncombe">
              <Button size="lg" className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold">
                Explore Buncombe County
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Problem / insight */}
      <section className="px-6 py-14 max-w-5xl mx-auto w-full">
        <div className="grid md:grid-cols-2 gap-10 items-start">
          <div className="space-y-4">
            <h3 className="text-2xl font-serif font-semibold text-slate-900">
              The old way: one number, opaque sources
            </h3>
            <p className="text-slate-600 leading-relaxed">
              Appraisers, assessors, and automated estimators have always relied on data that can be
              stale, incomplete, or averaged across unlike properties. A single &ldquo;fair
              value&rdquo; on a spreadsheet hides the assumptions — and in mixed neighborhoods
              (especially downtown commercial districts), one ZIP-wide ratio can be wildly wrong for
              an individual parcel.
            </p>
            <p className="text-slate-600 leading-relaxed">
              Property tax equity matters too: are assessments applied <em>uniformly</em> across
              owners, or does one ZIP get a break another doesn&apos;t? That&apos;s a different
              question than &ldquo;what would this house sell for today?&rdquo;
            </p>
          </div>
          <div className="space-y-4">
            <h3 className="text-2xl font-serif font-semibold text-slate-900">
              The Parcelogik way: transparency, not false precision
            </h3>
            <p className="text-slate-600 leading-relaxed">
              We don&apos;t remove judgment from valuation — we make the evidence visible. For each
              parcel you see the <strong>county assessment</strong>, a <strong>market estimate</strong>{" "}
              built from parcel-specific sales and comps (not a blind ratio extrapolation), and a
              separate <strong>equity study</strong> for uniformity analysis. We pick the best
              market method by priority; we don&apos;t blend unrelated numbers into one magic figure.
            </p>
            <ul className="space-y-2 text-sm text-slate-700">
              {[
                "County record vs. market estimate vs. variance — at a glance",
                "Show which comparable sales drove the estimate",
                "Separate ZIP equity metrics from market appraisal",
                "Live Spatialest PRC when available",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Data sources */}
      <section className="bg-white border-y px-6 py-14">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <h3 className="text-2xl font-serif font-semibold">What we use</h3>
            <p className="text-muted-foreground mt-2 max-w-2xl mx-auto">
              Multiple lenses on the same parcel — each with a defined role, none hidden behind a
              single headline number.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {DATA_SOURCES.map((s) => (
              <Card key={s.title} className="border-slate-200">
                <CardHeader className="py-3 px-4 pb-1">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Layers className="w-4 h-4 text-amber-600" />
                    {s.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed">
                  {s.detail}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How market estimate works */}
      <section className="px-6 py-14 max-w-5xl mx-auto w-full">
        <div className="rounded-xl border-2 border-slate-800 bg-slate-900 text-white p-8 sm:p-10">
          <h3 className="text-xl font-serif font-semibold text-amber-300 mb-4">
            How we choose a market estimate
          </h3>
          <p className="text-slate-300 leading-relaxed mb-6">
            We use a <strong className="text-white">priority ladder</strong>, not a weighted average.
            The first method with enough evidence wins:
          </p>
          <ol className="space-y-4">
            {[
              { n: 1, title: "This parcel's qualified sale", sub: "Strongest — verified transaction on this PIN" },
              { n: 2, title: "Nearby comparable sales", sub: "Median of recent sales in the same ZIP" },
              { n: 3, title: "Property characteristics", sub: "Fallback from lot, location, and class when sales are thin" },
            ].map(({ n, title, sub }) => (
              <li key={n} className="flex gap-4 items-start">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-400 text-slate-900 font-bold text-sm">
                  {n}
                </span>
                <div>
                  <p className="font-semibold">{title}</p>
                  <p className="text-sm text-slate-400">{sub}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="text-xs text-slate-500 mt-6 border-t border-slate-700 pt-4">
            ZIP-wide ratio extrapolation is shown separately for equity / uniformity analysis — it
            is not substituted for the market estimate.
          </p>
        </div>
      </section>

      {/* Counties */}
      <section className="px-6 py-14 max-w-5xl mx-auto w-full flex-1">
        <div className="flex items-center gap-2 mb-2">
          <MapPin className="w-5 h-5 text-slate-700" />
          <h3 className="text-2xl font-serif font-semibold">Counties</h3>
        </div>
        <p className="text-muted-foreground mb-8 max-w-2xl">
          Parcelogik is designed to scale county by county. Each jurisdiction gets the same
          transparent methodology with local data pipelines.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          {COUNTIES.map((c) => (
            <Card
              key={c.slug}
              className={c.status === "live" ? "border-2 border-amber-400 shadow-md" : "border-dashed opacity-80"}
            >
              <CardHeader className="py-4 px-4 pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-lg font-serif">{c.name}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">{c.state}</p>
                  </div>
                  {c.status === "live" ? (
                    <span className="text-[10px] uppercase font-bold bg-green-100 text-green-800 px-2 py-1 rounded-full">
                      Live
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded-full">
                      Planned
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-4">
                <p className="text-sm text-muted-foreground">{c.blurb}</p>
                <div className="flex flex-wrap gap-2">
                  {c.stats.map((s) => (
                    <span key={s} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-1 rounded">
                      {s}
                    </span>
                  ))}
                </div>
                {c.status === "live" && (
                  <Link href="/buncombe">
                    <Button className="w-full bg-slate-900 hover:bg-slate-800">
                      Open dashboard <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Use cases */}
      <section className="bg-slate-100 px-6 py-12 border-t">
        <div className="max-w-5xl mx-auto grid sm:grid-cols-3 gap-6 text-center">
          {[
            { icon: Scale, title: "Equity analysis", text: "Are assessments uniform across ZIPs and property types?" },
            { icon: FileSearch, title: "Appeal support", text: "Compare your assessment to comps and market evidence." },
            { icon: Building2, title: "Policy & revenue", text: "Understand the tax base and reappraisal impacts county-wide." },
          ].map(({ icon: Icon, title, text }) => (
            <div key={title} className="space-y-2">
              <Icon className="w-8 h-8 mx-auto text-amber-600" />
              <h4 className="font-semibold text-slate-900">{title}</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="bg-slate-900 text-slate-400 px-6 py-8 text-center text-xs">
        <p>
          Parcelogik.com · Property assessment intelligence · Not a licensed appraisal ·{" "}
          <Link href="/buncombe" className="text-amber-400 hover:underline">
            Buncombe County
          </Link>
        </p>
      </footer>
    </div>
  );
}
