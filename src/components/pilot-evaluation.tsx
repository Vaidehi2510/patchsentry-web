"use client";
import { useEffect, useState } from "react";
export function PilotEvaluation({
  root,
  suites,
  write,
  demo,
}: {
  root: string;
  suites: any[];
  write: boolean;
  demo: boolean;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [suite, setSuite] = useState(""),
    [sample, setSample] = useState(""),
    [workflow, setWorkflow] = useState("patchsentry"),
    [basis, setBasis] = useState("measured"),
    [note, setNote] = useState(""),
    [minutes, setMinutes] = useState<Record<string, string>>({
      setup: "",
      maintenance: "",
      triage: "",
      approvals: "",
      execution: "",
    }),
    [recordId, setRecordId] = useState(""),
    [history, setHistory] = useState<any>(null);
  async function request(path: string, method = "GET", body?: unknown) {
    const response = await fetch(root + path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const d = await response.json();
    if (!response.ok)
      throw Error(d.error || "The request could not be completed.");
    return d;
  }
  useEffect(() => {
    if (!demo)
      request("/pilots/evaluation")
        .then(setData)
        .catch((e) => setError(e.message));
  }, [root, demo]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel operations-panel">
      <h2>Workload evaluation & release history</h2>
      <p>
        Measure the same labeled workload with your current process and with
        Patchsentry. Include setup, maintenance, triage and approvals. Estimates
        never establish measured savings.
      </p>
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
      <details>
        <summary>Record human work for a pilot</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await request("/pilots/" + suite + "/worklog", "POST", {
                sampleId: sample,
                workflow,
                basis,
                minutes: Object.fromEntries(
                  Object.entries(minutes).map(([k, v]) => [k, Number(v)]),
                ),
                note,
              });
              setData(await request("/pilots/evaluation"));
              setMessage(
                "Time log retained in Ledger. This does not establish staffing replacement.",
              );
            });
          }}
        >
          <fieldset disabled={!write || demo || busy}>
            <label>
              Pilot
              <select
                required
                value={suite}
                onChange={(e) => setSuite(e.target.value)}
              >
                <option value="">Choose a registered pilot</option>
                {suites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Comparison sample ID
              <input
                required
                pattern="(?:[A-Za-z0-9_]|-){1,80}"
                value={sample}
                onChange={(e) => setSample(e.target.value)}
                placeholder="checkout-sample-1"
              />
            </label>
            <div className="testing-fields">
              <label>
                Workflow
                <select
                  value={workflow}
                  onChange={(e) => setWorkflow(e.target.value)}
                >
                  <option value="manual">
                    Current manual/tool-assisted workflow
                  </option>
                  <option value="patchsentry">Patchsentry workflow</option>
                </select>
              </label>
              <label>
                Measurement basis
                <select
                  value={basis}
                  onChange={(e) => setBasis(e.target.value)}
                >
                  <option value="measured">
                    Measured time · company supplied
                  </option>
                  <option value="estimated">
                    Estimate · not measured savings
                  </option>
                </select>
              </label>
            </div>
            <div className="testing-fields">
              {Object.entries(minutes).map(([key, value]) => (
                <label key={key}>
                  {key[0].toUpperCase() + key.slice(1)} · minutes
                  <input
                    required
                    type="number"
                    min={0}
                    max={100000}
                    step="any"
                    value={value}
                    onChange={(e) =>
                      setMinutes({ ...minutes, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>
            <label>
              Measurement method and limitations
              <textarea
                required
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button className="button button-secondary">Save time log</button>
          </fieldset>
        </form>
      </details>
      {data?.comparisons.map((c: any) => (
        <p key={c.suiteId + c.sampleId}>
          <strong>{c.sampleId}</strong>: {c.manualMinutes} current-process
          minutes; {c.patchsentryMinutes} Patchsentry minutes.{" "}
          {c.observedDifferenceMinutes === null
            ? "Includes estimates; measured difference unavailable."
            : `${c.observedDifferenceMinutes} fewer minutes in this self-reported sample.`}
        </p>
      ))}
      {!data?.comparisons.length && (
        <p className="fineprint">
          No paired workload measurement yet. Staffing impact remains unknown.
        </p>
      )}
      <p className="fineprint">{data?.notice}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            setHistory(await request("/ledger/history?recordId=" + recordId));
          });
        }}
      >
        <label>
          Assessment record ID
          <input
            required
            pattern="[a-f0-9]{64}"
            value={recordId}
            onChange={(e) => {
              setRecordId(e.target.value);
              setHistory(null);
            }}
            placeholder="Exact 64-character report ID"
          />
        </label>
        <button className="button button-secondary" disabled={busy || demo}>
          Retrieve release history
        </button>
      </form>
      {history && (
        <div>
          <p>
            {history.events.length} events on this page.{" "}
            {
              history.events.filter((e: any) => e.availability === "expired")
                .length
            }{" "}
            expired payloads. Evidence: {history.evidence.length} file
            references.
          </p>
          <a
            className="text-button"
            href={
              root +
              "/ledger/history?recordId=" +
              recordId +
              (history.pageBefore ? "&before=" + history.pageBefore : "")
            }
            download="patchsentry-release-history.json"
          >
            Download this history page
          </a>
          {history.nextBefore && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const before = history.nextBefore;
                  setHistory({
                    ...(await request(
                      "/ledger/history?recordId=" +
                        recordId +
                        "&before=" +
                        before,
                    )),
                    pageBefore: before,
                  });
                })
              }
            >
              Load earlier history
            </button>
          )}
          <p className="fineprint">{history.notice}</p>
        </div>
      )}
    </section>
  );
}
