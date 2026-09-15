import { updateJobAction } from "@/app/admin/actions";
import type { AdminAction, AdminJobRow } from "@/lib/admin/jobs";

const LABELS: Record<AdminAction, string> = {
  reject: "Reject",
  restore: "Restore",
  extend: "+30d",
  feature: "Feature",
  unfeature: "Unfeature",
};

export function availableActions(job: Pick<AdminJobRow, "status" | "is_featured">): AdminAction[] {
  switch (job.status) {
    case "active":
      return [job.is_featured ? "unfeature" : "feature", "extend", "reject"];
    case "expired":
    case "rejected":
      return ["restore"];
    case "draft":
    case "pending_payment":
    case "payment_expired":
      return ["reject"];
  }
}

export function JobActions({ job, returnTo }: { job: AdminJobRow; returnTo: string }) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {availableActions(job).map((action) => (
        <form key={action} action={updateJobAction}>
          <input type="hidden" name="jobId" value={job.id} />
          <input type="hidden" name="action" value={action} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <button
            type="submit"
            className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
              action === "reject"
                ? "border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700"
            }`}
          >
            {LABELS[action]}
          </button>
        </form>
      ))}
    </div>
  );
}
