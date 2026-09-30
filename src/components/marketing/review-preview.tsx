"use client";

import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleDot,
  Code2,
  GitPullRequest,
  MessageSquare,
  ScanEye,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

const findings = {
  behavior: {
    tab: "Behavior",
    icon: Code2,
    label: "Boundary case",
    title: "Free shipping starts one cent too late.",
    file: "checkout/shipping.ts : 24",
    body: "Orders of exactly $100 still receive a delivery charge. The requirement includes the $100 threshold.",
    suggestion: "Check the inclusive boundary and add a regression test.",
    code: "subtotal > 100",
    correct: "subtotal >= 100",
  },
  interface: {
    tab: "Interface",
    icon: ScanEye,
    label: "Accessibility",
    title: "The email field needs a visible label.",
    file: "checkout/contact.tsx : 18",
    body: "A placeholder is the only field description. It disappears while typing and does not establish an accessible label.",
    suggestion: "Associate a persistent Email label with the input.",
    code: '<input placeholder="Email" />',
    correct: '<label htmlFor="email">Email</label>',
  },
  security: {
    tab: "Security",
    icon: ShieldCheck,
    label: "Code finding · unverified",
    title: "Verify ownership before returning an order.",
    file: "api/orders/[id].ts : 31",
    body: "The changed handler reads an order by ID. Confirm that authorization is enforced for the requesting account.",
    suggestion: "Add an ownership check and a cross-account regression test.",
    code: "findOrder(params.id)",
    correct: "findOrderForUser(params.id, user.id)",
  },
};
export function ReviewPreview() {
  const [active, setActive] = useState<keyof typeof findings>("behavior");
  const finding = findings[active];
  return (
    <div className="hero-preview-wrap">
      <div className="preview-coordinate">REVIEW WORKSPACE / 01</div>
      <div className="review-preview">
        <div className="preview-topbar">
          <div className="preview-avatar">A</div>
          <span>
            Acme Store <ChevronDown size={11} />
          </span>
          <span className="sample-label">SAMPLE REVIEW</span>
        </div>
        <div className="preview-body">
          <div className="preview-pr">
            <span className="pr-icon">
              <GitPullRequest size={20} />
            </span>
            <div>
              <span className="preview-kicker">PULL REQUEST #142</span>
              <h2>A smoother checkout</h2>
            </div>
            <span className="preview-menu">···</span>
          </div>
          <div className="preview-meta">
            <span>feature/checkout</span>
            <ArrowRight size={12} />
            <span>main</span>
            <code>8a4f2d1</code>
          </div>
          <div className="preview-status">
            <span>
              <CircleDot size={15} /> Attention needed
            </span>
            <span>
              Review complete <Check size={13} />
            </span>
          </div>
          <div className="preview-tests">
            <div>
              <span className="test-dot passed" />
              <span>Checkout regression</span>
              <span>18 passed</span>
            </div>
            <div>
              <span className="test-dot failed" />
              <span>Shipping threshold</span>
              <span>1 failed</span>
            </div>
            <div>
              <span className="test-dot warning" />
              <span>Accessibility scan</span>
              <span>1 issue</span>
            </div>
          </div>
          <div
            className="preview-tabs"
            role="tablist"
            aria-label="Sample review findings"
          >
            {Object.entries(findings).map(([key, value]) => {
              const Icon = value.icon;
              return (
                <button
                  key={key}
                  role="tab"
                  tabIndex={key === active ? 0 : -1}
                  aria-selected={key === active}
                  onKeyDown={(event) => {
                    const keys = Object.keys(
                      findings,
                    ) as (keyof typeof findings)[];
                    const index = keys.indexOf(active);
                    const next =
                      event.key === "ArrowRight"
                        ? keys[(index + 1) % keys.length]
                        : event.key === "ArrowLeft"
                          ? keys[(index + keys.length - 1) % keys.length]
                          : event.key === "Home"
                            ? keys[0]
                            : event.key === "End"
                              ? keys[keys.length - 1]
                              : null;
                    if (next) {
                      event.preventDefault();
                      setActive(next);
                      requestAnimationFrame(() =>
                        document.getElementById(`sample-tab-${next}`)?.focus(),
                      );
                    }
                  }}
                  aria-controls="sample-finding"
                  id={`sample-tab-${key}`}
                  className={active === key ? "active" : ""}
                  onClick={() => setActive(key as keyof typeof findings)}
                >
                  <Icon size={12} />
                  {value.tab}
                </button>
              );
            })}
          </div>
          <div
            className="preview-finding"
            id="sample-finding"
            role="tabpanel"
            aria-labelledby={`sample-tab-${active}`}
          >
            <span className="finding-badge">
              <Sparkles size={10} />
              {finding.label}
            </span>
            <h3>{finding.title}</h3>
            <p>{finding.body}</p>
            <code className="finding-file">{finding.file}</code>
            <div className="finding-diff">
              <code>
                <span>−</span> {finding.code}
              </code>
              <code>
                <span>+</span> {finding.correct}
              </code>
            </div>
            <p className="finding-suggestion">{finding.suggestion}</p>
          </div>
          <div className="preview-bottom">
            <span>
              <MessageSquare size={12} /> Evidence ready for your PR
            </span>
            <span>
              0 source edits <Check size={12} />
            </span>
          </div>
        </div>
      </div>
      <div className="preview-caption">
        <span className="tiny-spark">✦</span> Read the change. Run the checks.
        Show the evidence.
      </div>
    </div>
  );
}
