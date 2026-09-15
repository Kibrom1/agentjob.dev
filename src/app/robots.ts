import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/unsubscribe/", "/post-a-job/success"] }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
