import type Stripe from "stripe";
import { EnvConfigError, getStripeEnv } from "@/lib/env";
import { getStripe } from "@/lib/stripe/client";
import { handleStripeEvent } from "@/lib/stripe/fulfillment";
import { createFulfillmentDeps } from "@/lib/stripe/fulfillment-deps";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const JSON_HEADERS = { "Cache-Control": "no-store" } as const;

/**
 * Stripe webhook. Signature is verified against the raw body. Responds 2xx
 * for anything it has processed or deliberately ignored; 5xx only for
 * transient failures so Stripe retries.
 */
export async function POST(request: Request) {
  let webhookSecret: string;
  try {
    webhookSecret = getStripeEnv().STRIPE_WEBHOOK_SECRET;
  } catch (error) {
    console.error("[stripe-webhook] not configured", error);
    return Response.json({ error: "Stripe is not configured" }, { status: 503, headers: JSON_HEADERS });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing Stripe-Signature header" }, { status: 400, headers: JSON_HEADERS });
  }

  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (error) {
    console.warn("[stripe-webhook] signature verification failed", error instanceof Error ? error.message : error);
    return Response.json({ error: "Invalid signature" }, { status: 400, headers: JSON_HEADERS });
  }

  try {
    const outcome = await handleStripeEvent(event, createFulfillmentDeps({ revalidate: true, notify: true }));
    return Response.json({ received: true, type: event.type, outcome }, { headers: JSON_HEADERS });
  } catch (error) {
    const status = error instanceof EnvConfigError ? 503 : 500;
    console.error("[stripe-webhook] processing failed", { event: event.id, type: event.type, error });
    return Response.json({ error: "Processing failed" }, { status, headers: JSON_HEADERS });
  }
}
