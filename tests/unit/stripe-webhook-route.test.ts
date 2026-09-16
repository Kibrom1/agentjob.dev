import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handleStripeEvent = vi.fn();
const createFulfillmentDeps = vi.fn(() => ({ marker: "deps" }));

vi.mock("@/lib/stripe/fulfillment", () => ({ handleStripeEvent }));
vi.mock("@/lib/stripe/fulfillment-deps", () => ({ createFulfillmentDeps }));

const SECRET = "whsec_routesecret";
const stripe = new Stripe("sk_test_route");

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/stripe/webhook/route");
}

function request(body: string, signature?: string) {
  return new Request("https://agentjob.dev/api/stripe/webhook", {
    method: "POST",
    body,
    headers: signature ? { "stripe-signature": signature } : {},
  });
}

const payload = JSON.stringify({
  id: "evt_route",
  object: "event",
  type: "checkout.session.completed",
  data: { object: { id: "cs_test_route", object: "checkout.session" } },
});

describe("POST /api/stripe/webhook", () => {
  beforeEach(() => {
    handleStripeEvent.mockReset();
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_route");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
  });

  it("returns 503 when Stripe is not configured", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const { POST } = await loadRoute();
    const response = await POST(request(payload, "t=1,v1=x"));
    expect(response.status).toBe(503);
  });

  it("requires a signature header", async () => {
    const { POST } = await loadRoute();
    expect((await POST(request(payload))).status).toBe(400);
  });

  it("rejects invalid signatures without processing", async () => {
    const { POST } = await loadRoute();
    const response = await POST(request(payload, "t=1,v1=deadbeef"));
    expect(response.status).toBe(400);
    expect(handleStripeEvent).not.toHaveBeenCalled();
  });

  it("processes verified events", async () => {
    handleStripeEvent.mockResolvedValue("activated");
    const { POST } = await loadRoute();
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const response = await POST(request(payload, signature));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, type: "checkout.session.completed", outcome: "activated" });
    expect(handleStripeEvent.mock.calls[0]?.[0]).toMatchObject({ id: "evt_route" });
    expect(createFulfillmentDeps).toHaveBeenCalledWith({ revalidate: true, notify: true });
  });

  it("returns 500 on processing failures so Stripe retries", async () => {
    handleStripeEvent.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await loadRoute();
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    expect((await POST(request(payload, signature))).status).toBe(500);
  });
});
