import "server-only";
import type Stripe from "stripe";
import { PRICING, type Plan } from "@/lib/posting/pricing";
import { getStripe } from "@/lib/stripe/client";

export const CHECKOUT_TTL_SECONDS = 60 * 60;

export type CheckoutRequest = {
  jobId: string;
  plan: Plan;
  jobTitle: string;
  company: string;
  customerEmail: string;
  origin: string;
};

export function buildCheckoutParams(request: CheckoutRequest, now: number = Date.now()): Stripe.Checkout.SessionCreateParams {
  const metadata = { job_id: request.jobId, plan: request.plan };
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      quantity: 1,
      price_data: {
        currency: PRICING.currency,
        unit_amount: PRICING.listing.amount,
        product_data: {
          name: PRICING.listing.name,
          description: `${request.jobTitle} at ${request.company}`.slice(0, 250),
        },
      },
    },
  ];

  if (request.plan === "featured") {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: PRICING.currency,
        unit_amount: PRICING.featured.amount,
        product_data: { name: PRICING.featured.name },
      },
    });
  }

  return {
    mode: "payment",
    line_items: lineItems,
    customer_email: request.customerEmail,
    customer_creation: "always",
    client_reference_id: request.jobId,
    metadata,
    payment_intent_data: { metadata, description: `Job listing ${request.jobId}` },
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    submit_type: "pay",
    expires_at: Math.floor(now / 1000) + CHECKOUT_TTL_SECONDS,
    success_url: `${request.origin}/post-a-job/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${request.origin}/post-a-job?canceled=1`,
  };
}

export async function createCheckoutSession(request: CheckoutRequest): Promise<{ id: string; url: string }> {
  const session = await getStripe().checkout.sessions.create(buildCheckoutParams(request), {
    idempotencyKey: `checkout:${request.jobId}`,
  });
  if (!session.url) {
    throw new Error(`Stripe returned checkout session ${session.id} without a URL`);
  }
  return { id: session.id, url: session.url };
}
