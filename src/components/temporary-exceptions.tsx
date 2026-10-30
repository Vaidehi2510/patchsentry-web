"use client";
import type { AutomationPolicy } from "@/lib/automation";
export function TemporaryExceptions({
  value,
  onChange,
}: {
  value: AutomationPolicy["temporaryExceptions"];
  onChange: (v: AutomationPolicy["temporaryExceptions"]) => void;
}) {
  return (
    <div>
      <h3>Temporary QA exceptions</h3>
      <p className="fineprint">
        An omission needs a scope, reason and expiration. It never changes an
        original result or authorizes a release. Existing branch/label
        exclusions above remain persistent policies.
      </p>
      {value.map((item, index) => (
        <div key={item.id}>
          <div className="testing-fields">
            <label>
              Exception scope
              <select
                value={item.scope}
                onChange={(e) =>
                  onChange(
                    value.map((v, i) =>
                      i === index
                        ? { ...v, scope: e.target.value as typeof v.scope }
                        : v,
                    ),
                  )
                }
              >
                {["pr", "build", "branch", "label"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Exact PR number or name pattern
              <input
                required
                maxLength={120}
                value={item.value}
                onChange={(e) =>
                  onChange(
                    value.map((v, i) =>
                      i === index ? { ...v, value: e.target.value } : v,
                    ),
                  )
                }
              />
            </label>
          </div>
          <label>
            Reason
            <input
              required
              maxLength={500}
              value={item.reason}
              onChange={(e) =>
                onChange(
                  value.map((v, i) =>
                    i === index ? { ...v, reason: e.target.value } : v,
                  ),
                )
              }
            />
          </label>
          <label>
            Expires at · UTC
            <input
              required
              type="datetime-local"
              value={item.expiresAt.slice(0, 16)}
              onChange={(e) => {
                const t = Date.parse(e.target.value + "Z");
                if (Number.isFinite(t))
                  onChange(
                    value.map((v, i) =>
                      i === index
                        ? { ...v, expiresAt: new Date(t).toISOString() }
                        : v,
                    ),
                  );
              }}
            />
          </label>
          <button
            type="button"
            className="text-button"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            Remove exception
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button button-secondary"
        disabled={value.length >= 30}
        onClick={() =>
          onChange([
            ...value,
            {
              id: crypto.randomUUID(),
              scope: "pr",
              value: "",
              reason: "",
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
            },
          ])
        }
      >
        Add temporary exception
      </button>
    </div>
  );
}
