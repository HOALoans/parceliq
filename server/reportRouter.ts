import { z } from "zod";
import { nanoid } from "nanoid";
import { router, publicProcedure } from "./_core/trpc.js";
import { pool } from "./db.js";
import {
  ensureReportTables,
  findReportBySessionId,
  insertReportRequest,
} from "./reportDb.js";
import { appBaseUrl, getStripe } from "./stripeClient.js";

const REPORT_PRICE_CENTS = 4900;

export const reportRouter = router({
  createCheckoutSession: publicProcedure
    .input(
      z.object({
        pin: z.string().min(1),
        address: z.string().optional(),
        email: z.string().email(),
      }),
    )
    .mutation(async ({ input }) => {
      await ensureReportTables();
      const pin = input.pin.trim();
      const requestId = nanoid();
      const base = appBaseUrl();

      const session = await getStripe().checkout.sessions.create({
        mode: "payment",
        customer_email: input.email,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: REPORT_PRICE_CENTS,
              product_data: {
                name: "Parcelogik Property Tax Appeal Report",
                description: `Appeal evidence report for ${input.address ?? pin}`,
              },
            },
          },
        ],
        success_url: `${base}/buncombe?pin=${encodeURIComponent(pin)}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/buncombe?pin=${encodeURIComponent(pin)}&appeal_cancelled=1`,
        metadata: {
          requestId,
          pin,
          address: input.address ?? "",
        },
      });

      if (!session.url) throw new Error("Stripe did not return a checkout URL");

      await insertReportRequest({
        id: requestId,
        pin,
        address: input.address ?? null,
        email: input.email,
        stripeSessionId: session.id,
      });

      return {
        requestId,
        sessionId: session.id,
        url: session.url,
      };
    }),

  getReportStatus: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ input }) => {
      await ensureReportTables();
      let row = await findReportBySessionId(input.sessionId);
      if (!row) {
        return { status: "not_found" as const, downloadUrl: null, requestId: null };
      }

      const stripeSession = await getStripe().checkout.sessions.retrieve(input.sessionId);
      if (stripeSession.payment_status === "paid" && row.status === "pending") {
        await pool.query(
          `UPDATE parceliq_report_requests SET status = 'paid', updated_at = NOW() WHERE id = $1`,
          [row.id],
        );
        row = (await findReportBySessionId(input.sessionId))!;
      }

      const status = String(row.status);
      const requestId = String(row.id);
      const base = appBaseUrl();
      const downloadUrl =
        (status === "sent" || status === "generated") && row.pdf_path
          ? `${base}/api/reports/${requestId}/download?session_id=${encodeURIComponent(input.sessionId)}`
          : null;

      return {
        status,
        downloadUrl,
        requestId,
        pin: String(row.pin),
        address: row.address != null ? String(row.address) : null,
        paymentStatus: stripeSession.payment_status,
      };
    }),

  getAppealPreview: publicProcedure
    .input(z.object({ pin: z.string().min(1), zip: z.string().optional() }))
    .query(async ({ input }) => {
      const pin = input.pin.trim();
      const yoyRes = await pool.query(
        `SELECT value_2021, value_2026, change_pct, vs_zip_median_pts, zip_median_change_pct
         FROM parceliq_yoy_change WHERE pin = $1 LIMIT 1`,
        [pin],
      ).catch(() => ({ rows: [] as Record<string, unknown>[] }));

      const yoy = yoyRes.rows[0] as Record<string, unknown> | undefined;

      const { rows: parcelRows } = await pool.query(
        `SELECT postal_code FROM parceliq_parcels WHERE pin = $1 LIMIT 1`,
        [pin],
      );
      const zip = input.zip ?? String(parcelRows[0]?.postal_code ?? "");

      const compCountRes = await pool.query(
        `SELECT COUNT(*)::int AS c FROM parceliq_sales s
         INNER JOIN parceliq_parcels p ON p.pin = s.pin
         WHERE p.postal_code = $1 AND s.pin != $2
           AND s.qualified = TRUE AND s.vacant_lot = FALSE
           AND s.sell_date >= '2020-01-01' AND s.selling_price > 0`,
        [zip, pin],
      );

      return {
        value2021: yoy?.value_2021 != null ? Number(yoy.value_2021) : null,
        value2026: yoy?.value_2026 != null ? Number(yoy.value_2026) : null,
        changePct: yoy?.change_pct != null ? Number(yoy.change_pct) : null,
        vsZipMedianPts: yoy?.vs_zip_median_pts != null ? Number(yoy.vs_zip_median_pts) : null,
        zipMedianChangePct: yoy?.zip_median_change_pct != null ? Number(yoy.zip_median_change_pct) : null,
        compCount: Number(compCountRes.rows[0]?.c ?? 0),
        countyMedianChangePct: 61.3,
      };
    }),
});
