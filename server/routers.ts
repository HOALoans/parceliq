import { router } from "./_core/trpc.js";
import { parceliqRouter } from "./parceliqRouter.js";
import { reportRouter } from "./reportRouter.js";

export const appRouter = router({
  parceliq: parceliqRouter,
  report: reportRouter,
});

export type AppRouter = typeof appRouter;
