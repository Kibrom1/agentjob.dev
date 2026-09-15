import "server-only";
import { getEmailEnv } from "@/lib/env";
import { sendEmail } from "@/lib/email/resend";
import { postingConfirmationEmail } from "@/lib/email/templates";
import { PRICING } from "@/lib/posting/pricing";
import { absoluteUrl } from "@/lib/site";

export async function sendPostingConfirmation({
  to,
  job,
}: {
  to: string;
  job: { id: string; slug: string; title: string; company: string };
}): Promise<void> {
  const env = getEmailEnv();
  await sendEmail(
    postingConfirmationEmail({
      to,
      title: job.title,
      company: job.company,
      jobUrl: absoluteUrl(`/jobs/${job.slug}`),
      durationDays: PRICING.listing.durationDays,
    }),
    { apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, replyTo: env.EMAIL_REPLY_TO, baseUrl: env.RESEND_API_BASE_URL },
    `posting-confirmation/${job.id}`,
  );
}
