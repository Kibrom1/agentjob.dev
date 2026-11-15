import { describe, expect, it, vi } from "vitest";
import { requestDigestSignup, type SignupDeps } from "@/lib/digest/signup";
import { digestConfirmationEmail, type DigestJob } from "@/lib/email/templates";

const JOB = (n: number): DigestJob => ({
  slug: `agent-engineer-${n}`,
  title: `Agent Engineer ${n}`,
  company: n === 1 ? "Evil <b>& Co" : `Orbit ${n}`,
  location: "Remote",
  workplace_type: "remote",
  job_type: "full_time",
  salary_min: null,
  salary_max: null,
  salary_currency: "USD",
  is_featured: false,
});

const CONFIRM = "11111111-1111-4111-8111-111111111111";
const UNSUB = "22222222-2222-4222-8222-222222222222";
const config = { siteUrl: "https://agenticroles.dev/", postalAddress: "1 Main St, Springfield, USA" };

function deps(overrides: Partial<SignupDeps> = {}): SignupDeps & { send: ReturnType<typeof vi.fn>; releaseConfirmation: ReturnType<typeof vi.fn> } {
  return {
    requestConfirmation: vi.fn(async () => ({ shouldSend: true as const, confirmToken: CONFIRM, unsubscribeToken: UNSUB })),
    listNewestJobs: vi.fn(async (limit: number) => [1, 2, 3, 4, 5, 6].slice(0, limit).map(JOB)),
    send: vi.fn(async () => undefined),
    releaseConfirmation: vi.fn(async () => undefined),
    ...overrides,
  } as never;
}

describe("requestDigestSignup", () => {
  it("emails a confirmation link with the five newest roles", async () => {
    const d = deps();
    await requestDigestSignup(d, config, { email: "a@b.co", source: "website" });

    expect(d.listNewestJobs).toHaveBeenCalledWith(5);
    expect(d.send).toHaveBeenCalledTimes(1);
    const message = d.send.mock.calls[0]![0];
    expect(message.to).toBe("a@b.co");
    expect(message.html).toContain(`https://agenticroles.dev/confirm/${CONFIRM}`);
    expect(message.text).toContain(`https://agenticroles.dev/confirm/${CONFIRM}`);
    expect(message.html).toContain("Agent Engineer 5");
    expect(message.html).not.toContain("Agent Engineer 6");
  });

  it("sends nothing for confirmed, unsubscribed or recently-emailed addresses", async () => {
    const d = deps({ requestConfirmation: vi.fn(async () => ({ shouldSend: false as const })) });
    await expect(requestDigestSignup(d, config, { email: "a@b.co", source: "website" })).resolves.toBeUndefined();
    expect(d.send).not.toHaveBeenCalled();
    expect(d.listNewestJobs).not.toHaveBeenCalled();
  });

  it("still sends the confirmation when the roles lookup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const d = deps({ listNewestJobs: vi.fn(async () => Promise.reject(new Error("db down"))) });
    await requestDigestSignup(d, config, { email: "a@b.co", source: "job-page" });
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(d.send.mock.calls[0]![0].html).not.toContain("newest roles right now");
  });

  it("re-opens the resend window and rethrows when sending fails", async () => {
    const d = deps({ send: vi.fn(async () => Promise.reject(new Error("resend 500"))) });
    await expect(requestDigestSignup(d, config, { email: "a@b.co", source: "website" })).rejects.toThrow("resend 500");
    expect(d.releaseConfirmation).toHaveBeenCalledWith("a@b.co");
  });
});

describe("digestConfirmationEmail", () => {
  const message = digestConfirmationEmail({
    to: "a@b.co",
    jobs: [1, 2, 3, 4, 5, 6].map(JOB),
    siteUrl: "https://agenticroles.dev",
    confirmUrl: `https://agenticroles.dev/confirm/${CONFIRM}`,
    unsubscribePageUrl: `https://agenticroles.dev/unsubscribe/${UNSUB}`,
    unsubscribePostUrl: `https://agenticroles.dev/api/unsubscribe/${UNSUB}`,
    postalAddress: "1 Main St, Springfield, USA",
  });

  it("keeps CAN-SPAM essentials: unsubscribe link, one-click header, postal address", () => {
    expect(message.html).toContain(`/unsubscribe/${UNSUB}`);
    expect(message.text).toContain(`/unsubscribe/${UNSUB}`);
    expect(message.html).toContain("1 Main St, Springfield, USA");
    expect(message.text).toContain("1 Main St, Springfield, USA");
    expect(message.headers).toEqual({
      "List-Unsubscribe": `<https://agenticroles.dev/api/unsubscribe/${UNSUB}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("is honest about the subject, escapes content and caps roles at five", () => {
    expect(message.subject).toBe("Confirm your Agentic Roles weekly digest");
    expect(message.html).toContain("Evil &lt;b&gt;&amp; Co");
    expect(message.html).not.toContain("<b>& Co");
    expect(message.html).not.toContain("Agent Engineer 6");
    expect(message.tags).toEqual([{ name: "category", value: "digest_confirmation" }]);
  });
});
