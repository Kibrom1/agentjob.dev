import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { planSubtotal } from "@/lib/posting/pricing";
import { handleStripeEvent, type FulfillmentDeps, type FulfillmentJob } from "@/lib/stripe/fulfillment";

const WEBHOOK_SECRET = "whsec_testsecret123";
const stripe = new Stripe("sk_test_unit");
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "cs_test_fulfil";

/** Builds an event the same way Stripe would deliver it (signed, then verified). */
function signedEvent(type: string, session: Record<string, unknown>): Stripe.Event {
  const payload = JSON.stringify({
    id: `evt_${Math.random().toString(36).slice(2)}`,
    object: "event",
    api_version: "2026-08-26.dahlia",
    created: 1_788_000_000,
    type,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object: { id: SESSION_ID, object: "checkout.session", ...session } },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return stripe.webhooks.constructEvent(payload, header, WEBHOOK_SECRET);
}

function paidSession(overrides: Record<string, unknown> = {}) {
  return {
    payment_status: "paid",
    currency: "usd",
    amount_subtotal: planSubtotal("featured"),
    amount_total: planSubtotal("featured") - 2_000,
    customer: "cus_123",
    customer_details: { email: "buyer@orbit.example" },
    metadata: { job_id: JOB_ID, plan: "featured" },
    ...overrides,
  };
}

function job(status: FulfillmentJob["status"]): FulfillmentJob {
  return { id: JOB_ID, slug: "agent-engineer-at-orbit-22222222", title: "Agent Engineer", company: "Orbit", status };
}

function deps(overrides: Partial<FulfillmentDeps> = {}) {
  const base = {
    findJobBySession: vi.fn(async () => job("pending_payment")),
    activateJob: vi.fn(async () => job("active")),
    expireCheckout: vi.fn(async () => 1),
    saveCustomer: vi.fn(async () => undefined),
    onPublished: vi.fn(async () => undefined),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  return { ...base, ...overrides } as typeof base;
}

describe("signature verification", () => {
  it("rejects tampered payloads", () => {
    const payload = JSON.stringify({ id: "evt_1", object: "event", type: "checkout.session.completed", data: { object: {} } });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    expect(() => stripe.webhooks.constructEvent(payload.replace("evt_1", "evt_2"), header, WEBHOOK_SECRET)).toThrow();
    expect(() => stripe.webhooks.constructEvent(payload, header, "whsec_other")).toThrow();
  });
});

describe("handleStripeEvent", () => {
  it("publishes a paid featured posting and runs follow-ups", async () => {
    const d = deps();
    const outcome = await handleStripeEvent(signedEvent("checkout.session.completed", paidSession()), d);
    expect(outcome).toBe("activated");
    expect(d.activateJob).toHaveBeenCalledWith(SESSION_ID, true);
    expect(d.saveCustomer).toHaveBeenCalledWith(JOB_ID, "cus_123");
    expect(d.onPublished).toHaveBeenCalledWith(job("active"), "buyer@orbit.example");
  });

  it("accepts discounted totals because it checks the pre-discount subtotal", async () => {
    const d = deps();
    const event = signedEvent("checkout.session.completed", paidSession({ amount_total: 0, payment_status: "no_payment_required" }));
    expect(await handleStripeEvent(event, d)).toBe("activated");
  });

  it("publishes a standard posting without the feature flag", async () => {
    const d = deps();
    const event = signedEvent(
      "checkout.session.async_payment_succeeded",
      paidSession({ amount_subtotal: planSubtotal("standard"), metadata: { job_id: JOB_ID, plan: "standard" } }),
    );
    expect(await handleStripeEvent(event, d)).toBe("activated");
    expect(d.activateJob).toHaveBeenCalledWith(SESSION_ID, false);
  });

  it("waits while an async payment is still processing", async () => {
    const d = deps();
    const event = signedEvent("checkout.session.completed", paidSession({ payment_status: "unpaid" }));
    expect(await handleStripeEvent(event, d)).toBe("awaiting_payment");
    expect(d.activateJob).not.toHaveBeenCalled();
  });

  it("refuses to publish when the paid amount does not match the plan", async () => {
    const d = deps();
    const cheap = signedEvent("checkout.session.completed", paidSession({ amount_subtotal: planSubtotal("standard") }));
    expect(await handleStripeEvent(cheap, d)).toBe("amount_mismatch");
    const wrongCurrency = signedEvent("checkout.session.completed", paidSession({ currency: "eur" }));
    expect(await handleStripeEvent(wrongCurrency, d)).toBe("amount_mismatch");
    expect(d.activateJob).not.toHaveBeenCalled();
    expect(d.log.error).toHaveBeenCalled();
  });

  it.each([
    [{ metadata: {} }],
    [{ metadata: { job_id: JOB_ID, plan: "platinum" } }],
    [{ metadata: null }],
  ])("rejects invalid metadata %#", async (override) => {
    const d = deps();
    expect(await handleStripeEvent(signedEvent("checkout.session.completed", paidSession(override)), d)).toBe("invalid_metadata");
    expect(d.findJobBySession).not.toHaveBeenCalled();
  });

  it("rejects a session whose metadata points at a different job", async () => {
    const d = deps({ findJobBySession: vi.fn(async () => ({ ...job("pending_payment"), id: "33333333-3333-4333-8333-333333333333" })) });
    expect(await handleStripeEvent(signedEvent("checkout.session.completed", paidSession()), d)).toBe("invalid_metadata");
    expect(d.activateJob).not.toHaveBeenCalled();
  });

  it("is idempotent for jobs that are already live", async () => {
    const d = deps({ findJobBySession: vi.fn(async () => job("active")) });
    expect(await handleStripeEvent(signedEvent("checkout.session.completed", paidSession()), d)).toBe("already_active");
    expect(d.activateJob).not.toHaveBeenCalled();
    expect(d.onPublished).not.toHaveBeenCalled();
  });

  it("reports unknown sessions", async () => {
    const d = deps({ findJobBySession: vi.fn(async () => null) });
    expect(await handleStripeEvent(signedEvent("checkout.session.completed", paidSession()), d)).toBe("not_found");
  });

  it("reports sessions that can no longer be activated", async () => {
    const d = deps({ activateJob: vi.fn(async () => job("payment_expired")) });
    expect(await handleStripeEvent(signedEvent("checkout.session.completed", paidSession()), d)).toBe("not_activatable");
    expect(d.onPublished).not.toHaveBeenCalled();
  });

  it("does not fail the webhook when follow-ups fail", async () => {
    const d = deps({
      saveCustomer: vi.fn(async () => {
        throw new Error("db down");
      }),
      onPublished: vi.fn(async () => {
        throw new Error("email down");
      }),
    });
    expect(await handleStripeEvent(signedEvent("checkout.session.completed", paidSession()), d)).toBe("activated");
    expect(d.log.warn).toHaveBeenCalledTimes(2);
  });

  it("propagates activation errors so Stripe retries", async () => {
    const d = deps({
      activateJob: vi.fn(async () => {
        throw new Error("timeout");
      }),
    });
    await expect(handleStripeEvent(signedEvent("checkout.session.completed", paidSession()), d)).rejects.toThrow("timeout");
  });

  it("expires abandoned or failed checkouts", async () => {
    const d = deps();
    expect(await handleStripeEvent(signedEvent("checkout.session.expired", {}), d)).toBe("expired");
    expect(await handleStripeEvent(signedEvent("checkout.session.async_payment_failed", {}), d)).toBe("expired");
    const none = deps({ expireCheckout: vi.fn(async () => 0) });
    expect(await handleStripeEvent(signedEvent("checkout.session.expired", {}), none)).toBe("ignored");
    expect(d.expireCheckout).toHaveBeenCalledWith(SESSION_ID);
  });

  it("ignores unrelated events", async () => {
    const d = deps();
    expect(await handleStripeEvent(signedEvent("customer.created", {}), d)).toBe("ignored");
    expect(d.findJobBySession).not.toHaveBeenCalled();
  });
});
