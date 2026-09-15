import { describe, expect, it, vi } from "vitest";
import { EnvConfigError, getEmailEnv, getServerEnv, getServiceEnv, getStripeEnv, isEmailConfigured } from "@/lib/env";

describe("env validation", () => {
  it("accepts a public key and refuses secret keys for public reads", () => {
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_ANON_KEY", "sb_publishable_abcdefghijklmnop");
    expect(getServerEnv().SUPABASE_URL).toBe("https://abc.supabase.co");
    vi.stubEnv("SUPABASE_ANON_KEY", "sb_secret_abcdefghijklmnopqrst");
    expect(() => getServerEnv()).toThrow(EnvConfigError);
  });

  it("requires a distinct, non-publishable service key", () => {
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_ANON_KEY", "same-key-value-1234567890");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "same-key-value-1234567890");
    expect(() => getServiceEnv()).toThrow(/must differ/);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_publishable_abcdefghijklmnop");
    expect(() => getServiceEnv()).toThrow(/publishable/);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_abcdefghijklmnopqrst");
    expect(getServiceEnv().SUPABASE_SERVICE_ROLE_KEY).toBe("sb_secret_abcdefghijklmnopqrst");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => getServiceEnv()).toThrow(EnvConfigError);
  });

  it("validates Stripe key formats", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "pk_test_nope");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_abc");
    expect(() => getStripeEnv()).toThrow(/STRIPE_SECRET_KEY/);
    vi.stubEnv("STRIPE_SECRET_KEY", "rk_live_abc123");
    expect(getStripeEnv().STRIPE_SECRET_KEY).toBe("rk_live_abc123");
  });

  it("validates email settings and reports whether email is configured", () => {
    vi.stubEnv("RESEND_API_KEY", "re_abc_123");
    vi.stubEnv("EMAIL_FROM", "AgentJobs <digest@agentjobs.dev>");
    vi.stubEnv("EMAIL_REPLY_TO", "");
    vi.stubEnv("POSTAL_ADDRESS", "123 Market St, San Francisco, CA");
    expect(getEmailEnv()).toMatchObject({ EMAIL_REPLY_TO: undefined });
    expect(isEmailConfigured()).toBe(true);
    vi.stubEnv("EMAIL_FROM", "not an address");
    expect(() => getEmailEnv()).toThrow(/EMAIL_FROM/);
    vi.stubEnv("POSTAL_ADDRESS", "");
    expect(isEmailConfigured()).toBe(false);
  });
});
