import { useEffect } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowRight,
  Building2,
  Scale,
  FileSearch,
  Layers,
  MapPin,
  Handshake,
} from "lucide-react";

type CountyStatus = "live" | "planned";

type CountyCard = {
  slug: string;
  name: string;
  state: string;
  status: CountyStatus;
  href: string;
  blurb: string;
  stats: string[];
  highlights?: { label: string; value: string; sub: string }[];
};

const DATA_SOURCES = [
  {
    title: "County property records",
    detail: "Official land, building, and total values from the assessor's office — the basis for your tax bill.",
  },
  {
    title: "Real home sales",
    detail: "Actual prices from homes bought and sold in the county — the receipts that prove what buyers paid.",
  },
  {
    title: "Similar home comparisons",
    detail: "We match sales by size, type, and age in your neighborhood — not a blind average across the whole ZIP.",
  },
  {
    title: "Value review cycles",
    detail: "When a county publishes prior-cycle and current-cycle values, we show the change home by home.",
  },
  {
    title: "Neighborhood price trends",
    detail: "Regional market trackers show how fast prices are moving in your area — kept separate from the headline numbers.",
  },
];

const COUNTIES: CountyCard[] = [
  {
    slug: "buncombe",
    name: "Buncombe County",
    state: "North Carolina",
    status: "live",
    href: "/buncombe",
    blurb: "Our first live county — Asheville metro, with full value-review and sales data.",
    stats: ["Fairness by ZIP", "Live county records", "Deed sales", "Value review"],
    highlights: [
      { label: "Properties on file", value: "112k+", sub: "Prior & current cycle" },
      { label: "Typical review increase", value: "+61%", sub: "County median (matched homes)" },
      { label: "Neighborhood range", value: "28 pts", sub: "Lowest vs. highest ZIP" },
    ],
  },
  {
    slug: "coming-soon",
    name: "More counties",
    state: "In progress",
    status: "planned",
    href: "#counties",
    blurb: "Parcelogik is built to onboard new counties with the same transparent methodology and local data pipelines.",
    stats: ["Assessor partnerships", "County-by-county rollout", "Contact us"],
  },
];

function prefetchCountyData(utils: ReturnType<typeof trpc.useUtils>, slug: string) {
  if (slug === "buncombe") {
    void utils.parceliq.assessmentRatios.prefetch();
  }
}

function CountyLink({
  href,
  slug,
  className,
  children,
}: {
  href: string;
  slug?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const utils = trpc.useUtils();
  return (
    <Link
      href={href}
      className={className}
      onMouseEnter={() => slug && prefetchCountyData(utils, slug)}
    >
      {children}
    </Link>
  );
}

export default function LandingPage() {
  const utils = trpc.useUtils();
  const liveCounties = COUNTIES.filter((c) => c.status === "live");

  useEffect(() => {
    for (const c of liveCounties) {
      prefetchCountyData(utils, c.slug);
    }
  }, [utils, liveCounties]);

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
            <p className="text-xs text-slate-400 mt-0.5">Transparent property assessment, built with assessors</p>
          </div>
          <a href="#counties">
            <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold">
              Counties <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-slate-900 text-white px-6 py-16 sm:py-20">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <p className="text-amber-400 text-sm font-medium uppercase tracking-widest">
            What changed · Why it changed · How does it compare?
          </p>
          <h2 className="text-3xl sm:text-4xl font-serif font-semibold leading-tight tracking-tight">
            Clear answers from the same data assessors use.
          </h2>
          <p className="text-slate-300 text-lg leading-relaxed">
            Parcelogik helps property owners understand county values — what changed in the latest
            review, how market trends factor in, and how a specific home compares to countywide
            benchmarks. One platform, county by county.
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <a href="#counties">
              <Button size="lg" className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold">
                Choose your county
              </Button>
            </a>
            {liveCounties.length === 1 && (
              <CountyLink href={liveCounties[0].href} slug={liveCounties[0].slug}>
                <Button size="lg" variant="outline" className="border-slate-500 text-white hover:bg-slate-800">
                  Open {liveCounties[0].name}
                </Button>
              </CountyLink>
            )}
          </div>
        </div>
      </section>

      {/* Assessor partnership */}
      <section className="px-6 py-14 max-w-5xl mx-auto w-full">
        <div className="rounded-xl border-2 border-slate-200 bg-white p-8 sm:p-10 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Handshake className="w-6 h-6 text-amber-700" />
            <h3 className="text-2xl font-serif font-semibold text-slate-900">
              Built to support assessor offices
            </h3>
          </div>
          <p className="text-slate-700 leading-relaxed text-lg">
            Property assessment is a demanding public service. Assessor offices must value tens of
            thousands of properties using consistent rules, public records, and periodic market
            updates — often with limited staff and constant public scrutiny.
          </p>
          <p className="text-slate-700 leading-relaxed mt-4">
            Parcelogik is designed as a <strong>transparency layer</strong>, not a replacement. We
            surface the same county records, deed sales, and review-cycle data assessors rely on,
            explained in plain language so owners can see <em>what</em> changed, <em>why</em> it
            changed, and <em>how</em> their home compares to county benchmarks.
          </p>
        </div>
      </section>

      {/* Three questions */}
      <section className="bg-white border-y px-6 py-14">
        <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-8">
          {[
            {
              title: "What changed?",
              text: "See what the county said your home was worth in the prior cycle vs. the current review — in dollars and plain percentages.",
            },
            {
              title: "Why did it change?",
              text: "We connect the assessor's updated values to market trends, so owners can follow the logic behind a value review.",
            },
            {
              title: "How does it compare?",
              text: "See how your home's change lines up with the county median and your neighborhood — the same benchmarks assessors use for uniformity.",
            },
          ].map(({ title, text }) => (
            <div key={title} className="space-y-2">
              <h4 className="text-lg font-semibold text-slate-900">{title}</h4>
              <p className="text-sm text-slate-600 leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Data sources */}
      <section className="px-6 py-14 max-w-5xl mx-auto w-full">
        <div className="text-center mb-10">
          <h3 className="text-2xl font-serif font-semibold">Where we get the numbers</h3>
          <p className="text-muted-foreground mt-2 max-w-2xl mx-auto">
            Multiple sources, each with a clear role — presented openly, not collapsed into one headline number.
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
      </section>

      {/* How Parcelogik does the math */}
      <section className="px-6 py-14 max-w-5xl mx-auto w-full">
        <div className="rounded-xl border-2 border-slate-800 bg-slate-900 text-white p-8 sm:p-10">
          <h3 className="text-xl font-serif font-semibold text-amber-300 mb-4">
            How Parcelogik does the math
          </h3>
          <ol className="space-y-5">
            {[
              {
                n: 1,
                title: "We look at real sales",
                sub: "Actual deed prices from homes bought and sold in the county — the strongest market evidence.",
              },
              {
                n: 2,
                title: "We check neighborhood trends",
                sub: "Regional market trackers show how fast prices are moving in your area — separate from the headline estimate.",
              },
              {
                n: 3,
                title: "We compare review cycles",
                sub: "Prior-cycle vs. current-cycle county values show how growth was distributed across the jurisdiction.",
              },
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
        </div>
      </section>

      {/* Value review feature — generic */}
      <section className="bg-indigo-50 border-y border-indigo-100 px-6 py-14">
        <div className="max-w-5xl mx-auto">
          <h3 className="text-2xl font-serif font-semibold text-slate-900 mb-3">
            Value review cycles, explained
          </h3>
          <p className="text-slate-600 leading-relaxed max-w-3xl mb-6">
            When a county completes a periodic reassessment, Parcelogik maps each property from the
            prior cycle to the new values. Owners see Then vs. Now for their home and how that change
            compares to county and neighborhood medians — the same uniformity lens assessors use.
          </p>
          <p className="text-sm text-indigo-900/80">
            Live counties show real numbers on their dashboard. More jurisdictions are onboarding.
          </p>
        </div>
      </section>

      {/* Counties */}
      <section id="counties" className="px-6 py-14 max-w-5xl mx-auto w-full flex-1 scroll-mt-4">
        <div className="flex items-center gap-2 mb-2">
          <MapPin className="w-5 h-5 text-slate-700" />
          <h3 className="text-2xl font-serif font-semibold">Counties</h3>
        </div>
        <p className="text-muted-foreground mb-8 max-w-2xl">
          Parcelogik rolls out one county at a time. Each jurisdiction gets the same transparent
          methodology with local assessor records, deed sales, and review-cycle data.
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
                      Coming soon
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
                {c.highlights && (
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                    {c.highlights.map((h) => (
                      <div key={h.label} className="text-center">
                        <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{h.label}</p>
                        <p className="text-lg font-serif font-semibold text-indigo-950">{h.value}</p>
                        <p className="text-[9px] text-muted-foreground leading-tight">{h.sub}</p>
                      </div>
                    ))}
                  </div>
                )}
                {c.status === "live" ? (
                  <CountyLink href={c.href} slug={c.slug}>
                    <Button className="w-full bg-slate-900 hover:bg-slate-800">
                      Open dashboard <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </CountyLink>
                ) : (
                  <Button className="w-full" variant="outline" disabled>
                    Not available yet
                  </Button>
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
            { icon: Scale, title: "Fairness check", text: "Is everyone being treated the same across neighborhoods?" },
            { icon: FileSearch, title: "Appeal support", text: "Compare your county value to real sales evidence." },
            { icon: Building2, title: "Policy & budgets", text: "Track how value reviews affect owners ZIP by ZIP." },
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
          Parcelogik.com · Transparent assessment data · Not a licensed appraisal ·{" "}
          <a href="#counties" className="text-amber-400 hover:underline">
            Counties
          </a>
        </p>
      </footer>
    </div>
  );
}
