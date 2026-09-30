import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  Cloud,
  Code2,
  Database,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  Server,
  ShieldCheck,
} from "lucide-react";
import { MarketingShell, PageIntro } from "@/components/marketing/site-shell";

export const metadata: Metadata = { title: "Security & boundaries" };
const boundaries = [
  {
    icon: Code2,
    title: "Your product code stays untouched.",
    text: "The QA engine reads repository snapshots. It does not commit fixes, push branches, merge PRs, or install generated tests into your product. Suggested fixes remain reviewable findings.",
    detail:
      "Optional comments, labels, and commit statuses are metadata writes. Grant them separately from source access.",
  },
  {
    icon: KeyRound,
    title: "Model credentials stay server-side.",
    text: "OpenRouter and local-model keys belong in the engine’s environment. The local model dashboard reports whether a credential is configured; it does not return the credential to the browser.",
    detail:
      "Do not put model keys in repository files, browser fields, or uploaded reports.",
  },
  {
    icon: Server,
    title: "Local inference has a local boundary.",
    text: "Local mode accepts a literal loopback API address and does not fall back to OpenRouter. Run a local model server alongside the QA runner with explicitly configured capabilities.",
    detail:
      "Configure your inference server for local processing. A server that itself forwards requests to a provider has its own data boundary.",
  },
  {
    icon: Cloud,
    title: "Hosted models receive review context.",
    text: "When you choose OpenRouter, selected source context, test evidence, and enabled screenshots are sent to OpenRouter and the selected model provider. Review your model and provider settings for the product’s data requirements.",
    detail:
      "Path exclusions and secret redaction reduce accidental exposure. They are not a guarantee that source material contains no sensitive information.",
  },
  {
    icon: Database,
    title: "The portal receives the reports you send.",
    text: "Running the model locally does not make a connected web workspace offline. If you upload a report, the portal stores the submitted review data for your workspace.",
    detail:
      "Review the report payload and sanitize sensitive fields before connecting an engine. Screenshots and findings can contain product or customer information.",
  },
  {
    icon: Fingerprint,
    title: "Evidence belongs to a revision.",
    text: "Reports and test evidence identify the product repository and exact head revision. A result from an earlier commit cannot establish a pass for a different change.",
    detail:
      "Model opinions stay separate from executed test results, and missing evidence stays visible.",
  },
];
export default function SecurityPage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="SECURITY & PRODUCT BOUNDARIES"
        title={
          <>
            Helpful by design.
            <br />
            Limited by permission.
          </>
        }
        description="Understand what the engine reads, where review data goes, and which actions stay in your team’s hands."
      />
      <section className="container boundary-summary">
        <div>
          <ShieldCheck size={24} />
          <strong>Read product code</strong>
          <span>Review committed snapshots</span>
        </div>
        <div>
          <Check size={24} />
          <strong>Write QA metadata, optionally</strong>
          <span>PR comments, labels, and statuses</span>
        </div>
        <div>
          <LockKeyhole size={24} />
          <strong>No source-code writes</strong>
          <span>No fixes, commits, pushes, or merges</span>
        </div>
      </section>
      <section className="container security-grid">
        {boundaries.map(({ icon: Icon, title, text, detail }) => (
          <article className="security-card" key={title}>
            <span className="detail-icon">
              <Icon size={23} />
            </span>
            <h2>{title}</h2>
            <p>{text}</p>
            <div>{detail}</div>
          </article>
        ))}
      </section>
      <section className="container security-environments">
        <div>
          <span className="eyebrow">EXECUTION NEEDS ITS OWN BOUNDARY</span>
          <h2>
            Test a preview environment.
            <br />
            Keep production out of the loop.
          </h2>
        </div>
        <div>
          <p>
            Interactive browser journeys can click buttons, submit forms, or
            create records. Use an isolated environment, dedicated test
            accounts, and resettable test data. Restrict the routes and journeys
            your runner is allowed to exercise.
          </p>
          <p>
            Source access and test execution are different privileges. Configure
            trusted runners for your stack, avoid passing model keys to test
            workloads, and inspect the engine’s execution documentation before
            enabling integration.
          </p>
          <a
            href="https://github.com/Vaidehi2510/QA-testbot"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            Inspect the engine and its boundaries <ArrowUpRight size={15} />
          </a>
        </div>
      </section>
      <section className="container information-banner">
        <CircleAlert size={28} />
        <div>
          <h2>Automation is evidence, not a security guarantee.</h2>
          <p>
            These are product boundaries, not a compliance certification or a
            promise to detect every vulnerability. High-risk products still need
            appropriate expert review and independent security testing.
          </p>
        </div>
      </section>
      <section className="container page-bottom-cta">
        <div>
          <span className="eyebrow">START WITH THE RIGHT PERMISSIONS</span>
          <h2>Your product. Your boundaries.</h2>
        </div>
        <Link href="/docs" className="button button-primary">
          Read the setup guide <ArrowUpRight size={16} />
        </Link>
      </section>
    </MarketingShell>
  );
}
