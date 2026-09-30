"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Cpu,
  Globe2,
  Search,
  Check,
  Eye,
  Wrench,
  ArrowUpRight,
  Save,
  ShieldCheck,
  RefreshCw,
  CircleHelp,
} from "lucide-react";
import {
  roles,
  roleLabels,
  type Project,
  type Settings,
  type CatalogModel,
} from "@/lib/contracts";
import { api } from "./workspace";

export function ModelSettings({
  project,
  demo,
  onSave,
}: {
  project: Project;
  demo: boolean;
  onSave: (p: Project) => void;
}) {
  const [settings, setSettings] = useState<Settings>(project.settings),
    [models, setModels] = useState<CatalogModel[]>([]),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [toolsOnly, setToolsOnly] = useState(true),
    [visionOnly, setVisionOnly] = useState(false),
    [fetchedAt, setFetchedAt] = useState("");
  useEffect(() => {
    setSettings(project.settings);
  }, [project.settings]);
  async function load() {
    setLoading(true);
    setError("");
    try {
      const d = await api("/api/models");
      setModels(d.models);
      setFetchedAt(d.fetchedAt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  const catalog: CatalogModel[] =
    settings.backend === "local"
      ? project.localModels.map((m) => ({
          ...m,
          promptPrice: null,
          completionPrice: null,
        }))
      : models;
  const visible = useMemo(
    () =>
      catalog.filter(
        (m) =>
          (!toolsOnly || m.tools) &&
          (!visionOnly || m.vision) &&
          `${m.id} ${m.name}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [catalog, query, toolsOnly, visionOnly],
  );
  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((v) => ({ ...v, [key]: value }));
    setMessage("");
  }
  async function save() {
    if (demo) {
      setMessage(
        "This is a demo. Create an account to save model settings for your product.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const d = await api(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ settings }),
      });
      onSave(d.project);
      setMessage(
        "Settings saved. Your enrolled runner will apply them on its next sync, within its local policy limits.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const eligible = catalog.filter((m) => m.tools && m.contextLength > 3000);
  return (
    <>
      <div className="model-backends">
        <button
          className={`backend-card ${settings.backend === "openrouter" ? "selected" : ""}`}
          onClick={() => {
            setSettings((v) => ({
              ...v,
              backend: "openrouter",
              model: "",
              roleModels: {},
            }));
            setMessage("");
          }}
        >
          <span className="backend-icon">
            <Globe2 size={25} />
          </span>
          <span>
            <strong>OpenRouter</strong>
            <span>Browse cloud models. Bring your own key.</span>
          </span>
          <span className="radio-dot">
            {settings.backend === "openrouter" && <span />}
          </span>
        </button>
        <button
          className={`backend-card ${settings.backend === "local" ? "selected" : ""}`}
          onClick={() => {
            setSettings((v) => ({
              ...v,
              backend: "local",
              model: "",
              roleModels: {},
            }));
            setMessage("");
          }}
        >
          <span className="backend-icon">
            <Cpu size={25} />
          </span>
          <span>
            <strong>Local models</strong>
            <span>Ollama or LM Studio. Your infrastructure.</span>
          </span>
          <span className="radio-dot">
            {settings.backend === "local" && <span />}
          </span>
        </button>
      </div>
      <div className="notice model-notice">
        <ShieldCheck size={19} />
        <div>
          <strong>
            {settings.backend === "openrouter"
              ? "Your key stays on your runner."
              : "Local inference. Outbound reporting."}
          </strong>
          <p>
            {settings.backend === "openrouter"
              ? "Set OPENROUTER_API_KEY in your QA runner’s environment. This website saves model choices, never your provider key. Provider charges and runner costs are separate."
              : "The runner contacts your local model server. This website cannot reach your localhost. Declare model capabilities on the runner; they appear here after it checks in. Reports still upload to this workspace."}
          </p>
        </div>
      </div>
      {error && (
        <div className="notice warning" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="notice success" role="status">
          <Check size={17} />
          <span>
            {message} {demo && <Link href="/signup">Create an account →</Link>}
          </span>
        </div>
      )}
      <div className="models-layout">
        <section className="panel catalog-panel">
          <div className="panel-heading">
            <div>
              <h2>
                {settings.backend === "openrouter"
                  ? "Find your model"
                  : "Models on your runner"}
              </h2>
              <p>
                {settings.backend === "openrouter"
                  ? "Live catalog · USD per million tokens"
                  : "Explicit capability profiles supplied by your runner"}
              </p>
            </div>
            {settings.backend === "openrouter" && (
              <button
                className="icon-button"
                aria-label="Refresh model catalog"
                onClick={load}
                disabled={loading}
              >
                <RefreshCw size={17} />
              </button>
            )}
          </div>
          <div className="catalog-filters">
            <label className="search-field">
              <Search size={17} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models or providers…"
                aria-label="Search models"
              />
            </label>
            <div>
              <label>
                <input
                  type="checkbox"
                  checked={toolsOnly}
                  onChange={(e) => setToolsOnly(e.target.checked)}
                />{" "}
                Tool calling
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={visionOnly}
                  onChange={(e) => setVisionOnly(e.target.checked)}
                />{" "}
                Vision
              </label>
              <span>{visible.length} models</span>
            </div>
          </div>
          <div className="model-list">
            {loading && settings.backend === "openrouter" ? (
              <div className="empty-state">
                <RefreshCw size={22} />
                <p>Loading the OpenRouter catalog…</p>
              </div>
            ) : visible.length ? (
              visible.slice(0, 100).map((m) => {
                const valid = m.tools && m.contextLength > 3000;
                return (
                  <button
                    className={`model-option ${settings.model === m.id ? "selected" : ""}`}
                    key={m.id}
                    onClick={() => update("model", m.id)}
                    disabled={!valid}
                  >
                    <span className="model-vendor">
                      {m.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="model-info">
                      <strong>{m.name}</strong>
                      <code>{m.id}</code>
                      <span className="model-capabilities">
                        <span>
                          {Math.round(m.contextLength / 1000)}k context
                        </span>
                        {m.tools && (
                          <span>
                            <Wrench size={11} /> Tools
                          </span>
                        )}
                        {m.vision && (
                          <span>
                            <Eye size={12} /> Vision
                          </span>
                        )}
                        {!valid && <span>Not eligible for this QA team</span>}
                      </span>
                    </span>
                    <span className="model-price">
                      {settings.backend === "local" ? (
                        <>
                          <strong>Local compute</strong>
                          <small>Hardware costs apply</small>
                        </>
                      ) : (
                        <>
                          <strong>
                            {m.promptPrice === null
                              ? "—"
                              : `$${m.promptPrice.toFixed(m.promptPrice < 0.01 ? 3 : 2)}`}
                          </strong>
                          <small>
                            in /{" "}
                            {m.completionPrice === null
                              ? "—"
                              : `$${m.completionPrice.toFixed(2)}`}{" "}
                            out
                          </small>
                        </>
                      )}
                    </span>
                    <span className="model-selected">
                      {settings.model === m.id && <Check size={18} />}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="empty-state">
                <Cpu size={27} />
                <h3>
                  {settings.backend === "local"
                    ? "No matching local models yet"
                    : "No matching models"}
                </h3>
                <p>
                  {settings.backend === "local"
                    ? "Connect your runner with declared model profiles, then refresh the workspace. Never expose your model server to the public internet."
                    : "Try a different search or fewer filters."}
                </p>
                {settings.backend === "local" && (
                  <Link href="/docs" className="text-button">
                    Read the local model setup <ArrowUpRight size={14} />
                  </Link>
                )}
              </div>
            )}
          </div>
          <div className="table-footer">
            {visible.length > 100
              ? "Showing the first 100 matches. Search to narrow results. "
              : ""}
            {settings.backend === "openrouter" && fetchedAt
              ? `Catalog fetched ${new Date(fetchedAt).toLocaleTimeString()}. Provider availability can vary.`
              : "Capabilities are declared by your runner, not benchmarked by this portal."}
          </div>
        </section>
        <aside aria-label="Model configuration">
          <section className="panel team-settings">
            <span className="mini-label">TEAM CONFIGURATION</span>
            <h3>One model, or a specialist mix.</h3>
            <label>
              Default model
              <input
                readOnly
                value={settings.model}
                placeholder="Select from the catalog"
              />
            </label>
            <div className="role-settings">
              {roles.map((role) => (
                <div key={role}>
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.roles.includes(role)}
                      onChange={(e) => {
                        if (!e.target.checked && settings.roles.length === 1)
                          return;
                        update(
                          "roles",
                          e.target.checked
                            ? [...settings.roles, role]
                            : settings.roles.filter((r) => r !== role),
                        );
                      }}
                    />
                    {roleLabels[role]}
                  </label>
                  <select
                    aria-label={`${roleLabels[role]} model`}
                    value={settings.roleModels[role] || ""}
                    disabled={!settings.roles.includes(role)}
                    onChange={(e) => {
                      const next = { ...settings.roleModels };
                      if (e.target.value) next[role] = e.target.value;
                      else delete next[role];
                      update("roleModels", next);
                    }}
                  >
                    <option value="">Use default model</option>
                    {eligible
                      .filter(
                        (m) =>
                          !settings.allowImages || role !== "ui-ux" || m.vision,
                      )
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </div>
              ))}
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={settings.allowImages}
                onChange={(e) => update("allowImages", e.target.checked)}
              />
              <span>
                Allow screenshot analysis
                <small>
                  UI / UX model must support vision. Requires local enrollment
                  permission.
                </small>
              </span>
            </label>
          </section>
          <section className="panel budget-settings">
            <span className="mini-label">GUARDRAILS</span>
            <h3>Give your team a budget.</h3>
            <label>
              Provider budget per run (USD)
              <input
                type="number"
                min={0}
                max={25}
                step={0.25}
                value={settings.maxCostUsd}
                onChange={(e) => update("maxCostUsd", Number(e.target.value))}
              />
            </label>
            <label>
              Maximum model calls
              <input
                type="number"
                min={1}
                max={40}
                step={1}
                value={settings.maxCallsPerRun}
                onChange={(e) =>
                  update("maxCallsPerRun", Number(e.target.value))
                }
              />
            </label>
            <p className="fineprint">
              <CircleHelp size={14} /> The runner’s enrolled ceilings take
              priority. Switching backends or raising limits requires a local
              configuration change. No silent cloud fallback.
            </p>
            <button
              className="button button-primary auth-submit"
              onClick={save}
              disabled={busy || !settings.model}
            >
              <Save size={16} />
              {busy ? "Saving…" : "Save model settings"}
            </button>
          </section>
        </aside>
      </div>
    </>
  );
}
