import type Stripe from "stripe";
import type { Enums } from "@/lib/database.types";
import { PRICING, isPlan, planSubtotal } from "@/lib/posting/pricing";

export type FulfillmentJob = {
  id: string;
  slug: string;
  title: string;
  company: string;
  status: Enums<"job_status">;
};

export type FulfillmentLogger = Pick<Console, "info" | "warn" | "error">;

/** Side effects, injected so the decision logic is testable without I/O. */
export type FulfillmentDeps = {
  findJobBySession(sessionId: string): Promise<FulfillmentJob | null>;
  activateJob(sessionId: string, featured: boolean): Promise<FulfillmentJob>;
  expireCheckout(sessionId: string): Promise<number>;
  saveCustomer(jobId: string, customerId: string): Promise<void>;
  onPublished(job: FulfillmentJob, contactEmail: string | null): Promise<void>;
  log: FulfillmentLogger;
};

export type FulfillmentOutcome =
  | "activated"
  | "already_active"
  | "awaiting_payment"
  | "amount_mismatch"
  | "invalid_metadata"
  | "not_found"
  | "not_activatable"
  | "expired"
  | "ignored";

function customerIdOf(session: Stripe.Checkout.Session): string | null {
  const customer = session.customer;
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

/**
 * Publishes the job behind a Checkout session if, and only if, Stripe says it
 * is paid for the price this server set. Shared by the webhook and the
 * success page, and idempotent across both.
 */
export async function fulfillCheckoutSession(
  session: Stripe.Checkout.Session,
  deps: FulfillmentDeps,
): Promise<FulfillmentOutcome> {
  const jobId = session.metadata?.job_id;
  const plan = session.metadata?.plan;

  if (!jobId || !isPlan(plan)) {
    deps.log.error("[fulfillment] session without valid metadata", { session: session.id });
    return "invalid_metadata";
  }

  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    return "awaiting_payment";
  }

  if (session.currency !== PRICING.currency || session.amount_subtotal !== planSubtotal(plan)) {
    deps.log.error("[fulfillment] paid amount does not match plan; not publishing", {
      session: session.id,
      plan,
      currency: session.currency,
      subtotal: session.amount_subtotal,
      expected: planSubtotal(plan),
    });
    return "amount_mismatch";
  }

  const existing = await deps.findJobBySession(session.id);
  if (!existing) {
    deps.log.error("[fulfillment] no job for paid session", { session: session.id, jobId });
    return "not_found";
  }
  if (existing.id !== jobId) {
    deps.log.error("[fulfillment] session metadata points at a different job", {
      session: session.id,
      metadataJob: jobId,
      storedJob: existing.id,
    });
    return "invalid_metadata";
  }
  if (existing.status === "active") {
    return "already_active";
  }

  const job = await deps.activateJob(session.id, plan === "featured");
  if (job.status !== "active") {
    deps.log.warn("[fulfillment] paid session could not activate job", { session: session.id, status: job.status });
    return "not_activatable";
  }

  const customerId = customerIdOf(session);
  if (customerId) {
    await deps.saveCustomer(job.id, customerId).catch((cause: unknown) => {
      deps.log.warn("[fulfillment] could not store Stripe customer", { job: job.id, cause });
    });
  }

  const contactEmail = session.customer_details?.email ?? session.customer_email ?? null;
  await deps.onPublished(job, contactEmail).catch((cause: unknown) => {
    deps.log.warn("[fulfillment] post-publish hooks failed", { job: job.id, cause });
  });

  deps.log.info("[fulfillment] job published", { job: job.id, plan });
  return "activated";
}

export async function handleStripeEvent(event: Stripe.Event, deps: FulfillmentDeps): Promise<FulfillmentOutcome> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return fulfillCheckoutSession(event.data.object, deps);

    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      const changed = await deps.expireCheckout(event.data.object.id);
      return changed > 0 ? "expired" : "ignored";
    }

    default:
      return "ignored";
  }
}
