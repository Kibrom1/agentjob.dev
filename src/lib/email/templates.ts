import { formatSalaryRange } from "@/lib/format";
import type { OutboundEmail } from "@/lib/email/resend";
import { JOB_TYPE_LABELS, WORKPLACE_LABELS, type JobType, type WorkplaceType } from "@/lib/types";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function withUtm(url: string, campaign: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("utm_source", "newsletter");
  parsed.searchParams.set("utm_medium", "email");
  parsed.searchParams.set("utm_campaign", campaign);
  return parsed.toString();
}

const WRAPPER_START =
  '<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#18181b">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px">' +
  '<tr><td style="padding:24px 28px">';
const WRAPPER_END = "</td></tr></table></td></tr></table></body></html>";

export type DigestJob = {
  slug: string;
  title: string;
  company: string;
  location: string;
  workplace_type: WorkplaceType;
  job_type: JobType;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  is_featured: boolean;
};

export type DigestEmailInput = {
  to: string;
  jobs: DigestJob[];
  siteUrl: string;
  unsubscribePageUrl: string;
  unsubscribePostUrl: string;
  postalAddress: string;
  campaign: string;
  weekLabel: string;
};

export function digestEmail(input: DigestEmailInput): OutboundEmail {
  const count = input.jobs.length;
  const subject = `${count} new AI agent ${count === 1 ? "role" : "roles"} this week`;

  const htmlItems = input.jobs
    .map((job) => {
      const url = withUtm(new URL(`/jobs/${job.slug}`, input.siteUrl).toString(), input.campaign);
      const salary = formatSalaryRange(job.salary_min, job.salary_max, job.salary_currency);
      const meta = [job.location, WORKPLACE_LABELS[job.workplace_type], JOB_TYPE_LABELS[job.job_type], salary]
        .filter(Boolean)
        .map((part) => escapeHtml(String(part)))
        .join(" · ");
      const badge = job.is_featured
        ? ' <span style="background:#059669;color:#fff;border-radius:999px;padding:1px 8px;font-size:11px">Featured</span>'
        : "";
      return (
        '<tr><td style="padding:14px 0;border-top:1px solid #f4f4f5">' +
        `<div style="font-size:13px;color:#52525b">${escapeHtml(job.company)}${badge}</div>` +
        `<a href="${escapeHtml(url)}" style="display:block;margin-top:2px;font-size:16px;font-weight:600;color:#18181b;text-decoration:none">${escapeHtml(job.title)}</a>` +
        `<div style="margin-top:4px;font-size:13px;color:#71717a">${meta}</div>` +
        "</td></tr>"
      );
    })
    .join("");

  const browseUrl = withUtm(input.siteUrl, input.campaign);

  const html =
    WRAPPER_START +
    '<p style="margin:0;font-family:ui-monospace,Menlo,monospace;font-size:12px;letter-spacing:.08em;color:#047857;text-transform:uppercase">AgentJobs weekly</p>' +
    `<h1 style="margin:6px 0 4px;font-size:22px">${escapeHtml(subject)}</h1>` +
    `<p style="margin:0 0 12px;color:#52525b;font-size:14px">New roles for engineers building AI agents · ${escapeHtml(input.weekLabel)}</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${htmlItems}</table>` +
    `<p style="margin:20px 0 0"><a href="${escapeHtml(browseUrl)}" style="display:inline-block;background:#18181b;color:#fff;border-radius:8px;padding:10px 16px;font-size:14px;text-decoration:none">Browse all jobs</a></p>` +
    '<hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0 12px">' +
    '<p style="margin:0;font-size:12px;color:#71717a">You are receiving this because you subscribed at agentjobs.dev. ' +
    `<a href="${escapeHtml(input.unsubscribePageUrl)}" style="color:#71717a">Unsubscribe</a></p>` +
    `<p style="margin:6px 0 0;font-size:12px;color:#a1a1aa">${escapeHtml(input.postalAddress)}</p>` +
    WRAPPER_END;

  const textItems = input.jobs
    .map((job) => {
      const salary = formatSalaryRange(job.salary_min, job.salary_max, job.salary_currency);
      const meta = [job.location, WORKPLACE_LABELS[job.workplace_type], JOB_TYPE_LABELS[job.job_type], salary]
        .filter(Boolean)
        .join(" · ");
      const url = withUtm(new URL(`/jobs/${job.slug}`, input.siteUrl).toString(), input.campaign);
      return `${job.is_featured ? "★ " : ""}${job.title} — ${job.company}\n${meta}\n${url}`;
    })
    .join("\n\n");

  const text =
    `${subject}\n${input.weekLabel}\n\n${textItems}\n\nBrowse all jobs: ${browseUrl}\n\n` +
    `Unsubscribe: ${input.unsubscribePageUrl}\n${input.postalAddress}\n`;

  return {
    to: input.to,
    subject,
    html,
    text,
    headers: {
      "List-Unsubscribe": `<${input.unsubscribePostUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    tags: [{ name: "category", value: "weekly_digest" }],
  };
}

export type PostingConfirmationInput = {
  to: string;
  title: string;
  company: string;
  jobUrl: string;
  durationDays: number;
};

export function postingConfirmationEmail(input: PostingConfirmationInput): OutboundEmail {
  const subject = `Your listing is live: ${input.title}`;
  const html =
    WRAPPER_START +
    `<h1 style="margin:0 0 8px;font-size:20px">${escapeHtml(subject)}</h1>` +
    `<p style="margin:0 0 16px;color:#52525b;font-size:14px">Thanks for posting ${escapeHtml(input.company)}'s role on AgentJobs.dev. ` +
    `It is now live on the board for ${input.durationDays} days and will be included in the next weekly digest.</p>` +
    `<p style="margin:0"><a href="${escapeHtml(input.jobUrl)}" style="display:inline-block;background:#059669;color:#fff;border-radius:8px;padding:10px 16px;font-size:14px;text-decoration:none">View your listing</a></p>` +
    '<p style="margin:20px 0 0;font-size:12px;color:#71717a">Need a change? Reply to this email and we will update the listing.</p>' +
    WRAPPER_END;
  const text =
    `${subject}\n\nThanks for posting ${input.company}'s role on AgentJobs.dev. It is live for ${input.durationDays} days ` +
    `and will be included in the next weekly digest.\n\nView your listing: ${input.jobUrl}\n\n` +
    "Need a change? Reply to this email and we will update the listing.\n";
  return { to: input.to, subject, html, text, tags: [{ name: "category", value: "posting_confirmation" }] };
}
