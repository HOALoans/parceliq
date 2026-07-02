import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import * as trpcExpress from "@trpc/server/adapters/express";
import { createContext } from "./context.js";
import { appRouter } from "../routers.js";
import { ensureTables } from "../db.js";
import { handleReportDownload, handleStripeWebhook } from "../webhookHandler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export { appRouter } from "../routers.js";
export type { AppRouter } from "../routers.js";

const app = express();

// Stripe webhook — must use raw body (before express.json)
app.post(
  "/webhook/stripe",
  express.raw({ type: "application/json" }),
  (req, res) => {
    void handleStripeWebhook(req, res);
  },
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "Parcelogik", ts: new Date().toISOString() });
});

// Appeal report PDF download
app.get("/api/reports/:requestId/download", (req, res) => {
  void handleReportDownload(req, res);
});

// tRPC
app.use(
  "/api/trpc",
  trpcExpress.createExpressMiddleware({ router: appRouter, createContext })
);

// Serve Vite build (dist/client) on the same port as the API
const clientDist = path.resolve(__dirname, "../../client");
if (fs.existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist, {
    setHeaders(res, filePath) {
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-store");
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=3600");
      }
    },
  }));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
} else {
  console.warn(`⚠️  Client build missing at ${clientDist} — run "npm run build" or use Vite on :5173`);
}

const PORT = Number(process.env.PORT) || 10000;

const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  (async () => {
    await ensureTables();
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🏛  Parcelogik.com running on port ${PORT}`);
    });
  })();
}
