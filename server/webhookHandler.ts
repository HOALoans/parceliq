import type { Request, Response } from "express";
import fs from "fs";
import Stripe from "stripe";
import { Resend } from "resend";
import { pool } from "./db.js";
import {
  ensureReportTables,
  findReportById,
  findReportBySessionId,
  updateReportStatus,
} from "./reportDb.js";
import { generateReport } from "./reportGenerator.js";
import { appBaseUrl, getStripe } from "./stripeClient.js";

function resendFromAddress(): string {
  const raw = process.env.RESEND_FROM_EMAIL ?? "Parcelogik <onboarding@resend.dev>";
  return raw.trim().replace(/^["']|["']$/g, "");
}

async function sendReportEmail(opts: {
  email: string;
  pin: string;
  address: string;
  requestId: string;
  sessionId: string;
  pdfPath: string;
}): Promise<boolean> {
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    console.warn("RESEND_API_KEY not set — skipping appeal report email");
    return false;
  }

  const resend = new Resend(resendKey);
  const downloadUrl = `${appBaseUrl()}/api/reports/${opts.requestId}/download?session_id=${encodeURIComponent(opts.sessionId)}`;
  const pdfBuffer = fs.readFileSync(opts.pdfPath);

  const { data, error } = await resend.emails.send({
    from: resendFromAddress(),
    to: opts.email,
    subject: `Your Parcelogik Appeal Report — ${opts.address}`,
    html: `
      <p>Thank you for your purchase. Your Buncombe County property tax appeal report is attached.</p>
      <p><a href="${downloadUrl}">Download your PDF report</a></p>
      <p>Report ID: ${opts.requestId}</p>
      <p style="color:#64748b;font-size:12px">Parcelogik — analytical research, not a licensed appraisal.</p>
    `,
    attachments: [
      {
        filename: `parcelogik-appeal-${opts.pin.replace(/-/g, "")}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });

  if (error) {
    console.error("Resend email failed:", error);
    return false;
  }

  console.log(`Appeal report emailed to ${opts.email} (Resend id: ${data?.id ?? "unknown"})`);
  return true;
}

export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    res.status(500).send("STRIPE_WEBHOOK_SECRET not configured");
    return;
  }

  const sig = req.headers["stripe-signature"];
  if (!sig || typeof sig !== "string") {
    res.status(400).send("Missing stripe-signature");
    return;
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(req.body as Buffer, sig, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    console.error("Stripe webhook signature error:", message);
    res.status(400).send(`Webhook Error: ${message}`);
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    await processPaidSession(session);
  }

  res.json({ received: true });
}

async function processPaidSession(session: Stripe.Checkout.Session): Promise<void> {
  await ensureReportTables();
  const row = await findReportBySessionId(session.id);
  if (!row) {
    console.error("No report request for session", session.id);
    return;
  }

  const requestId = String(row.id);
  const pin = String(row.pin);
  const email = String(row.email);

  if (row.status === "sent" && row.pdf_path) return;

  await updateReportStatus(requestId, "paid");

  try {
    const pdfPath = await generateReport(pool, pin, requestId);
    await updateReportStatus(requestId, "generated", { pdfPath });

    const address = row.address != null ? String(row.address) : pin;
    await sendReportEmail({
      email,
      pin,
      address,
      requestId,
      sessionId: session.id,
      pdfPath,
    });

    await updateReportStatus(requestId, "sent", { pdfPath });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Report generation failed:", message);
    await updateReportStatus(requestId, "failed", { errorMessage: message });
  }
}

export async function handleReportDownload(req: Request, res: Response): Promise<void> {
  const requestId = req.params.requestId;
  const sessionId = typeof req.query.session_id === "string" ? req.query.session_id : "";

  if (!requestId || !sessionId) {
    res.status(400).send("Missing request id or session_id");
    return;
  }

  await ensureReportTables();
  const row = await findReportById(requestId);
  if (!row || String(row.stripe_session_id) !== sessionId) {
    res.status(404).send("Report not found");
    return;
  }

  const status = String(row.status);
  if (status === "pending" || status === "failed") {
    res.status(404).send("PDF not ready yet — check your email shortly.");
    return;
  }

  let pdfPath = row.pdf_path != null ? String(row.pdf_path) : "";
  let regenerated = false;

  if (!pdfPath || !fs.existsSync(pdfPath)) {
    try {
      const pin = String(row.pin);
      console.log(`Regenerating appeal report PDF for ${requestId} (${pin})`);
      pdfPath = await generateReport(pool, pin, requestId);
      await updateReportStatus(requestId, "sent", { pdfPath });
      regenerated = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("On-demand report regeneration failed:", message);
      res.status(500).send("Could not generate report — please contact support.");
      return;
    }
  }

  if (regenerated && row.email) {
    await sendReportEmail({
      email: String(row.email),
      pin: String(row.pin),
      address: row.address != null ? String(row.address) : String(row.pin),
      requestId,
      sessionId,
      pdfPath,
    });
  }

  const filename = `parcelogik-appeal-${String(row.pin).replace(/-/g, "")}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  fs.createReadStream(pdfPath).pipe(res);
}
