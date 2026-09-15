"use client";

import { useActionState } from "react";
import { createJobAction, type AdminCreateState } from "@/app/admin/actions";
import { Constants } from "@/lib/database.types";
import { SALARY_CURRENCIES, type PostingField } from "@/lib/posting/schema";
import { JOB_TYPE_LABELS, WORKPLACE_LABELS, type Category } from "@/lib/types";

const INITIAL: AdminCreateState = { status: "idle" };

const inputClass =
  "block h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm focus:border-accent-500 focus:ring-4 focus:ring-accent-500/15 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900";

type TextField = { name: PostingField; label: string; placeholder?: string; type?: string };

const TEXT_FIELDS: TextField[] = [
  { name: "title", label: "Job title" },
  { name: "company_name", label: "Company" },
  { name: "company_url", label: "Company website", placeholder: "https://", type: "url" },
  { name: "company_logo_url", label: "Logo URL (https)", placeholder: "https://", type: "url" },
  { name: "location", label: "Location", placeholder: "Remote (US)" },
  { name: "tags", label: "Tags (comma-separated)", placeholder: "LangGraph, Python" },
  { name: "salary_min", label: "Salary from" },
  { name: "salary_max", label: "Salary to" },
  { name: "apply_target", label: "Apply URL or email" },
];

export function AdminJobForm({ categories }: { categories: Category[] }) {
  const [state, action, pending] = useActionState(createJobAction, INITIAL);
  const errors = state.status === "error" ? state.fieldErrors : {};

  const error = (field: PostingField) =>
    errors[field] ? (
      <p id={`admin-${field}-error`} className="mt-1 text-xs text-red-600 dark:text-red-400">
        {errors[field]}
      </p>
    ) : null;

  return (
    <form action={action} className="space-y-5" noValidate>
      {state.status === "error" && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {state.message}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {TEXT_FIELDS.map((field) => (
          <div key={field.name}>
            <label htmlFor={`admin-${field.name}`} className="text-sm font-medium">
              {field.label}
            </label>
            <input
              id={`admin-${field.name}`}
              name={field.name}
              type={field.type ?? "text"}
              placeholder={field.placeholder}
              aria-invalid={Boolean(errors[field.name])}
              aria-describedby={errors[field.name] ? `admin-${field.name}-error` : undefined}
              className={`${inputClass} mt-1`}
            />
            {error(field.name)}
          </div>
        ))}

        <div>
          <label htmlFor="admin-category_slug" className="text-sm font-medium">
            Category
          </label>
          <select id="admin-category_slug" name="category_slug" defaultValue="" className={`${inputClass} mt-1`}>
            <option value="">Choose…</option>
            {categories.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.name}
              </option>
            ))}
          </select>
          {error("category_slug")}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label htmlFor="admin-job_type" className="text-sm font-medium">
              Type
            </label>
            <select id="admin-job_type" name="job_type" defaultValue="full_time" className={`${inputClass} mt-1`}>
              {Constants.public.Enums.job_type.map((type) => (
                <option key={type} value={type}>
                  {JOB_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="admin-workplace_type" className="text-sm font-medium">
              Workplace
            </label>
            <select id="admin-workplace_type" name="workplace_type" defaultValue="remote" className={`${inputClass} mt-1`}>
              {Constants.public.Enums.workplace_type.map((type) => (
                <option key={type} value={type}>
                  {WORKPLACE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="admin-salary_currency" className="text-sm font-medium">
              Currency
            </label>
            <select id="admin-salary_currency" name="salary_currency" defaultValue="USD" className={`${inputClass} mt-1`}>
              {SALARY_CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div>
        <label htmlFor="admin-description" className="text-sm font-medium">
          Description (Markdown)
        </label>
        <textarea
          id="admin-description"
          name="description"
          rows={14}
          aria-invalid={Boolean(errors.description)}
          className={`${inputClass} mt-1 h-auto py-2 font-mono`}
        />
        {error("description")}
      </div>

      <div className="flex flex-wrap items-end gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="featured" className="size-4 accent-accent-600" />
          Feature this listing
        </label>
        <div>
          <label htmlFor="admin-days" className="text-sm font-medium">
            Days live
          </label>
          <input id="admin-days" name="days" type="number" min={1} max={365} defaultValue={30} className={`${inputClass} mt-1 w-24`} />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="ml-auto h-10 rounded-lg bg-accent-600 px-5 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-70"
        >
          {pending ? "Publishing…" : "Publish listing"}
        </button>
      </div>
    </form>
  );
}
