import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  const origin = process.env.SITE_URL || "https://patchsentry.vercel.app";
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/app", "/api/"] },
    sitemap: `${origin}/sitemap.xml`,
  };
}
