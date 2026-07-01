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
  CheckCircle2,
  Pizza,
} from "lucide-react";

const DATA_SOURCES = [
  {
    title: "County property records",
    detail: "Official land, building, and total values from Buncombe County — what your tax bill is based on.",
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
    title: "2021 → 2026 new value review",
    detail: "What the county said your home was worth five years ago vs. what it says today — home by home.",
  },
  {
    title: "Neighborhood price trends",
    detail: "Trusted market trackers show how fast prices are moving in your area — kept separate from the headline numbers.",
  },
];

const COUNTIES = [
  {
    slug: "buncombe",
    name: "Buncombe County",
    state: "North Carolina",
    status: "live" as const,
    blurb: "112,000+ properties · Asheville metro · 2026 new value review",
    stats: ["Fairness by ZIP", "Live county data", "2021→2026 review", "85k+ home sales"],
  },
  {
    slug: "coming-soon",
    name: "Your county",
    state: "Coming soon",
    status: "planned" as const,
    blurb: "Parcelogik is built to onboard new counties with the same clear, honest approach.",
    stats: ["Multi-county ready", "Contact us"],
  },
];

function prefetchBuncombeData(utils: ReturnType<typeof trpc.useUtils>) {
  void utils.parceliq.assessmentRatios.prefetch();
}

function BuncombeLink({
  href = "/buncombe",
  className,
  children,
}: {
  href?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const utils = trpc.useUtils();
  return (
    <Link
      href={href}
      className={className}
      onMouseEnter={() => prefetchBuncombeData(utils)}
    >
      {children}
    </Link>
  );
}

export default function LandingPage() {
  const utils = trpc.useUtils();

  useEffect(() => {
    prefetchBuncombeData(utils);
  }, [utils]);

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
            <p className="text-xs text-slate-400 mt-0.5">Property tax clarity for real people</p>
          </div>
          <BuncombeLink>
            <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold">
              Buncombe County <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </BuncombeLink>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-slate-900 text-white px-6 py-16 sm:py-20">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <p className="text-amber-400 text-sm font-medium uppercase tracking-widest">
            What changed · Why it changed · Is it fair?
          </p>
          <h2 className="text-3xl sm:text-4xl font-serif font-semibold leading-tight tracking-tight">
            Your property taxes shouldn&apos;t feel like a spreadsheet mystery.
          </h2>
          <p className="text-slate-300 text-lg leading-relaxed">
            Parcelogik turns county data into plain answers: what your home is worth on paper,
            how that changed since 2021, and whether your increase is in line with everyone else.
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <BuncombeLink>
              <Button size="lg" className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold">
                Explore Buncombe County
              </Button>
            </BuncombeLink>
          </div>
        </div>
      </section>

      {/* Pizza analogy — the "why" */}
      <section className="px-6 py-14 max-w-5xl mx-auto w-full">
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-8 sm:p-10">
          <div className="flex items-center gap-2 mb-4">
            <Pizza className="w-6 h-6 text-amber-700" />
            <h3 className="text-2xl font-serif font-semibold text-slate-900">
              The pizza slice — why values change
            </h3>
          </div>
          <p className="text-slate-700 leading-relaxed text-lg">
            Think of the county budget like a <strong>giant pizza ordered for a party</strong>, and your
            tax bill is your share of the cost. The county isn&apos;t trying to make the pizza bigger
            just to trick you — it&apos;s trying to figure out how big <em>your slice</em> should be
            based on how your home compares to everyone else&apos;s.
          </p>
          <p className="text-slate-700 leading-relaxed mt-4">
            If your neighborhood suddenly became the most popular spot in town, your slice got bigger —
            you pay a bit more of the total bill. Someone in a neighborhood that didn&apos;t change as
            much pays less. That&apos;s the whole story behind the 2021 → 2026 new value review.
          </p>
        </div>
      </section>

      {/* Three questions */}
      <section className="bg-white border-y px-6 py-14">
        <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-8">
          {[
            {
              title: "What changed?",
              text: "See what the county said your home was worth in 2021 vs. what it says now — in dollars and plain percentages.",
            },
            {
              title: "Why did it change?",
              text: "We connect county math to what actually happened in the housing market, so the numbers make sense.",
            },
            {
              title: "Is it fair?",
              text: "Compare your home's growth to the county average and your neighbors. Get a clear verdict — not jargon.",
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
            Multiple sources, each with a clear job — nothing hidden behind one magic figure.
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

      {/* How Parcelogik does the math — 3 steps */}
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
                sub: "Actual receipts from homes bought and sold in Buncombe County over the last few years.",
              },
              {
                n: 2,
                title: "We check neighborhood trends",
                sub: "Trusted market trackers (like Zillow) show how fast prices are moving in your specific area.",
              },
              {
                n: 3,
                title: "We compare the two timelines",
                sub: "The county's 2021 values vs. the new 2026 values — to see who is carrying the heaviest share of growth.",
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

      {/* New value review */}
      <section className="bg-indigo-50 border-y border-indigo-100 px-6 py-14">
        <div className="max-w-5xl mx-auto">
          <h3 className="text-2xl font-serif font-semibold text-slate-900 mb-3">
            2021 → 2026 new value review
          </h3>
          <p className="text-slate-600 leading-relaxed max-w-3xl mb-6">
            Buncombe&apos;s latest value review is live in Parcelogik. Look up any address to see
            Then vs. Now — and whether your home&apos;s growth matches the county average.
          </p>
          <div className="grid sm:grid-cols-3 gap-4 text-center">
            {[
              { label: "Matched homes", value: "112k+", sub: "2021 & 2026 on file" },
              { label: "Typical county increase", value: "+61%", sub: "Across matched homes" },
              { label: "Neighborhood range", value: "28 pts", sub: "Lowest vs. highest ZIP" },
            ].map(({ label, value, sub }) => (
              <div key={label} className="rounded-lg border border-indigo-200 bg-white p-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="text-2xl font-serif font-semibold mt-1 text-indigo-950">{value}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Counties */}
      <section className="px-6 py-14 max-w-5xl mx-auto w-full flex-1">
        <div className="flex items-center gap-2 mb-2">
          <MapPin className="w-5 h-5 text-slate-700" />
          <h3 className="text-2xl font-serif font-semibold">Counties</h3>
        </div>
        <p className="text-muted-foreground mb-8 max-w-2xl">
          Parcelogik is designed to scale county by county — same honest approach, local data.
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
                  <BuncombeLink>
                    <Button className="w-full bg-slate-900 hover:bg-slate-800">
                      Open dashboard <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </BuncombeLink>
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
            { icon: Building2, title: "Policy & budgets", text: "See who bore the largest increases in the new value review." },
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
          Parcelogik.com · Property tax clarity · Not a licensed appraisal ·{" "}
          <BuncombeLink className="text-amber-400 hover:underline">
            Buncombe County
          </BuncombeLink>
        </p>
      </footer>
    </div>
  );
}
