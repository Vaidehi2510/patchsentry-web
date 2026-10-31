"use client";
import {AssuranceHub} from "./assurance-hub";
import {DeviceFarm} from "./device-farm";
import {VisualBaselines} from "./visual-baselines";
import {AutomationPanel} from './automation-panel';
import {HostedRepositorySetup} from './hosted-repository-setup';
import {QualityHub,EvidencePanel} from "./quality-hub";
import {AccountSettings} from "./account-settings";
import { subjectLabel, subjectTitle, platformLabels } from "@/lib/targets";
import { releaseGate } from "@/lib/release-gate";
import { TeamOperations, JoinProject } from "./team-operations";
import { roleRank } from "@/lib/team";
import { TestLibrary } from "./test-library";
import Link from "next/link";
import { BrandMark } from "./marketing/site-shell";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  LayoutDashboard,
  ClipboardCheck,
  GitPullRequest,
  SlidersHorizontal,
  Plug,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  ShieldCheck,
  CircleCheck,
  CircleAlert,
  Clock3,
  ChevronDown,
  ChevronRight,
  LogOut,
  BookOpen,
  RefreshCw,
  X,
  Terminal,
  Copy,
  Check,
  Menu,
  Cpu,
  LockKeyhole,
  ExternalLink,
  FileCode2,
  Code2,
  AlertTriangle,
} from "lucide-react";
import type { Project, Run, RunStatus, Settings } from "@/lib/contracts";
import { demoProject, demoRuns } from "@/lib/demo";
import { ModelSettings } from "./model-settings";
import { TestingSetup, JobQueue, RunnerStatus } from "./testing-setup";
import "./workspace.css";
import { MotionToggle } from "./motion";
import { runnerOnline } from "@/lib/jobs";

type Tab = "overview" | "runs" | "models" | "testing" | "integration" | "tests" | "team" | "account" | "quality" | "automation" | "assurance";
type User = { id: string; name: string; email: string };
const nav = [
  { id: "overview" as Tab, label: "Overview", icon: LayoutDashboard },
  { id: "automation" as Tab, label: "Automation & reports", icon: Clock3 },
  { id: "assurance" as Tab, label: "Pilot & Ledger", icon: ShieldCheck },
  { id: "quality" as Tab, label: "Product QA", icon: ClipboardCheck },
  { id: "runs" as Tab, label: "QA reports", icon: GitPullRequest },
  { id: "tests" as Tab, label: "Test library", icon: Code2 },
  { id: "models" as Tab, label: "Models & agents", icon: SlidersHorizontal },
  { id: "testing" as Tab, label: "Testing setup", icon: FileCode2 },
  { id: "team" as Tab, label: "Team & operations", icon: ShieldCheck },
  { id: "integration" as Tab, label: "Integrations", icon: Plug },
];
const statusLabels: Record<RunStatus, string> = {
  passed: "Checks passed",
  failed: "Changes needed",
  blocked: "Blocked",
  running: "In progress",
  needs_review: "Needs review",
  no_checks: "No checks",
};
export async function api(path: string, options: RequestInit = {}) {
  const r = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    cache: "no-store",
  });
  let d;
  try {
    d = await r.json();
  } catch {
    throw new Error("The server returned an unexpected response.");
  }
  if (!r.ok)
    throw new Error(
      typeof d.error === "string"
        ? d.error
        : d.message || "Could not complete this request.",
    );
  return d;
}
export function Status({ run }: { run: Run }) {
  const s = run.score.status;
  return (
    <span className={`status status-${s}`}>
      {s === "passed" ? (
        <CircleCheck size={13} />
      ) : s === "running" ? (
        <Clock3 size={13} />
      ) : (
        <CircleAlert size={13} />
      )}{" "}
      {statusLabels[s]}
    </span>
  );
}

export function Workspace({ demo = false }: { demo?: boolean }) {
  const [user, setUser] = useState<User | null>(
      demo
        ? { id: "demo", name: "Alex Morgan", email: "Demo workspace" }
        : null,
    ),
    [projects, setProjects] = useState<Project[]>(demo ? [demoProject] : []),
    [projectId, setProjectId] = useState(demo ? "demo" : ""),
    [runs, setRuns] = useState<Run[]>(demo ? demoRuns : []),
    [loading, setLoading] = useState(!demo),
    [error, setError] = useState(""),
    [tab, setTab] = useState<Tab>("overview"),
    [selected, setSelected] = useState<Run | null>(null),
    [creating, setCreating] = useState(false),
    [mobile, setMobile] = useState(false),
    [accountMenu,setAccountMenu]=useState(false),
    [busy, setBusy] = useState(false);
  const project = projects.find((p) => p.id === projectId);
  useEffect(()=>{if(!accountMenu)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setAccountMenu(false);document.querySelector<HTMLButtonElement>('.account-trigger')?.focus();}};const outside=(e:PointerEvent)=>{if(!(e.target as Element).closest('.sidebar-account'))setAccountMenu(false);};document.addEventListener('keydown',key);document.addEventListener('pointerdown',outside);return()=>{document.removeEventListener('keydown',key);document.removeEventListener('pointerdown',outside);};},[accountMenu]);
  const dialogReturnFocus = useRef<HTMLElement | null>(null);
  function openProject() {
    dialogReturnFocus.current = document.activeElement as HTMLElement | null;
    setCreating(true);
  }
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  useEffect(() => {
    if (!creating) return;
    const previous = dialogReturnFocus.current;
    const dialog = document.querySelector<HTMLElement>(".workspace [role=dialog]");
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) { event.preventDefault(); setCreating(false); }
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter(el => el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); if (previous?.isConnected) previous.focus(); };
  }, [creating]);
  useEffect(() => {
    if (demo) return;
    let alive = true;
    api("/api/session")
      .then(async (d) => {
        if (!d.user) {
          location.replace(d.next || "/login");
          return;
        }
        if (!alive) return;
        setUser(d.user);
        if(sessionStorage.getItem('patchsentry-invitation')){location.replace('/invite');return;}
        const p = await api("/api/projects");
        if (alive) {
          setProjects(p.projects);
          setProjectId(p.projects.find((x:Project)=>x.id===new URLSearchParams(location.search).get("project"))?.id || p.projects[0]?.id || "");
          setLoading(false);
        }
      })
      .catch((e) => {
        if (alive) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [demo]);
  useEffect(() => {
    if (demo || !projectId) return;
    let alive = true;
    setRuns([]);
    setSelected(null);
    api(`/api/projects/${projectId}/runs`)
      .then((d) => {
        if (alive) setRuns(d.runs);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [projectId, demo]);
  useEffect(() => {
    const value = new URLSearchParams(location.search).get("tab");
    if (value==="account" || nav.some((x) => x.id === value)) setTab(value as Tab);
  }, []);
  function go(next: Tab) {
    setTab(next);setAccountMenu(false);
    setSelected(null);
    setMobile(false);
    history.replaceState(null, "", `${demo ? "/demo" : "/app"}?tab=${next}${!demo&&projectId?`&project=${encodeURIComponent(projectId)}`:""}`);
    requestAnimationFrame(() => {
      document.getElementById("workspace-title")?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    });
  }
  async function refresh() {
    if (demo) return;
    const refreshId = projectId;
    setBusy(true);
    setError("");
    try {
      const p = await api("/api/projects");
      setProjects(p.projects);
      if (!projectId || !p.projects.some((item: Project) => item.id === projectId)) setProjectId(p.projects[0]?.id || "");
      if (projectId && p.projects.some((item: Project) => item.id === projectId)) {
        const d = await api(`/api/projects/${projectId}/runs`);
        if (projectRef.current === refreshId) setRuns(d.runs);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (demo || !projectId) return;
    const timer = setInterval(() => { void refresh(); }, 30000);
    return () => clearInterval(timer);
  }, [demo, projectId]);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const { project: p } = await api("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: data.get("name"),
          repository: data.get("repository"),
        }),
      });
      setProjects((v) => [...v, p]);
      setProjectId(p.id);
      setCreating(false);
      go("overview");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const passed = runs.filter((r) => r.score.status === "passed").length,
    findings = runs.reduce((s, r) => s + r.findings.length, 0),
    blocked = runs.filter(
      (r) =>
        r.score.status === "blocked" ||
        r.score.status === "failed" ||
        r.score.status === "needs_review",
    ).length;
  return (
    <div className="workspace">
      <aside
        aria-label="Workspace navigation"
        className={`app-sidebar ${mobile ? "sidebar-open" : ""}`}
      >
        <Link className="wordmark" aria-label="Patchsentry workspace overview" href={demo?"/demo?tab=overview":"/app?tab=overview"} onClick={e=>{e.preventDefault();go("overview");}}>
          <BrandMark />
          patchsentry
        </Link>
        <div className="workspace-selector">
          <span className="workspace-avatar">
            {demo ? "A" : user?.name.slice(0, 1).toUpperCase() || "P"}
          </span>
          <div>
            <strong>
              {demo
                ? "Acme workspace"
                : user
                  ? `${user.name.split(" ")[0]}’s workspace`
                  : "Your workspace"}
            </strong>
            <small>{demo ? "Demo environment" : "Personal workspace"}</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <span className="nav-caption">WORKSPACE</span>
        <nav aria-label="Workspace navigation">
          {nav.map((n) => (
            <button
              key={n.id}
              className={tab === n.id ? "active" : ""}
              onClick={() => go(n.id)}
            >
              <n.icon size={18} />
              {n.label}
              {n.id === "runs" && (
                <span className="nav-count">{runs.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-callout">
          <ShieldCheck size={21} />
          <strong>Your code. Untouched.</strong>
          <p>
            Read access to code.
            <br />
            Evidence for every decision.
          </p>
          <Link href="/architecture#permissions">
            Our permission model <ArrowUpRight size={14} />
          </Link>
        </div>
        <nav className="sidebar-bottom">
          <Link href="/docs">
            <BookOpen size={18} />
            Documentation <ArrowUpRight size={14} />
          </Link>
          <Link href="/">
            <ArrowUpRight size={18} />
            Product website
          </Link>
        </nav>
        <div className="sidebar-account"><button className="sidebar-user account-trigger" aria-expanded={accountMenu} aria-controls="account-menu" onClick={()=>setAccountMenu(!accountMenu)}><span className="user-avatar">{user?.name.slice(0,1)||"P"}</span><span><strong>{user?.name||"Loading…"}</strong><small>{demo?"Exploring Patchsentry":user?.email}</small></span><ChevronDown size={17}/></button>{accountMenu&&<div id="account-menu" className="account-menu"><button onClick={()=>go("account")}>Manage my account</button><button onClick={()=>go("overview")}>Workspace overview</button><Link href="/architecture">How Patchsentry works</Link>{!demo&&<button onClick={async()=>{try{await api("/api/auth/sign-out",{method:"POST",body:"{}"});location.assign("/login");}catch(e){setError((e as Error).message);}}}>Sign out</button>}</div>}</div>
      </aside>
      {mobile && (
        <button
          className="sidebar-scrim"
          onClick={() => setMobile(false)}
          aria-label="Close navigation"
        />
      )}
      <div className="app-body">
        <header className="app-topbar">
          <div>
            <button
              className="mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span className="topbar-muted">Workspace</span>
            <ChevronRight size={13} />
            <strong>{tab==="account"?"My account":nav.find((n) => n.id === tab)?.label}</strong>
          </div>
          <div>
            <MotionToggle />
            <span className="version-tag">PUBLIC BETA</span>
            <Link href="/docs" className="icon-link" aria-label="Documentation">
              <BookOpen size={18} />
            </Link>
          </div>
        </header>
        {demo && (
          <div
            className="demo-banner"
            role="region"
            aria-label="Demo workspace notice"
          >
            <span>
              <span className="demo-dot" />
              You’re exploring a demo. All reports and metrics below are
              illustrative.
            </span>
            <Link href="/signup">
              Create your workspace <ArrowRight size={14} />
            </Link>
          </div>
        )}
        <main className="app-main">
          {error && (
            <div className="notice warning" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="empty-state">
              <RefreshCw size={26} />
              <h2>Opening your workspace…</h2>
            </div>
          ) : (
            <>
              {!demo && <JoinProject refresh={refresh} />}
              {project?.accessRole && project.accessRole !== "owner" && <p className="notice">Patchsentry project role: {project.accessRole === "qa" ? "QA engineer" : project.accessRole}. Your permissions control the actions available below.</p>}
              <div className="app-heading">
                <div>
                  <span className="eyebrow">
                    {demo ? "THE BIG PICTURE" : "YOUR QUALITY WORKSPACE"}
                  </span>
                  <h1 id="workspace-title" tabIndex={-1}>
                    {selected
                      ? subjectLabel(selected)
                      : tab === "assurance" ? "Earn confidence. Keep the evidence." : tab === "automation" ? "QA that keeps up with your product." : tab === "account" ? "Your account. Your control." : tab === "overview"
                        ? "Ship with your eyes open."
                        : tab === "runs"
                          ? "Every change. Every finding."
                          : tab === "models"
                            ? "Build your QA team."
                            : "Make QA part of your flow."}
                  </h1>
                  <p>
                    {selected
                      ? subjectTitle(selected)
                      : tab === "assurance" ? "Measured pilots, staged release gates and immutable assessment receipts." : tab === "automation" ? "Automatic triggers, explicit exceptions, weekly evidence and optional team updates." : tab === "account" ? "Manage your profile, sign-in security, devices and workspaces." : tab === "overview"
                        ? "A clear view of what’s ready, what’s risky, and what needs you."
                        : tab === "runs"
                          ? "Trace each result to the exact revision that was tested."
                          : tab === "models"
                            ? "Choose the intelligence. Set the boundaries. Keep the control."
                            : "Connect your product and bring its QA evidence into one place."}
                  </p>
                </div>
                <div className="heading-actions">
                  {projects.length > 0 && (
                    <label className="sr-only" htmlFor="project-switch">
                      Current project
                    </label>
                  )}
                  {projects.length > 0 && (
                    <select
                      id="project-switch"
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                    >
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    className="button button-primary"
                    onClick={() =>
                      demo ? location.assign("/signup") : openProject()
                    }
                  >
                    <Plus size={16} />
                    New project
                  </button>
                </div>
              </div>
              {tab==="account" ? <AccountSettings demo={demo} projects={projects} onProfile={name=>setUser(u=>u?{...u,name}:u)}/> : !project ? (
                <div className="empty-state large">
                  <span className="empty-icon">
                    <GitPullRequest size={28} />
                  </span>
                  <h2>Your first product starts here.</h2>
                  <p>
                    Bring a personal project or a team product. Create a project, connect OpenRouter on the website, then choose your model and checks.
                    <br />
                    Results will appear after your first PR, build, or release assessment.
                  </p>
                  <button
                    className="button button-primary"
                    onClick={openProject}
                  >
                    Create a project <ArrowRight size={16} />
                  </button>
                  <Link href="/demo">Preview a sample workspace</Link>
                </div>
              ) : selected ? (
                <RunDetail
                  projectId={project.id}
                  run={selected}
                  onBack={() => setSelected(null)}
                  demo={demo}
                />
              ) : (
                <>
                  {tab === "assurance" && <AssuranceHub key={project.id} project={project} demo={demo}/>}
                  {tab === "quality" && <QualityHub project={project} runs={runs} demo={demo} navigate={go}/>}
                  {tab === "team" && <TeamOperations key={project.id} project={project} demo={demo} />}
                  {tab === "team" && <DeviceFarm project={project} demo={demo}/>}
                  {!demo && tab === "overview" && <><section className="notice"><div><strong>Build a durable QA plan for this product.</strong><p>Connect the repository, define requirements, inspect bugs and measure outcomes in one guided workflow.</p><button className="text-button" onClick={()=>go("quality")}>Open Product QA setup →</button></div></section><ProjectSetup project={project} navigate={go} /></>}
                  {tab === 'automation' && <AutomationPanel key={project.id} project={project} demo={demo} navigate={go}/>}
                  {tab === "testing" && <fieldset className="access-controls" disabled={roleRank[project.accessRole || "owner"] < 2}><TestingSetup key={project.id} project={project} demo={demo} onSaved={value => setProjects(items => items.map(p => p.id === value.id ? value : p))} /></fieldset>}
                  {tab === "testing" && <VisualBaselines project={project} demo={demo}/>}
                  {tab === "overview" && (
                    <>
                      <div className="stat-grid">
                        <Stat
                          label="QA reports"
                          value={runs.length}
                          note="Revision-specific runs"
                          icon={<GitPullRequest size={18} />}
                        />
                        <Stat
                          label="Checks passed"
                          value={passed}
                          note="All required checks passed"
                          icon={<CircleCheck size={18} />}
                          color="green"
                        />
                        <Stat
                          label="Needs attention"
                          value={blocked}
                          note="Failures, blockers, or review"
                          icon={<CircleAlert size={18} />}
                          color="orange"
                        />
                        <Stat
                          label="Reported findings"
                          value={findings}
                          note="AI suggestions need verification"
                          icon={<Search size={18} />}
                          color="purple"
                        />
                      </div>
                      <div className="overview-columns">
                        <section className="panel reports-panel">
                          <div className="panel-heading">
                            <div>
                              <h2>Latest product assessments</h2>
                              <p>The signal behind your next release.</p>
                            </div>
                            <button
                              className="text-button"
                              onClick={() => go("runs")}
                            >
                              View all <ArrowRight size={14} />
                            </button>
                          </div>
                          <RunTable
                            runs={runs.slice(0, 5)}
                            onSelect={setSelected}
                          />
                        </section>
                        <section className="panel team-panel">
                          <span className="mini-label">YOUR QA TEAM</span>
                          <h2>
                            Five perspectives.{" "}
                            <br />
                            One clear report.
                          </h2>
                          <div className="team-list">
                            {[
                              {
                                name: "Test planner",
                                label: "Finds what needs testing",
                                icon: GitPullRequest,
                              },
                              {
                                name: "Code reviewer",
                                label: "Traces changes through code",
                                icon: FileCode2,
                              },
                              {
                                name: "Security reviewer",
                                label: "Surfaces risky boundaries",
                                icon: ShieldCheck,
                              },
                              {
                                name: "UI / UX reviewer",
                                label: "Checks the user experience",
                                icon: LayoutDashboard,
                              },
                              {
                                name: "Bug triage",
                                label: "Turns findings into next steps",
                                icon: Search,
                              },
                            ].map((r) => (
                              <div key={r.name}>
                                <span>
                                  <r.icon size={16} />
                                </span>
                                <section>
                                  <strong>{r.name}</strong>
                                  <small>{r.label}</small>
                                </section>
                                <span className="team-dot" />
                              </div>
                            ))}
                          </div>
                          <button
                            className="text-button"
                            onClick={() => go("models")}
                          >
                            Configure your team <ArrowRight size={14} />
                          </button>
                        </section>
                      </div>
                      <div className="integration-strip">
                        <span className="terminal-tile">
                          <Terminal size={22} />
                        </span>
                        <div>
                          <strong>
                            {demo
                              ? "Your workflow, with a second set of eyes."
                              : project.agentLastSeen
                                ? "Your runner has checked in."
                                : "Configure hosted QA to start collecting evidence."}
                          </strong>
                          <p>
                            {demo
                              ? "Keep GitHub as your source of truth. Bring QA into changes, builds and complete releases."
                              : project.agentLastSeen
                                ? `Last heartbeat: ${new Date(project.agentLastSeen).toLocaleString()}`
                                : "Hosted workers inspect your source and disposable preview, then publish results here."}
                          </p>
                        </div>
                        <button
                          className="button button-secondary"
                          onClick={() => go("integration")}
                        >
                          {demo ? "See how it connects" : "Set up integration"}
                          <ArrowUpRight size={16} />
                        </button>
                      </div>
                      <div className="score-explainer">
                        <ShieldCheck size={16} />
                        <span>
                          Scores measure passed required checks, not certainty
                          that a product is bug-free. Blocked and skipped checks
                          remain in the denominator.
                        </span>
                      </div>
                    </>
                  )}
                  {tab === "runs" && (
                    <Reports
                      runs={runs}
                      onSelect={setSelected}
                      refresh={refresh}
                      busy={busy}
                      demo={demo}
                    />
                  )}
                  {tab === "tests" && <fieldset className="access-controls" disabled={project.accessRole === "viewer"}><TestLibrary key={project.id} project={project} demo={demo} /></fieldset>}
                  {tab === "models" && (
                    <fieldset className="access-controls" disabled={roleRank[project.accessRole || "owner"] < 2}><ModelSettings
                      key={project.id}
                      project={project}
                      demo={demo}
                      onSave={(p) =>
                        setProjects((v) =>
                          v.map((x) => (x.id === p.id ? p : x)),
                        )
                      }
                    /></fieldset>
                  )}
                  {(tab === "overview" || tab === "runs") && <details className="qa-request-details"><summary><GitPullRequest size={19} /><span>Request a QA assessment<small>{demo ? "Preview PR, build and release requests" : "Test a pull request, build or complete release version"}</small></span><ChevronDown size={18} /></summary><fieldset className="access-controls" disabled={project.accessRole === "viewer"}><JobQueue key={project.id} project={project} demo={demo} runs={runs} openRun={setSelected} refresh={refresh} /></fieldset></details>}
                  {tab === "integration" && (
                    <fieldset className="access-controls" disabled={(project.accessRole || "owner") !== "owner"}><Integration
                      key={project.id}
                      project={project}
                      demo={demo}
                      refresh={refresh}
                    /></fieldset>
                  )}
                </>
              )}
            </>
          )}
          <footer className="app-footer">
            <span>
              <ShieldCheck size={13} /> Product code is never modified by
              Patchsentry.
            </span>
            <Link href="/docs">
              Need a hand? Read the docs <ArrowUpRight size={13} />
            </Link>
          </footer>
        </main>
      </div>
      {creating && (
        <div
          className="modal-backdrop"
          onClick={() => !busy && setCreating(false)}
        >
          <section
            className="modal project-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="Close"
              disabled={busy}
              onClick={() => setCreating(false)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">YOUR NEXT PRODUCT</span>
            <h2 id="project-title">Create a project</h2>
            <p>
              Create a QA workspace for a personal or team repository.
            </p>
            <p className="fineprint">Verified MFA is required. <Link href="/app?tab=account">Verify MFA in My account</Link> if you used a remembered browser.</p>
            <form onSubmit={create}>
              <div className="project-form-fields">
                <label>
                  Project name
                  <input
                    name="name"
                    required
                    maxLength={80}
                    placeholder="My storefront"
                    autoFocus
                  />
                </label>
                <label>
                  GitHub repository
                  <input
                    name="repository"
                    required
                    pattern="(?:[A-Za-z0-9_.]|-)+/(?:[A-Za-z0-9_.]|-)+"
                    maxLength={201}
                    placeholder="your-username/your-project"
                  />
                </label>
                <p className="fineprint"><LockKeyhole size={14} /> Public or private repositories. Creating a workspace does not grant GitHub access.</p>
                <details className="project-access-help"><summary>Repository access and ownership</summary><p>You become the Patchsentry workspace owner. A repository administrator must separately authorize its read-only GitHub connection. Repository permissions stay unchanged.</p></details>
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
              </div>
              <div className="project-form-actions">
                <button
                  className="button button-primary auth-submit"
                  disabled={busy}
                >
                  {busy ? "Creating…" : "Create project"}
                  <ArrowRight size={16} />
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
function ProjectSetup({ project, navigate }: { project: Project; navigate: (tab: Tab) => void }) {
  const steps: { title: string; text: string; done: boolean; tab: Tab }[] = [
    { title: "Connect your AI provider", text: "Paste and verify your OpenRouter key on the website. Hosted web QA needs no local connector.", done: project.executionMode === "hosted", tab: "models" },
    { title: "Choose your AI", text: "Pick a compatible local model or browse OpenRouter models.", done: Boolean(project.settings.model), tab: "models" },
    { title: "Define your test coverage", text: "Set browser goals, or enroll API/native suites and CI results for your product.", done: Boolean(project.testingProfile?.previewUrlTemplate && project.testingProfile.goals.goals.length || project.runner?.ready && project.runner.baselineSuites && project.runner.platforms?.some(p => p !== "web")), tab: "testing" },
  ];
  const complete = steps.filter(s => s.done).length;
  if (complete === steps.length) return null;
  return <section className="setup-checklist" aria-labelledby="setup-title"><div className="setup-checklist-heading"><div><span className="eyebrow">YOUR FIRST REVIEW, STEP BY STEP</span><h2 id="setup-title">Let’s connect the pieces.</h2><p>Personal project or team product—the setup is the same.</p></div><span>{complete} of 3 ready</span></div><div className="setup-checklist-grid">{steps.map((step, i) => <button key={step.tab} onClick={() => navigate(step.tab)}><span className={step.done ? "setup-done" : ""}>{step.done ? <Check size={18} /> : String(i + 1).padStart(2, "0")}</span><strong>{step.title}</strong><p>{step.text}</p><span className="setup-link">{step.done ? "Review setup" : "Get started"}<ArrowRight size={16} /></span></button>)}</div></section>;
}
function Stat({
  label,
  value,
  note,
  icon,
  color = "",
}: {
  label: string;
  value: number;
  note: string;
  icon: React.ReactNode;
  color?: string;
}) {
  return (
    <section className="stat-card">
      <div>
        <span>{label}</span>
        <span className={`stat-icon ${color}`}>{icon}</span>
      </div>
      <strong>{value.toString().padStart(2, "0")}</strong>
      <small>{note}</small>
    </section>
  );
}
function RunTable({
  runs,
  onSelect,
}: {
  runs: Run[];
  onSelect: (r: Run) => void;
}) {
  return runs.length ? (
    <div className="run-list">
      {runs.map((run) => (
        <button
          className="run-row"
          key={run.recordId}
          onClick={() => onSelect(run)}
        >
          <span className={`pr-icon ${run.score.status}`}>
            <GitPullRequest size={20} />
          </span>
          <span className="run-title">
            <strong>{subjectTitle(run)}</strong>
            <span>
              <code>{subjectLabel(run)}</code>
              <span>·</span>
              <span>{run.revision.slice(0, 7)}</span>
              <span>·</span>
              <span>
                {new Date(run.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </span>
          </span>
          <span className="run-status">
            <Status run={run} />
            <span>
              {run.score.passed}/{run.score.total} required checks passed
            </span>
          </span>
          <span className={`run-score ${run.score.status}`}>
            {run.score.score ?? "—"}
            <small>/100</small>
          </span>
          <ChevronRight size={16} />
        </button>
      ))}
    </div>
  ) : (
    <div className="empty-state">
      <GitPullRequest size={24} />
      <h3>No reports yet</h3>
      <p>Connect OpenRouter, save your preview and expectations, then request QA to see real results here.</p>
    </div>
  );
}
function Reports({
  runs,
  onSelect,
  refresh,
  busy,
  demo,
}: {
  runs: Run[];
  onSelect: (r: Run) => void;
  refresh: () => void;
  busy: boolean;
  demo: boolean;
}) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all");
  const filtered = runs.filter(
    (r) =>
      (filter === "all" || r.score.status === filter) &&
      `${subjectTitle(r)} ${subjectLabel(r)} ${r.revision}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className="panel">
      <div className="report-toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Search QA reports"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title, PR, or commit…"
          />
        </label>
        <select
          aria-label="Filter reports by status"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All statuses</option>
          {Object.entries(statusLabels).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        {!demo && (
          <button
            className="button button-secondary"
            onClick={refresh}
            disabled={busy}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        )}
      </div>
      <RunTable runs={filtered} onSelect={onSelect} />
      <div className="table-footer">
        {filtered.length} of {runs.length} reports · Scores include every
        required check
      </div>
    </section>
  );
}
function RunDetail({
  projectId,
  run,
  onBack,
  demo,
}: {
  projectId:string;
  run: Run;
  onBack: () => void;
  demo: boolean;
}) {
  return (
    <>
      <button className="text-button back-report" onClick={onBack}>
        ← Back to reports
      </button>
      <div className="detail-summary panel">
        <div>
          <Status run={run} />
          <h2>{subjectTitle(run)}</h2>
          <p>
            {run.repository} · <code>{run.revision.slice(0, 12)}</code> ·{" "}
            {new Date(run.createdAt).toLocaleString()}
          </p>
          {run.people && <p className="fineprint">Requested by {run.people.requestedBy || 'not recorded'}{run.people.author ? ` · PR author ${run.people.author}` : ''}{run.people.mergedBy ? ` · merged by ${run.people.mergedBy}` : ''}{run.people.releasedBy ? ` · released by ${run.people.releasedBy}` : ''}{run.people.builtBy ? ` · built by ${run.people.builtBy}` : ''} · identity source: {run.people.source}</p>}
          {!demo && (
            <a
              href={run.pr ? `https://github.com/${run.repository}/pull/${run.pr.number}` : `https://github.com/${run.repository}/commit/${run.revision}`}
              target="_blank"
              rel="noreferrer"
              className="text-button"
            >
              {run.pr ? "Open pull request" : "Open source revision"} <ExternalLink size={14} />
            </a>
          )}
        </div>
        <div className={`score-circle ${run.score.status}`}>
          <strong>{run.score.score ?? "—"}</strong>
          <span>check score</span>
        </div>
      </div>
      {run.executionEvidence&&run.executionEvidence.status!=='verified'&&<section className="notice"><h2>Execution scope needs attention</h2><p>The check score counts the reported checks. It does not establish that every requested test ran or authorize a release.</p><ul>{run.executionEvidence.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul></section>}
      <section className="panel"><EvidencePanel root={`/api/projects/${projectId}`} recordId={run.recordId} demo={demo}/></section>
      {run.target && <section className="panel release-summary"><div><span className="eyebrow">VERSION-LEVEL QA</span><h2>{releaseGate(run, { revision: run.revision, target: run.target }).eligible ? "Assessment checks passed · release policy still applies" : "Release gate needs attention"}</h2><p>Platform: {platformLabels[run.target.platform]} · {run.target.kind === 'release' ? 'Version' : 'Build'}: {run.target.name}</p><label>Exact artifact SHA-256<code>{run.target.artifactSha256}</code></label><p className="fineprint">Use the deployment gate against the same artifact before shipping. It never deploys the product or changes its source.</p></div><ul>{releaseGate(run, { revision: run.revision, target: run.target }).reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></section>}
      <div className="detail-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Required checks</h2>
              <p>
                {run.score.passed} passed · {run.score.failed} failed ·{" "}
                {run.score.blocked} blocked · {run.score.pending} pending
              </p>
            </div>
          </div>
          <div className="checks-list">
            {run.checks.map((check) => (
              <div key={check.id}>
                <span className={`check-icon ${check.status}`}>
                  {check.status === "passed" ? (
                    <CircleCheck size={19} />
                  ) : check.status === "pending" ||
                    check.status === "running" ? (
                    <Clock3 size={19} />
                  ) : (
                    <CircleAlert size={19} />
                  )}
                </span>
                <div>
                  <strong>{check.name}</strong>
                  <p>
                    {check.details ||
                      `${check.method} check · ${check.required ? "required" : "optional"}`}
                  </p>
                </div>
                <span className="check-label">
                  {check.status.replaceAll("_", " ")}
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel evidence-panel">
          <span className="mini-label">RUN CONTEXT</span>
          <h3>Evidence over assumptions.</h3>
          <dl>
            <dt>Revision</dt>
            <dd>
              <code>{run.revision.slice(0, 12)}</code>
            </dd>
            <dt>Model backend</dt>
            <dd>{run.ai.backend}</dd>
            <dt>Model</dt>
            <dd>{run.ai.model || "Not reported"}</dd>
            <dt>Model calls</dt>
            <dd>{run.ai.calls}</dd>
            <dt>Provider cost</dt>
            <dd>
              {run.ai.costUsd === null
                ? "Not reported"
                : `$${run.ai.costUsd.toFixed(4)}${run.ai.costIsEstimate ? " (estimated)" : ""}`}
            </dd>
          </dl>
          <p className="fineprint">
            Local hardware and runner costs are separate. Uploaded summaries
            exclude raw logs and screenshots; detailed evidence remains with
            your runner.
          </p>
        </section>
      </div>
      <section className="panel findings-panel">
        <div className="panel-heading">
          <div>
            <h2>Findings & suggested fixes</h2>
            <p>
              Review these suggestions against the evidence before changing your
              product.
            </p>
          </div>
          <span className="nav-count">{run.findings.length}</span>
        </div>
        {run.findings.length ? (
          run.findings.map((f, i) => (
            <article className="finding" key={i}>
              <div className="finding-heading">
                <span className={`severity severity-${f.severity}`}>
                  {f.severity}
                </span>
                <span>{f.category}</span>
                <span className="unverified">Unverified suggestion</span>
              </div>
              <h3>{f.title}</h3>
              {f.file && <code className="finding-file">{f.file}</code>}
              <p>{f.description}</p>
              {f.suggestedFix && (
                <div className="suggested-fix">
                  <strong>
                    <Cpu size={15} /> Suggested next step
                  </strong>
                  <p>{f.suggestedFix}</p>
                </div>
              )}
            </article>
          ))
        ) : (
          <div className="empty-state">
            <CircleCheck size={25} />
            <p>
              No findings were reported for this run. Coverage remains limited
              to the checks performed.
            </p>
          </div>
        )}
      </section>
      {run.limitations.length > 0 && (
        <section className="notice limitations">
          <AlertTriangle size={18} />
          <div>
            <strong>Coverage & limitations</strong>
            <ul>
              {run.limitations.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}
function Integration({
  project,
  demo,
  refresh,
}: {
  project: Project;
  demo: boolean;
  refresh: () => void;
}) {
  const [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false),
    [confirm, setConfirm] = useState(false), [advanced,setAdvanced]=useState(false);
  async function rotate() {
    setBusy(true);
    setError("");
    try {
      const d = await api(`/api/projects/${project.id}/token`, {
        method: "POST",
        body: "{}",
      });
      setToken(d.token);
      setConfirm(false);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const origin =
    typeof window !== "undefined"
      ? location.origin
      : "https://YOUR-PATCHSENTRY-SITE";
  if(project.settings.backend==='openrouter'&&!advanced)return <div className="quality-hub"><section className="panel operations-panel"><span className="eyebrow">HOSTED QA · NO CUSTOMER INFRASTRUCTURE</span><h2>Run QA from your browser</h2><p>In Models &amp; agents, paste and verify your OpenRouter key. Save your model selection, then add a public disposable preview and expected behavior in Testing setup.</p><p>Patchsentry provisions an isolated cloud worker for each requested run. You do not need a runner token, a connector command, Docker, or an always-on computer.</p><div className="notice"><p>{project.executionMode==='hosted'?'Hosted execution is selected. Request a run after saving your model, preview and expectations.':'First verify your OpenRouter key in Models & agents to select hosted execution. No runner connection is required.'}</p></div><p className="fineprint">Hosted web testing reads public or connected private GitHub repositories. Builds/releases also require an immutable public artifact URL. Private repositories can connect read access below. Authored Node tests run in an offline hosted VM; managed native testing uses your AWS Device Farm account. Local-only models and private suites can use the optional advanced runner.</p><button className="button button-secondary" onClick={async()=>{try{if(!demo){await api(`/api/projects/${project.id}`,{method:'PATCH',body:JSON.stringify({executionMode:'self-hosted'})});refresh();}setAdvanced(true);}catch(e){setError((e as Error).message);}}}>Advanced: configure a private-network or self-hosted runner</button>{error&&<p className="form-error" role="alert">{error}</p>}</section><HostedRepositorySetup projectId={project.id} repository={project.repository} demo={demo}/></div>;
  return (
    <div className="integration-layout">
      <section className="panel integration-main">
        <RunnerStatus project={project} />
        <div className="panel-heading">
          <div>
            <span className="mini-label">YOUR PRODUCT</span>
            <h2>{project.repository}</h2>
            <p>
              {project.agentLastSeen
                ? `Last connected ${new Date(project.agentLastSeen).toLocaleString()}`
                : "Waiting for a trusted QA runner"}
            </p>
          </div>
          <span
            className={`status ${project.agentLastSeen ? "status-passed" : "status-blocked"}`}
          >
            {project.agentLastSeen ? "Has connected" : "Not connected"}
          </span>
        </div>
        <div className="setup-steps">
          <article>
            <span className="step-number">1</span>
            <div>
              <h3>Set up the QA engine</h3>
              <p>
                Use the separate bot repository to configure read access to your
                product and the checks it should run. GitHub comments, labels,
                and statuses are optional.
              </p>
              <a
                className="text-button"
                href="https://github.com/Vaidehi2510/QA-testbot"
                target="_blank"
                rel="noreferrer"
              >
                Open the QA engine <ArrowUpRight size={14} />
              </a>
            </div>
          </article>
          <article>
            <span className="step-number">2</span>
            <div>
              <h3>Create a runner token</h3>
              <p>
                This project-scoped token lets your runner read settings, claim enrolled jobs,
                and upload reports. Save it as a secret on the runner.
              </p>
              {demo ? (
                <Link className="button button-secondary" href="/signup">
                  Create an account to connect <ArrowRight size={14} />
                </Link>
              ) : token ? (
                <div className="token-reveal">
                  <strong>Copy now. This token is shown once.</strong>
                  <code>{token}</code>
                  <button
                    className="button button-secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(token);
                        setCopied(true);
                      } catch {
                        setError(
                          "Clipboard unavailable. Select and copy the token manually.",
                        );
                      }
                    }}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
                    {copied ? "Copied" : "Copy token"}
                  </button>
                  <button className="text-button" onClick={() => setToken("")}>
                    Hide token
                  </button>
                </div>
              ) : confirm ? (
                <div className="notice warning">
                  <p>
                    Rotating disconnects runners using the previous token.
                    Update their secret after copying the new token.
                  </p>
                  <button
                    className="button button-primary"
                    disabled={busy}
                    onClick={rotate}
                  >
                    Rotate token
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setConfirm(false)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() =>
                    project.tokenConfigured ? setConfirm(true) : rotate()
                  }
                >
                  <LockKeyhole size={15} />
                  {busy
                    ? "Creating…"
                    : project.tokenConfigured
                      ? "Rotate runner token"
                      : "Create runner token"}
                </button>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </div>
          </article>
          <article>
            <span className="step-number">3</span>
            <div>
              <h3>Enroll your local runner</h3>
              <p>Create <code>portal-policy.json</code> in the separate bot checkout. Adjust the product path and preview origin, install the selected browsers, and enable the model locally. This website does not provision runner infrastructure.</p>
              <details><summary>Show a conservative local enrollment policy</summary><pre className="code-block"><code>{JSON.stringify({ schemaVersion: 1, repository: project.repository, repoCheckout: "/ABSOLUTE/path/to/product", base: project.testingProfile?.baseRef || "main", allowedPreviewOrigins: ["https://pr-{pr}.preview.example"], allowedBrowsers: ["chromium"], allowedBackends: [project.settings.backend], maxPages: 4, maxGoals: 8, maxAssertions: 30, maxCostUsd: project.settings.maxCostUsd, maxCallsPerRun: project.settings.maxCallsPerRun, allowImages: false, allowMutations: false, allowSemanticMaintenance: false, executeBaseline: false, timeoutMs: 900000, configPath: "qa-config.json", regressionDir: ".qa-regressions" }, null, 2)}</code></pre></details>
              <details><summary>Enroll build / release QA and authored tests</summary><p>Start with a reviewed baseline test suite and dependency image in the bot configuration. Then explicitly add the platforms you intend to test and a separate builder-manifest directory. Authored tests are optional and always container-isolated.</p><pre className="code-block"><code>{JSON.stringify({ allowedPlatforms: ["web"], releaseManifestDir: ".qa-build-manifests", executeBaseline: true, allowWorkspaceTests: false, allowedPreviewOrigins: ["https://preview.example"] }, null, 2)}</code></pre><p>Set <code>allowWorkspaceTests: true</code> locally only if you want to execute tests explicitly enabled in the website test library. Save CI manifests under their artifact digest. The engine documentation describes the required fields and deployment gate.</p><a className="text-button" href="https://github.com/Vaidehi2510/QA-testbot/blob/main/docs/releases.md" target="_blank" rel="noreferrer">Read build, platform and gate setup <ArrowUpRight size={14}/></a></details>
              <p>Run the offline prerequisite check first:</p><pre className="code-block"><code>{`node scripts/agent.mjs --bot-dir /path/to/QA-testbot --execute-jobs --runner-policy portal-policy.json --check-runner`}</code></pre>
              <p>
                Clone the website repository on your trusted runner. Set{" "}
                <code>QA_PORTAL_TOKEN</code> in its environment, then run:
              </p>
              <pre className="code-block">
                <code>{`export QA_PORTAL_URL="${origin}"\nnode scripts/agent.mjs \\\n  --bot-dir /path/to/QA-testbot \\\n  --watch --execute-jobs --runner-policy portal-policy.json`}</code>
              </pre>
              <p className="fineprint">
                Keep <code>OPENROUTER_API_KEY</code> or your local model
                credentials in the runner environment, or use Models &amp; agents for verified, encrypted delivery to your enrolled runner.
                Uploaded summaries can contain product information.
              </p>
              <a
                className="text-button"
                href="https://github.com/Vaidehi2510/patchsentry-web/blob/main/docs/agent.md"
                target="_blank"
                rel="noreferrer"
              >
                Read connector setup and local model policy{" "}
                <ArrowUpRight size={14} />
              </a>
            </div>
          </article>
          <article>
            <span className="step-number">4</span>
            <div>
              <h3>Choose a change, build or release</h3>
              <p>
                Save a preview URL, browser engines, and trusted goals in Testing setup.
                Request a PR with its number and commit, or a build/release with its name, platform, exact artifact digest and source commit.
                Your enrolled runner claims the job, executes the reviewed engine, and uploads results.
                Missing prerequisites remain blocked; the web server does not execute product code.
              </p>
              <Link className="text-button" href="/docs">
                Review the full integration guide <ArrowRight size={14} />
              </Link>
            </div>
          </article>
        </div>
      </section>
      <aside aria-label="Integration permissions">
        <section className="panel permissions-card">
          <ShieldCheck size={24} />
          <h3>A clear permission boundary.</h3>
          <ul>
            <li>
              <Check size={15} /> Read product source
            </li>
            <li>
              <Check size={15} /> Test an isolated snapshot
            </li>
            <li>
              <Check size={15} /> Comment on pull requests
            </li>
            <li>
              <Check size={15} /> Publish labels and statuses
            </li>
            <li className="permission-denied">
              <X size={15} /> Edit or push product code
            </li>
            <li className="permission-denied">
              <X size={15} /> Merge pull requests
            </li>
          </ul>
        </section>
        <section className="panel privacy-note">
          <Cpu size={22} />
          <h3>Running a local model?</h3>
          <p>
            Your runner connects to Ollama or LM Studio on its own machine. Only
            declared model capabilities and bounded QA summaries are sent to
            this portal.
          </p>
          <p>
            Local inference keeps model requests local. Uploading reports is a
            separate choice.
          </p>
          <Link href="/security" className="text-button">
            Read the data boundary <ArrowUpRight size={14} />
          </Link>
        </section>
      </aside>
    </div>
  );
}
