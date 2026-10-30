import Link from "next/link";
import { MarketingShell,PageIntro } from "@/components/marketing/site-shell";
import { TeamAccessGuide } from "@/components/team-access-guide";

export const metadata = { title: "How Patchsentry fits together" };
export default function Architecture() {
  return (
    <MarketingShell><PageIntro eyebrow="A PRACTICAL CONNECTION GUIDE" title={<>One workspace.<br/>Managed QA execution.</>} description="Patchsentry coordinates QA. The separate QA engine runs it. Your product stays in its own repository."/>
      <div className="container section architecture-guide">
        <div className="docs-content">
          <section>
            <h2>The everyday flow</h2><p>Connect OpenRouter, select models, save a public preview and test expectations, and request QA on the website. Patchsentry provisions and stops hosted web workers. Keep the connector only if you need local models, private-network access or native device suites.</p>
            <ol>
              <li>
                Your product repository contains your application. Give the QA
                runner read access and provide an authorized disposable preview
                or exact build artifact.
              </li>
              <li>
                The <strong>patchsentry-web</strong> repository runs this
                website and its backend: accounts, team roles, test drafts,
                model selections, QA requests, results and optional Slack
                settings. Its current production database is Postgres on Neon.
              </li>
              <li>
                The <strong>QA-testbot</strong> repository contains the
                execution engine: code inspection, AI specialists, browser
                checks, isolated tests and evidence. Patchsentry installs a pinned engine version in a managed worker for hosted web QA. You do not need to install this repository yourself.
              </li>
              <li>
                For optional private/self-hosted execution, the connector from{" "}
                <code>patchsentry-web/scripts/agent.mjs</code> runs on that same
                trusted machine. It polls the website for jobs, invokes the QA
                engine under a locally reviewed policy, and uploads bounded
                result summaries. Hosted mode uses managed workers that fetch committed Git objects in isolated storage. The website server does not execute product code.
              </li>
              <li>
                Read the outcome in this dashboard. Optional Slack updates and
                GitHub comments/checks report evidence; they never change
                product code. GitHub publishing needs its separately configured
                app/connector permissions.
              </li>
            </ol>
          </section>
          <section>
            <h2>What is Patchsentry Ledger?</h2>
            <p>
              <strong>Patchsentry-Ledger-Java</strong> is an optional Java 21 /
              Spring Boot report service, with Postgres for report/check
              records, MongoDB for evidence and Redis for rate limiting. It
              stores, validates and scores reports; it does not run tests or
              provide this website’s account system.
            </p>
            <p>
              The current website and connector do not call Ledger. Their
              reports are stored directly through the website backend. You do
              not need to deploy Ledger to use the current product. Connecting
              it later requires a deliberate report API/authentication adapter;
              simply deploying both does not connect them.
            </p>
          </section>
          <section id="permissions">
            <h2>Who can connect a product?</h2>
            <p>
              A repository administrator, or an authorized person delegated by
              them, should set up the GitHub app/runner and its secrets. Keep
              source access read-only. GitHub write permission alone does not
              make someone a Patchsentry owner, and a Patchsentry invite does
              not grant repository access. Registering a repository name here is
              not a GitHub ownership check.
            </p>
            <TeamAccessGuide />
          </section>
          <section>
            <h2>Company domains and private spaces</h2>
            <p>
              In My account, owners/admins can associate a work domain with a
              product and prove control using a DNS TXT record. Each project
              already has a private workspace link. Only invited members can
              open its data. Domain verification does not enable SSO, automatic
              joining, a custom hostname, or access to GitHub secrets.
            </p>
          </section>
          <section>
            <h2>Start with two repositories</h2>
            <p>
              Use the website plus QA-testbot for today’s workflow. Keep the
              product separate and read-only. Keep Ledger optional until you
              need and implement its separate service integration.
            </p>
            <Link href="/app?tab=integration" className="button button-primary">
              Open integration setup
            </Link>
          </section>
        </div>
      </div>
    </MarketingShell>
  );
}
