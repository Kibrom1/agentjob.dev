/**
 * Minimal Resend REST client (no SDK): single and batch sends with
 * idempotency keys and bounded retries on 429/5xx.
 * https://resend.com/docs/api-reference/emails/send-batch-emails
 */

export const RESEND_API_URL = "https://api.resend.com";
export const RESEND_BATCH_LIMIT = 100;

export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
};

export type ResendConfig = {
  apiKey: string;
  from: string;
  replyTo?: string;
  /** Override for local test doubles; defaults to the Resend API. */
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
};

export class ResendError extends Error {
  override readonly name = "ResendError";
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function toPayload(email: OutboundEmail, config: ResendConfig) {
  return {
    from: config.from,
    to: [email.to],
    subject: email.subject,
    html: email.html,
    text: email.text,
    ...(config.replyTo ? { reply_to: config.replyTo } : {}),
    ...(email.headers ? { headers: email.headers } : {}),
    ...(email.tags ? { tags: email.tags } : {}),
  };
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 10_000);
  return Math.min(500 * 2 ** (attempt - 1), 8_000);
}

async function post(path: string, body: unknown, idempotencyKey: string | undefined, config: ResendConfig): Promise<unknown> {
  const doFetch = config.fetch ?? fetch;
  const sleep = config.sleep ?? defaultSleep;
  const maxAttempts = config.maxAttempts ?? 3;

  for (let attempt = 1; ; attempt++) {
    const baseUrl = (config.baseUrl ?? RESEND_API_URL).replace(/\/$/, "");
    const response = await doFetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (response.ok) {
      return response.json();
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < maxAttempts) {
      await sleep(retryDelayMs(response, attempt));
      continue;
    }

    let detail = response.statusText;
    try {
      const errorBody = (await response.json()) as { message?: unknown };
      if (typeof errorBody.message === "string") detail = errorBody.message;
    } catch {
      // keep statusText
    }
    throw new ResendError(`Resend ${path} failed (${response.status}): ${detail}`, response.status, retryable);
  }
}

export async function sendEmail(email: OutboundEmail, config: ResendConfig, idempotencyKey?: string): Promise<string> {
  const result = (await post("/emails", toPayload(email, config), idempotencyKey, config)) as { id?: unknown };
  if (typeof result.id !== "string") throw new ResendError("Resend response missing id", 502, false);
  return result.id;
}

/** Sends up to 100 emails in one request; returns provider ids in input order. */
export async function sendEmailBatch(emails: OutboundEmail[], config: ResendConfig, idempotencyKey: string): Promise<string[]> {
  if (emails.length === 0) return [];
  if (emails.length > RESEND_BATCH_LIMIT) {
    throw new RangeError(`Resend batches are limited to ${RESEND_BATCH_LIMIT} emails`);
  }
  const result = (await post(
    "/emails/batch",
    emails.map((email) => toPayload(email, config)),
    idempotencyKey,
    config,
  )) as { data?: Array<{ id?: unknown }> };

  const ids = (result.data ?? []).map((item) => (typeof item.id === "string" ? item.id : ""));
  if (ids.length !== emails.length) {
    throw new ResendError(`Resend batch returned ${ids.length} ids for ${emails.length} emails`, 502, false);
  }
  return ids;
}
