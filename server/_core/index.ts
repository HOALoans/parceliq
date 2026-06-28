import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import * as trpcExpress from "@trpc/server/adapters/express";
import { createContext } from "./context.js";
import { appRouter } from "../routers.js";
import { ensureTables } from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export { appRouter } from "../routers.js";
export type { AppRouter } from "../routers.js";

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "ParcelIQ", ts: new Date().toISOString() });
});

// tRPC
app.use(
  "/api/trpc",
  trpcExpress.createExpressMiddleware({ router: appRouter, createContext })
);

// Serve Vite build in production
const isProd = process.env.NODE_ENV === "production";
if (isProd) {
  const clientDist = path.resolve(__dirname, "../../client");
  app.use(express.static(clientDist, {
    setHeaders(res, filePath) {
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-store");
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }));
  // SPA fallback
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const PORT = Number(process.env.PORT) || 10000;

const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  (async () => {
    await ensureTables();
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🏛  ParcelIQ running on port ${PORT}`);
    });
  })();
}
