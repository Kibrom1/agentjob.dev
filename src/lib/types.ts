import type { Enums, FunctionReturns, Tables } from "@/lib/database.types";

export type JobType = Enums<"job_type">;
export type WorkplaceType = Enums<"workplace_type">;

export type Category = Pick<Tables<"categories">, "slug" | "name" | "description">;

/** Row returned by the `search_jobs` RPC (feed card data). */
export type JobSummary = Omit<FunctionReturns<"search_jobs">[number], "total_count">;

/** Public columns of a live job, as granted to the anon role. */
export type JobDetail = Pick<
  Tables<"jobs">,
  | "id"
  | "slug"
  | "title"
  | "company"
  | "company_logo_url"
  | "company_url"
  | "location"
  | "workplace_type"
  | "job_type"
  | "category_slug"
  | "tags"
  | "description"
  | "apply_url"
  | "salary_min"
  | "salary_max"
  | "salary_currency"
> & {
  is_featured: boolean;
  published_at: string;
  expires_at: string;
  category: Category | null;
};

export type JobSearchFilters = {
  query?: string;
  category?: string;
  workplace?: WorkplaceType;
  tag?: string;
  page: number;
};

export type JobSearchResult = {
  jobs: JobSummary[];
  total: number;
  page: number;
  pageCount: number;
  /** Epoch ms when the rows were read; the reference point for relative dates. */
  fetchedAt: number;
};

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
};

export const WORKPLACE_LABELS: Record<WorkplaceType, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};
