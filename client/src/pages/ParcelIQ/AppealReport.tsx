/**
 * Appeal report purchase — free preview + Stripe checkout ($49).
 */

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Download, Loader2, CheckCircle2 } from "lucide-react";

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

type AppealReportProps = {
  pin: string;
  address: string;
  reappraisalYoY?: Record<string, any> | null;
  compCount?: number;
  checkoutSessionId?: string | null;
};

/** Sticky top bar after Stripe checkout — download + generating state. */
export function AppealReportStatusBar({ sessionId }: { sessionId: string }) {
  const statusQuery = trpc.report.getReportStatus.useQuery(
    { sessionId },
    {
      refetchInterval: (data) =>
        data?.status === "sent" || data?.status === "failed" ? false : 3000,
    },
  );

  const paid =
    statusQuery.data?.status === "sent" ||
    statusQuery.data?.status === "generated" ||
    statusQuery.data?.paymentStatus === "paid";
  const downloadUrl = statusQuery.data?.downloadUrl;

  if (statusQuery.isLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground shadow-sm">
        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
        Confirming payment and generating your appeal report…
      </div>
    );
  }

  if (paid && downloadUrl) {
    return (
      <div className="rounded-lg border-2 border-green-500 bg-green-50 px-4 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-sm">
        <div className="flex items-start gap-2 text-green-900">
          <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Your appeal report is ready</p>
            <p className="text-sm text-green-800 mt-0.5">
              Payment confirmed. Download your 6-page PDF below.
            </p>
          </div>
        </div>
        <Button asChild size="lg" className="bg-green-700 hover:bg-green-800 shrink-0">
          <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
            <Download className="w-4 h-4 mr-2" />
            Download PDF Report
          </a>
        </Button>
      </div>
    );
  }

  if (statusQuery.data?.status === "failed") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        Report generation failed. Contact support with your payment confirmation.
      </div>
    );
  }

  return null;
}

export default function AppealReport({
  pin,
  address,
  reappraisalYoY,
  compCount: compCountProp,
  checkoutSessionId,
}: AppealReportProps) {
  const [email, setEmail] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(checkoutSessionId ?? null);

  useEffect(() => {
    if (checkoutSessionId) setSessionId(checkoutSessionId);
  }, [checkoutSessionId]);

  const preview = trpc.report.getAppealPreview.useQuery(
    { pin, zip: reappraisalYoY?.zipcode },
    { enabled: Boolean(pin) },
  );

  const statusQuery = trpc.report.getReportStatus.useQuery(
    { sessionId: sessionId! },
    {
      enabled: Boolean(sessionId),
      refetchInterval: (data) =>
        data?.status === "sent" || data?.status === "failed" ? false : 3000,
    },
  );

  const checkout = trpc.report.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });

  const yoy = reappraisalYoY;
  const value2021 = yoy?.value_2021 ?? preview.data?.value2021;
  const value2026 = yoy?.value_2026 ?? preview.data?.value2026;
  const changePct = yoy?.change_pct ?? preview.data?.changePct;
  const vsZip = yoy?.vs_zip_median_pts ?? preview.data?.vsZipMedianPts;
  const zipMedian = yoy?.zip_median_change_pct ?? preview.data?.zipMedianChangePct;
  const countyMedian = preview.data?.countyMedianChangePct ?? 61.3;
  const compCount = compCountProp ?? preview.data?.compCount ?? 0;

  const paid =
    statusQuery.data?.status === "sent" ||
    statusQuery.data?.status === "generated" ||
    statusQuery.data?.paymentStatus === "paid";

  const downloadUrl = statusQuery.data?.downloadUrl;

  if (sessionId && paid && downloadUrl) {
    return null;
  }

  if (sessionId && (statusQuery.isLoading || (paid && !downloadUrl))) {
    return null;
  }

  return (
    <Card className="border-2 border-amber-400 shadow-md overflow-hidden">
      <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-amber-400" />
          <div>
            <p className="font-serif font-semibold text-lg">Property Tax Appeal Report</p>
            <p className="text-xs text-slate-400">Professional 6-page PDF · Buncombe County</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-amber-400">$49</p>
          <p className="text-[10px] text-slate-400 uppercase tracking-wide">One-time</p>
        </div>
      </div>

      <CardContent className="pt-5 space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 mb-2">
            Free preview
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border bg-neutral-50 px-3 py-2">
              <p className="text-[10px] text-muted-foreground uppercase">2021 value</p>
              <p className="font-mono font-semibold text-sm mt-0.5">{fmt(value2021)}</p>
            </div>
            <div className="rounded-lg border bg-neutral-50 px-3 py-2">
              <p className="text-[10px] text-muted-foreground uppercase">2026 value</p>
              <p className="font-mono font-semibold text-sm mt-0.5">{fmt(value2026)}</p>
            </div>
            <div className="rounded-lg border bg-neutral-50 px-3 py-2">
              <p className="text-[10px] text-muted-foreground uppercase">% change</p>
              <p className="font-mono font-semibold text-sm mt-0.5">{fmtPct(changePct)}</p>
            </div>
            <div className="rounded-lg border bg-neutral-50 px-3 py-2">
              <p className="text-[10px] text-muted-foreground uppercase">vs ZIP median</p>
              <p className="font-mono font-semibold text-sm mt-0.5">
                {vsZip != null ? `${vsZip > 0 ? "+" : ""}${Number(vsZip).toFixed(1)} pts` : "—"}
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
            County median reappraisal: <strong>{fmtPct(countyMedian)}</strong>
            {zipMedian != null && (
              <> · Your ZIP median: <strong>{fmtPct(zipMedian)}</strong></>
            )}
            .{" "}
            <strong className="text-slate-800">
              {compCount} comparable sale{compCount !== 1 ? "s" : ""} found in your ZIP
            </strong>{" "}
            — full table in the paid report.
          </p>
        </div>

        <div className="border-t pt-4 space-y-3">
          <p className="text-sm text-slate-700 leading-relaxed">
            Full report includes: comparable sales table, ZIP equity analysis, Zillow market trend,
            step-by-step Buncombe appeal guide, and data methodology — formatted for assessor review.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              type="email"
              placeholder="Email for report delivery"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1"
            />
            <Button
              size="lg"
              className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold shrink-0"
              disabled={!email || checkout.isLoading}
              onClick={() =>
                checkout.mutate({ pin, address, email })
              }
            >
              {checkout.isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Redirecting…
                </>
              ) : (
                "Get My Appeal Report — $49"
              )}
            </Button>
          </div>
          {checkout.isError && (
            <p className="text-sm text-red-700">{checkout.error.message}</p>
          )}
          <p className="text-[10px] text-muted-foreground">
            Secure checkout via Stripe. Not a licensed appraisal or legal advice.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
