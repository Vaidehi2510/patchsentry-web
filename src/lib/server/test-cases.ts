import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TestCaseInputSchema, type TestCase } from '../test-cases';
import type { Database } from './database';
import { JobError } from './jobs';
type Row = { id: string; project_id: string; name: string; framework: TestCase['framework']; source: string; enabled: boolean; sha256: string; version: number; created_at: Date | string; updated_at: Date | string };
const view = (row: Row): TestCase => ({ id: row.id, name: row.name, framework: row.framework, source: row.source, enabled: row.enabled, sha256: row.sha256, version: row.version, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() });
export async function listTestCases(database: Database, projectId: string) { return (await database.query<Row>('SELECT * FROM qa_test_cases WHERE project_id=$1 ORDER BY created_at,id LIMIT 40', [projectId])).rows.map(view); }
export async function enabledUnitTests(query: Database['query'], projectId: string) {
  const rows = (await query<Row>("SELECT * FROM qa_test_cases WHERE project_id=$1 AND enabled=true AND framework='node' ORDER BY id", [projectId])).rows;
  return rows.map(row => ({ id: row.id, name: row.name, source: row.source, sha256: row.sha256 }));
}
export async function saveTestCase(database: Database, projectId: string, body: unknown, id?: string) {
  const parsed = id ? z.object({ version: z.number().int().positive(), test: TestCaseInputSchema }).strict().safeParse(body) : TestCaseInputSchema.safeParse(body);
  if (!parsed.success) throw new JobError(400, 'Check the test name, framework, source size and sandbox execution setting.');
  const version = id ? (parsed.data as { version: number }).version : undefined;
  const input = TestCaseInputSchema.parse(id ? (parsed.data as { test: unknown }).test : parsed.data);
  const client = await database.connect();
  try {
    await client.query('BEGIN'); await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [projectId]);
    const rows = (await client.query<Row>('SELECT * FROM qa_test_cases WHERE project_id=$1', [projectId])).rows;
    if (id && !rows.some(row => row.id === id)) throw new JobError(404, 'Test case not found.');
    if (id && rows.find(row => row.id === id)!.version !== version) throw new JobError(409, 'This test changed in another tab. Reload before editing.');
    if (!id && rows.length >= 40) throw new JobError(409, 'A project can store up to 40 test cases.');
    const enabled = rows.filter(row => row.id !== id && row.enabled).concat(input.enabled ? [{ source: input.source } as Row] : []);
    if (enabled.length > 8 || enabled.reduce((sum, row) => sum + Buffer.byteLength(row.source), 0) > 96000) throw new JobError(409, 'A job can include up to eight enabled Node tests totaling 96 KB.');
    const hash = createHash('sha256').update(input.source).digest('hex');
    const saved = id ? await client.query<Row>('UPDATE qa_test_cases SET name=$1, framework=$2, source=$3, enabled=$4, sha256=$5, version=version+1, updated_at=now() WHERE id=$6 AND project_id=$7 AND version=$8 RETURNING *', [input.name, input.framework, input.source, input.enabled, hash, id, projectId, version])
      : await client.query<Row>('INSERT INTO qa_test_cases (id,project_id,name,framework,source,enabled,sha256) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [randomUUID(), projectId, input.name, input.framework, input.source, input.enabled, hash]);
    if (!saved.rows.length) throw new JobError(409, 'The test changed while saving. Reload and try again.');
    await client.query('COMMIT'); return view(saved.rows[0]);
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export async function deleteTestCase(database: Database, projectId: string, id: string) { const result = await database.query('DELETE FROM qa_test_cases WHERE id=$1 AND project_id=$2 RETURNING id', [id, projectId]); if (!result.rows.length) throw new JobError(404, 'Test case not found.'); return { deleted: true }; }
