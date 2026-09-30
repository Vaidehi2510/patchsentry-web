import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  Code2,
  Cpu,
  Eye,
  Fingerprint,
  GitBranch,
  GitPullRequest,
  Layers3,
  ListChecks,
  LockKeyhole,
  MessageSquare,
  MonitorCheck,
  ScanEye,
  ShieldCheck,
  Sparkles,
  Terminal,
  Workflow,
} from "lucide-react";
import { MarketingShell } from "@/components/marketing/site-shell";
import { ReviewPreview } from "@/components/marketing/review-preview";

const roles = [
  {
    icon: ListChecks,
    number: "01",
    title: "Test planner",
    text: "Turns the diff into a plan. Finds the paths, boundaries, and requirements that need attention.",
  },
  {
    icon: Code2,
    number: "02",
    title: "Code reviewer",
    text: "Reads beyond changed lines. Traces surrounding behavior and suggests focused fixes.",
  },
  {
    icon: ShieldCheck,
    number: "03",
    title: "Security reviewer",
    text: "Looks for broken trust boundaries, sensitive data exposure, and missing access checks.",
  },
  {
    icon: ScanEye,
    number: "04",
    title: "UI / UX reviewer",
    text: "Inspects interface code and screenshot evidence for visual and usability concerns.",
  },
  {
    icon: MessageSquare,
    number: "05",
    title: "Bug triage",
    text: "Connects failed checks to likely causes, reproduction evidence, and next steps.",
  },
];
const steps = [
  {
    icon: GitBranch,
    title: "Connect your product",
    text: "Give the engine read access to your repository. Run it alongside your product, with checks kept in the QA workspace.",
  },
  {
    icon: Cpu,
    title: "Build your QA team",
    text: "Choose OpenRouter or a local model server. Assign specialists and set investigation limits.",
  },
  {
    icon: GitPullRequest,
    title: "Choose a change",
    text: "Select a PR or committed revision. Review the exact change against configured tests and browser journeys.",
  },
  {
    icon: CheckCheck,
    title: "Decide with evidence",
    text: "See failures, screenshots, findings, and proposed fixes. Bring in a human when a decision needs context.",
  },
];
export default function HomePage() {
  return (
    <MarketingShell>
      <section className="hero-section">
        <div className="hero-grid-bg" aria-hidden="true" />
        <div className="container hero-grid">
          <div className="hero-copy">
            <div className="hero-announcement">
              <span className="status-pulse" /> YOUR NEXT QA TEAM IS SOFTWARE{" "}
              <ArrowUpRight size={12} />
            </div>
            <h1>
              Ship the change.
              <br />
              <span>Catch the risk.</span>
            </h1>
            <p className="hero-description">
              A thoughtful QA team for every pull request.
              <br className="desktop-break" /> Inspect code, test the
              experience, and find the bugs
              <br className="desktop-break" /> hiding between “it works” and
              ready to ship.
            </p>
            <div className="hero-cta">
              <Link className="button button-primary" href="/signup">
                Start your workspace <ArrowUpRight size={16} />
              </Link>
              <Link className="button button-secondary" href="/demo">
                Explore the demo <ArrowRight size={15} />
              </Link>
            </div>
            <div className="hero-assurance">
              <span>
                <Check size={13} /> No source-code edits
              </span>
              <span>
                <Check size={13} /> Your choice of model
              </span>
            </div>
            <div className="hero-little-note">
              <span className="note-line" />
              Built for builders. Backed by evidence.
            </div>
          </div>
          <ReviewPreview />
        </div>
      </section>
      <section className="capability-strip" aria-label="Product capabilities">
        <div className="container capability-inner">
          <div className="capability-intro">
            A smaller team.
            <br />
            <strong>A sharper review.</strong>
          </div>
          <div>
            <strong>
              5<span>specialists</span>
            </strong>
            <p>One coordinated QA workflow</p>
          </div>
          <div>
            <strong>
              2<span>model backends</span>
            </strong>
            <p>OpenRouter or your local server</p>
          </div>
          <div>
            <strong>
              0<span>source edits</span>
            </strong>
            <p>Your product stays yours</p>
          </div>
          <span className="capability-decoration" aria-hidden="true">
            ✳
          </span>
        </div>
      </section>
      <section id="features" className="section features-section">
        <div className="container">
          <div className="section-heading split-heading">
            <div>
              <span className="eyebrow">MORE THAN A CODE REVIEW</span>
              <h2>
                The whole change.
                <br />
                <span className="muted-heading">Not just the diff.</span>
              </h2>
            </div>
            <p>
              Good QA connects what changed to what could break. Patchsentry
              brings code investigation, real checks, and interface evidence
              into one review.
            </p>
          </div>
          <div className="feature-bento">
            <article className="feature-card feature-code">
              <div className="feature-icon">
                <Code2 size={21} />
              </div>
              <h3>Context before conclusions.</h3>
              <p>
                Specialists read surrounding code, requirements, and test
                results. Findings point back to the evidence that supports them.
              </p>
              <div className="code-visual" aria-hidden="true">
                <div className="code-visual-header">
                  <span />
                  <span />
                  <span />
                  <small>checkout/shipping.ts</small>
                </div>
                <div>
                  <i>21</i>
                  <code>
                    <b>export function</b> deliveryFee(total) &#123;
                  </code>
                </div>
                <div className="code-highlight">
                  <i>22</i>
                  <code>
                    {" "}
                    <b>return</b> total &gt; 100 ? 0 : 8;
                  </code>
                  <span className="code-mark">✦</span>
                </div>
                <div>
                  <i>23</i>
                  <code>&#125;</code>
                </div>
                <div className="code-annotation">
                  <Sparkles size={13} />
                  <span>Check the exact $100 boundary.</span>
                </div>
              </div>
              <span className="illustration-label">ILLUSTRATIVE FINDING</span>
            </article>
            <article className="feature-card feature-browser">
              <div className="feature-icon">
                <MonitorCheck size={21} />
              </div>
              <h3>Look at the experience.</h3>
              <p>
                Run configured browser journeys, capture desktop and mobile
                screenshots, and check accessibility, layout, and broken assets.
              </p>
              <div className="browser-visual" aria-hidden="true">
                <div className="browser-window">
                  <div className="browser-bar">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="browser-mock-nav">
                    <strong>studio.</strong>
                    <span>Shop &nbsp; About</span>
                  </div>
                  <div className="browser-product">
                    <div className="product-shape">
                      <span />
                    </div>
                    <div>
                      <small>THE EVERYDAY EDIT</small>
                      <strong>Less, but better.</strong>
                      <span className="mock-line" />
                      <span className="mock-line short" />
                      <span className="mock-button">Explore collection ↗</span>
                    </div>
                  </div>
                </div>
                <div className="phone-window">
                  <div className="phone-notch" />
                  <strong>studio.</strong>
                  <div className="phone-product" />
                  <div className="phone-line" />
                  <div className="phone-line short" />
                  <div className="phone-button" />
                </div>
                <div className="browser-check">
                  <Check size={12} /> Multiple viewports
                </div>
              </div>
              <span className="illustration-label">
                CONFIGURED JOURNEYS · ILLUSTRATIVE UI
              </span>
            </article>
            <article className="feature-card feature-evidence">
              <div className="feature-icon">
                <Fingerprint size={21} />
              </div>
              <h3>A verdict you can trace.</h3>
              <p>
                Test results establish pass or fail. AI findings stay clearly
                labeled. Every review belongs to the revision it actually
                inspected.
              </p>
              <div className="evidence-stack">
                <span>
                  <GitPullRequest size={15} />
                  <span>
                    PR #142 <small>checkout improvements</small>
                  </span>
                  <Check size={14} />
                </span>
                <span>
                  <Fingerprint size={15} />
                  <span>
                    Revision <code>8a4f2d1</code>
                  </span>
                  <Check size={14} />
                </span>
                <span>
                  <Layers3 size={15} />
                  <span>Tests + screenshots + findings</span>
                  <Check size={14} />
                </span>
              </div>
            </article>
            <article className="feature-card feature-local">
              <div className="feature-icon">
                <Cpu size={21} />
              </div>
              <h3>Your models. Your call.</h3>
              <p>
                Choose hosted models through OpenRouter or run compatible models
                on your own machine. Local mode has no cloud fallback.
              </p>
              <div className="model-choice">
                <span>
                  <span className="model-symbol">↗</span>OpenRouter
                  <small>Hosted models</small>
                </span>
                <span>
                  <Terminal size={21} />
                  Local server<small>Your compute</small>
                </span>
              </div>
            </article>
            <article className="feature-card feature-human">
              <div className="feature-icon">
                <Eye size={21} />
              </div>
              <h3>Humans at the right moments.</h3>
              <p>
                Keep a QA expert in the loop for ambiguous requirements and
                consequential findings. Routine checks can run without a manual
                walkthrough.
              </p>
              <div className="human-question">
                <span className="question-avatar">?</span>
                <div>
                  <strong>One decision needs your context.</strong>
                  <p>Should the discount apply before delivery?</p>
                  <span>
                    Requirement clarification <ArrowUpRight size={11} />
                  </span>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>
      <section className="section team-section">
        <div className="container team-layout">
          <div className="team-copy">
            <span className="eyebrow">A TEAM, NOT A SINGLE PROMPT</span>
            <h2>
              Different perspectives.
              <br />
              <span className="muted-heading">One quality bar.</span>
            </h2>
            <p>
              Five specialists investigate through bounded read and search
              tools. They can choose trusted suites, review results, and propose
              fixes without rewriting your product.
            </p>
            <Link href="/how-it-works" className="text-link">
              Meet your review workflow <ArrowUpRight size={15} />
            </Link>
            <div className="team-orbit" aria-hidden="true">
              <div className="orbit-line" />
              <div className="orbit-line inner" />
              <span className="orbit-core">
                <Sparkles size={25} />
              </span>
              {roles.map(({ icon: Icon, number }, i) => (
                <span className={`orbit-agent orbit-agent-${i}`} key={number}>
                  <Icon size={20} />
                </span>
              ))}
              <span className="orbit-label">
                COORDINATED, BOUNDED, TRACEABLE
              </span>
            </div>
          </div>
          <div className="role-list">
            {roles.map(({ icon: Icon, number, title, text }) => (
              <article key={number} className="team-role">
                <span className="role-number">{number}</span>
                <span className="role-icon">
                  <Icon size={20} />
                </span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
                <ArrowUpRight size={15} className="role-arrow" />
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="section workflow-section">
        <div className="container">
          <div className="section-heading">
            <span className="eyebrow">
              FROM PULL REQUEST TO CLEAR NEXT STEP
            </span>
            <h2>
              A review that fits
              <br />
              the way you already ship.
            </h2>
          </div>
          <div className="workflow-grid">
            {steps.map(({ icon: Icon, title, text }, index) => (
              <article className="workflow-step" key={title}>
                <div className="workflow-top">
                  <span className="workflow-number">0{index + 1}</span>
                  <Icon size={22} />
                  {index < 3 && (
                    <ArrowRight size={17} className="workflow-arrow" />
                  )}
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
          <div className="workflow-note">
            <LockKeyhole size={17} />
            <p>
              <strong>Read your code. Respect your boundaries.</strong> Optional
              PR comments, labels, and statuses communicate results. Your source
              files, branches, and commits stay untouched.
            </p>
            <Link href="/security">
              See the boundaries <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>
      </section>
      <section className="section honest-section">
        <div className="container honest-layout">
          <div>
            <span className="eyebrow">
              BUILT TO BE USEFUL. DESIGNED TO BE HONEST.
            </span>
            <h2>
              Less repetitive QA.
              <br />
              More informed shipping.
            </h2>
          </div>
          <div>
            <p>
              Automate the repeatable work: reading changes, running your
              checks, inspecting UI evidence, and collecting actionable
              findings. Save your expert’s time for the decisions that need
              product judgment.
            </p>
            <p>
              Coverage comes from your requirements, environments, configured
              journeys, and test suites. No model can promise to find every bug.
              Patchsentry makes the gaps visible.
            </p>
            <div className="open-source-note">
              <Workflow size={19} />
              <span>
                <strong>Start with the self-hosted QA engine.</strong> No engine
                license charge. You cover the models and compute you choose.
              </span>
            </div>
          </div>
        </div>
      </section>
      <section className="final-cta-section">
        <div className="container final-cta">
          <span className="cta-asterisk" aria-hidden="true">
            ✳
          </span>
          <span className="eyebrow">MAKE CONFIDENCE PART OF YOUR WORKFLOW</span>
          <h2>
            Your next release
            <br />
            deserves a second look.
          </h2>
          <p>Bring your product. Build your QA team. Ship with evidence.</p>
          <div className="hero-cta">
            <Link href="/signup" className="button button-primary">
              Start your workspace <ArrowUpRight size={16} />
            </Link>
            <Link href="/demo" className="button button-secondary">
              Take a look first <ArrowRight size={15} />
            </Link>
          </div>
          <span className="cta-footnote">
            No source-code edits. No forced model choice.
          </span>
        </div>
      </section>
    </MarketingShell>
  );
}
