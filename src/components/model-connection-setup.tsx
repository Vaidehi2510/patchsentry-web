"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Plug,
  ShieldCheck,
  RefreshCw,
  Copy,
  Check,
  KeyRound,
  Server,
} from "lucide-react";
import type { Project } from "@/lib/contracts";
import type { ConnectionView } from "@/lib/model-connection";
type Worker = {
  id: string;
  online: boolean;
  setupEnabled: boolean;
  fingerprint: string | null;
  backends: string[];
};
async function call(url: string, body?: unknown) {
  const r = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const v = await r.json();
  if (!r.ok)
    throw new Error(v.error || "Connection setup could not be completed.");
  return v;
}
export function ModelConnectionSetup({
  project,
  backend,
  selectedModel,
  demo,
  onInventory,
}: {
  project: Project;
  backend: "openrouter" | "local";
  selectedModel: string;
  demo: boolean;
  onInventory: (p: Project) => void;
}) {
  const latestProject = useRef(project);
  latestProject.current = project;
  const refreshedInventory = useRef("");
  const root = `/api/projects/${project.id}/model-connections`;
  const [workers, setWorkers] = useState<Worker[]>([]),
    [connections, setConnections] = useState<ConnectionView[]>([]),
    [runnerId, setRunnerId] = useState(""),
    [apiKey, setApiKey] = useState(""),
    [endpoint, setEndpoint] = useState("http://127.0.0.1:11434/v1"),
    [profile, setProfile] = useState({
      id: "",
      contextLength: 8192,
      tools: false,
      vision: false,
    }),
    [recognized, setRecognized] = useState(false),
    [costConsent, setCostConsent] = useState(false),
    [probeModel, setProbeModel] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [copied, setCopied] = useState(false);
  const chosen = workers.find((w) => w.id === runnerId),
    current = connections.filter(
      (c) => c.backend === backend && c.runnerId === runnerId,
    ),
    latest = current[0],
    configured = current.find((c) =>
      ["configure", "disconnect"].includes(c.action),
    ),
    testId =
      probeModel || selectedModel || (backend === "local" ? profile.id : ""),
    tested = current.find((c) => c.action === "test" && c.model === testId);
  const verified = Boolean(
    chosen?.online &&
      tested?.status === "passed" &&
      tested.result?.inferencePassed &&
      Date.now() - Date.parse(tested.completedAt || "") < 15 * 60000 &&
      (!configured ||
        Date.parse(tested.createdAt) >= Date.parse(configured.createdAt)),
  );
  const waiting = latest && ["queued", "running"].includes(latest.status),
    discovered =
      current.find((c) => c.result?.models?.length)?.result?.models || [];
  async function load() {
    if (demo) return;
    const data = await call(root);
    setWorkers(data.runners);
    setConnections(data.connections);
    setRunnerId((id) =>
      data.runners.some((w: Worker) => w.id === id)
        ? id
        : data.runners.find(
            (w: Worker) =>
              w.online && w.setupEnabled && w.backends.includes(backend),
          )?.id || "",
    );
    const configured = data.connections.find(
      (c: ConnectionView) =>
        c.action === "configure" &&
        c.status === "passed" &&
        c.backend === "local",
    );
    if (configured && refreshedInventory.current !== configured.id) {
      const fresh = await call(`/api/projects/${project.id}`);
      refreshedInventory.current = configured.id;
      onInventory({
        ...latestProject.current,
        localModels: fresh.project.localModels,
        runner: fresh.project.runner,
        agentLastSeen: fresh.project.agentLastSeen,
      });
    }
  }
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      if (alive)
        load().catch((e) => {
          if (alive) setError(e.message);
        });
    };
    refresh();
    const t = setInterval(refresh, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [project.id, backend, demo]);
  useEffect(() => {
    setApiKey("");
    setError("");
    setMessage("");
    setRecognized(false);
    setCostConsent(false);
    setProbeModel("");
  }, [backend, runnerId]);
  async function request(
    action: "configure" | "discover" | "test" | "disconnect",
  ) {
    if (demo) {
      setMessage(
        "Demo mode shows the workflow. Sign in and connect your own runner to make real checks.",
      );
      return;
    }
    if (!chosen?.online || !chosen.setupEnabled || !recognized) {
      setError(
        "Choose an online setup-enabled runner and confirm its fingerprint.",
      );
      return;
    }
    if (action === "test" && backend === "openrouter" && !costConsent) {
      setError("Confirm the small provider-credit cost before testing.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body: Record<string, unknown> = {
        runnerId,
        backend,
        action,
        consent: true,
      };
      if (action === "test") body.model = testId;
      if (["configure", "discover"].includes(action)) {
        if (apiKey) body.apiKey = apiKey;
        if (backend === "local")
          body.local = {
            baseUrl: endpoint,
            models: action === "configure" ? [profile] : [],
          };
      }
      await call(root, body);
      if (action !== "discover") setApiKey("");
      setMessage(
        "Request queued. Your runner performs the check; status updates automatically.",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const command = `node scripts/agent.mjs --bot-dir /path/to/QA-testbot --watch --allow-model-setup --allow-backends openrouter,local`;
  return (
    <section
      className="panel connection-setup"
      aria-label="Model connection setup"
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">CONNECT BEFORE YOU TEST</span>
          <h2>
            <Plug size={22} />{" "}
            {backend === "openrouter"
              ? "Connect OpenRouter"
              : "Connect a local model server"}
          </h2>
          <p>
            Model catalogs show available choices. A saved selection alone is
            not a verified connection.
          </p>
        </div>
        <span
          className={`status ${verified ? "status-passed" : "status-blocked"}`}
        >
          {demo
            ? "Demo · not connected"
            : verified
              ? "Inference checked"
              : waiting
                ? "Check in progress"
                : latest?.status === "failed"
                  ? "Check failed"
                  : "Not verified"}
        </span>
      </div>
      <ol className="connection-steps">
        <li>
          <strong>Link the machine that will run QA.</strong>
          <details open={!workers.some((w) => w.online && w.setupEnabled)}>
            <summary>Runner setup instructions</summary>
            <p>
              In <Link href="/app?tab=integration">Integrations</Link>, the
              project owner issues a runner token. Set{" "}
              <code>QA_PORTAL_URL</code> and <code>QA_PORTAL_TOKEN</code> on
              that machine, then start this connector from the website
              repository:
            </p>
            <pre tabIndex={0} aria-label="Model setup connector command">
              <code>{command}</code>
            </pre>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                navigator.clipboard
                  .writeText(command)
                  .then(() => setCopied(true))
                  .catch(() => setError("Copy the command manually."))
              }
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}Copy connector
              command
            </button>
            <p className="fineprint">
              This explicitly permits credential installation and local model
              configuration. It does not activate product testing. QA execution
              still requires the separately enrolled execution policy.
            </p>
          </details>
        </li>
        <li>
          <strong>Choose your trusted runner.</strong>
          <label>
            Connection runner
            <select
              aria-label="Connection runner"
              value={runnerId}
              onChange={(e) => setRunnerId(e.target.value)}
            >
              <option value="">
                {demo
                  ? "Connect a real runner after signup"
                  : "Choose a runner"}
              </option>
              {workers.map((w) => (
                <option
                  key={w.id}
                  value={w.id}
                  disabled={
                    !w.online ||
                    !w.setupEnabled ||
                    !w.backends.includes(backend)
                  }
                >
                  Worker {w.id.slice(0, 12)} ·{" "}
                  {w.online
                    ? w.setupEnabled
                      ? "setup enabled"
                      : "update connector flags"
                    : "offline"}
                </option>
              ))}
            </select>
          </label>
          {chosen?.fingerprint && (
            <p className="fineprint">
              Compare this public fingerprint with the connector’s{" "}
              <code>modelSetup.fingerprint</code>:{" "}
              <code className="connection-fingerprint">
                {chosen.fingerprint}
              </code>
            </p>
          )}
          <label className="testing-checkbox">
            <input
              type="checkbox"
              disabled={!chosen?.online || !chosen?.setupEnabled}
              checked={recognized}
              onChange={(e) => setRecognized(e.target.checked)}
            />
            I recognize this runner and authorize connection setup on it.
          </label>
          {!workers.some((w) => w.online && w.setupEnabled) && (
            <p className="notice warning">
              No setup-enabled runner is online. Start the connector above. A
              public website cannot directly connect to your machine’s
              localhost.
            </p>
          )}
        </li>
        <li>
          <strong>
            {backend === "openrouter"
              ? "Verify your key and deliver it securely."
              : "Discover and configure your local server."}
          </strong>
          {backend === "local" && (
            <>
              <label>
                Local server preset
                <select
                  aria-label="Local server preset"
                  onChange={(e) => {
                    if (e.target.value) setEndpoint(e.target.value);
                  }}
                  defaultValue="http://127.0.0.1:11434/v1"
                >
                  <option value="http://127.0.0.1:11434/v1">Ollama</option>
                  <option value="http://127.0.0.1:1234/v1">LM Studio</option>
                  <option value="">Custom loopback server</option>
                </select>
              </label>
              <label>
                Server address on your runner
                <input
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  spellCheck={false}
                />
              </label>
            </>
          )}
          <label>
            {backend === "openrouter"
              ? "OpenRouter API key"
              : "Local server API key (optional)"}
            <input
              type="password"
              name="provider-api-key"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              maxLength={256}
              spellCheck={false}
              placeholder={
                backend === "openrouter"
                  ? "Paste your OpenRouter key"
                  : "Leave blank for a server without authentication"
              }
            />
          </label>
          <p className="fineprint">
            <ShieldCheck size={15} />{" "}
            {backend === "openrouter"
              ? "Key validation contacts OpenRouter over HTTPS without making a paid model call. The key is then encrypted to your chosen runner."
              : "Your runner performs discovery. Local endpoints and optional keys are never used by the web server to contact your localhost."}{" "}
            Plaintext keys are not stored in the portal or returned to the
            browser. The runner stores a private encrypted credential file
            outside product source. Do not paste keys into chat.
          </p>
          {backend === "openrouter" ? (
            <button
              type="button"
              className="button button-primary"
              disabled={
                busy ||
                Boolean(waiting) ||
                !apiKey ||
                !recognized ||
                !chosen?.online
              }
              onClick={() => request("configure")}
            >
              <KeyRound size={18} />
              Verify key and connect runner
            </button>
          ) : (
            <>
              <button
                type="button"
                className="button button-secondary"
                disabled={
                  busy || Boolean(waiting) || !recognized || !chosen?.online
                }
                onClick={() => request("discover")}
              >
                <Server size={18} />
                Discover local models
              </button>
              <div className="testing-fields">
                <label>
                  Local model ID
                  <input
                    list="discovered-local-models"
                    value={profile.id}
                    onChange={(e) =>
                      setProfile({ ...profile, id: e.target.value })
                    }
                  />
                  <datalist id="discovered-local-models">
                    {discovered.map((m) => (
                      <option key={m.id} value={m.id} />
                    ))}
                  </datalist>
                </label>
                <label>
                  Actual context window
                  <input
                    type="number"
                    min={1024}
                    max={2000000}
                    value={profile.contextLength}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        contextLength: Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <label className="testing-checkbox">
                <input
                  type="checkbox"
                  checked={profile.tools}
                  onChange={(e) =>
                    setProfile({ ...profile, tools: e.target.checked })
                  }
                />
                This model supports tool calls
              </label>
              <label className="testing-checkbox">
                <input
                  type="checkbox"
                  checked={profile.vision}
                  onChange={(e) =>
                    setProfile({ ...profile, vision: e.target.checked })
                  }
                />
                This model supports image inputs
              </label>
              <p className="fineprint">
                Declare capabilities from your actual model/server
                configuration. Discovery and a basic reply check do not prove
                tool or image support. Tool-capable models are required for
                agent planning.
              </p>
              <button
                type="button"
                className="button button-primary"
                disabled={
                  busy ||
                  Boolean(waiting) ||
                  !profile.id ||
                  !recognized ||
                  !chosen?.online
                }
                onClick={() => request("configure")}
              >
                Save local connection on runner
              </button>
            </>
          )}
        </li>
        <li>
          <strong>
            Test the selected model, then save your QA assignments below.
          </strong>
          <label>
            Model ID to test
            <input
              value={testId}
              onChange={(e) => setProbeModel(e.target.value)}
              placeholder={
                backend === "openrouter"
                  ? "Choose a model from the catalog below"
                  : "Use your configured local model ID"
              }
            />
          </label>
          {backend === "openrouter" ? (
            <label className="testing-checkbox">
              <input
                type="checkbox"
                checked={costConsent}
                onChange={(e) => setCostConsent(e.target.checked)}
              />
              I authorize one synthetic connection request, up to 32 output
              tokens, which may use provider credits.
            </label>
          ) : (
            <p className="fineprint">
              This sends a small synthetic prompt to your local server. It uses
              your compute and has no cloud fallback.
            </p>
          )}
          <button
            type="button"
            className="button button-secondary"
            disabled={
              busy ||
              Boolean(waiting) ||
              !testId ||
              !recognized ||
              !chosen?.online ||
              (backend === "openrouter" && !costConsent)
            }
            onClick={() => request("test")}
          >
            Run inference check
          </button>
          <p className="fineprint">
            After saving your QA assignments below, restart the connector with{" "}
            <code>--apply-model-settings</code> added to the same command. No
            product source is included in the connection check. A successful
            check is specific to this runner and model, is shown as current for
            15 minutes, and does not certify QA quality. Each different role
            model needs its own check.
          </p>
        </li>
      </ol>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {latest && (
        <div className="notice" role="status">
          <div>
            <strong>
              {latest.status === "queued"
                ? "Waiting for runner"
                : latest.status === "running"
                  ? "Runner is checking"
                  : latest.status === "passed"
                    ? "Runner check completed"
                    : latest.status === "uncertain"
                      ? "Outcome uncertain"
                      : "Connection check failed"}
            </strong>
            <p>
              {latest.result?.message ||
                "The runner has not confirmed this request yet."}
            </p>
            {latest.keyVerifiedAt && (
              <p className="fineprint">
                OpenRouter key authentication checked{" "}
                {new Date(latest.keyVerifiedAt).toLocaleString()}. This is
                separate from model inference.
              </p>
            )}
            {latest.completedAt && (
              <p className="fineprint">
                Last result {new Date(latest.completedAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>
      )}
      <div className="testing-inline">
        <button
          type="button"
          className="text-button"
          onClick={() => load().catch((e) => setError(e.message))}
        >
          <RefreshCw size={16} />
          Refresh connection status
        </button>
        {!demo && (
          <button
            type="button"
            className="text-button"
            disabled={
              busy || Boolean(waiting) || !recognized || !chosen?.online
            }
            onClick={() => {
              if (
                window.confirm(
                  "Remove this provider’s saved encrypted key from the selected runner? Environment credentials are not changed.",
                )
              )
                request("disconnect");
            }}
          >
            Remove saved runner key
          </button>
        )}
      </div>
    </section>
  );
}
