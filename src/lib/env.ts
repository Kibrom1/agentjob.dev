import "server-only";
import { z } from "zod";

/**
 * Server environment, validated per feature and read at call time (never at
 * import), so `next build` works without secrets and a missing key only
 * disables the feature that needs it — with an actionable error.
 */
export class EnvConfigError extends Error {
  override readonly name = "EnvConfigError";
}

function parseEnv<Schema extends z.ZodType>(feature: string, schema: Schema, values: Record<string, unknown>): z.infer<Schema> {
  const parsed = schema.safeParse(values);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new EnvConfigError(`Invalid ${feature} configuration — ${details}. See .env.example.`);
  }
  return parsed.data;
}

const supabaseUrl = z.url({ protocol: /^https?$/, error: "must be an absolute http(s) URL" });

const publicDbSchema = z.object({
  SUPABASE_URL: supabaseUrl,
  SUPABASE_ANON_KEY: z
    .string({ error: "is required" })
    .trim()
    .min(20, "looks too short — copy the anon (or sb_publishable_) key from Supabase → Settings → API")
    .refine((key) => !key.startsWith("sb_secret_"), {
      message: "must be a public key; never use a secret/service-role key for public reads",
    }),
});

export type ServerEnv = z.infer<typeof publicDbSchema>;

export function getServerEnv(): ServerEnv {
  return parseEnv("Supabase (public)", publicDbSchema, {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  });
}

const serviceDbSchema = z
  .object({
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: z
      .string({ error: "is required for employer posting, admin, digest and maintenance" })
      .trim()
      .min(20, "looks too short — copy the service_role (or sb_secret_) key"),
    SUPABASE_ANON_KEY: z.string().optional(),
  })
  .refine((env) => env.SUPABASE_SERVICE_ROLE_KEY !== env.SUPABASE_ANON_KEY, {
    path: ["SUPABASE_SERVICE_ROLE_KEY"],
    message: "must differ from SUPABASE_ANON_KEY",
  })
  .refine((env) => !env.SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_publishable_"), {
    path: ["SUPABASE_SERVICE_ROLE_KEY"],
    message: "is a publishable key; use the service_role / sb_secret_ key",
  });

export type ServiceEnv = { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string };

export function getServiceEnv(): ServiceEnv {
  const env = parseEnv("Supabase (service role)", serviceDbSchema, {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  });
  return { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY };
}

const stripeSchema = z.object({
  STRIPE_SECRET_KEY: z
    .string({ error: "is required for paid job posts" })
    .trim()
    .regex(/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/, "must be a Stripe secret (sk_) or restricted (rk_) key"),
  STRIPE_WEBHOOK_SECRET: z
    .string({ error: "is required to verify Stripe webhooks" })
    .trim()
    .regex(/^whsec_[A-Za-z0-9]+$/, "must be a Stripe webhook signing secret (whsec_)"),
  STRIPE_API_BASE_URL: z.url({ protocol: /^https?$/ }).optional(),
});

export type StripeEnv = z.infer<typeof stripeSchema>;

export function getStripeEnv(): StripeEnv {
  return parseEnv("Stripe", stripeSchema, {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_API_BASE_URL: process.env.STRIPE_API_BASE_URL?.trim() || undefined,
  });
}

const emailSchema = z.object({
  RESEND_API_KEY: z
    .string({ error: "is required to send email" })
    .trim()
    .regex(/^re_[A-Za-z0-9_]+$/, "must be a Resend API key (re_)"),
  EMAIL_FROM: z
    .string({ error: "is required, e.g. \"AgentJob <digest@agentjob.dev>\"" })
    .trim()
    .regex(/^(?:[^<>]+ )?<?[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>?$/, "must be an address or \"Name <address>\""),
  EMAIL_REPLY_TO: z.email("must be an email address").optional(),
  POSTAL_ADDRESS: z
    .string({ error: "is required by CAN-SPAM in every marketing email" })
    .trim()
    .min(10, "must be a full physical mailing address"),
  RESEND_API_BASE_URL: z.url({ protocol: /^https?$/ }).optional(),
});

export type EmailEnv = z.infer<typeof emailSchema>;

export function getEmailEnv(): EmailEnv {
  return parseEnv("email (Resend)", emailSchema, {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_REPLY_TO: process.env.EMAIL_REPLY_TO?.trim() || undefined,
    POSTAL_ADDRESS: process.env.POSTAL_ADDRESS,
    RESEND_API_BASE_URL: process.env.RESEND_API_BASE_URL?.trim() || undefined,
  });
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && process.env.POSTAL_ADDRESS);
}

const cronSchema = z.object({
  CRON_SECRET: z
    .string({ error: "is required to authenticate scheduled jobs" })
    .min(16, "must be at least 16 characters"),
});

export function getCronEnv(): z.infer<typeof cronSchema> {
  return parseEnv("cron", cronSchema, { CRON_SECRET: process.env.CRON_SECRET });
}
