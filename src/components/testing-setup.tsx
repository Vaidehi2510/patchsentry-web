"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Play, Plus, RefreshCw, Trash2, CircleCheck, CircleAlert } from "lucide-react";
import type { Project, Run } from "@/lib/contracts";
import { TestingProfileSchema, browsers, runnerOnline, testingDefaults, type Job, type TestingProfile } from "@/lib/jobs";

async function request(url: string, method = "GET", body?: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, cache: "no-store", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || "The request could not be completed."); return value;
}
const newGoal = () => ({ id: `goal-${Date.now()}`, name: "", start: "/", requirement: "", inputs: {} as Record<string, string>, assertions: [{ id: "expected-outcome", action: "expectText" as const, selector: '[role="status"]', text: "", exact: true }] });
function syntheticInputText(profile: TestingProfile) { return Object.fromEntries(profile.goals.goals.map(g => [g.id, Object.entries(g.inputs).map(([key, value]) => `${key}=${value}`).join("\n")])); }
function parseSyntheticInputs(value: string) { const entries = value.split(/\r?\n/).filter(line => line.trim()).map(line => { const at = line.indexOf("="); if (at < 1) throw new Error("Each synthetic input needs key=value on its own line."); return [line.slice(0, at).trim(), line.slice(at + 1)]; }); if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Error("Synthetic input names must be unique."); return Object.fromEntries(entries); }

export function RunnerStatus({ project }: { project: Project }) {
  const online = runnerOnline(project.agentLastSeen);
  const ready = online && project.runner?.ready;
  return <div className={`notice ${ready ? "" : "warning"}`}><span>{ready ? <CircleCheck size={19} /> : <CircleAlert size={19} />}</span><div>
    <strong>{!online ? "Runner offline" : ready ? "Runner online · execution enrolled" : "Runner online · setup incomplete"}</strong>
    <p>{project.agentLastSeen ? `Last heartbeat ${new Date(project.agentLastSeen).toLocaleString()}. ` : "No runner heartbeat yet. "}A heartbeat is current for 90 seconds.</p>
    {online && project.runner?.missing.length ? <ul>{project.runner.missing.map((item, i) => <li key={i}>{item}</li>)}</ul> : null}
    {ready && <p>Enrolled: {project.runner!.browsers.join(", ")} · up to {project.runner!.maxPages} pages · ${project.runner!.maxCostUsd} provider cost and {project.runner!.maxCallsPerRun} model calls per job. Local compute costs are separate.</p>}
  </div></div>;
}

export function TestingSetup({ project, demo, onSaved }: { project: Project; demo: boolean; onSaved: (project: Project) => void }) {
  const [profile, setProfile] = useState<TestingProfile>(project.testingProfile || testingDefaults);
  const [pages, setPages] = useState(profile.pages.join("\n"));
  const [inputText, setInputText] = useState<Record<string, string>>(() => syntheticInputText(profile));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  useEffect(() => { const next = project.testingProfile || testingDefaults; setProfile(next); setPages(next.pages.join("\n")); setInputText(syntheticInputText(next)); setSaved(false); }, [project.id]);
  function goal(index: number, update: Partial<TestingProfile["goals"]["goals"][number]>) { setProfile(p => ({ ...p, goals: { ...p.goals, goals: p.goals.goals.map((g, i) => i === index ? { ...g, ...update } : g) } })); }
  async function save(event: FormEvent) {
    event.preventDefault(); setError(""); setSaved(false);
    let goals;
    try { goals = profile.goals.goals.map(g => ({ ...g, inputs: parseSyntheticInputs(inputText[g.id] || "") })); } catch (e) { setError((e as Error).message); return; }
    const parsed = TestingProfileSchema.safeParse({ ...profile, goals: { ...profile.goals, goals }, pages: pages.split(/\r?\n/).map(v => v.trim()).filter(Boolean) });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || "Check the testing profile."); return; }
    if (demo) { setError("Demo configuration is illustrative. Create an account to save a real testing profile."); return; }
    setBusy(true);
    try { const result = await request(`/api/projects/${project.id}`, "PATCH", { testingProfile: parsed.data }); onSaved(result.project); setSaved(true); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="testing-layout"><RunnerStatus project={project} /><form className="panel testing-form" onSubmit={save}>
    <div className="panel-heading"><div><h2>Preview and browser coverage</h2><p>Define trusted expected behavior. The runner reads the product and plans bounded browser journeys around these expectations.</p></div></div>
    <div className="testing-fields"><label>Preview URL template<input required value={profile.previewUrlTemplate} placeholder="https://pr-{pr}.preview.example" onChange={e => setProfile({ ...profile, previewUrlTemplate: e.target.value })} /><small>Use {"{pr}"} or {"{sha}"}. The origin must also be enrolled on the runner. Never use production accounts or data.</small></label>
      <label>Base branch or revision<input required value={profile.baseRef} onChange={e => setProfile({ ...profile, baseRef: e.target.value })} /><small>Must match the runner policy. Commits must already exist in its read-only product checkout.</small></label>
      <label>Starting pages, one path per line<textarea rows={3} value={pages} onChange={e => setPages(e.target.value)} /></label>
      <label>Maximum discovered pages<input type="number" min={1} max={8} value={profile.maxPages} onChange={e => setProfile({ ...profile, maxPages: Number(e.target.value) })} /></label>
    </div>
    <label className="testing-checkbox"><input type="checkbox" checked={profile.discoverPages} onChange={e => setProfile({ ...profile, discoverPages: e.target.checked })} />Discover same-origin pages and expandable controls within this budget</label>
    <fieldset><legend>Browser engines</legend><div className="testing-inline">{browsers.map(browser => <label className="testing-checkbox" key={browser}><input type="checkbox" checked={profile.browsers.includes(browser)} onChange={e => setProfile({ ...profile, browsers: e.target.checked ? [...profile.browsers, browser] : profile.browsers.filter(value => value !== browser) })} />{browser}</label>)}</div><p className="fineprint">Each selected engine must be installed and enrolled on your runner. This does not provision a hosted browser or physical device.</p></fieldset>
    <label className="testing-checkbox"><input type="checkbox" checked={profile.allowMutations} onChange={e => setProfile({ ...profile, allowMutations: e.target.checked })} />Allow synthetic form submissions to this disposable preview</label><p className="fineprint">Off by default. The local policy must independently permit preview mutations. This never authorizes product source changes.</p>
    <label className="testing-checkbox"><input type="checkbox" checked={profile.visualRegression} onChange={e => setProfile({ ...profile, visualRegression: e.target.checked })} />Compare screenshots with locally accepted visual baselines</label><p className="fineprint">Requires a locally enrolled baseline directory. Missing baselines block the comparison until a reviewer accepts them on the runner; the website cannot silently accept a changed UI.</p>
    <label className="testing-checkbox"><input type="checkbox" checked={profile.goals.allowSemanticMaintenance} onChange={e => setProfile({ ...profile, goals: { ...profile.goals, allowSemanticMaintenance: e.target.checked } })} />Allow constrained maintenance of retained browser journeys</label><p className="fineprint">Requires matching local enrollment. Expected business outcomes remain the trusted assertions above; a failing product must not be changed into a passing test.</p>
    <div className="panel-heading"><div><h2>Trusted user goals and expected outcomes</h2><p>Describe the user task, then state what success must show. Expected outcomes are supplied by you, not inferred from the current UI.</p></div><button className="button button-secondary" type="button" disabled={profile.goals.goals.length >= 8} onClick={() => setProfile({ ...profile, goals: { ...profile.goals, goals: [...profile.goals.goals, newGoal()] } })}><Plus size={15} />Add goal</button></div>
    {!profile.goals.goals.length && <p className="notice warning">Add at least one goal with an explicit assertion before requesting a run.</p>}
    {profile.goals.goals.map((g, i) => <fieldset className="goal-card" key={g.id}><legend>Goal {i + 1}</legend><div className="testing-fields">
      <label>Goal name<input required maxLength={120} value={g.name} placeholder="A new user can sign up" onChange={e => goal(i, { name: e.target.value })} /></label>
      <label>Start path<input required value={g.start} onChange={e => goal(i, { start: e.target.value })} /></label>
      <label className="full-width">Task and product requirement<textarea required maxLength={1000} rows={3} value={g.requirement} placeholder="A visitor creates an account with a synthetic email and reaches the welcome screen." onChange={e => goal(i, { requirement: e.target.value })} /></label>
      <label className="full-width">Synthetic inputs (key=value, one per line)<textarea rows={2} value={inputText[g.id] || ""} placeholder="email=qa-user@example.test" onChange={e => setInputText(values => ({ ...values, [g.id]: e.target.value }))} /></label>
      {g.assertions.map((a, j) => <div className="assertion-fields full-width" key={a.id}><label>Expected outcome<select value={a.action} onChange={e => { const action = e.target.value as typeof a.action; const assertions = [...g.assertions]; assertions[j] = action === "expectUrl" ? { id: a.id, action, path: "/welcome" } : { id: a.id, action, selector: '[role="status"]', ...(action === "expectText" ? { text: "", exact: true } : {}) }; goal(i, { assertions }); }}><option value="expectText">Element shows expected text</option><option value="expectUrl">Browser reaches expected path</option><option value="expectVisible">Element is visible</option></select></label>
        {a.action === "expectUrl" ? <label>Expected path<input required value={a.path || ""} onChange={e => goal(i, { assertions: g.assertions.map((v, n) => n === j ? { ...v, path: e.target.value } : v) })} /></label> : <><label>Element selector<input required value={a.selector || ""} placeholder="body" onChange={e => goal(i, { assertions: g.assertions.map((v, n) => n === j ? { ...v, selector: e.target.value } : v) })} /></label>{a.action === "expectText" && <label>Exact expected text<input required maxLength={500} value={a.text || ""} placeholder="Welcome to your account" onChange={e => goal(i, { assertions: g.assertions.map((v, n) => n === j ? { ...v, text: e.target.value } : v) })} /></label>}</>}
        {a.action === "expectText" && <label className="testing-checkbox"><input type="checkbox" checked={a.exact !== false} onChange={e => goal(i, { assertions: g.assertions.map((v, n) => n === j ? { ...v, exact: e.target.checked } : v) })} />Match the element's complete text (uncheck for contains)</label>}
        {g.assertions.length > 1 && <button type="button" className="text-button" onClick={() => goal(i, { assertions: g.assertions.filter((_, n) => n !== j) })}>Remove assertion</button>}</div>)}
      <div className="testing-inline full-width"><button type="button" className="button button-secondary" disabled={g.assertions.length >= 8 || profile.goals.goals.reduce((n, entry) => n + entry.assertions.length, 0) >= 30} onClick={() => goal(i, { assertions: [...g.assertions, { id: `assertion-${Date.now()}`, action: "expectText", selector: '[role="status"]', text: "", exact: true }] })}>Add assertion</button><button type="button" className="text-button" onClick={() => setProfile({ ...profile, goals: { ...profile.goals, goals: profile.goals.goals.filter((_, index) => index !== i) } })}><Trash2 size={14} />Remove goal</button></div>
    </div></fieldset>)}
    {error && <p className="form-error" role="alert">{error}</p>}{saved && <p role="status">Testing profile saved. New jobs use this version; queued jobs retain their original profile.</p>}
    <button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save testing profile"}</button>
  </form></div>;
}

export function JobQueue({ project, demo, runs, openRun, refresh }: { project: Project; demo: boolean; runs: Run[]; openRun: (run: Run) => void; refresh: () => void }) {
  const [jobs, setJobs] = useState<Job[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [pr, setPr] = useState(""), [revision, setRevision] = useState("");
  const submission = useRef<{ identity: string; dedupeKey: string } | null>(null);
  const submitting = useRef(false);
  async function reload() { if (!demo) { const data = await request(`/api/projects/${project.id}/jobs`); setJobs(data.jobs); } }
  useEffect(() => { let alive = true; setJobs([]); const load = () => { if (!demo) request(`/api/projects/${project.id}/jobs`).then(data => { if (alive) setJobs(data.jobs); }).catch(e => { if (alive) setError(e.message); }); }; load(); const timer = setInterval(load, 15000); return () => { alive = false; clearInterval(timer); }; }, [project.id, demo]);
  async function submit(event: FormEvent) { event.preventDefault(); if (demo) { setError("Create a real project and enroll a runner to execute QA."); return; } if (submitting.current) return; submitting.current = true; setBusy(true); setError(""); const identity = `${project.id}:${pr}:${revision.toLowerCase()}`; if (submission.current?.identity !== identity) submission.current = { identity, dedupeKey: crypto.randomUUID() }; try { await request(`/api/projects/${project.id}/jobs`, "POST", { prNumber: Number(pr), revision: revision.toLowerCase(), dedupeKey: submission.current.dedupeKey }); await reload(); submission.current = null; refresh(); } catch (e) { setError((e as Error).message); } finally { submitting.current = false; setBusy(false); } }
  async function action(job: Job, kind: "retry" | "cancel") { setBusy(true); setError(""); try { await request(`/api/projects/${project.id}/jobs/${job.id}/${kind}`, "POST", {}); await reload(); refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <section className="panel job-queue"><div className="panel-heading"><div><h2>Run QA on your enrolled runner</h2><p>Jobs use the saved profile, model settings, and exact commit. Product code stays unchanged.</p></div><button className="button button-secondary" onClick={() => reload().catch(e => setError(e.message))} disabled={demo}><RefreshCw size={15} />Refresh</button></div>
    <form className="job-request" onSubmit={submit}><label>PR number<input required type="number" min={1} max={100000000} value={pr} onChange={e => setPr(e.target.value)} placeholder="42" /></label><label>Full commit SHA<input required pattern="[a-fA-F0-9]{40}" minLength={40} maxLength={40} value={revision} onChange={e => setRevision(e.target.value)} placeholder="40-character commit SHA" /></label><button className="button button-primary" disabled={busy}><Play size={15} />{busy ? "Requesting…" : "Request QA run"}</button></form>
    <p className="fineprint">Fetch the exact commit through your trusted checkout setup first. A missing runner or incomplete testing profile creates a visible blocked request. An expired lease needs explicit retry; it never silently repeats paid model calls.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!jobs.length ? <p className="empty-state">No requested jobs yet. Existing synced reports remain available below.</p> : <div className="job-list">{jobs.map(job => <article key={job.id}><div><strong>PR #{job.pr.number} · {job.revision.slice(0, 12)}</strong><span className={`status status-${job.status === "completed" ? "running" : job.status === "running" || job.status === "queued" ? "running" : "blocked"}`}>{job.status === "completed" ? "Execution finished" : job.status}</span><p>{job.message || "Waiting for the enrolled runner."}</p><small>{new Date(job.createdAt).toLocaleString()} · {job.attempts}/3 attempts</small></div><div className="testing-inline">{["blocked", "failed"].includes(job.status) && job.attempts < 3 && <button className="button button-secondary" disabled={busy} onClick={() => action(job, "retry")}>Retry explicitly</button>}{["queued", "running", "blocked"].includes(job.status) && <button className="text-button" disabled={busy} onClick={() => action(job, "cancel")}>Cancel</button>}{job.recordId && <button className="button button-secondary" onClick={async () => { const run = runs.find(r => r.recordId === job.recordId); if (run) openRun(run); else { try { const result = await request(`/api/projects/${project.id}/runs`); const report = result.runs.find((r: Run) => r.recordId === job.recordId); if (report) openRun(report); else setError("The completed report is not available yet. Refresh shortly."); } catch (e) { setError((e as Error).message); } } }}>View report</button>}</div></article>)}</div>}
  </section>;
}
