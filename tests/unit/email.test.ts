import { describe, expect, it, vi } from "vitest";
import { RESEND_BATCH_LIMIT, ResendError, sendEmail, sendEmailBatch, type OutboundEmail } from "@/lib/email/resend";
import { digestEmail, escapeHtml, postingConfirmationEmail } from "@/lib/email/templates";

const email: OutboundEmail = { to: "a@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi" };

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("templates", () => {
  it("escapes HTML", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("renders the digest without injecting job content as HTML", () => {
    const message = digestEmail({
      to: "dev@example.com",
      jobs: [
        {
          slug: "x-1",
          title: "<script>alert(1)</script> Engineer",
          company: "Evil & Co",
          location: "Remote",
          workplace_type: "remote",
          job_type: "contract",
          salary_min: null,
          salary_max: null,
          salary_currency: "USD",
          is_featured: false,
        },
      ],
      siteUrl: "https://agentjobs.dev",
      unsubscribePageUrl: "https://agentjobs.dev/unsubscribe/t",
      unsubscribePostUrl: "https://agentjobs.dev/api/unsubscribe/t",
      postalAddress: "1 Main St",
      campaign: "digest-2026-09-14",
      weekLabel: "Week of September 14, 2026",
    });
    expect(message.subject).toBe("1 new AI agent role this week");
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).toContain("Evil &amp; Co");
    expect(message.html).toContain("utm_campaign=digest-2026-09-14");
    expect(message.text).toContain("https://agentjobs.dev/jobs/x-1?utm_source=newsletter");
    expect(message.tags).toEqual([{ name: "category", value: "weekly_digest" }]);
  });

  it("renders the posting confirmation", () => {
    const message = postingConfirmationEmail({
      to: "a@b.co",
      title: "Agent <Engineer>",
      company: "Orbit",
      jobUrl: "https://agentjobs.dev/jobs/x",
      durationDays: 30,
    });
    expect(message.subject).toBe("Your listing is live: Agent <Engineer>");
    expect(message.html).toContain("Agent &lt;Engineer&gt;");
    expect(message.text).toContain("30 days");
  });
});

describe("resend client", () => {
  it("sends a single email with auth and idempotency headers", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { id: "msg_1" }));
    const id = await sendEmail(email, { apiKey: "re_key", from: "AgentJobs <d@agentjobs.dev>", replyTo: "hi@agentjobs.dev", fetch: fetchMock }, "k1");
    expect(id).toBe("msg_1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_key");
    expect(headers["Idempotency-Key"]).toBe("k1");
    expect(JSON.parse(String(init.body))).toMatchObject({ from: "AgentJobs <d@agentjobs.dev>", to: ["a@example.com"], reply_to: "hi@agentjobs.dev" });
  });

  it("retries rate limits and server errors, honouring Retry-After", async () => {
    const sleeps: number[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { message: "slow down" }, { "retry-after": "2" }))
      .mockResolvedValueOnce(jsonResponse(502, { message: "bad gateway" }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ id: "m1" }, { id: "m2" }] }));
    const ids = await sendEmailBatch([email, { ...email, to: "b@example.com" }], {
      apiKey: "re_key",
      from: "d@agentjobs.dev",
      fetch: fetchMock,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    }, "batch-key");
    expect(ids).toEqual(["m1", "m2"]);
    expect(sleeps).toEqual([2000, 1000]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fails fast on client errors with the provider message", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(422, { message: "invalid from" }));
    const promise = sendEmail(email, { apiKey: "re_key", from: "bad", fetch: fetchMock });
    await expect(promise).rejects.toBeInstanceOf(ResendError);
    await expect(sendEmail(email, { apiKey: "re_key", from: "bad", fetch: fetchMock })).rejects.toThrow("invalid from");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the maximum attempts", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(500, {}));
    await expect(
      sendEmail(email, { apiKey: "k", from: "d@x.dev", fetch: fetchMock, sleep: async () => undefined, maxAttempts: 2 }),
    ).rejects.toMatchObject({ status: 500, retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("validates batch size and response shape", async () => {
    await expect(sendEmailBatch([], { apiKey: "k", from: "d@x.dev" }, "k")).resolves.toEqual([]);
    const tooMany = Array.from({ length: RESEND_BATCH_LIMIT + 1 }, () => email);
    await expect(sendEmailBatch(tooMany, { apiKey: "k", from: "d@x.dev" }, "k")).rejects.toThrow(RangeError);
    const short = vi.fn(async () => jsonResponse(200, { data: [{ id: "m1" }] }));
    await expect(sendEmailBatch([email, email], { apiKey: "k", from: "d@x.dev", fetch: short }, "k")).rejects.toThrow("returned 1 ids");
  });
});
