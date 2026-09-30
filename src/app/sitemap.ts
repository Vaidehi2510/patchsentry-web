import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = process.env.SITE_URL || "https://patchsentry.vercel.app";
  return ["", "/how-it-works", "/docs", "/security", "/demo"].map((path) => ({
    url: `${origin}${path}`,
    changeFrequency: "monthly",
    priority: path ? 0.7 : 1,
  }));
}
