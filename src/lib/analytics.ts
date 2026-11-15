import { track as vercelTrack } from "@vercel/analytics";

/**
 * Typed wrapper around Vercel Web Analytics custom events. Every event and
 * its properties are declared here, so call sites cannot send free-form data.
 * Properties must stay non-personal: never put an email, name, company or
 * free text in an event.
 */
export type AnalyticsEvents = {
  /** A visitor clicked the outbound "Apply" link on a job page. */
  apply_click: { placement: "top" | "bottom" | "sidebar" | "mobile-bar"; slug: string };
  /** A signup request was submitted (confirmation email requested, not yet confirmed). */
  digest_signup: { source: "website" | "job-page" };
  /** An employer showed interest in paid posting while it is "coming soon". */
  post_job_interest: { action: "waitlist_submit" | "mailto_click" };
};

export type AnalyticsEventName = keyof AnalyticsEvents;

/** Fire-and-forget; analytics must never break the page. */
export function track<Name extends AnalyticsEventName>(name: Name, properties: AnalyticsEvents[Name]): void {
  try {
    vercelTrack(name, properties);
  } catch {
    // Blocked, offline or not running on Vercel: ignore.
  }
}
