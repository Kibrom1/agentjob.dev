import { OG_CONTENT_TYPE, OG_SIZE, renderSiteCard } from "@/lib/og-card";

export const alt = "AgentJob: jobs for engineers who build AI agents";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderSiteCard();
}
