import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  SUPABASE_URL: z.url({ protocol: /^https?$/, error: "SUPABASE_URL must be an absolute http(s) URL" }),
  SUPABASE_ANON_KEY: z
    .string()
    .trim()
    .min(20, "SUPABASE_ANON_KEY looks too short — copy the anon (or sb_publishable_) key from Supabase → Settings → API")
    .refine((key) => !key.startsWith("sb_secret_"), {
      message: "SUPABASE_ANON_KEY must be a public key; never use a secret/service-role key for public reads",
    }),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvConfigError extends Error {
  override readonly name = "EnvConfigError";
}

let cached: ServerEnv | undefined;

/**
 * Validated server environment. Evaluated lazily so `next build` succeeds for
 * routes that never touch the database, while any request that does gets a
 * precise, actionable error instead of an opaque fetch failure.
 */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new EnvConfigError(`Invalid server environment — ${details}. See .env.example.`);
  }

  cached = parsed.data;
  return cached;
}
