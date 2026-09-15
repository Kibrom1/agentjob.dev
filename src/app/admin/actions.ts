"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { z } from "zod";
import { AdminAuthError, assertAdmin } from "@/lib/admin/guard";
import { ADMIN_ACTIONS } from "@/lib/admin/jobs";
import { EnvConfigError } from "@/lib/env";
import { parsePosting, postingInputFromFormData, toJobPayload, type FieldErrors } from "@/lib/posting/schema";
import { getAdminDbClient } from "@/lib/supabase/admin";

const CURATED_CONTACT_SENTINEL = "admin@agentjobs.invalid";

const updateSchema = z.object({
  jobId: z.uuid(),
  action: z.enum(ADMIN_ACTIONS),
  days: z.coerce.number().int().min(1).max(365).default(30),
  returnTo: z
    .string()
    .regex(/^\/admin(\?[^#\s]*)?$/)
    .catch("/admin"),
});

export type AdminActionState = { status: "idle" } | { status: "ok"; message: string } | { status: "error"; message: string };

/** Lifecycle actions from the jobs table (reject / restore / extend / feature). */
export async function updateJobAction(formData: FormData): Promise<void> {
  await assertAdmin();

  const parsed = updateSchema.safeParse({
    jobId: formData.get("jobId"),
    action: formData.get("action"),
    days: formData.get("days") ?? undefined,
    returnTo: formData.get("returnTo") ?? undefined,
  });
  if (!parsed.success) {
    throw new Error("Invalid admin action request");
  }

  const { data, error } = await getAdminDbClient().rpc("admin_update_job", {
    p_job_id: parsed.data.jobId,
    p_action: parsed.data.action,
    p_days: parsed.data.days,
  });
  if (error) {
    console.error("[admin] update failed", { ...parsed.data, code: error.code, message: error.message });
    const separator = parsed.data.returnTo.includes("?") ? "&" : "?";
    redirect(`${parsed.data.returnTo}${separator}error=${encodeURIComponent(error.message.slice(0, 160))}` as Route);
  }

  revalidatePath("/");
  revalidatePath(`/jobs/${data.slug}`);
  revalidatePath("/admin");
  redirect(parsed.data.returnTo as Route);
}

export type AdminCreateState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors: FieldErrors };

const createOptionsSchema = z.object({
  featured: z.literal("on").optional(),
  days: z.coerce.number().int().min(1).max(365).catch(30),
});

/** Publishes a curated listing immediately (no payment). */
export async function createJobAction(_previous: AdminCreateState, formData: FormData): Promise<AdminCreateState> {
  try {
    await assertAdmin();
  } catch (error) {
    if (error instanceof AdminAuthError) return { status: "error", message: "Your admin session has expired. Reload the page.", fieldErrors: {} };
    throw error;
  }

  const input = postingInputFromFormData(formData);
  // Curated listings have no employer contact; satisfy the shared schema
  // with a reserved, never-deliverable address that is not persisted.
  const parsed = parsePosting({ ...input, contact_email: CURATED_CONTACT_SENTINEL, featured: "" });
  if (!parsed.success) {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors: parsed.errors };
  }

  const options = createOptionsSchema.parse({
    featured: formData.get("featured") === "on" ? "on" : undefined,
    days: formData.get("days"),
  });

  let slug: string;
  try {
    const { data, error } = await getAdminDbClient().rpc("admin_create_job", {
      p_job: toJobPayload(parsed.data),
      p_featured: options.featured === "on",
      p_days: options.days,
    });
    if (error) {
      console.error("[admin] create failed", error);
      return { status: "error", message: `Database rejected the listing: ${error.message}`, fieldErrors: {} };
    }
    slug = data.slug;
  } catch (error) {
    const message = error instanceof EnvConfigError ? error.message : "Could not reach the database.";
    return { status: "error", message, fieldErrors: {} };
  }

  revalidatePath("/");
  revalidatePath("/admin");
  redirect(`/admin?created=${encodeURIComponent(slug)}` as Route);
}
