import "server-only";
import Stripe from "stripe";
import { getStripeEnv } from "@/lib/env";

let client: Stripe | undefined;

export function getStripe(): Stripe {
  if (client) return client;
  const { STRIPE_SECRET_KEY, STRIPE_API_BASE_URL } = getStripeEnv();
  const endpoint = STRIPE_API_BASE_URL ? new URL(STRIPE_API_BASE_URL) : null;
  client = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: "2026-08-26.dahlia",
    maxNetworkRetries: 2,
    timeout: 15_000,
    appInfo: { name: "agentjobs.dev", url: "https://agentjobs.dev" },
    // Only for stripe-mock / local test doubles; unset in production.
    ...(endpoint
      ? {
          host: endpoint.hostname,
          port: endpoint.port || (endpoint.protocol === "https:" ? "443" : "80"),
          protocol: endpoint.protocol === "https:" ? ("https" as const) : ("http" as const),
        }
      : {}),
  });
  return client;
}
