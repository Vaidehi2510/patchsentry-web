import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Cpu,
  Fingerprint,
  GitPullRequest,
  MessageSquare,
  ScanEye,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { MarketingShell, PageIntro } from "@/components/marketing/site-shell";

export const metadata: Metadata = { title: "How it works" };
const stages = [
  {
    number: "01",
    icon: GitPullRequest,
    title: "Start with the exact change.",
    text: "Connect the QA engine to a product repository with read access. Choose the pull request or committed base and head revisions you want reviewed. The engine reads a bounded snapshot and records which revision it inspected.",
    items: [
      "Your product repository does not need generated tests or bot-authored commits.",
      "Read access to code is separate from optional comments, labels, and status permissions.",
      "Test suites and browser journeys belong in a trusted QA configuration.",
    ],
  },
  {
    number: "02",
    icon: Cpu,
    title: "Give your specialists the right models.",
    text: "Browse OpenRouter models or connect a compatible local inference server. Choose a default model or assign a model to each specialist. Set the limits for calls, tool rounds, context, and hosted-model spending.",
    items: [
      "Five roles cover planning, code review, security, UI/UX, and bug triage.",
      "Local models need explicit context, tool-calling, and vision capability profiles.",
      "Local inference stays with the local runner. The hosted portal cannot reach your laptop’s loopback server.",
    ],
  },
  {
    number: "03",
    icon: ScanEye,
    title: "Inspect, test, and collect evidence.",
    text: "The specialists read code and select from configured, trusted checks. After explicit local enrollment, request an exact PR commit from the workspace. A durable job queue sends bounded work to your runner, which executes trusted suites and planned browser journeys against the configured preview. Browser evidence can include screenshots, accessibility issues, layout checks, and page errors.",
    items: [
      "Use a dedicated preview environment with test data for interactive journeys.",
      "Generated test code and suggested fixes remain proposals; the bot does not insert them into your product.",
      "Missing tests, screenshots, environments, or requirements appear as coverage limitations.",
    ],
  },
  {
    number: "04",
    icon: Fingerprint,
    title: "Get a decision you can inspect.",
    text: "Real test results establish pass or fail. The final AI review investigates those results and adds cited findings, likely causes, and suggested fixes. Reports stay tied to their revision so a new commit cannot inherit an old pass.",
    items: [
      "A model saying “looks good” cannot replace executed test evidence.",
      "Code findings are distinguished from verified test failures.",
      "Optional PR comments and statuses point your team to the results.",
    ],
  },
  {
    number: "05",
    icon: MessageSquare,
    title: "Bring a person in where it matters.",
    text: "Ambiguous requirements and consequential findings need judgment. Give your QA expert a focused question and its evidence instead of asking them to repeat an entire test pass.",
    items: [
      "A human can clarify intended behavior and assess product tradeoffs.",
      "A developer applies the proposed fix in the normal development workflow.",
      "Run the checks again against the new revision before signing off.",
    ],
  },
];
export default function HowItWorksPage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="THE REVIEW WORKFLOW"
        title={
          <>
            From “what changed?”
            <br />
            to “what needs attention?”
          </>
        }
        description="A practical loop of investigation, execution, and evidence. Keep your product untouched and your decisions informed."
      />
      <section className="container workflow-detail-list">
        {stages.map(({ number, icon: Icon, title, text, items }) => (
          <article className="workflow-detail" key={number}>
            <div className="detail-step-number">{number}</div>
            <div className="detail-step-body">
              <span className="detail-icon">
                <Icon size={24} />
              </span>
              <h2>{title}</h2>
              <p>{text}</p>
              <ul>
                {items.map((item) => (
                  <li key={item}>
                    <Check size={15} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </section>
      <section className="container information-banner">
        <ShieldCheck size={28} />
        <div>
          <h2>Broad coverage starts with a product-specific setup.</h2>
          <p>
            The engine is reusable across products. Meaningful test journeys,
            requirements, and environments still need to describe your product.
            The bot reports the limits of what it actually checked.
          </p>
        </div>
      </section>
      <section className="container page-bottom-cta">
        <div>
          <span className="eyebrow">PUT IT INTO PRACTICE</span>
          <h2>Start with one important PR.</h2>
        </div>
        <div>
          <Link href="/docs" className="button button-secondary">
            <Terminal size={16} /> Read the setup guide
          </Link>
          <Link href="/signup" className="button button-primary">
            Create a workspace <ArrowUpRight size={16} />
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
