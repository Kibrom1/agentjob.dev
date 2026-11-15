import { digestConfirmationEmail, type DigestJob } from "@/lib/email/templates";
import type { OutboundEmail } from "@/lib/email/resend";

export type ConfirmationGrant =
  | { shouldSend: false }
  | { shouldSend: true; confirmToken: string; unsubscribeToken: string };

export type SignupDeps = {
  /** Creates or refreshes the pending row; never reveals whether it already existed. */
  requestConfirmation(email: string, source: string): Promise<ConfirmationGrant>;
  listNewestJobs(limit: number): Promise<DigestJob[]>;
  send(email: OutboundEmail): Promise<void>;
  /** Re-opens the resend window after a failed send. */
  releaseConfirmation(email: string): Promise<void>;
};

export type SignupConfig = { siteUrl: string; postalAddress: string };

export const CONFIRMATION_JOB_COUNT = 5;

/**
 * Handles one signup request. Returns normally whether or not an email was
 * sent, so callers can answer identically for new, pending, confirmed and
 * unsubscribed addresses. Throws only when the request itself failed (the
 * caller shows a generic error, and the resend window is re-opened).
 */
export async function requestDigestSignup(
  deps: SignupDeps,
  config: SignupConfig,
  input: { email: string; source: string },
): Promise<void> {
  const grant = await deps.requestConfirmation(input.email, input.source);
  if (!grant.shouldSend) return;

  try {
    // Welcome content is a nicety: a failed lookup must not block confirmation.
    const jobs = await deps.listNewestJobs(CONFIRMATION_JOB_COUNT).catch((cause: unknown) => {
      console.error("[subscribe] newest roles lookup failed", cause);
      return [] as DigestJob[];
    });
    await deps.send(
      digestConfirmationEmail({
        to: input.email,
        jobs,
        siteUrl: config.siteUrl,
        confirmUrl: new URL(`/confirm/${grant.confirmToken}`, config.siteUrl).toString(),
        unsubscribePageUrl: new URL(`/unsubscribe/${grant.unsubscribeToken}`, config.siteUrl).toString(),
        unsubscribePostUrl: new URL(`/api/unsubscribe/${grant.unsubscribeToken}`, config.siteUrl).toString(),
        postalAddress: config.postalAddress,
      }),
    );
  } catch (cause) {
    await deps.releaseConfirmation(input.email).catch(() => undefined);
    throw cause;
  }
}
