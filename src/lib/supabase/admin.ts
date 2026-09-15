import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getServiceEnv } from "@/lib/env";

export type AdminDbClient = SupabaseClient<Database>;

const REQUEST_TIMEOUT_MS = 10_000;

const fetchWithTimeout: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal, cache: "no-store" });
};

let client: AdminDbClient | undefined;

/**
 * Service-role client: bypasses RLS. Only ever imported by server code
 * (`server-only` enforces this at build time) and never exposed to users.
 */
export function getAdminDbClient(): AdminDbClient {
  if (client) return client;

  const env = getServiceEnv();
  client = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: fetchWithTimeout,
      headers: { "X-Client-Info": "agentjobs-server" },
    },
  });
  return client;
}
