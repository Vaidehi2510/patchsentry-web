import {
  computeScore,
  settingsDefaults,
  type Project,
  type Run,
  type RunInput,
} from "./contracts";
export const demoProject: Project = {
  id: "demo",
  name: "Acme storefront",
  repository: "demo/acme-storefront",
  createdAt: "2026-09-01T10:00:00Z",
  settings: { ...settingsDefaults, model: "Choose a model" },
  agentLastSeen: null,
  localModels: [],
  tokenConfigured: false,
};
const scenarios = [
  {
    number: 142,
    title: "Add express checkout to the cart",
    passed: 8,
    failed: 1,
    blocked: 1,
    findings: [
      {
        title: "Checkout button falls outside the mobile viewport",
        severity: "high" as const,
        category: "UI / UX",
        file: "src/components/Cart.tsx",
        description:
          "In this illustrative report, the primary action overflows at a 375px viewport. A customer cannot complete checkout without scrolling horizontally.",
        suggestedFix:
          "Allow the action row to wrap, remove its fixed minimum width, and verify the checkout journey at 375px and 768px.",
        status: "unverified" as const,
      },
      {
        title: "Discount total is inconsistent after quantity changes",
        severity: "medium" as const,
        category: "Functional",
        file: "src/cart/totals.ts",
        description:
          "The sample quantity-change scenario keeps the previous discount value after the subtotal updates.",
        suggestedFix:
          "Recalculate discounts from the updated item quantities and add a regression case for the threshold boundary.",
        status: "unverified" as const,
      },
    ],
  },
  {
    number: 139,
    title: "Improve search filtering and empty states",
    passed: 12,
    failed: 0,
    blocked: 0,
    findings: [],
  },
  {
    number: 137,
    title: "Update account settings navigation",
    passed: 6,
    failed: 0,
    blocked: 2,
    findings: [],
  },
];
export const demoRuns: Run[] = scenarios.map((s, i) => {
  const names = [
    "Build and type checks",
    "Unit regression suite",
    "API contract checks",
    "Desktop checkout journey",
    "Keyboard navigation",
    "Accessibility scan",
    "Image and resource loading",
    "Code and security review",
    "Mobile layout regression",
    "Preview revision verification",
    "Search results journey",
    "Empty state accessibility",
  ];
  const input: RunInput = {
    schemaVersion: 1,
    recordId: String(i + 1).repeat(64),
    repository: demoProject.repository,
    pr: { number: s.number, title: s.title },
    revision: ("a4d9e" + i).padEnd(40, "c"),
    createdAt: `2026-09-${28 - i}T14:32:00Z`,
    completedAt: `2026-09-${28 - i}T14:36:00Z`,
    phase: "completed",
    checks: Array.from({ length: s.passed + s.failed + s.blocked }, (_, j) => ({
      id: `check-${j}`,
      name: names[j] || "Required check",
      method: j === 7 ? "analysis" : "automated",
      required: true,
      status:
        j < s.passed
          ? "passed"
          : j < s.passed + s.failed
            ? "failed"
            : "blocked",
      details:
        j < s.passed
          ? "Sample check completed with supporting evidence."
          : j < s.passed + s.failed
            ? "Horizontal overflow detected in the sample mobile journey."
            : "The sample preview could not prove its deployed revision.",
    })),
    findings: s.findings,
    ai: {
      backend: "openrouter",
      model: "Illustrative model",
      costUsd: null,
      costIsEstimate: true,
      calls: 10 - i,
    },
    limitations: [
      "Illustrative demo data. These checks were not run against your product.",
      "A passing check covers its stated scenario and revision, not every possible behavior.",
    ],
  };
  return {
    ...input,
    score: computeScore(input),
    receivedAt: input.completedAt!,
  };
});
