"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Code2, Download, Plus, Save, Trash2, ShieldCheck } from 'lucide-react';
import { TestCaseInputSchema, testFrameworks, type TestCase, type TestCaseInput } from '@/lib/test-cases';
import type { Project } from '@/lib/contracts';
const template = `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst path = require('node:path');\n\n// Product files are read-only at process.env.QA_PRODUCT_ROOT.\n// Example: require(path.join(process.env.QA_PRODUCT_ROOT, 'src/totals.cjs'));\ntest('describe the expected product behavior', () => {\n  assert.fail('Replace this draft with an assertion against your product');\n});\n`;
const templates = {
  node: template,
  vitest: "import { test, expect } from 'vitest';\n\ntest('describe expected product behavior', () => {\n  expect.fail('Replace this draft with a product assertion');\n});\n",
  pytest: "import pytest\n\ndef test_expected_product_behavior():\n    pytest.fail('Replace this draft with a product assertion')\n",
  junit: "import org.junit.jupiter.api.Test;\nimport static org.junit.jupiter.api.Assertions.fail;\n\nclass ProductTest {\n  @Test void expectedProductBehavior() {\n    fail(\"Replace this draft with a product assertion\");\n  }\n}\n",
  dotnet: "using Xunit;\n\npublic class ProductTests {\n  [Fact] public void ExpectedProductBehavior() {\n    Assert.Fail(\"Replace this draft with a product assertion\");\n  }\n}\n",
};
const draft = (): TestCaseInput => ({ name: '', framework: 'node', source: template, enabled: false });
const labels = { node: 'Node.js · offline sandbox', vitest: 'Vitest · export to CI', pytest: 'Python / pytest · export to CI', junit: 'Java / JUnit · export to CI', dotnet: '.NET · export to CI' };
async function request(url: string, method = 'GET', body?: unknown) {
  const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, cache: 'no-store', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Could not save the test.'); return value;
}
export function TestLibrary({ project, demo }: { project: Project; demo: boolean }) {
  const [tests, setTests] = useState<TestCase[]>([]), [editing, setEditing] = useState<TestCase | null>(null), [input, setInput] = useState(draft), [busy, setBusy] = useState(false), [loading, setLoading] = useState(!demo), [error, setError] = useState(''), [message, setMessage] = useState(''), [deleting, setDeleting] = useState('');
  useEffect(() => { if (demo) return; let alive = true; request(`/api/projects/${project.id}/tests`).then(data => { if (alive) setTests(data.tests); }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [project.id, demo]);
  function choose(test?: TestCase) { setEditing(test || null); setInput(test ? { name: test.name, framework: test.framework, source: test.source, enabled: test.enabled } : draft()); setError(''); setMessage(''); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(''); setMessage('');
    const parsed = TestCaseInputSchema.safeParse(input); if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    if (demo) { setMessage('This is a local demo draft. Export it below, or create an account to save tests to a project.'); return; }
    setBusy(true);
    try { const result = await request(`/api/projects/${project.id}/tests${editing ? `/${editing.id}` : ''}`, editing ? 'PATCH' : 'POST', editing ? { version: editing.version, test: parsed.data } : parsed.data); setTests(values => [...values.filter(t => t.id !== result.test.id), result.test]); setEditing(result.test); setMessage('Test saved. New QA requests take an immutable copy of enabled tests; queued runs are unchanged.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove(id: string) { setBusy(true); setError(''); try { await request(`/api/projects/${project.id}/tests/${id}`, 'DELETE'); setTests(values => values.filter(t => t.id !== id)); if (editing?.id === id) choose(); setDeleting(''); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  function download() { const ext = { node: '.test.cjs', vitest: '.test.ts', pytest: '.py', junit: '.java', dotnet: '.cs' }[input.framework]; const url = URL.createObjectURL(new Blob([input.source], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = (input.name || 'product-test').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) + ext; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return <div className="test-library"><div className="notice"><ShieldCheck size={21}/><div><strong>Your tests. A separate workspace.</strong><p>Author unit tests or adapt model suggestions here. Product source stays read-only. Enabled Node tests run only in an explicitly enrolled offline sandbox; other frameworks export to your CI, whose JUnit results can be imported.</p></div></div>
    <div className="test-library-layout"><section className="panel test-library-list"><div className="panel-heading"><div><h2>Test library</h2><p>{tests.filter(t => t.enabled).length}/8 enabled for new runs</p></div><button className="icon-button" aria-label="New unit test" onClick={() => choose()}><Plus size={20}/></button></div>{loading ? <p className="empty-state">Loading saved tests…</p> : !tests.length ? <p className="empty-state">Start with one important boundary or regression. Drafts stay paused until you enable them.</p> : tests.map(test => <button className={`test-library-item ${editing?.id === test.id ? 'active' : ''}`} key={test.id} onClick={() => choose(test)}><Code2 size={18}/><span><strong>{test.name}</strong><small>{test.framework} · {test.enabled ? 'Enabled' : 'Draft'} · v{test.version}</small></span></button>)}{demo && <Link className="text-button" href="/signup">Create an account to save tests →</Link>}</section>
    <form className="panel test-editor" onSubmit={save}><div className="panel-heading"><div><span className="eyebrow">{editing ? 'EDIT YOUR TEST' : 'START A DRAFT'}</span><h2>{editing ? editing.name : 'What should always work?'}</h2></div></div><div className="testing-fields"><label>Test name<input required maxLength={120} value={input.name} onChange={e => setInput({ ...input, name: e.target.value })} placeholder="Free shipping includes the $100 boundary"/></label><label>Framework<select aria-label="Framework" value={input.framework} onChange={e => { const framework = e.target.value as TestCaseInput["framework"]; setInput({ ...input, framework, source: input.source === templates[input.framework] ? templates[framework] : input.source, enabled: false }); }}>{testFrameworks.map(f => <option key={f} value={f}>{labels[f]}</option>)}</select></label></div>
      <label>Test source<textarea aria-label="Test source" className="test-source" rows={18} maxLength={24000} value={input.source} spellCheck={false} autoCapitalize="none" onChange={e => setInput({ ...input, source: e.target.value })}/></label><p className="fineprint">Use synthetic inputs. The website stores your authored test source; it never executes it. Node tests use the standard <code>node:test</code> runner and <code>QA_PRODUCT_ROOT</code> for the exact read-only product snapshot.</p>
      <label className="testing-checkbox"><input type="checkbox" disabled={input.framework !== 'node'} checked={input.enabled} onChange={e => setInput({ ...input, enabled: e.target.checked })}/>Include this Node unit test in future QA requests</label><p className="fineprint">The local runner must independently permit authored tests. Saving or exporting a draft does not run code or call a model.</p>
      {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="notice success" role="status">{message}</p>}
      <div className="testing-inline"><button className="button button-primary" disabled={busy}><Save size={18}/>{busy ? 'Saving…' : editing ? 'Save revision' : 'Save test draft'}</button><button type="button" className="button button-secondary" onClick={download}><Download size={18}/>Export test</button>{editing && <button type="button" className="text-button" disabled={busy} onClick={() => setDeleting(editing.id)}><Trash2 size={17}/>Delete</button>}</div>
      {deleting && <div className="notice warning"><div><strong>Delete this saved test?</strong><p>Existing job snapshots keep their original test source.</p><button type="button" className="button button-secondary" disabled={busy} onClick={() => remove(deleting)}>Delete test</button> <button type="button" className="text-button" onClick={() => setDeleting('')}>Keep it</button></div></div>}
    </form></div>
  </div>;
}
