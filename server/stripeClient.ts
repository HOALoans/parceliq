import Stripe from "stripe";

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  if (!stripe) stripe = new Stripe(key);
  return stripe;
}

export function appBaseUrl(): string {
  let url = (process.env.APP_URL ?? process.env.PUBLIC_URL ?? "http://localhost:10000").trim();
  if (url && !/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  return url.replace(/\/$/, "");
}
