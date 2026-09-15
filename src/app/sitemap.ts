import type { MetadataRoute } from "next";
import { listLiveJobSlugs } from "@/lib/jobs";
import { absoluteUrl } from "@/lib/site";

// Generated on request rather than at build time, so `next build` never needs
// database credentials and the sitemap always reflects live listings.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const jobs = await listLiveJobSlugs();
  const newest = jobs[0]?.published_at;

  return [
    {
      url: absoluteUrl("/"),
      lastModified: newest ? new Date(newest) : new Date(),
      changeFrequency: "hourly",
      priority: 1,
    },
    {
      url: absoluteUrl("/post-a-job"),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    ...jobs.map((job) => ({
      url: absoluteUrl(`/jobs/${job.slug}`),
      lastModified: new Date(job.published_at),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
