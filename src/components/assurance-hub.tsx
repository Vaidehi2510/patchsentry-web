"use client";
import { useEffect, useState } from "react";
import type { Project } from "@/lib/contracts";
import {PilotEvaluation} from "./pilot-evaluation";
import benchmark from "@/data/todomvc-benchmark.json";
async function call(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Could not update assurance.");
  return data;
}
const percent = (v: number | null | undefined) =>
  v == null ? "Not measured" : (v * 100).toFixed(1) + "%";
export function AssuranceHub({
  project,
  demo,
}: {
  project: Project;
  demo: boolean;
}) {
  const root = `/api/projects/${project.id}`,
    owner = (project.accessRole || "owner") === "owner",
    manage = ["owner", "admin"].includes(project.accessRole || "owner"),
    qa = ["owner", "admin", "qa"].includes(project.accessRole || "owner");
  const [state, setState] = useState<any>(null),
    [ledger, setLedger] = useState<any>(null),
    [policy, setPolicy] = useState<any>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [verify, setVerify] = useState<any>(null),
    [name, setName] = useState(""),
    [revision, setRevision] = useState(""),
    [cases, setCases] = useState(""),
    [partition,setPartition]=useState("development"),
    [records, setRecords] = useState<Record<string, string>>({}),
    [origin, setOrigin] = useState(""),
    [token, setToken] = useState(""),
    [consent, setConsent] = useState(false),
    [provenance, setProvenance] = useState({
      recordId: "",
      runId: "",
      artifactId: "",
    }),
    [reviewDoc, setDocument] = useState({
      kind: "security-review",
      title: "",
      issuer: "",
      artifactSha256: "",
      reference: "",
      conclusion: "",
    });
  async function load() {
    if (demo) return;
    const [a, l] = await Promise.all([
      call(root + "/assurance"),
      call(root + "/ledger"),
    ]);
    setState(a);
    setPolicy(a.policy);
    setLedger(l);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [root, demo]);
  async function action(fn: () => Promise<unknown>, success: string) {
    if (demo) {
      setMessage(
        "Use a real project to register evidence. This example does not qualify a production gate.",
      );
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      await load();
      setMessage(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const controls = benchmark.results.filter((r) => r.expected === "passed"),
    seeds = benchmark.results.filter((r) => r.expected === "failed"),
    matched = benchmark.results.filter((r) => r.expected === r.actual).length;
  return (
    <div className="quality-hub">
      <section className="panel operations-panel">
        <span className="eyebrow">PILOT TO PRODUCTION</span>
        <h2>Earn confidence before enforcing release gates</h2>
        <p>
          Advisory assessments report findings without authorizing deployment.
          Enforced gates require independently reviewed production labels,
          measured outcomes, reviewed evidence and exact build provenance.
        </p>
        <div className="testing-fields">
          <p>
            <strong>
              {state?.policy.mode === "enforced" ? "Enforced" : "Advisory"}
            </strong>
            <br />
            Release policy
          </p>
          <p>
            <strong>{percent(state?.productionMetrics.recall)}</strong>
            <br />
            Recall on labeled cases
          </p>
          <p>
            <strong>{percent(state?.productionMetrics.falseAlarmRate)}</strong>
            <br />
            False alarms on verified clean controls
          </p>
          <p>
            <strong>{percent(state?.productionMetrics.reliability)}</strong>
            <br />
            Execution completeness
          </p>
        </div>
        {state && (
          <>
            <p>
              {state.productionMetrics.cases} registered production cases ·{" "}
              {state.costs.assessments} distinct assessments ·{" "}
              {state.productionMetrics.missed} observed misses ·{" "}
              {state.productionMetrics.unverifiedDefects} unverified defect
              cases. Distinct labeled defect IDs: {state.uniqueDefects?.labeledIds??0}; executions without a distinct defect ID: {state.uniqueDefects?.executionsWithoutDefectId??0}. Held-out cases: {state.heldOutMetrics?.cases??0}. Browser repeats are executions, not distinct defects.
            </p>
            <p>
              Known inference: ${state.costs.knownInferenceUsd.toFixed(4)}.
              Unknown infrastructure cost: {state.costs.unknownInfrastructure}{" "}
              assessments. Estimated inference runs:{" "}
              {state.costs.estimatedInference}. Unknown values are not zero.
            </p>
            <ul>
              {state.reasons.map((r: string) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        )}
      </section>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <section className="panel operations-panel">
        <span className="eyebrow">MEASURED PUBLIC BENCHMARK</span>
        <h2>TodoMVC controlled pilot</h2>
        <p>
          {matched}/{benchmark.results.length} targeted outcomes matched ·{" "}
          {seeds.filter((r) => r.actual === "failed").length}/{seeds.length}{" "}
          seeded-defect executions detected ·{" "}
          {controls.filter((r) => r.actual === "failed").length} unexpected
          failures among {controls.length} scoped clean controls.
        </p>
        <p>
          Chromium, Firefox and WebKit; desktop/mobile; repeated journeys.
          Source stayed unchanged. Five seeded fault types were exercised. This
          is scoped functional/layout measurement, not 78 passing full-product
          assessments. Pre-existing accessibility/asset findings remain outside
          those targeted counts.
        </p>
        <p>
          AI diagnosis was not evaluated. Infrastructure and human-review cost
          remain unknown. Controlled results cannot promote your production
          gate.
        </p>
        <p>
          <a
            href={`https://github.com/tastejs/todomvc/tree/${benchmark.revision}`}
            target="_blank"
            rel="noreferrer"
          >
            Inspect pinned public source →
          </a>{" "}
          · Measured {benchmark.measuredAt}
        </p>
      </section>
      <section className="panel operations-panel">
        <h2>Your production pilot</h2>
        <p>
          Register labels before running tests. A different QA
          engineer/admin/owner reviews them; then link new completed reports.
          Reviewed labels are fixed, and observations cannot be replaced.
        </p>
        <details>
          <summary>Register labeled cases</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action(async () => {
                const lines = cases
                  .split("\n")
                  .filter((v) => v.trim())
                  .map((line) => {
                    const [id, expected, checkId, requirement, defectId, scenario] = line
                      .split("|")
                      .map((v) => v.trim());
                    return {
                      id,
                      expected,
                      checkId,
                      requirement,
                      ...(defectId?{defectId}:{}),
                      ...(scenario?{scenario}:{}),
                    };
                  });
                await call(root + "/pilots", "POST", {
                  name,
                  kind: "production",
                  partition,
                  repository: project.repository,
                  revision,
                  cases: lines,
                  limitations: [],
                });
                setName("");
                setCases("");
              }, "Pilot registered. Ask another reviewer to check the labels before executing new assessments.");
            }}
          >
            <fieldset disabled={!qa || busy}>
              <label>Evaluation partition<select value={partition} onChange={e=>setPartition(e.target.value)}><option value="development">Development cases</option><option value="held-out">Held-out evaluation · labels frozen before execution</option></select></label>
              <label>
                Pilot name
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Pinned source SHA
                <input
                  required
                  pattern="[a-f0-9]{40,64}"
                  value={revision}
                  onChange={(e) => setRevision(e.target.value)}
                />
              </label>
              <label>
                Cases · one per line
                <textarea
                  required
                  rows={5}
                  value={cases}
                  onChange={(e) => setCases(e.target.value)}
                  placeholder={
                    "checkout-total | defect | goal-checkout-total | Existing checkout tax defect must be caught\nlogin-valid | clean | goal-login | A valid account signs in"
                  }
                />
              </label>
              <p>
                Format: case ID | defect, clean or identity-block | exact
                automated check ID | expected business behavior.
              </p>
              <button className="button button-primary">
                Register pilot labels
              </button>
            </fieldset>
          </form>
        </details>
        {state?.suites.map((suite: any) => (
          <details className="work-domain" key={suite.id}>
            <summary>
              {suite.name} · {suite.kind} ·{" "}
              {suite.reviewer_id ? "Labels reviewed" : "Review needed"}
            </summary>
            <p>
              {suite.metrics.detected}/{suite.metrics.defectCases} defect
              executions detected; {suite.metrics.missed} missed;{" "}
              {suite.metrics.falseAlarms} false alarms; {suite.metrics.missing}{" "}
              missing observations.
            </p>
            {qa && !suite.reviewer_id && (
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() =>
                  action(
                    () =>
                      call(
                        root + "/pilots/" + suite.id + "/review",
                        "POST",
                        {},
                      ),
                    "Labels reviewed. Execute fresh assessments, then link the observed checks.",
                  )
                }
              >
                Review labels as a different reviewer
              </button>
            )}
            {suite.cases.map((c: any) => (
              <div key={c.id}>
                <p>
                  <strong>{c.id}</strong> · expected {c.expected} · observed{" "}
                  {c.actual}
                  <br />
                  {c.requirement}
                  <br />
                  Check:{" "}
                  <code className="connection-fingerprint">{c.checkId}</code>
                </p>
                {qa && !c.recordId && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      action(
                        () =>
                          call(
                            root + "/pilots/" + suite.id + "/observe",
                            "POST",
                            {
                              caseId: c.id,
                              recordId: records[suite.id + c.id],
                            },
                          ),
                        "Observation linked to the exact retained report.",
                      );
                    }}
                  >
                    <label>
                      Report ID for {c.id}
                      <input
                        required
                        pattern="[a-f0-9]{64}"
                        value={records[suite.id + c.id] || ""}
                        onChange={(e) =>
                          setRecords({
                            ...records,
                            [suite.id + c.id]: e.target.value,
                          })
                        }
                      />
                    </label>
                    <button className="button button-secondary" disabled={busy}>
                      Link observed result
                    </button>
                  </form>
                )}
              </div>
            ))}
          </details>
        ))}
      </section>
      <PilotEvaluation root={root} suites={state?.suites||[]} write={qa} demo={demo}/>
      {state?.operations&&<section className="panel operations-panel"><h2>Unattended operations</h2><p>{state.operations.notice}</p><p>Shared pilot capacity: {state.operations.hosted.sharedMonthlyUsed}/{state.operations.hosted.limits.monthlyAssessments} monthly assessments; {state.operations.hosted.sharedActive}/{state.operations.hosted.limits.globalActive} active. Provider account quota has not been independently verified.</p><p>Authenticated maintenance: {state.operations.maintenanceConfigured?'configured; successful execution still needs monitoring':'not configured; operator setup required'}.</p><p className="fineprint">{state.operations.health?.notice}</p>{state.operations.health?.tasks.map((t:any)=><p key={t.name}>{t.name}: {t.interrupted?'interrupted':t.state}; last success: {t.last_succeeded_at?new Date(t.last_succeeded_at).toLocaleString():'not observed'}</p>)}<div className="testing-fields"><div><h3>Jobs</h3>{state.operations.jobs.map((v:any)=><p key={v.status}>{v.status}: {v.count}</p>)}</div><div><h3>Archive delivery</h3>{state.operations.archives.map((v:any)=><p key={v.status}>{v.status}: {v.count}</p>)}</div></div></section>}
      <section className="panel operations-panel">
        <h2>Release policy</h2>
        <p>
          Only the owner can change enforcement after recent MFA. Eligibility is
          recalculated at each release decision; stale reports, missing costs
          and expired evidence can block an already-enforced gate.
        </p>
        {policy && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action(
                () => call(root + "/assurance", "PATCH", policy),
                "Release policy saved and recorded in the assessment ledger.",
              );
            }}
          >
            <fieldset disabled={!owner || busy}>
              <label>
                Rollout phase
                <select
                  value={policy.mode}
                  onChange={(e) =>
                    setPolicy({ ...policy, mode: e.target.value })
                  }
                >
                  <option value="advisory">Advisory · reports only</option>
                  <option value="enforced">
                    Enforced · block unqualified releases
                  </option>
                </select>
              </label>
              <div className="testing-fields">
                {[
                  ["minCases", "Minimum production cases", 20, 1000],
                  ["minAssessments", "Minimum distinct assessments", 5, 100],
                  ["minRecall", "Minimum recall fraction", 0.9, 1],
                  ["maxFalseAlarmRate", "Maximum false-alarm fraction", 0, 0.1],
                  ["minReliability", "Minimum execution completeness", 0.95, 1],
                  [
                    "maxKnownInferenceUsd",
                    "Maximum measured inference spend · USD",
                    0,
                    10000,
                  ],
                ].map(([key, label, min, max]) => (
                  <label key={String(key)}>
                    {label}
                    <input
                      type="number"
                      step={Number(max) <= 1 ? "0.01" : "1"}
                      min={Number(min)}
                      max={Number(max)}
                      value={policy[key]}
                      onChange={(e) =>
                        setPolicy({ ...policy, [key]: Number(e.target.value) })
                      }
                    />
                  </label>
                ))}
              </div>
              {[["requireHeldOut","Require a separate held-out evaluation before release"],["requireArchiveAcknowledgment","Require acknowledgment from the configured Java archive before release"],["requireRetainedEvidence","Require retained evidence for every required passing check"]].map(([key,label])=><label className="testing-checkbox" key={key}><input type="checkbox" checked={Boolean(policy[key])} onChange={e=>setPolicy({...policy,[key]:e.target.checked})}/>{label}</label>)}
              <p className="fineprint">Both controls are opt-in. Missing archives or expired evidence block release when required. They do not turn an assessment into a passing result.</p>
              <label className="testing-checkbox">
                <input
                  type="checkbox"
                  checked={policy.requireKnownCosts}
                  onChange={(e) =>
                    setPolicy({
                      ...policy,
                      requireKnownCosts: e.target.checked,
                    })
                  }
                />
                Require known infrastructure and inference cost
              </label>
              <p>Required independently reviewed evidence (within 30 days):</p>
              {["sso", "offboarding", "devices", "security-review"].map(
                (kind) => (
                  <label className="testing-checkbox" key={kind}>
                    <input
                      type="checkbox"
                      checked={policy.requiredEvidence.includes(kind)}
                      onChange={(e) =>
                        setPolicy({
                          ...policy,
                          requiredEvidence: e.target.checked
                            ? [...policy.requiredEvidence, kind]
                            : policy.requiredEvidence.filter(
                                (k: string) => k !== kind,
                              ),
                        })
                      }
                    />
                    {kind}
                  </label>
                ),
              )}
              <button className="button button-primary">
                Save release policy
              </button>
            </fieldset>
          </form>
        )}
      </section>
      <section className="panel operations-panel">
        <h2>Build provenance</h2>
        <p>
          Connect read-only GitHub Actions access. The verifier matches the
          successful workflow’s source SHA and artifact digest to bytes already
          checked by a completed hosted build/release assessment. AWS upload
          declarations alone cannot qualify.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            action(
              () =>
                call(root + "/build-provenance", "POST", {
                  recordId: provenance.recordId,
                  runId: Number(provenance.runId),
                  artifactId: Number(provenance.artifactId),
                }),
              "Exact build provenance verified and recorded in Ledger.",
            );
          }}
        >
          <fieldset disabled={!qa || busy}>
            {[
              ["recordId", "Assessment record ID"],
              ["runId", "GitHub Actions run ID"],
              ["artifactId", "GitHub artifact ID"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  required
                  value={(provenance as any)[key]}
                  onChange={(e) =>
                    setProvenance({ ...provenance, [key]: e.target.value })
                  }
                />
              </label>
            ))}
            <button className="button button-secondary">
              Verify exact build provenance
            </button>
          </fieldset>
        </form>
      </section>
      <section className="panel operations-panel">
        <h2>Independent review evidence</h2>
        <p>
          Record the actual provider/assessor report, its SHA-256 and reference.
          A different admin reviews the issuer, report and conclusion. This
          records your review; it does not manufacture an assessment or certify
          its independence.
        </p>
        <details>
          <summary>Supply a completed review</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action(
                () => call(root + "/assurance-evidence", "POST", reviewDoc),
                "Review document recorded. Ask another admin to verify its issuer and contents.",
              );
            }}
          >
            <fieldset disabled={!manage || busy}>
              <label>
                Evidence type
                <select
                  value={reviewDoc.kind}
                  onChange={(e) =>
                    setDocument({ ...reviewDoc, kind: e.target.value })
                  }
                >
                  {["security-review", "sso", "offboarding", "devices"].map(
                    (v) => (
                      <option key={v}>{v}</option>
                    ),
                  )}
                </select>
              </label>
              {[
                ["title", "Review title"],
                ["issuer", "Assessor / provider"],
                ["artifactSha256", "Report SHA-256"],
                ["reference", "Private report reference"],
                ["conclusion", "Conclusion and unresolved risks"],
              ].map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    required
                    value={(reviewDoc as any)[key]}
                    onChange={(e) =>
                      setDocument({ ...reviewDoc, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
              <button className="button button-secondary">
                Record supplied evidence
              </button>
            </fieldset>
          </form>
        </details>
        {state?.evidence.map((e: any) => (
          <div className="work-domain" key={e.id}>
            <p>
              {e.kind}: {e.payload.title} ·{" "}
              {e.reviewer_id ? "Reviewed" : "Review pending"}
              <br />
              {e.payload.issuer} · {e.payload.conclusion}
            </p>
            {manage && !e.reviewer_id && (
              <button
                disabled={busy}
                className="text-button"
                onClick={() =>
                  action(
                    () =>
                      call(
                        root + "/assurance-evidence/" + e.id + "/review",
                        "POST",
                        {},
                      ),
                    "Source document independently reviewed within your team.",
                  )
                }
              >
                Review as a different admin
              </button>
            )}
          </div>
        ))}
      </section>
      <section className="panel operations-panel">
        <span className="eyebrow">PATCHSENTRY LEDGER</span>
        <h2>Assessment and decision history</h2>
        <p>
          The hosted ledger automatically records completed report snapshots,
          policy changes, provenance and release decisions. Hash-linked receipts
          reveal changed history when compared with a retained head receipt.
          Encrypted report copies follow retention; this is not independent
          notarization.
        </p>
        <div className="testing-inline">
          <button
            className="button button-secondary"
            disabled={busy || demo}
            onClick={() =>
              action(
                async () => setVerify(await call(root + "/ledger/verify")),
                "Ledger chain checked.",
              )
            }
          >
            Verify receipt chain
          </button>
          {owner && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                action(
                  () => call(root + "/ledger/backfill", "POST", {}),
                  "Up to 50 retained completed reports examined for archival.",
                )
              }
            >
              Archive next 50 completed reports
            </button>
          )}
        </div>
        {verify && (
          <p role="status">
            Receipt chain: {verify.valid ? "Valid" : "FAILED"} ·{" "}
            {verify.verifiedEntries ?? 0} entries ·{" "}
            {verify.complete ? "Complete" : "Partial verification"}
            <code className="connection-fingerprint">{verify.headHash}</code>
          </p>
        )}
        <div className="operations-list">
          {ledger?.entries.map((e: any) => (
            <div key={e.id}>
              <span>
                <strong>
                  #{e.sequence} · {e.event_type}
                </strong>
                <small>
                  {e.created_at} ·{" "}
                  {e.payload_retained
                    ? "Payload retained"
                    : "Digest receipt only"}{" "}
                  · Java archive:{" "}
                  {ledger.connection
                    ? e.archive_status || "Not an assessment"
                    : "Not connected"}
                </small>
                <code className="connection-fingerprint">{e.entry_hash}</code>
              </span>
              <button
                className="text-button"
                disabled={!e.payload_retained}
                onClick={() =>
                  action(async () => {
                    const payload = await call(root + "/ledger/" + e.id);
                    const blob = new Blob([JSON.stringify(payload, null, 2)], {
                        type: "application/json",
                      }),
                      url = URL.createObjectURL(blob),
                      a = document.createElement("a");
                    a.href = url;
                    a.download = "patchsentry-ledger-" + e.sequence + ".json";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }, "Retained ledger snapshot exported.")
                }
              >
                Export snapshot
              </button>
            </div>
          ))}
        </div>
        {ledger?.entries.length >= 100 && (
          <button
            className="button button-secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const older = await call(
                  root + "/ledger?before=" + ledger.entries.at(-1).sequence,
                );
                setLedger({
                  ...older,
                  entries: [...ledger.entries, ...older.entries],
                });
                setMessage(
                  older.entries.length
                    ? "Earlier receipts loaded."
                    : "No earlier receipts remain.",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Load earlier receipts
          </button>
        )}
        {owner && (
          <details>
            <summary>Optional Java Ledger archive connection</summary>
            <p>
              No Java service is required for the hosted ledger above. To keep a
              separate company archive, deploy Patchsentry-Ledger-Java, have the
              operator approve its HTTPS origin, and issue a scoped runner token
              for this repository. Never enter its global admin token.
              Connecting explicitly permits assessment transfer to that service,
              whose retention and access policies are separate.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                action(async () => {
                  await call(root + "/ledger/connect", "POST", {
                    origin,
                    token,
                    approveAssessmentTransfer: consent,
                  });
                  setToken("");
                }, "Scoped Java Ledger connection verified.");
              }}
            >
              <label>
                Approved Java Ledger HTTPS origin
                <input
                  required
                  type="url"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  placeholder="https://ledger.your-company.com"
                />
              </label>
              <label>
                Project-scoped Ledger runner token
                <input
                  required
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <label className="testing-checkbox">
                <input
                  required
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                I authorize transferring this project’s assessments to this
                company Ledger
              </label>
              <button disabled={busy} className="button button-secondary">
                Verify Java Ledger connection
              </button>
            </form>
            {ledger?.connection && (
              <>
                <p>Connected: {ledger.connection.origin}</p>
                <button disabled={busy} className="text-button" onClick={()=>action(()=>call(root+"/ledger/reconcile","POST",{}),"Archive receipts checked against the service. Inspect confirmed, failed and conflicting statuses.")}>Reconcile confirmed archive receipts</button>
                <button
                  disabled={busy}
                  className="text-button"
                  onClick={() =>
                    action(
                      () => call(root + "/ledger/deliver", "POST", {}),
                      "Pending assessments processed; inspect each receipt for confirmation.",
                    )
                  }
                >
                  Deliver pending assessments
                </button>
                <button
                  disabled={busy}
                  className="text-button"
                  onClick={() =>
                    action(
                      () => call(root + "/ledger/retry", "POST", {}),
                      "Failed delivery receipts rechecked. Confirm individual archive status.",
                    )
                  }
                >
                  Retry failed archive deliveries
                </button>
                <button
                  disabled={busy}
                  className="text-button"
                  onClick={() =>
                    action(
                      () => call(root + "/ledger/connection", "DELETE"),
                      "Java delivery disconnected. Hosted receipts remain available.",
                    )
                  }
                >
                  Disconnect Java archive
                </button>
              </>
            )}
          </details>
        )}
      </section>
    </div>
  );
}
