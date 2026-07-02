import Stripe from "stripe";

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  if (!stripe) stripe = new Stripe(key);
  return stripe;
}

export function appBaseUrl(): string {
  return (process.env.APP_URL ?? process.env.PUBLIC_URL ?? "http://localhost:10000").replace(/\/$/, "");
}
