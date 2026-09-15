"use client";

import { useActionState, useEffect, useId, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { startJobCheckout, type PostJobState } from "@/app/post-a-job/actions";
import { Markdown } from "@/components/markdown";
import { Constants } from "@/lib/database.types";
import { formatSalaryRange } from "@/lib/format";
import { PRICING, formatUsd, planFor, planSubtotal } from "@/lib/posting/pricing";
import {
  DESCRIPTION_MAX,
  MAX_TAGS,
  POSTING_STEPS,
  SALARY_CURRENCIES,
  firstStepWithError,
  parsePosting,
  parseTags,
  validateStep,
  type FieldErrors,
  type PostingField,
} from "@/lib/posting/schema";
import { JOB_TYPE_LABELS, WORKPLACE_LABELS, type Category } from "@/lib/types";

export const DRAFT_STORAGE_KEY = "agentjobs:post-job-draft";

type Values = Record<PostingField, string>;

const EMPTY_VALUES: Values = {
  company_name: "",
  company_url: "",
  company_logo_url: "",
  contact_email: "",
  title: "",
  category_slug: "",
  job_type: "full_time",
  workplace_type: "remote",
  location: "",
  tags: "",
  description: "",
  salary_min: "",
  salary_max: "",
  salary_currency: "USD",
  apply_target: "",
  featured: "",
};

const INITIAL_STATE: PostJobState = { status: "idle" };

const inputClass = (hasError: boolean) =>
  `block h-10 w-full rounded-lg border bg-white px-3 text-sm placeholder:text-zinc-400 focus:ring-4 focus:outline-none dark:bg-zinc-900 ${
    hasError
      ? "border-red-500 focus:border-red-500 focus:ring-red-500/15"
      : "border-zinc-300 focus:border-accent-500 focus:ring-accent-500/15 dark:border-zinc-700"
  }`;

function readDraft(): Partial<Values> | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const draft: Partial<Values> = {};
    for (const key of Object.keys(EMPTY_VALUES) as PostingField[]) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "string") draft[key] = value;
    }
    return draft;
  } catch {
    return null;
  }
}

type FieldProps = {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
  children: ReactNode;
};

function Field({ id, label, error, hint, optional, children }: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="flex items-baseline justify-between text-sm font-medium">
        {label}
        {optional && <span className="text-xs font-normal text-zinc-400">Optional</span>}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type PostJobFormProps = {
  categories: Category[];
  restoreDraft: boolean;
};

export function PostJobForm({ categories, restoreDraft }: PostJobFormProps) {
  const formId = useId();
  const [state, formAction, pending] = useActionState(startJobCheckout, INITIAL_STATE);
  const [values, setValues] = useState<Values>(EMPTY_VALUES);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [preview, setPreview] = useState(false);
  const [restored, setRestored] = useState(false);
  // While a draft restore is pending, don't persist the empty initial values
  // over the draft we are about to read.
  const [draftReady, setDraftReady] = useState(!restoreDraft);
  const [seenState, setSeenState] = useState(state);

  // Surface server-side validation by jumping to the offending step.
  if (state !== seenState) {
    setSeenState(state);
    if (state.status === "error") {
      setErrors(state.fieldErrors);
      setStep(state.step);
    }
  }

  // Restore a draft saved before a cancelled checkout (client-only storage,
  // applied after hydration so server and client markup match).
  useEffect(() => {
    if (!restoreDraft) return;
    const frame = window.requestAnimationFrame(() => {
      const draft = readDraft();
      if (draft) {
        setValues((current) => ({ ...current, ...draft }));
        setRestored(true);
      }
      setDraftReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [restoreDraft]);

  useEffect(() => {
    if (!draftReady) return;
    try {
      window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(values));
    } catch {
      // storage unavailable (private mode); the form still works
    }
  }, [values, draftReady]);

  const id = (field: PostingField) => `${formId}-${field}`;
  const describedBy = (field: PostingField) => (errors[field] ? `${id(field)}-error` : undefined);

  function update(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const field = event.currentTarget.name as PostingField;
    const value =
      event.currentTarget instanceof HTMLInputElement && event.currentTarget.type === "checkbox"
        ? event.currentTarget.checked
          ? "on"
          : ""
        : event.currentTarget.value;
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) {
      setErrors((current) => {
        const next = { ...current };
        delete next[field];
        return next;
      });
    }
  }

  function goNext() {
    const stepErrors = validateStep(step, values);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length === 0) {
      setStep((current) => Math.min(current + 1, POSTING_STEPS.length - 1));
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(formId)?.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
    }
  }

  function goBack() {
    setErrors({});
    setStep((current) => Math.max(current - 1, 0));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const result = parsePosting(values);
    if (!result.success) {
      event.preventDefault();
      setErrors(result.errors);
      setStep(firstStepWithError(result.errors));
    }
  }

  const featured = values.featured === "on";
  const total = planSubtotal(planFor(featured));
  const tags = parseTags(values.tags);
  const salaryMin = /^\d+$/.test(values.salary_min.replace(/[,_\s]/g, "")) ? Number(values.salary_min.replace(/[,_\s]/g, "")) : null;
  const salaryMax = /^\d+$/.test(values.salary_max.replace(/[,_\s]/g, "")) ? Number(values.salary_max.replace(/[,_\s]/g, "")) : null;
  const salaryPreview = formatSalaryRange(salaryMin, salaryMax, values.salary_currency || "USD");
  const categoryName = categories.find((category) => category.slug === values.category_slug)?.name;
  const isLastStep = step === POSTING_STEPS.length - 1;

  return (
    <form id={formId} action={formAction} onSubmit={handleSubmit} noValidate className="scroll-mt-20 space-y-8">
      <ol className="grid grid-cols-5 gap-2" aria-label="Progress">
        {POSTING_STEPS.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => index < step && setStep(index)}
              disabled={index >= step}
              aria-current={index === step ? "step" : undefined}
              className="group w-full text-left disabled:cursor-default"
            >
              <span
                className={`block h-1 rounded-full ${
                  index <= step ? "bg-accent-600" : "bg-zinc-200 dark:bg-zinc-800"
                }`}
              />
              <span
                className={`mt-2 hidden text-xs sm:block ${
                  index === step ? "font-semibold text-zinc-900 dark:text-zinc-100" : "text-zinc-500 group-enabled:hover:text-zinc-900 dark:group-enabled:hover:text-zinc-100"
                }`}
              >
                {index + 1}. {item.title}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="text-sm text-zinc-500 sm:hidden">
        Step {step + 1} of {POSTING_STEPS.length}: {POSTING_STEPS[step]?.title}
      </p>

      {restored && (
        <p role="status" className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          We restored the details you entered before checkout.
        </p>
      )}

      {state.status === "error" && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {state.message}
        </p>
      )}

      {/* Honeypot */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={`${formId}-nickname`}>Nickname</label>
        <input id={`${formId}-nickname`} name="nickname" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      {/* Step 1: company */}
      <fieldset hidden={step !== 0} className="space-y-5">
        <legend className="mb-5 text-lg font-semibold tracking-tight">Tell us about the company</legend>
        <Field id={id("company_name")} label="Company name" error={errors.company_name}>
          <input id={id("company_name")} name="company_name" value={values.company_name} onChange={update} maxLength={120} autoComplete="organization" aria-invalid={Boolean(errors.company_name)} aria-describedby={describedBy("company_name")} className={inputClass(Boolean(errors.company_name))} />
        </Field>
        <Field id={id("company_url")} label="Company website" optional error={errors.company_url}>
          <input id={id("company_url")} name="company_url" type="url" inputMode="url" value={values.company_url} onChange={update} placeholder="https://example.com" aria-invalid={Boolean(errors.company_url)} aria-describedby={describedBy("company_url")} className={inputClass(Boolean(errors.company_url))} />
        </Field>
        <Field id={id("company_logo_url")} label="Logo URL" optional error={errors.company_logo_url} hint="A square PNG or SVG served over https works best.">
          <input id={id("company_logo_url")} name="company_logo_url" type="url" inputMode="url" value={values.company_logo_url} onChange={update} placeholder="https://example.com/logo.png" aria-invalid={Boolean(errors.company_logo_url)} aria-describedby={describedBy("company_logo_url") ?? `${id("company_logo_url")}-hint`} className={inputClass(Boolean(errors.company_logo_url))} />
        </Field>
        <Field id={id("contact_email")} label="Your email" error={errors.contact_email} hint="For your receipt and listing confirmation. Never shown publicly.">
          <input id={id("contact_email")} name="contact_email" type="email" inputMode="email" autoComplete="email" value={values.contact_email} onChange={update} placeholder="you@company.com" aria-invalid={Boolean(errors.contact_email)} aria-describedby={describedBy("contact_email") ?? `${id("contact_email")}-hint`} className={inputClass(Boolean(errors.contact_email))} />
        </Field>
      </fieldset>

      {/* Step 2: role */}
      <fieldset hidden={step !== 1} className="space-y-5">
        <legend className="mb-5 text-lg font-semibold tracking-tight">Describe the role</legend>
        <Field id={id("title")} label="Job title" error={errors.title}>
          <input id={id("title")} name="title" value={values.title} onChange={update} maxLength={140} placeholder="Senior Agent Orchestration Engineer" aria-invalid={Boolean(errors.title)} aria-describedby={describedBy("title")} className={inputClass(Boolean(errors.title))} />
        </Field>
        <Field id={id("category_slug")} label="Category" error={errors.category_slug}>
          <select id={id("category_slug")} name="category_slug" value={values.category_slug} onChange={update} aria-invalid={Boolean(errors.category_slug)} aria-describedby={describedBy("category_slug")} className={inputClass(Boolean(errors.category_slug))}>
            <option value="">Choose a category…</option>
            {categories.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id={id("job_type")} label="Employment type" error={errors.job_type}>
            <select id={id("job_type")} name="job_type" value={values.job_type} onChange={update} className={inputClass(Boolean(errors.job_type))}>
              {Constants.public.Enums.job_type.map((type) => (
                <option key={type} value={type}>
                  {JOB_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </Field>
          <Field id={id("workplace_type")} label="Workplace" error={errors.workplace_type}>
            <select id={id("workplace_type")} name="workplace_type" value={values.workplace_type} onChange={update} className={inputClass(Boolean(errors.workplace_type))}>
              {Constants.public.Enums.workplace_type.map((type) => (
                <option key={type} value={type}>
                  {WORKPLACE_LABELS[type]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field id={id("location")} label="Location" error={errors.location} hint='City, region or remote scope, e.g. "Remote (US)" or "London, UK".'>
          <input id={id("location")} name="location" value={values.location} onChange={update} maxLength={120} aria-invalid={Boolean(errors.location)} aria-describedby={describedBy("location") ?? `${id("location")}-hint`} className={inputClass(Boolean(errors.location))} />
        </Field>
        <Field id={id("tags")} label="Tags" optional error={errors.tags} hint={`Comma-separated, up to ${MAX_TAGS}: frameworks, languages, infra.`}>
          <input id={id("tags")} name="tags" value={values.tags} onChange={update} placeholder="LangGraph, Python, MCP, vLLM" aria-invalid={Boolean(errors.tags)} aria-describedby={describedBy("tags") ?? `${id("tags")}-hint`} className={inputClass(Boolean(errors.tags))} />
        </Field>
      </fieldset>

      {/* Step 3: description */}
      <fieldset hidden={step !== 2} className="space-y-3">
        <legend className="mb-5 text-lg font-semibold tracking-tight">Job description</legend>
        <div className="flex items-center justify-between">
          <label htmlFor={id("description")} className="text-sm font-medium">
            Description <span className="font-normal text-zinc-400">(Markdown supported)</span>
          </label>
          <div className="flex rounded-lg border border-zinc-200 p-0.5 text-xs dark:border-zinc-800" role="group" aria-label="Editor mode">
            <button type="button" onClick={() => setPreview(false)} aria-pressed={!preview} className={`rounded-md px-2 py-1 ${!preview ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 dark:text-zinc-400"}`}>
              Write
            </button>
            <button type="button" onClick={() => setPreview(true)} aria-pressed={preview} className={`rounded-md px-2 py-1 ${preview ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 dark:text-zinc-400"}`}>
              Preview
            </button>
          </div>
        </div>
        <textarea
          id={id("description")}
          name="description"
          value={values.description}
          onChange={update}
          hidden={preview}
          rows={16}
          maxLength={DESCRIPTION_MAX}
          placeholder={"## About the role\n\nWhat the team builds, what the engineer will own…\n\n## Requirements\n\n- Production experience with agent frameworks"}
          aria-invalid={Boolean(errors.description)}
          aria-describedby={describedBy("description")}
          className={`${inputClass(Boolean(errors.description))} h-auto py-2 font-mono leading-relaxed`}
        />
        {preview && (
          <div className="min-h-64 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            {values.description.trim() ? (
              <Markdown>{values.description}</Markdown>
            ) : (
              <p className="text-sm text-zinc-400">Nothing to preview yet.</p>
            )}
          </div>
        )}
        <div className="flex justify-between text-xs text-zinc-500">
          {errors.description ? (
            <p id={`${id("description")}-error`} className="text-sm text-red-600 dark:text-red-400">
              {errors.description}
            </p>
          ) : (
            <span>Headings, lists, links, tables and code blocks render on the listing.</span>
          )}
          <span className="font-mono">{values.description.length.toLocaleString("en-US")}</span>
        </div>
      </fieldset>

      {/* Step 4: compensation and apply */}
      <fieldset hidden={step !== 3} className="space-y-5">
        <legend className="mb-5 text-lg font-semibold tracking-tight">Compensation and applications</legend>
        <div className="grid gap-5 sm:grid-cols-[1fr_1fr_7rem]">
          <Field id={id("salary_min")} label="Salary from" optional error={errors.salary_min}>
            <input id={id("salary_min")} name="salary_min" inputMode="numeric" value={values.salary_min} onChange={update} placeholder="150000" aria-invalid={Boolean(errors.salary_min)} aria-describedby={describedBy("salary_min")} className={inputClass(Boolean(errors.salary_min))} />
          </Field>
          <Field id={id("salary_max")} label="Salary to" optional error={errors.salary_max}>
            <input id={id("salary_max")} name="salary_max" inputMode="numeric" value={values.salary_max} onChange={update} placeholder="210000" aria-invalid={Boolean(errors.salary_max)} aria-describedby={describedBy("salary_max")} className={inputClass(Boolean(errors.salary_max))} />
          </Field>
          <Field id={id("salary_currency")} label="Currency" error={errors.salary_currency}>
            <select id={id("salary_currency")} name="salary_currency" value={values.salary_currency} onChange={update} className={inputClass(Boolean(errors.salary_currency))}>
              {SALARY_CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="-mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Annual base salary. Listings with a salary range get noticeably more clicks.
        </p>
        <Field id={id("apply_target")} label="How to apply" error={errors.apply_target} hint="Your application page (https://…) or an email address.">
          <input id={id("apply_target")} name="apply_target" value={values.apply_target} onChange={update} placeholder="https://jobs.example.com/agent-engineer" aria-invalid={Boolean(errors.apply_target)} aria-describedby={describedBy("apply_target") ?? `${id("apply_target")}-hint`} className={inputClass(Boolean(errors.apply_target))} />
        </Field>
      </fieldset>

      {/* Step 5: review and pay */}
      <fieldset hidden={step !== 4} className="space-y-6">
        <legend className="mb-5 text-lg font-semibold tracking-tight">Review and publish</legend>

        <div className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <p className="text-sm text-zinc-500">{values.company_name || "Company"}</p>
          <p className="mt-0.5 text-lg font-semibold tracking-tight">{values.title || "Job title"}</p>
          <p className="mt-1 text-sm text-zinc-500">
            {[values.location, WORKPLACE_LABELS[values.workplace_type as keyof typeof WORKPLACE_LABELS], JOB_TYPE_LABELS[values.job_type as keyof typeof JOB_TYPE_LABELS], salaryPreview]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {(categoryName || tags.length > 0) && (
            <p className="mt-3 flex flex-wrap gap-1.5 text-xs">
              {categoryName && <span className="rounded-md bg-zinc-900 px-2 py-0.5 text-white dark:bg-zinc-100 dark:text-zinc-900">{categoryName}</span>}
              {tags.map((tag) => (
                <span key={tag} className="rounded-md border border-zinc-200 px-2 py-0.5 font-mono text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                  {tag}
                </span>
              ))}
            </p>
          )}
        </div>

        <label
          htmlFor={id("featured")}
          className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors ${
            featured ? "border-accent-500 bg-accent-50 dark:bg-accent-950/40" : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800"
          }`}
        >
          <input id={id("featured")} name="featured" type="checkbox" checked={featured} onChange={update} className="mt-1 size-4 accent-accent-600" />
          <span>
            <span className="font-medium">Feature this listing (+{formatUsd(PRICING.featured.amount)})</span>
            <span className="mt-0.5 block text-sm text-zinc-600 dark:text-zinc-400">
              Pinned above all other roles and highlighted in the weekly digest for {PRICING.listing.durationDays} days.
            </span>
          </span>
        </label>

        <dl className="space-y-2 rounded-xl bg-zinc-50 p-4 text-sm dark:bg-zinc-900/60">
          <div className="flex justify-between">
            <dt>Job listing · {PRICING.listing.durationDays} days</dt>
            <dd>{formatUsd(PRICING.listing.amount)}</dd>
          </div>
          {featured && (
            <div className="flex justify-between">
              <dt>Featured placement</dt>
              <dd>{formatUsd(PRICING.featured.amount)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-zinc-200 pt-2 font-semibold dark:border-zinc-800">
            <dt>Total</dt>
            <dd>{formatUsd(total)}</dd>
          </div>
        </dl>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          You&apos;ll pay securely with Stripe. Your listing goes live automatically as soon as payment is confirmed.
        </p>
      </fieldset>

      <div className="flex items-center justify-between gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <button
          type="button"
          onClick={goBack}
          disabled={step === 0 || pending}
          className="h-10 rounded-lg px-4 text-sm font-medium text-zinc-600 hover:text-zinc-900 disabled:invisible dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          ← Back
        </button>
        {/*
          Distinct keys force React to create a new element. Reusing the same
          <button> would flip its type to "submit" while the "Continue" click
          is still being dispatched, and the browser would submit the form.
        */}
        {isLastStep ? (
          <button
            key="submit"
            type="submit"
            disabled={pending}
            className="h-11 rounded-lg bg-accent-600 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-700 disabled:cursor-wait disabled:opacity-70"
          >
            {pending ? "Opening checkout…" : `Continue to payment · ${formatUsd(total)}`}
          </button>
        ) : (
          <button
            key="next"
            type="button"
            onClick={goNext}
            className="h-10 rounded-lg bg-zinc-900 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Continue →
          </button>
        )}
      </div>
    </form>
  );
}
