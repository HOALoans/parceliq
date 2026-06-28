import { router } from "./_core/trpc.js";
import { parceliqRouter } from "./parceliqRouter.js";

export const appRouter = router({
  parceliq: parceliqRouter,
});

export type AppRouter = typeof appRouter;
