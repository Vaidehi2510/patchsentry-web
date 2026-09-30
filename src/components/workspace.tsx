"use client";
import Link from "next/link";
import { BrandMark } from "./marketing/site-shell";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  LayoutDashboard,
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
  AlertTriangle,
} from "lucide-react";
import type { Project, Run, RunStatus, Settings } from "@/lib/contracts";
import { demoProject, demoRuns } from "@/lib/demo";
import { ModelSettings } from "./model-settings";
import "./workspace.css";

type Tab = "overview" | "runs" | "models" | "integration";
type User = { id: string; name: string; email: string };
const nav = [
  { id: "overview" as Tab, label: "Overview", icon: LayoutDashboard },
  { id: "runs" as Tab, label: "PR reports", icon: GitPullRequest },
  { id: "models" as Tab, label: "Models & agents", icon: SlidersHorizontal },
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
    [busy, setBusy] = useState(false);
  const project = projects.find((p) => p.id === projectId);
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  useEffect(() => {
    if (demo) return;
    let alive = true;
    api("/api/session")
      .then(async (d) => {
        if (!d.user) {
          location.replace("/login");
          return;
        }
        if (!alive) return;
        setUser(d.user);
        const p = await api("/api/projects");
        if (alive) {
          setProjects(p.projects);
          setProjectId(p.projects[0]?.id || "");
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
    if (nav.some((x) => x.id === value)) setTab(value as Tab);
  }, []);
  function go(next: Tab) {
    setTab(next);
    setSelected(null);
    setMobile(false);
    history.replaceState(null, "", `${demo ? "/demo" : "/app"}?tab=${next}`);
  }
  async function refresh() {
    if (demo) return;
    const refreshId = projectId;
    setBusy(true);
    setError("");
    try {
      const p = await api("/api/projects");
      setProjects(p.projects);
      if (projectId) {
        const d = await api(`/api/projects/${projectId}/runs`);
        if (projectRef.current === refreshId) setRuns(d.runs);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
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
      go("integration");
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
        <Link className="wordmark" href="/">
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
          <Link href="/security">
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
        <div className="sidebar-user">
          <span className="user-avatar">{user?.name.slice(0, 1) || "P"}</span>
          <div>
            <strong>{user?.name || "Loading…"}</strong>
            <small>{demo ? "Exploring Patchsentry" : user?.email}</small>
          </div>
          {!demo && (
            <button
              aria-label="Sign out"
              onClick={async () => {
                try {
                  await api("/api/auth/sign-out", {
                    method: "POST",
                    body: "{}",
                  });
                  location.assign("/login");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          )}
        </div>
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
            <strong>{nav.find((n) => n.id === tab)?.label}</strong>
          </div>
          <div>
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
              <div className="app-heading">
                <div>
                  <span className="eyebrow">
                    {demo ? "THE BIG PICTURE" : "YOUR QUALITY WORKSPACE"}
                  </span>
                  <h1>
                    {selected
                      ? `Pull request #${selected.pr.number}`
                      : tab === "overview"
                        ? "Ship with your eyes open."
                        : tab === "runs"
                          ? "Every change. Every finding."
                          : tab === "models"
                            ? "Build your QA team."
                            : "Make QA part of your flow."}
                  </h1>
                  <p>
                    {selected
                      ? selected.pr.title
                      : tab === "overview"
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
                      demo ? location.assign("/signup") : setCreating(true)
                    }
                  >
                    <Plus size={16} />
                    New project
                  </button>
                </div>
              </div>
              {!project ? (
                <div className="empty-state large">
                  <span className="empty-icon">
                    <GitPullRequest size={28} />
                  </span>
                  <h2>Your first product starts here.</h2>
                  <p>
                    Create a project, select your model, and connect a QA
                    runner.
                    <br />
                    Results will appear after your first PR check.
                  </p>
                  <button
                    className="button button-primary"
                    onClick={() => setCreating(true)}
                  >
                    Create a project <ArrowRight size={16} />
                  </button>
                  <Link href="/demo">Preview a sample workspace</Link>
                </div>
              ) : selected ? (
                <RunDetail
                  run={selected}
                  onBack={() => setSelected(null)}
                  demo={demo}
                />
              ) : (
                <>
                  {tab === "overview" && (
                    <>
                      <div className="stat-grid">
                        <Stat
                          label="PR reports"
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
                              <h2>Latest pull requests</h2>
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
                                : "Connect a runner to start collecting evidence."}
                          </strong>
                          <p>
                            {demo
                              ? "Keep GitHub as your source of truth. Bring QA into every pull request."
                              : project.agentLastSeen
                                ? `Last heartbeat: ${new Date(project.agentLastSeen).toLocaleString()}`
                                : "The runner reads your product and publishes bounded reports to this workspace."}
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
                  {tab === "models" && (
                    <ModelSettings
                      key={project.id}
                      project={project}
                      demo={demo}
                      onSave={(p) =>
                        setProjects((v) =>
                          v.map((x) => (x.id === p.id ? p : x)),
                        )
                      }
                    />
                  )}
                  {tab === "integration" && (
                    <Integration
                      key={project.id}
                      project={project}
                      demo={demo}
                      refresh={refresh}
                    />
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
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="Close"
              onClick={() => setCreating(false)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">YOUR NEXT PRODUCT</span>
            <h2 id="project-title">Create a project</h2>
            <p>
              Register the repository you want to test. Access is configured
              separately on your trusted runner.
            </p>
            <form onSubmit={create}>
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
                  pattern="[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+"
                  maxLength={201}
                  placeholder="your-org/your-product"
                />
              </label>
              <p className="fineprint">
                <LockKeyhole size={14} /> This does not grant GitHub access or
                change repository permissions.
              </p>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="button button-primary auth-submit"
                disabled={busy}
              >
                {busy ? "Creating…" : "Create project"}
                <ArrowRight size={16} />
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
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
            <strong>{run.pr.title}</strong>
            <span>
              <code>#{run.pr.number}</code>
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
      <p>Connect a runner and test your first PR to see real results here.</p>
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
      `${r.pr.title} ${r.pr.number} ${r.revision}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className="panel">
      <div className="report-toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Search PR reports"
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
  run,
  onBack,
  demo,
}: {
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
          <h2>{run.pr.title}</h2>
          <p>
            {run.repository} · <code>{run.revision.slice(0, 12)}</code> ·{" "}
            {new Date(run.createdAt).toLocaleString()}
          </p>
          {!demo && (
            <a
              href={`https://github.com/${run.repository}/pull/${run.pr.number}`}
              target="_blank"
              rel="noreferrer"
              className="text-button"
            >
              Open pull request <ExternalLink size={14} />
            </a>
          )}
        </div>
        <div className={`score-circle ${run.score.status}`}>
          <strong>{run.score.score ?? "—"}</strong>
          <span>check score</span>
        </div>
      </div>
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
    [confirm, setConfirm] = useState(false);
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
  return (
    <div className="integration-layout">
      <section className="panel integration-main">
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
                This project-scoped token lets your runner read model settings
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
              <h3>Start the outbound connector</h3>
              <p>
                Clone the website repository on your trusted runner. Set{" "}
                <code>QA_PORTAL_TOKEN</code> in its environment, then run:
              </p>
              <pre className="code-block">
                <code>{`export QA_PORTAL_URL="${origin}"\nnode scripts/agent.mjs \\\n  --bot-dir /path/to/QA-testbot \\\n  --watch --apply-model-settings`}</code>
              </pre>
              <p className="fineprint">
                Keep <code>OPENROUTER_API_KEY</code> or your local model
                credentials on the runner. The website never needs those keys.
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
              <h3>Choose the PRs and run QA</h3>
              <p>
                Configure the bot’s PR scope or trigger a review on your runner.
                The connector publishes reports here as checks complete. This
                portal does not execute untrusted PR code on the web server.
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
