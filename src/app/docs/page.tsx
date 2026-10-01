import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  Cpu,
  GitBranch,
  Terminal,
} from "lucide-react";
import { MarketingShell, PageIntro } from "@/components/marketing/site-shell";

export const metadata: Metadata = { title: "Documentation" };
const engine = "https://github.com/Vaidehi2510/QA-testbot";
export default function DocsPage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="DOCUMENTATION / GETTING STARTED"
        title={
          <>
            Your first review,
            <br />
            one step at a time.
          </>
        }
        description="The web workspace brings your reviews together. The QA engine reads your product, runs configured checks, and communicates with your chosen models."
      />
      <div className="container docs-layout">
        <aside className="docs-sidebar">
          <span>ON THIS PAGE</span>
          <a href="#architecture">How the pieces fit</a>
          <a href="#engine">Run the QA engine</a>
          <a href="#models">Choose a model backend</a>
          <a href="#review">Review a specific change</a>
          <a href="#browser">Add browser coverage</a>
          <a href="#workspace">Connect a workspace</a>
          <a href="#next">Go further</a>
          <div>
            <BookOpen size={18} />
            <p>Source of truth</p>
            <a href={engine} target="_blank" rel="noreferrer">
              Engine repository <ArrowUpRight size={12} />
            </a>
          </div>
        </aside>
        <div className="docs-content">
          <section id="architecture">
            <span className="eyebrow">01 / THE ARCHITECTURE</span>
            <h2>A workspace and a runner.</h2>
            <p>
              <strong>Patchsentry’s web workspace</strong> is where you organize
              review activity and inspect shared reports.{" "}
              <strong>The self-hosted QA engine</strong> runs alongside your
              repository, test environments, and model connection.
            </p>
            <div className="docs-diagram">
              <div>
                <GitBranch size={24} />
                <strong>Your product</strong>
                <span>Read access to committed code</span>
              </div>
              <span>→</span>
              <div>
                <Terminal size={24} />
                <strong>Your QA engine</strong>
                <span>Models, tests, and evidence</span>
              </div>
              <span>→</span>
              <div>
                <BookOpen size={24} />
                <strong>Your workspace</strong>
                <span>Submitted review reports</span>
              </div>
            </div>
            <p>
              Keep the QA checkout separate from your product checkout. Tests
              and browser journeys can live in the QA workspace. The bot can
              publish PR comments, labels, and statuses when configured; source
              writes are not required.
            </p>
          </section>
          <section id="engine">
            <span className="eyebrow">02 / INSTALL THE ENGINE</span>
            <h2>Start a local QA workspace.</h2>
            <p>
              Use Node.js 22.17 or later. Clone the engine into its own
              directory, install its dependencies, and start the local model
              dashboard.
            </p>
            <pre className="docs-code">
              <code>{`git clone https://github.com/Vaidehi2510/QA-testbot.git
cd QA-testbot
npm ci
npm run dashboard`}</code>
            </pre>
            <p>
              Open the localhost URL printed by the dashboard. You can browse
              model settings without running a paid review. Production
              integrations are enabled separately in the engine configuration.
            </p>
            <a
              className="text-link"
              href={`${engine}/blob/main/README.md`}
              target="_blank"
              rel="noreferrer"
            >
              Read the complete engine setup <ArrowUpRight size={14} />
            </a>
          </section>
          <section id="models">
            <span className="eyebrow">03 / MODEL CONNECTION</span>
            <h2>Hosted or local. Your choice.</h2>
            <div className="docs-options">
              <article>
                <span className="detail-icon">
                  <ArrowUpRight size={21} />
                </span>
                <h3>OpenRouter</h3>
                <p>
                  Set <code>OPENROUTER_API_KEY</code> in the engine environment.
                  Browse models, select a default or per-role model, and choose
                  a spending limit.
                </p>
                <p>
                  Selected repository context and evidence are sent to the model
                  provider.
                </p>
              </article>
              <article>
                <span className="detail-icon">
                  <Cpu size={21} />
                </span>
                <h3>A local model server</h3>
                <p>
                  Select <strong>Local model server</strong> in the engine
                  dashboard. Enter a compatible loopback <code>/v1</code>{" "}
                  address and add explicit capability profiles.
                </p>
                <p>
                  Local mode needs no OpenRouter key and has no cloud fallback.
                  Compute still has a cost.
                </p>
              </article>
            </div>
            <div className="docs-callout">
              <strong>Choose capabilities, not just a model name.</strong>
              <p>
                Agent investigations require tool calling and text input/output.
                Screenshot review also requires image input. Local profiles must
                state the actual configured context size and supported features.
              </p>
            </div>
          </section>
          <section id="review">
            <span className="eyebrow">04 / REVIEW A CHANGE</span>
            <h2>Point the engine at committed revisions.</h2>
            <p>
              With the model connection saved and enabled, run a review against
              your separate product checkout. The command reads committed
              snapshots and writes reports in the QA workspace.
            </p>
            <pre className="docs-code">
              <code>{`npm run review -- \\
  --repo /path/to/your-product \\
  --base main \\
  --head your-feature-branch`}</code>
            </pre>
            <p>
              For a PR, use the exact base and head revisions corresponding to
              that PR. Configure a trusted runner or supply revision-bound test
              results to add real test evidence. A code review without executed
              checks does not establish a QA pass.
            </p>
            <p>
              Use <code>--dry-run</code> to preview a review without model
              requests. Generated tests and fixes remain proposals. Developers
              apply changes through their normal workflow.
            </p>
            <a
              className="text-link"
              href={`${engine}/blob/main/docs/ai.md`}
              target="_blank"
              rel="noreferrer"
            >
              Model configuration and evidence formats{" "}
              <ArrowUpRight size={14} />
            </a>
          </section>
          <section id="browser">
            <span className="eyebrow">05 / UI & UX COVERAGE</span>
            <h2>Give the engine a product experience to test.</h2>
            <p>
              Configure a browser suite with a preview URL, allowed routes,
              viewports, and the journeys that matter to your product. Use test
              accounts and resettable data. The runner can collect screenshots,
              accessibility findings, page errors, and configured layout checks.
            </p>
            <ul className="docs-checklist">
              <li>
                <Check size={16} />
                Start with the critical path: signup, checkout, or your core
                workflow.
              </li>
              <li>
                <Check size={16} />
                Include desktop and mobile viewports and meaningful assertions.
              </li>
              <li>
                <Check size={16} />
                Supply product requirements so intended behavior is
                distinguishable from an improvement idea.
              </li>
              <li>
                <Check size={16} />
                Use a vision-capable model when asking the UI/UX specialist to
                inspect screenshots.
              </li>
            </ul>
            <p>
              The engine also accepts supplied screenshot evidence. Coverage is
              limited to the routes, states, and interactions that were actually
              exercised. It cannot infer every product journey from code alone.
            </p>
            <a
              className="text-link"
              href={`${engine}/tree/main/docs`}
              target="_blank"
              rel="noreferrer"
            >
              Browse execution and browser documentation{" "}
              <ArrowUpRight size={14} />
            </a>
          </section>
          <section id="workspace">
            <span className="eyebrow">06 / SHARE REVIEW ACTIVITY</span>
            <h2>Connect your review workspace.</h2>
            <p>
              Create a Patchsentry account and a workspace, then use its
              integration instructions to connect the QA engine. Keep workspace
              ingestion credentials in the engine environment, separate from
              model and repository credentials.
            </p>
            <p>
              In your project’s <strong>Integrations</strong> view, create a
              project-scoped runner token. Clone the website repository on the
              trusted runner, set <code>QA_PORTAL_TOKEN</code> as a secret, and
              use your deployed site’s origin:
            </p>
            <pre className="docs-code">
              <code>{`export QA_PORTAL_URL="https://your-patchsentry-site.example"
node scripts/agent.mjs \\
  --bot-dir /path/to/QA-testbot \\
  --watch --execute-jobs --runner-policy portal-policy.json`}</code>
            </pre>
            <p>
              Create a local portal-policy.json, install the chosen browsers, enable the model locally, and run --check-runner first. Then save trusted goals in Testing setup and request a full commit SHA from the dashboard. The connector claims enrolled jobs and uploads bounded report
              summaries. It does not run PR code on the web server. Model
              settings synchronization is opt-in; changing backends or enabling
              image sharing also requires enrollment on the runner. Keep model
              keys on that runner.
            </p>
            <a
              className="text-link"
              href="https://github.com/Vaidehi2510/patchsentry-web/blob/main/docs/agent.md"
              target="_blank"
              rel="noreferrer"
            >
              Read the connector setup and enrollment policy{" "}
              <ArrowUpRight size={14} />
            </a>
            <div className="docs-callout">
              <strong>Local models do not mean an offline portal.</strong>
              <p>
                The web workspace receives the report data you submit. Inspect
                and sanitize findings, source excerpts, screenshots, and other
                sensitive evidence before enabling report uploads.
              </p>
            </div>
            <Link className="button button-primary" href="/signup">
              Create your workspace <ArrowUpRight size={15} />
            </Link>
          </section>
          <section id="next">
            <span className="eyebrow">07 / KEEP GOING</span>
            <h2>Make the workflow your own.</h2>
            <div className="docs-resource-list">
              <Link href="/how-it-works">
                <span>
                  <strong>Understand the full QA loop</strong>
                  <small>From PR selection to an evidence-based decision</small>
                </span>
                <ArrowUpRight size={18} />
              </Link>
              <Link href="/security">
                <span>
                  <strong>Review permissions and data boundaries</strong>
                  <small>
                    Source access, model providers, execution, and reports
                  </small>
                </span>
                <ArrowUpRight size={18} />
              </Link>
              <a href={engine} target="_blank" rel="noreferrer">
                <span>
                  <strong>Inspect and configure the engine</strong>
                  <small>
                    Source code, configuration, and integration documentation
                  </small>
                </span>
                <ArrowUpRight size={18} />
              </a>
            </div>
          </section>
        </div>
      </div>
    </MarketingShell>
  );
}
