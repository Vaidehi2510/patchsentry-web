import type { Metadata } from "next";
import "./globals.css";
import "./experience.css";
import { MotionProvider } from "@/components/motion";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.SITE_URL || "https://patchsentry.vercel.app",
  ),
  title: {
    default: "Patchsentry — Confidence in every change",
    template: "%s · Patchsentry",
  },
  description:
    "Automated product QA for pull requests, CI builds and complete releases. Author tests, choose local or OpenRouter models, and verify evidence before deployment without changing product source.",
  applicationName: "Patchsentry",
  openGraph: {
    title: "Patchsentry — Confidence in every change",
    description:
      "Your AI QA workspace for product tests, build evidence and pre-deployment decisions. Your code stays yours.",
    siteName: "Patchsentry",
    type: "website",
  },
  icons: { icon: "/icon.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body><MotionProvider>{children}</MotionProvider></body>
    </html>
  );
}
