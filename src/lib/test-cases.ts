import { z } from 'zod';
export const testFrameworks = ['node', 'vitest', 'pytest', 'junit', 'dotnet'] as const;
export const TestCaseInputSchema = z.object({
  name: z.string().trim().min(1).max(120), framework: z.enum(testFrameworks),
  source: z.string().min(1).max(24000).refine(v => !v.includes('\0') && new TextEncoder().encode(v).length <= 24000, 'Test source must fit within 24 KB.'),
  enabled: z.boolean().default(false),
}).strict().refine(v => !v.enabled || v.framework === 'node', 'Only Node unit tests can run directly in the enrolled offline sandbox. Export other frameworks to your CI runner and import its JUnit results.');
export type TestCaseInput = z.infer<typeof TestCaseInputSchema>;
export type TestCase = TestCaseInput & { id: string; sha256: string; version: number; createdAt: string; updatedAt: string };
export const UnitTestSnapshotSchema = z.object({ id: z.string().uuid(), name: z.string().min(1).max(120), source: z.string().min(1).max(24000).refine(v => !v.includes('\0') && new TextEncoder().encode(v).length <= 24000), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
