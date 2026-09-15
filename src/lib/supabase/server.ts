import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getServerEnv } from "@/lib/env";

export type PublicDbClient = SupabaseClient<Database>;

const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Wraps fetch with a hard timeout so a slow or unreachable Supabase instance
 * fails the request quickly (and renders the error boundary) instead of
 * hanging the server render. An upstream abort signal is still honoured.
 */
const fetchWithTimeout: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};

let client: PublicDbClient | undefined;

/**
 * Server-side Supabase client authenticated with the public (anon/publishable)
 * key. All reads are therefore constrained by RLS and column grants.
 *
 * The client is stateless HTTP (PostgREST), carries no user session, and is
 * safe to share across requests within one server process.
 */
export function getPublicDbClient(): PublicDbClient {
  if (client) return client;

  const env = getServerEnv();
  client = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: fetchWithTimeout,
      headers: { "X-Client-Info": "agentjobs-web" },
    },
  });
  return client;
}
