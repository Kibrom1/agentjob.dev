import { z } from "zod";
import { Constants } from "@/lib/database.types";
import { SLUG_PATTERN, TAG_PATTERN, emailSchema } from "@/lib/validation";

/**
 * Job posting form contract, shared by the client (per-step validation) and
 * the server action (authoritative validation). Every rule mirrors a database
 * CHECK so the database never has to reject a validated submission.
 */

export const SALARY_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "CHF", "SGD", "INR", "JPY"] as const;
export type SalaryCurrency = (typeof SALARY_CURRENCIES)[number];

export const MAX_TAGS = 12;
export const MAX_SALARY = 10_000_000;
export const DESCRIPTION_MIN = 50;
export const DESCRIPTION_MAX = 50_000;

const trimmed = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(min, min <= 1 ? `${label} is required` : `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);

const optionalUrl = (label: string, httpsOnly: boolean) =>
  z
    .string()
    .trim()
    .max(2048, `${label} is too long`)
    .optional()
    .transform((value) => (value ? value : undefined))
    .refine(
      (value) => {
        if (value === undefined) return true;
        try {
          const url = new URL(value);
          const okProtocol = httpsOnly ? url.protocol === "https:" : url.protocol === "https:" || url.protocol === "http:";
          return okProtocol && !/\s/.test(value) && url.hostname.includes(".");
        } catch {
          return false;
        }
      },
      { message: httpsOnly ? `${label} must be an https:// URL` : `${label} must be a valid http(s) URL` },
    );

/** "LangGraph, Python ,python" → ["LangGraph", "Python"] (case-insensitive de-dupe). */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of raw.split(",")) {
    const tag = part.trim().replace(/\s+/g, " ");
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

const tagsField = z
  .string()
  .optional()
  .transform((value) => parseTags(value ?? ""))
  .superRefine((tags, ctx) => {
    if (tags.length > MAX_TAGS) {
      ctx.addIssue({ code: "custom", message: `Use at most ${MAX_TAGS} tags` });
    }
    const invalid = tags.filter((tag) => !TAG_PATTERN.test(tag));
    if (invalid.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `Tags must be 1–32 letters, numbers or . + # / - (invalid: ${invalid.slice(0, 3).join(", ")})`,
      });
    }
  });

const salaryField = (label: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (!value) return null;
      const normalised = value.replace(/[,_\s]/g, "");
      if (!/^\d+$/.test(normalised)) {
        ctx.addIssue({ code: "custom", message: `${label} must be a whole number` });
        return z.NEVER;
      }
      const amount = Number(normalised);
      if (amount > MAX_SALARY) {
        ctx.addIssue({ code: "custom", message: `${label} looks too large` });
        return z.NEVER;
      }
      return amount;
    });

/** Apply target: an https URL, or an email that becomes a mailto: link. */
const applyTargetField = z
  .string({ error: "Application URL or email is required" })
  .trim()
  .min(1, "Application URL or email is required")
  .max(2000, "Application link is too long")
  .transform((value, ctx) => {
    if (emailSchema.safeParse(value).success && !value.includes("/")) {
      return `mailto:${value.toLowerCase()}`;
    }
    try {
      const url = new URL(value);
      if ((url.protocol === "https:" || url.protocol === "http:") && !/\s/.test(value) && url.hostname.includes(".")) {
        return value;
      }
    } catch {
      // fall through to the issue below
    }
    ctx.addIssue({ code: "custom", message: "Enter an https:// application link or an email address" });
    return z.NEVER;
  });

const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
  .optional()
  .transform((value) => value === "on" || value === "true");

/** Field-level rules, without cross-field refinements (so steps can `pick`). */
export const postingFields = z.object({
  company_name: trimmed(1, 120, "Company name"),
  company_url: optionalUrl("Company website", false),
  company_logo_url: optionalUrl("Logo URL", true),
  contact_email: emailSchema,
  title: trimmed(3, 140, "Job title"),
  category_slug: z
    .string({ error: "Choose a category" })
    .regex(SLUG_PATTERN, "Choose a category"),
  job_type: z.enum(Constants.public.Enums.job_type, { error: "Choose an employment type" }),
  workplace_type: z.enum(Constants.public.Enums.workplace_type, { error: "Choose remote, hybrid or on-site" }),
  location: trimmed(1, 120, "Location"),
  tags: tagsField,
  description: trimmed(DESCRIPTION_MIN, DESCRIPTION_MAX, "Description"),
  salary_min: salaryField("Minimum salary"),
  salary_max: salaryField("Maximum salary"),
  salary_currency: z.enum(SALARY_CURRENCIES, { error: "Choose a currency" }).default("USD"),
  apply_target: applyTargetField,
  featured: checkbox,
});

export const postingSchema = postingFields.superRefine((value, ctx) => {
  if (value.salary_min !== null && value.salary_max !== null && value.salary_max < value.salary_min) {
    ctx.addIssue({
      code: "custom",
      path: ["salary_max"],
      message: "Maximum salary must be greater than or equal to the minimum",
    });
  }
});

export type PostingInput = z.input<typeof postingFields>;
export type Posting = z.output<typeof postingSchema>;
export type PostingField = keyof PostingInput;

export const POSTING_STEPS = [
  {
    id: "company",
    title: "Company",
    fields: ["company_name", "company_url", "company_logo_url", "contact_email"],
  },
  {
    id: "role",
    title: "Role",
    fields: ["title", "category_slug", "job_type", "workplace_type", "location", "tags"],
  },
  {
    id: "description",
    title: "Description",
    fields: ["description"],
  },
  {
    id: "apply",
    title: "Pay & apply",
    fields: ["salary_min", "salary_max", "salary_currency", "apply_target"],
  },
  {
    id: "review",
    title: "Review",
    fields: ["featured"],
  },
] as const satisfies ReadonlyArray<{ id: string; title: string; fields: ReadonlyArray<PostingField> }>;

export type FieldErrors = Partial<Record<PostingField, string>>;

/** Untrusted form input: every field arrives as a string (or is absent). */
export type RawPostingInput = Partial<Record<PostingField, string>>;

function collectErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && field in postingFields.shape && !(field in errors)) {
      errors[field as PostingField] = issue.message;
    }
  }
  return errors;
}

/** Validates the fields of one step (plus salary range when both are on it). */
export function validateStep(stepIndex: number, values: RawPostingInput): FieldErrors {
  const step = POSTING_STEPS[stepIndex];
  if (!step) return {};
  const mask = Object.fromEntries(step.fields.map((field) => [field, true])) as Record<PostingField, true>;
  const schema = postingFields.pick(mask);
  const result = schema.safeParse(values);
  const errors = result.success ? {} : collectErrors(result.error);

  if (step.id === "apply" && !errors.salary_min && !errors.salary_max) {
    const full = postingSchema.safeParse(values);
    if (!full.success) {
      const rangeIssue = full.error.issues.find(
        (issue) => issue.path[0] === "salary_max" && issue.code === "custom" && issue.message.startsWith("Maximum salary must be greater"),
      );
      if (rangeIssue) errors.salary_max = rangeIssue.message;
    }
  }
  return errors;
}

export type ParsedPosting = { success: true; data: Posting } | { success: false; errors: FieldErrors };

export function parsePosting(values: RawPostingInput): ParsedPosting {
  const result = postingSchema.safeParse(values);
  return result.success ? { success: true, data: result.data } : { success: false, errors: collectErrors(result.error) };
}

/** Index of the first step containing an errored field. */
export function firstStepWithError(errors: FieldErrors): number {
  const index = POSTING_STEPS.findIndex((step) => step.fields.some((field) => field in errors));
  return index === -1 ? 0 : index;
}

/** Reads only known string fields from FormData (files and unknown keys are ignored). */
export function postingInputFromFormData(formData: FormData): RawPostingInput {
  const input: RawPostingInput = {};
  for (const field of Object.keys(postingFields.shape) as PostingField[]) {
    const value = formData.get(field);
    if (typeof value === "string") input[field] = value;
  }
  return input;
}

/** Shape expected by public.create_job_posting(p_job). */
export function toJobPayload(posting: Posting) {
  return {
    title: posting.title,
    company: posting.company_name,
    company_logo_url: posting.company_logo_url ?? null,
    company_url: posting.company_url ?? null,
    location: posting.location,
    workplace_type: posting.workplace_type,
    job_type: posting.job_type,
    category_slug: posting.category_slug,
    tags: posting.tags,
    description: posting.description,
    apply_url: posting.apply_target,
    salary_min: posting.salary_min,
    salary_max: posting.salary_max,
    salary_currency: posting.salary_currency,
  };
}

/** Shape expected by public.create_job_posting(p_employer). */
export function toEmployerPayload(posting: Posting) {
  return {
    company_name: posting.company_name,
    email: posting.contact_email,
    website_url: posting.company_url ?? null,
    logo_url: posting.company_logo_url ?? null,
  };
}
