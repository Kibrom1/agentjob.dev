import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

// Public, text-only share cards: safe to cache at the edge for a while.
const CACHE_CONTROL = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";

type CardProps = {
  heading: string;
  subheading?: string;
  meta?: string;
  headingSize?: number;
};

/** Renders a 1200x630 card from plain strings only (no remote images, fonts or URLs). */
export function renderOgCard({ heading, subheading, meta, headingSize = 72 }: CardProps): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#09090b",
          color: "#fafafa",
          padding: 72,
        }}
      >
        <div style={{ display: "flex", fontSize: 36, fontWeight: 700, color: "#a1a1aa" }}>
          agenticroles.dev
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: headingSize, fontWeight: 700, lineHeight: 1.1 }}>
            {heading}
          </div>
          {subheading ? (
            <div style={{ display: "flex", fontSize: 40, color: "#d4d4d8", marginTop: 28 }}>
              {subheading}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", fontSize: 30, color: "#a1a1aa" }}>
          {meta ?? "Jobs for engineers who build AI agents"}
        </div>
      </div>
    ),
    { ...OG_SIZE, headers: { "Cache-Control": CACHE_CONTROL } },
  );
}

export function renderSiteCard(): ImageResponse {
  return renderOgCard({
    heading: "Agentic Roles",
    subheading: "Jobs for engineers who build AI agents",
    meta: "Orchestration, tool-use backends, local LLM infrastructure, evals and more",
    headingSize: 120,
  });
}
