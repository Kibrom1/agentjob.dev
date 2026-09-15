import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClearDraft } from "@/components/post-job/clear-draft";
import { RefreshWhilePending } from "@/components/post-job/refresh-while-pending";
import { EnvConfigError } from "@/lib/env";
import { getStripe } from "@/lib/stripe/client";
import { fulfillCheckoutSession, type FulfillmentJob } from "@/lib/stripe/fulfillment";
import { createFulfillmentDeps } from "@/lib/stripe/fulfillment-deps";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payment received",
  robots: { index: false, follow: false },
};

const SESSION_PATTERN = /^cs_(test|live)_[A-Za-z0-9]+$/;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Looks up the job behind the Checkout session. If the webhook has not
 * arrived yet, confirms payment directly with Stripe (server-to-server) and
 * publishes through the same idempotent fulfillment path.
 */
async function resolveJob(sessionId: string): Promise<FulfillmentJob | null> {
  const deps = createFulfillmentDeps({ revalidate: false, notify: false });
  const job = await deps.findJobBySession(sessionId);
  if (!job || job.status !== "pending_payment") return job;

  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    const outcome = await fulfillCheckoutSession(session, deps);
    if (outcome === "activated") {
      return deps.findJobBySession(sessionId);
    }
  } catch (error) {
    console.error("[post-job/success] direct confirmation failed; waiting for webhook", error);
  }
  return job;
}

export default async function CheckoutSuccessPage({ searchParams }: Props) {
  const raw = (await searchParams).session_id;
  const sessionId = typeof raw === "string" ? raw : "";
  if (!SESSION_PATTERN.test(sessionId)) notFound();

  let job: FulfillmentJob | null;
  try {
    job = await resolveJob(sessionId);
  } catch (error) {
    if (error instanceof EnvConfigError) throw error;
    console.error("[post-job/success] lookup failed", error);
    throw new Error("Could not load your listing");
  }
  if (!job) notFound();

  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center sm:px-6">
      <ClearDraft />
      {job.status === "active" ? (
        <>
          <p className="font-mono text-sm text-accent-700 dark:text-accent-400">Payment confirmed</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Your listing is live 🎉</h1>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">
            <span className="font-medium text-zinc-900 dark:text-zinc-100">{job.title}</span> at {job.company} is now on the
            board. A confirmation and receipt are on their way to your inbox.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href={`/jobs/${job.slug}`}
              className="inline-flex h-10 items-center rounded-lg bg-accent-600 px-4 text-sm font-semibold text-white hover:bg-accent-700"
            >
              View your listing
            </Link>
            <Link
              href="/post-a-job"
              className="inline-flex h-10 items-center rounded-lg border border-zinc-300 px-4 text-sm font-medium hover:border-zinc-500 dark:border-zinc-700"
            >
              Post another role
            </Link>
          </div>
        </>
      ) : job.status === "pending_payment" ? (
        <>
          <RefreshWhilePending />
          <p className="font-mono text-sm text-zinc-500">Processing</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Confirming your payment…</h1>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">
            This usually takes a few seconds. Some payment methods take longer; your listing goes live automatically once
            Stripe confirms the payment, and we&apos;ll email you when it does.
          </p>
          <span
            role="status"
            aria-label="Waiting for payment confirmation"
            className="mx-auto mt-8 block size-6 animate-spin rounded-full border-2 border-zinc-300 border-t-accent-600"
          />
        </>
      ) : (
        <>
          <p className="font-mono text-sm text-zinc-500">Checkout {job.status === "payment_expired" ? "expired" : "closed"}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">This checkout is no longer active</h1>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">
            No listing was published from this session. If you were charged, reply to your Stripe receipt and we&apos;ll
            sort it out right away.
          </p>
          <Link
            href="/post-a-job"
            className="mt-8 inline-flex h-10 items-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Start a new posting
          </Link>
        </>
      )}
    </div>
  );
}
