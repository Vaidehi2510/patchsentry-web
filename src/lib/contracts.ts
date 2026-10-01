import { z } from "zod";
import type { Runner, TestingProfile } from "./jobs";

export const roles = [
  "planner",
  "code-review",
  "security",
  "ui-ux",
  "triage",
] as const;
export const roleLabels: Record<string, string> = {
  planner: "Test planner",
  "code-review": "Code reviewer",
  security: "Security reviewer",
  "ui-ux": "UI / UX reviewer",
  triage: "Bug triage",
};
const ModelId = z
  .string()
  .trim()
  .max(160)
  .regex(/^[a-zA-Z0-9_./:@+\-]*$/, "Use a model ID from the catalog.");
export const SettingsSchema = z
  .object({
    backend: z.enum(["openrouter", "local"]).default("openrouter"),
    model: ModelId.default(""),
    roleModels: z.partialRecord(z.enum(roles), ModelId).default({}),
    roles: z
      .array(z.enum(roles))
      .min(1)
      .max(5)
      .refine((v) => new Set(v).size === v.length)
      .default([...roles]),
    maxCostUsd: z.number().finite().min(0).max(25).default(2),
    maxCallsPerRun: z.number().int().min(1).max(40).default(20),
    allowImages: z.boolean().default(false),
  })
  .strict();
export const settingsDefaults = {
  backend: "openrouter" as const,
  model: "",
  roleModels: {},
  roles: [...roles],
  maxCostUsd: 2,
  maxCallsPerRun: 20,
  allowImages: false,
};
export type Settings = z.infer<typeof SettingsSchema>;
export const LocalModelSchema = z
  .object({
    id: ModelId.min(1),
    name: z.string().max(160),
    contextLength: z.number().int().min(1024).max(10000000),
    tools: z.boolean(),
    vision: z.boolean(),
  })
  .strict();
export type LocalModel = z.infer<typeof LocalModelSchema>;
export const statuses = [
  "passed",
  "failed",
  "blocked",
  "skipped",
  "pending",
  "running",
  "execution_error",
  "awaiting_human",
  "unsupported",
] as const;
export const CheckSchema = z
  .object({
    id: z.string().min(1).max(160),
    name: z.string().max(240),
    method: z.enum(["automated", "analysis", "human", "unsupported"]),
    required: z.boolean(),
    status: z.enum(statuses),
    details: z.string().max(1200).optional(),
  })
  .strict();
export const FindingSchema = z
  .object({
    title: z.string().min(1).max(240),
    severity: z.enum(["critical", "high", "medium", "low", "info"]),
    category: z.string().max(80),
    file: z.string().max(300).optional(),
    description: z.string().max(1600),
    suggestedFix: z.string().max(1600).optional(),
    status: z.literal("unverified"),
  })
  .strict();
export const RunInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    recordId: z.string().regex(/^[a-f0-9]{64}$/),
    repository: z
      .string()
      .regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)
      .max(201),
    pr: z
      .object({
        number: z.number().int().positive(),
        title: z.string().max(300),
      })
      .strict(),
    revision: z.string().regex(/^[a-fA-F0-9]{40,64}$/),
    createdAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable().optional(),
    phase: z.string().max(80),
    checks: z
      .array(CheckSchema)
      .max(200)
      .refine(
        (v) => new Set(v.map((x) => x.id)).size === v.length,
        "Duplicate check IDs",
      ),
    findings: z.array(FindingSchema).max(100),
    ai: z
      .object({
        backend: z.enum(["openrouter", "local", "unknown"]),
        model: z.string().max(160),
        costUsd: z.number().finite().min(0).max(10000).nullable(),
        costIsEstimate: z.boolean(),
        calls: z.number().int().min(0).max(10000),
      })
      .strict(),
    limitations: z.array(z.string().max(600)).max(30),
  })
  .strict();
export type RunInput = z.infer<typeof RunInputSchema>;
export type Check = z.infer<typeof CheckSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type RunStatus =
  "passed" | "failed" | "blocked" | "running" | "needs_review" | "no_checks";
export type Score = {
  score: number | null;
  passed: number;
  failed: number;
  blocked: number;
  pending: number;
  total: number;
  status: RunStatus;
};
export function computeScore(
  input: Pick<RunInput, "checks" | "findings">,
): Score {
  const required = input.checks.filter((c) => c.required);
  const passed = required.filter(
    (c) => c.status === "passed" && c.method !== "unsupported",
  ).length;
  const failed = required.filter(
    (c) => c.status === "failed" || c.status === "execution_error",
  ).length;
  const pending = required.filter(
    (c) => c.status === "pending" || c.status === "running",
  ).length;
  const blocked = required.length - passed - failed - pending;
  const highRisk = input.findings.some(
    (f) => f.severity === "critical" || f.severity === "high",
  );
  return {
    score: required.length
      ? Math.floor((100 * passed) / required.length)
      : null,
    passed,
    failed,
    blocked,
    pending,
    total: required.length,
    status: !required.length
      ? "no_checks"
      : failed
        ? "failed"
        : blocked
          ? "blocked"
          : pending
            ? "running"
            : highRisk
              ? "needs_review"
              : "passed",
  };
}
export type Project = {
  id: string;
  name: string;
  repository: string;
  createdAt: string;
  settings: Settings;
  agentLastSeen: string | null;
  localModels: LocalModel[];
  tokenConfigured?: boolean;
  testingProfile?: TestingProfile;
  runner?: Runner | null;
};
export type Run = RunInput & { score: Score; receivedAt: string };
export type CatalogModel = {
  id: string;
  name: string;
  contextLength: number;
  tools: boolean;
  vision: boolean;
  promptPrice: number | null;
  completionPrice: number | null;
};
