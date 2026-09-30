import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Patchsentry — Confidence in every change",
    template: "%s · Patchsentry",
  },
  description:
    "An AI QA team for your pull requests. Inspect code, run checks, review interfaces, and turn evidence into clear decisions—with no source-code edits.",
  applicationName: "Patchsentry",
  icons: { icon: "/icon.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
