import { describe, expect, it } from "vitest";
import { PRICING, formatUsd, isPlan, planFor, planSubtotal } from "@/lib/posting/pricing";
import { CHECKOUT_TTL_SECONDS, buildCheckoutParams } from "@/lib/stripe/checkout";

describe("pricing", () => {
  it("matches the published prices", () => {
    expect(planSubtotal("standard")).toBe(14_900);
    expect(planSubtotal("featured")).toBe(24_800);
    expect(formatUsd(PRICING.listing.amount)).toBe("$149");
    expect(formatUsd(1999)).toBe("$19.99");
  });

  it("maps and validates plans", () => {
    expect(planFor(true)).toBe("featured");
    expect(planFor(false)).toBe("standard");
    expect(isPlan("featured")).toBe(true);
    expect(isPlan("premium")).toBe(false);
    expect(isPlan(undefined)).toBe(false);
  });
});

describe("buildCheckoutParams", () => {
  const request = {
    jobId: "11111111-1111-4111-8111-111111111111",
    jobTitle: "Agent Engineer",
    company: "Orbit",
    customerEmail: "a@orbit.example",
    origin: "https://agentjobs.dev",
  };

  it("charges the listing only for the standard plan", () => {
    const params = buildCheckoutParams({ ...request, plan: "standard" }, 1_000_000);
    expect(params.mode).toBe("payment");
    expect(params.line_items).toHaveLength(1);
    expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(14_900);
    expect(params.metadata).toEqual({ job_id: request.jobId, plan: "standard" });
    expect(params.payment_intent_data?.metadata).toEqual(params.metadata);
    expect(params.client_reference_id).toBe(request.jobId);
    expect(params.expires_at).toBe(1000 + CHECKOUT_TTL_SECONDS);
    expect(params.success_url).toBe("https://agentjobs.dev/post-a-job/success?session_id={CHECKOUT_SESSION_ID}");
    expect(params.cancel_url).toBe("https://agentjobs.dev/post-a-job?canceled=1");
  });

  it("adds the featured line item", () => {
    const params = buildCheckoutParams({ ...request, plan: "featured" });
    expect(params.line_items?.map((item) => item.price_data?.unit_amount)).toEqual([14_900, 9_900]);
    const total = params.line_items?.reduce((sum, item) => sum + (item.price_data?.unit_amount ?? 0), 0);
    expect(total).toBe(planSubtotal("featured"));
  });
});
