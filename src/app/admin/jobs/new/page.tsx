import type { Metadata } from "next";
import { AdminJobForm } from "@/components/admin/admin-job-form";
import { assertAdmin } from "@/lib/admin/guard";
import { listCategories } from "@/lib/jobs";

export const metadata: Metadata = { title: "New listing" };

export default async function AdminNewJobPage() {
  await assertAdmin();
  const categories = await listCategories();

  return (
    <div className="max-w-3xl">
      <h1 className="text-lg font-semibold">Publish a curated listing</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Goes live immediately without payment. Use it for hand-picked roles and for partners.
      </p>
      <AdminJobForm categories={categories} />
    </div>
  );
}
