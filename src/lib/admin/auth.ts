/**
 * HTTP Basic authentication for /admin. Runtime-agnostic (Web Crypto only) so
 * it can run in proxy.ts as well as in server actions. Deliberately does not
 * import `server-only`/env.ts, which cannot be bundled into the proxy.
 */

export const ADMIN_REALM = "AgentJob admin";

export type AdminCredentials = { username: string; password: string };

export type AdminConfig =
  | { enabled: true; credentials: AdminCredentials }
  | { enabled: false; reason: string };

export function readAdminConfig(env: Record<string, string | undefined> = process.env): AdminConfig {
  const password = env.ADMIN_PASSWORD ?? "";
  const username = env.ADMIN_USERNAME?.trim() || "admin";
  if (password.length < 12) {
    return { enabled: false, reason: "Set ADMIN_PASSWORD (12+ characters) to enable the admin console." };
  }
  return { enabled: true, credentials: { username, password } };
}

export function parseBasicAuth(header: string | null | undefined): AdminCredentials | null {
  if (!header) return null;
  const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header);
  if (!match?.[1]) return null;

  let decoded: string;
  try {
    const binary = atob(match[1]);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }

  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

/** Compares fixed-length digests so timing does not leak length or prefix. */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

export async function isAuthorizedAdmin(header: string | null | undefined, config: AdminConfig): Promise<boolean> {
  if (!config.enabled) return false;
  const supplied = parseBasicAuth(header);
  if (!supplied) return false;
  const [userOk, passOk] = await Promise.all([
    constantTimeEqual(supplied.username, config.credentials.username),
    constantTimeEqual(supplied.password, config.credentials.password),
  ]);
  return userOk && passOk;
}
