import { beforeEach, describe, expect, it, vi } from "vitest";

const consumeRateLimit = vi.fn();
const upsert = vi.fn();
const from = vi.fn(() => ({ upsert }));

vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  consumeRateLimit: (...args: unknown[]) => consumeRateLimit(...args),
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminDbClient: () => ({ from }) }));

import { joinEmployerWaitlist } from "@/app/post-a-job/waitlist-actions";
import { waitlistSchema } from "@/lib/waitlist";

const idle = { status: "idle" } as const;
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const valid = { email: " Boss@Acme.test ", company: " Acme ", roleNote: "  Agent infra lead  " };

beforeEach(() => {
  consumeRateLimit.mockResolvedValue(true);
  upsert.mockResolvedValue({ error: null });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("waitlistSchema", () => {
  it("normalises and treats an empty note as null", () => {
    expect(waitlistSchema.parse({ email: " A@B.co ", company: " X ", roleNote: "   " })).toEqual({
      email: "a@b.co",
      company: "X",
      roleNote: null,
    });
  });

  it("enforces the same limits as the database", () => {
    expect(waitlistSchema.safeParse({ email: "a@b.co", company: "", roleNote: "" }).success).toBe(false);
    expect(waitlistSchema.safeParse({ email: "a@b.co", company: "x".repeat(121), roleNote: "" }).success).toBe(false);
    expect(waitlistSchema.safeParse({ email: "a@b.co", company: "x", roleNote: "y".repeat(1001) }).success).toBe(false);
    expect(waitlistSchema.safeParse({ email: "nope", company: "x", roleNote: "" }).success).toBe(false);
  });
});

describe("joinEmployerWaitlist", () => {
  it("stores a normalised row via upsert on email", async () => {
    const state = await joinEmployerWaitlist(idle, form(valid));
    expect(state).toEqual({ status: "success", countable: true });
    expect(from).toHaveBeenCalledWith("employer_waitlist");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: "boss@acme.test", company: "Acme", role_note: "Agent infra lead" }),
      { onConflict: "email" },
    );
  });

  it("accepts a submission without the optional note", async () => {
    const state = await joinEmployerWaitlist(idle, form({ email: "a@b.co", company: "Acme" }));
    expect(state.status).toBe("success");
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ role_note: null }), expect.anything());
  });

  it("returns per-field errors and keeps the typed values", async () => {
    const state = await joinEmployerWaitlist(idle, form({ email: "nope", company: "", roleNote: "hi" }));
    expect(state).toMatchObject({
      status: "error",
      fieldErrors: { email: expect.any(String), company: expect.any(String) },
      values: { email: "nope", company: "", roleNote: "hi" },
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("ignores honeypot hits without storing or counting them", async () => {
    const state = await joinEmployerWaitlist(idle, form({ ...valid, nickname: "bot" }));
    expect(state).toEqual({ status: "success", countable: false });
    expect(upsert).not.toHaveBeenCalled();
    expect(consumeRateLimit).not.toHaveBeenCalled();
  });

  it("rate limits before writing", async () => {
    consumeRateLimit.mockResolvedValue(false);
    const state = await joinEmployerWaitlist(idle, form(valid));
    expect(state.status).toBe("error");
    expect(upsert).not.toHaveBeenCalled();
    expect(consumeRateLimit).toHaveBeenCalledWith(expect.objectContaining({ scope: "waitlist" }));
  });

  it("shows a generic error when the write fails", async () => {
    upsert.mockResolvedValue({ error: { code: "XX000", message: "boom" } });
    expect((await joinEmployerWaitlist(idle, form(valid))).status).toBe("error");
    upsert.mockRejectedValue(new Error("network"));
    expect((await joinEmployerWaitlist(idle, form(valid))).status).toBe("error");
  });
});
