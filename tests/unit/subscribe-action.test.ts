import { beforeEach, describe, expect, it, vi } from "vitest";

const consumeRateLimit = vi.fn();
const requestDigestSignup = vi.fn();
const isEmailConfigured = vi.fn();

vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  consumeRateLimit: (...args: unknown[]) => consumeRateLimit(...args),
}));
vi.mock("@/lib/digest/signup", () => ({ requestDigestSignup: (...args: unknown[]) => requestDigestSignup(...args) }));
vi.mock("@/lib/digest/signup-deps", () => ({ createSignupDeps: () => ({}) }));
vi.mock("@/lib/env", () => ({
  isEmailConfigured: () => isEmailConfigured(),
  getEmailEnv: () => ({ POSTAL_ADDRESS: "1 Main St, Springfield, USA" }),
}));

import { subscribeToDigest } from "@/app/actions";

const idle = { status: "idle" } as const;
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

beforeEach(() => {
  consumeRateLimit.mockResolvedValue(true);
  requestDigestSignup.mockResolvedValue(undefined);
  isEmailConfigured.mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("subscribeToDigest (double opt-in)", () => {
  it("asks the visitor to check their inbox, normalising the address", async () => {
    const state = await subscribeToDigest(idle, form({ email: "  Reader@Example.com ", source: "job-page" }));
    expect(state).toMatchObject({ status: "success", countable: true });
    expect(state.status === "success" && state.message).toMatch(/confirmation link/i);
    expect(requestDigestSignup).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ postalAddress: "1 Main St, Springfield, USA" }),
      { email: "reader@example.com", source: "job-page" },
    );
  });

  it("answers identically whether or not an email was actually sent (no address enumeration)", async () => {
    const first = await subscribeToDigest(idle, form({ email: "new@example.com" }));
    requestDigestSignup.mockResolvedValue(undefined); // existing/confirmed address: nothing sent, same resolution
    const second = await subscribeToDigest(idle, form({ email: "existing@example.com" }));
    expect(second).toEqual(first);
  });

  it("silently accepts honeypot hits without touching anything or counting them", async () => {
    const state = await subscribeToDigest(idle, form({ email: "bot@example.com", website: "http://spam" }));
    expect(state).toMatchObject({ status: "success", countable: false });
    expect(requestDigestSignup).not.toHaveBeenCalled();
    expect(consumeRateLimit).not.toHaveBeenCalled();
  });

  it("rejects invalid addresses before any work", async () => {
    const state = await subscribeToDigest(idle, form({ email: "nope" }));
    expect(state.status).toBe("error");
    expect(consumeRateLimit).not.toHaveBeenCalled();
  });

  it("is rate limited per network (also covers re-sends)", async () => {
    consumeRateLimit.mockResolvedValue(false);
    const state = await subscribeToDigest(idle, form({ email: "a@b.co" }));
    expect(state.status).toBe("error");
    expect(requestDigestSignup).not.toHaveBeenCalled();
  });

  it("shows a generic error when email is not configured or sending fails", async () => {
    isEmailConfigured.mockReturnValue(false);
    expect((await subscribeToDigest(idle, form({ email: "a@b.co" }))).status).toBe("error");
    expect(requestDigestSignup).not.toHaveBeenCalled();

    isEmailConfigured.mockReturnValue(true);
    requestDigestSignup.mockRejectedValue(new Error("resend 500"));
    const failed = await subscribeToDigest(idle, form({ email: "a@b.co" }));
    expect(failed).toMatchObject({ status: "error", email: "a@b.co" });
  });

  it("maps a database validation error to the invalid-address message", async () => {
    requestDigestSignup.mockRejectedValue(Object.assign(new Error("bad"), { code: "22023" }));
    const state = await subscribeToDigest(idle, form({ email: "a@b.co" }));
    expect(state).toMatchObject({ status: "error", message: "Enter a valid email address" });
  });
});
