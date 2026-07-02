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

    const downloadUrl = `${appBaseUrl()}/api/reports/${requestId}/download?session_id=${encodeURIComponent(session.id)}`;

    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const resend = new Resend(resendKey);
      const from = process.env.RESEND_FROM_EMAIL ?? "Parcelogik <onboarding@resend.dev>";
      const pdfBuffer = fs.readFileSync(pdfPath);

      await resend.emails.send({
        from,
        to: email,
        subject: "Your Parcelogik Appeal Report",
        html: `
          <p>Thank you for your purchase. Your Buncombe County property tax appeal report is ready.</p>
          <p><a href="${downloadUrl}">Download your PDF report</a></p>
          <p>Report ID: ${requestId}</p>
          <p style="color:#64748b;font-size:12px">Parcelogik — analytical research, not a licensed appraisal.</p>
        `,
        attachments: [
          {
            filename: `parcelogik-appeal-report-${pin.replace(/-/g, "")}.pdf`,
            content: pdfBuffer,
          },
        ],
      });
    } else {
      console.warn("RESEND_API_KEY not set — skipping appeal report email");
    }

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

  const pdfPath = row.pdf_path != null ? String(row.pdf_path) : "";
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    res.status(404).send("PDF not ready yet — check your email shortly.");
    return;
  }

  const filename = `parcelogik-appeal-${String(row.pin).replace(/-/g, "")}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  fs.createReadStream(pdfPath).pipe(res);
}
