"use client";

import Link from "next/link";
import { ArrowUpRight, Github, Menu, X } from "lucide-react";
import { useState } from "react";

export function BrandMark({
  className = "",
  size = 31,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      className={`brand-mark ${className}`}
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
    >
      <rect width="36" height="36" rx="10" fill="currentColor" />
      <path
        d="M11 25V11h8a5 5 0 0 1 0 10h-4v4h-4Zm4-8h4a1 1 0 1 0 0-2h-4v2Z"
        fill="#F7F7F2"
      />
      <path d="m24 22 2.3-3 2.3 3-2.3 3-2.3-3Z" fill="#C8B6FF" />
    </svg>
  );
}
export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="Patchsentry home">
      <BrandMark />
      <span>
        patchsentry<span className="brand-period">.</span>
      </span>
    </Link>
  );
}
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Brand />
        <nav className="desktop-nav" aria-label="Main navigation">
          <Link href="/#features">Product</Link>
          <Link href="/how-it-works">How it works</Link>
          <Link href="/docs">Docs</Link>
          <Link href="/security">Security</Link>
        </nav>
        <div className="header-actions">
          <Link href="/login" className="login-link">
            Log in
          </Link>
          <Link href="/signup" className="button button-primary button-small">
            Get started <ArrowUpRight size={14} />
          </Link>
        </div>
        <button
          className="mobile-menu-button"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          aria-controls="mobile-navigation"
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
      {open && (
        <nav
          id="mobile-navigation"
          className="mobile-navigation"
          aria-label="Mobile navigation"
        >
          {[
            ["Product", "/#features"],
            ["How it works", "/how-it-works"],
            ["Documentation", "/docs"],
            ["Security", "/security"],
            ["Log in", "/login"],
            ["Get started", "/signup"],
          ].map(([name, href]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}>
              {name}
              <ArrowUpRight size={15} />
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-main">
          <div className="footer-brand">
            <Brand />
            <p>
              Confidence in every change.
              <br />
              Evidence behind every decision.
            </p>
            <a
              className="github-link"
              href="https://github.com/Vaidehi2510/QA-testbot"
              target="_blank"
              rel="noreferrer"
            >
              <Github size={16} /> Explore the QA engine{" "}
              <ArrowUpRight size={13} />
            </a>
          </div>
          <div className="footer-column">
            <span>PRODUCT</span>
            <Link href="/#features">Your QA team</Link>
            <Link href="/how-it-works">How it works</Link>
            <Link href="/demo">Explore the demo</Link>
            <Link href="/signup">Create a workspace</Link>
          </div>
          <div className="footer-column">
            <span>RESOURCES</span>
            <Link href="/docs">Documentation</Link>
            <Link href="/security">Security & boundaries</Link>
            <a
              href="https://github.com/Vaidehi2510/QA-testbot"
              target="_blank"
              rel="noreferrer"
            >
              Engine on GitHub
            </a>
            <a
              href="https://github.com/Vaidehi2510/patchsentry-web"
              target="_blank"
              rel="noreferrer"
            >
              Website on GitHub
            </a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Patchsentry</span>
          <span className="footer-principle">
            <span /> Models investigate. Evidence decides.
          </span>
          <span>Built for thoughtful shipping.</span>
        </div>
      </div>
    </footer>
  );
}
export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing-page">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main-content">{children}</main>
      <SiteFooter />
    </div>
  );
}
export function PageIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: React.ReactNode;
  description: string;
}) {
  return (
    <div className="page-intro container">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
