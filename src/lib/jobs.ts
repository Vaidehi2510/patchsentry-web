import { z } from "zod";
import { SettingsSchema, type RunInput } from "./contracts";

export const browsers = ["chromium", "firefox", "webkit"] as const;
const safeText = (max: number) => z.string().trim().max(max).refine(v => !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v));
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/);
const relativePath = z.string().min(1).max(300).refine(value => {
  try { const decoded = decodeURIComponent(value); return decoded.startsWith("/") && !decoded.startsWith("//") && !/[\\\x00-\x20#]/.test(decoded) && !decoded.split(/[/?]/).includes(".."); } catch { return false; }
}, "Use a repository preview path such as /checkout.");
export const PreviewTemplateSchema = z.string().max(500).refine(value => {
  if (!value) return true;
  const expanded = value.replaceAll("{pr}", "1").replaceAll("{sha}", "a".repeat(40));
  try { const url = new URL(expanded); return !/[{}\s\\]/.test(expanded) && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.hash && !url.search; } catch { return false; }
}, "Use an HTTP(S) preview URL, optionally containing {pr} or {sha}, without credentials or query parameters.");
export const AssertionSchema = z.object({
  id: identifier, action: z.enum(["expectText", "expectVisible", "expectUrl"]),
  selector: safeText(240).optional(), role: z.string().regex(/^[a-z]+$/).max(40).optional(), name: safeText(160).optional(),
  text: safeText(500).optional(), path: relativePath.optional(), exact: z.boolean().optional(),
}).strict().superRefine((a, ctx) => {
  if (a.action === "expectUrl" ? !a.path : !(a.selector || a.role && a.name)) ctx.addIssue({ code: "custom", message: "Each assertion needs an explicit URL path or element selector/role and name." });
  if (a.action === "expectText" && !a.text) ctx.addIssue({ code: "custom", message: "Expected text is required." });
  if (a.exact !== undefined && a.action !== "expectText") ctx.addIssue({ code: "custom", message: "Exact matching applies only to text assertions." });
  if (a.selector !== undefined && (!a.selector || /^(?:javascript|internal):/i.test(a.selector))) ctx.addIssue({ code: "custom", message: "Use an explicit CSS or supported accessibility locator." });
  if (a.role !== undefined && !a.name) ctx.addIssue({ code: "custom", message: "A role locator requires its accessible name." });
  if (a.action === "expectUrl" && [a.selector, a.role, a.name, a.text].some(v => v !== undefined) || a.action !== "expectUrl" && a.path !== undefined || a.action === "expectVisible" && a.text !== undefined) ctx.addIssue({ code: "custom", message: "The assertion contains fields for a different action." });
});
export const GoalSchema = z.object({
  id: identifier, name: safeText(120).min(1), start: relativePath, requirement: safeText(1000).min(1),
  inputs: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,49}$/), safeText(200)).refine(v => Object.keys(v).length <= 10).default({}),
  assertions: z.array(AssertionSchema).min(1).max(8).refine(v => new Set(v.map(a => a.id)).size === v.length),
}).strict();
export const TestingProfileSchema = z.object({
  previewUrlTemplate: PreviewTemplateSchema.default(""),
  baseRef: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/).refine(v => !v.includes("..") && !v.endsWith(".lock")).default("main"),
  pages: z.array(relativePath).min(1).max(8).refine(v => new Set(v).size === v.length).default(["/"]),
  discoverPages: z.boolean().default(true), maxPages: z.number().int().min(1).max(8).default(4),
  allowMutations: z.boolean().default(false),
  visualRegression: z.boolean().default(false),
  browsers: z.array(z.enum(browsers)).min(1).max(3).refine(v => new Set(v).size === v.length).default(["chromium"]),
  goals: z.object({ schemaVersion: z.literal(1), allowSemanticMaintenance: z.boolean().default(false), goals: z.array(GoalSchema).max(8)
    .refine(v => new Set(v.map(g => g.id)).size === v.length)
    .refine(v => v.reduce((sum, goal) => sum + goal.assertions.length, 0) <= 30) }).strict().default({ schemaVersion: 1, allowSemanticMaintenance: false, goals: [] }),
}).strict().refine(v => v.pages.length <= v.maxPages, "The page budget must cover all explicit pages.");
export const testingDefaults = TestingProfileSchema.parse({});
export type TestingProfile = z.infer<typeof TestingProfileSchema>;
export const RunnerSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{32,64}$/), executeJobs: z.boolean(), ready: z.boolean(),
  missing: z.array(safeText(240)).max(20), browsers: z.array(z.enum(browsers)).max(3),
  backends: z.array(z.enum(["openrouter", "local"])).max(2), maxPages: z.number().int().min(0).max(8),
  maxCostUsd: z.number().min(0).max(25), maxCallsPerRun: z.number().int().min(0).max(100),
}).strict().refine(v => !v.ready || v.executeJobs && v.missing.length === 0, "A ready runner must be enrolled and have no missing prerequisites.");
export type Runner = z.infer<typeof RunnerSchema>;
export const JobRequestSchema = z.object({ prNumber: z.number().int().positive().max(100000000), revision: z.string().regex(/^[a-fA-F0-9]{40}$/), dedupeKey: z.string().uuid() }).strict();
export const JobInputSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().uuid(), repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).max(201),
  pr: z.object({ number: z.number().int().positive() }).strict(), revision: z.string().regex(/^[a-f0-9]{40}$/),
  base: z.string().min(1).max(120), settings: SettingsSchema, testingProfile: TestingProfileSchema,
}).strict();
export type JobInput = z.infer<typeof JobInputSchema>;
export const jobStatuses = ["queued", "running", "completed", "blocked", "failed", "cancelled"] as const;
export type JobStatus = typeof jobStatuses[number];
export type Job = JobInput & { status: JobStatus; attempts: number; createdAt: string; updatedAt: string; leaseExpiresAt: string | null; message: string; recordId: string | null };
export const LeaseSchema = z.object({ runnerId: z.string().regex(/^[a-f0-9]{32,64}$/), leaseToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export const AckSchema = LeaseSchema.extend({ status: z.enum(["completed", "blocked", "failed"]), recordId: z.string().regex(/^[a-f0-9]{64}$/).optional(), message: safeText(600).default("") }).strict().refine(v => v.status !== "completed" || Boolean(v.recordId));
export function runnerOnline(lastSeen: string | null | undefined, now = Date.now()) { return !!lastSeen && now - Date.parse(lastSeen) < 90_000 && now >= Date.parse(lastSeen) - 10_000; }
export function jobReportMatches(job: JobInput, report: RunInput) { return report.repository.toLowerCase() === job.repository.toLowerCase() && report.pr.number === job.pr.number && report.revision.toLowerCase() === job.revision; }
