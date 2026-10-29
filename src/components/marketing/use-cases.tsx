"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Code2, GitPullRequest, Laptop, LockKeyhole, Sprout, Users } from "lucide-react";
const scenarios = {
  personal: {
    title: "Your ambition. A second set of eyes.",
    text: "Build the side project, portfolio, or open-source tool you've been thinking about. Get a structured review without needing a QA department.",
    bullets: ["Use a personal, school, or work email", "Connect public or private repositories", "Run a compatible local model on your own machine"],
    project: "My weekend project", branch: "feature/first-release", icon: Sprout,
    checks: ["Investigate the changed code", "Test the configured user journey", "Review the mobile experience"],
    note: "A focused QA workspace for independent builders.",
  },
  team: {
    title: "A clearer handoff. A calmer release.",
    text: "Review your team's changes, builds and complete versions with repeatable checks and findings tied to each artifact. Bring the results into your existing pull-request workflow.",
    bullets: ["Connect an organization repository through your runner", "Choose hosted or local models for the project", "Keep a QA expert involved where judgment matters"],
    project: "Our next product release", branch: "feature/checkout-update", icon: Users,
    checks: ["Review the complete candidate build", "Replay the regression journeys", "Check the release gate before deployment"],
    note: "Project access is managed by its account owner; team invitations are not yet available.",
  },
};
export function UseCases() {
  const [active, setActive] = useState<keyof typeof scenarios>("personal");
  const scenario = scenarios[active];
  return <section id="for-you" className="section use-cases-section">
    <div className="container">
      <div className="section-heading split-heading"><div><span className="eyebrow">BIG IDEAS COME IN EVERY SIZE</span><h2>For the things<br /><span className="muted-heading">you’re building.</span></h2></div><p>One developer or a growing team. A private experiment or a public contribution. Make quality part of how you build.</p></div>
      <div className="use-case-tabs" role="group" aria-label="Choose a project example">
        <button aria-pressed={active === "personal"} onClick={() => setActive("personal")}><Laptop size={19} /> Just me & my ideas</button>
        <button aria-pressed={active === "team"} onClick={() => setActive("team")}><Users size={19} /> My team & our product</button>
      </div>
      <div className="use-case-card" data-scenario={active}>
        <div className="use-case-copy" key={active}><span className="use-case-icon"><scenario.icon size={29} /></span><h3>{scenario.title}</h3><p>{scenario.text}</p><ul>{scenario.bullets.map(text => <li key={text}><Check size={18} />{text}</li>)}</ul><Link className="text-link" href="/signup">Find your next step <ArrowUpRight size={18} /></Link></div>
        <div className="use-case-illustration"><div className="use-case-window"><div className="use-case-window-bar"><span /><span /><span /><small>ILLUSTRATIVE WORKFLOW</small></div><div className="use-case-project"><scenario.icon size={23} /><strong>{scenario.project}</strong><LockKeyhole size={17} /></div><p className="use-case-branch"><GitPullRequest size={16} />{scenario.branch}</p><div className="release-pipeline" aria-hidden="true"><span /><i /><span /><i /><span /></div><div className="use-case-checks">{scenario.checks.map((text, i) => <div key={text} style={{ "--step": i } as React.CSSProperties}><span><Check size={15} /></span>{text}</div>)}</div><div className="use-case-evidence"><Code2 size={18} /> Evidence for your decision. Your code stays yours.</div></div><p>{scenario.note}</p></div>
      </div>
    </div>
  </section>;
}
