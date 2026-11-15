import { getJobBySlug } from "@/lib/jobs";
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard, renderSiteCard } from "@/lib/og-card";
import { OG_LIMITS, truncateOgText } from "@/lib/og-text";

export const alt = "Job on AgentJob";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export const revalidate = 300;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const job = await getJobBySlug(slug);
    if (!job) return renderSiteCard();

    const title = truncateOgText(job.title, OG_LIMITS.title);
    return renderOgCard({
      heading: title,
      subheading: truncateOgText(job.company, OG_LIMITS.company),
      meta: truncateOgText(job.location, OG_LIMITS.location),
      headingSize: title.length > 55 ? 56 : 68,
    });
  } catch {
    // Unknown job, database outage or render failure: never 500 a share card.
    return renderSiteCard();
  }
}
