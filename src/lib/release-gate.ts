import { computeScore, type RunInput } from './contracts';
import { sameSubject, type AssessmentTarget } from './targets';
export function releaseGate(report: RunInput, expected: { revision: string; target: AssessmentTarget }, now = Date.now()) {
  const reasons: string[] = [];
  if (report.revision.toLowerCase() !== expected.revision.toLowerCase() || !sameSubject(report, { target: expected.target })) reasons.push('The report does not match the requested source revision, artifact, platform and build/version.');
  const completed = Date.parse(report.completedAt || '');
  if (report.phase !== 'completed' || !Number.isFinite(completed) || completed > now + 10000 || now - completed > 3600000) reasons.push('Release evidence must be complete and less than one hour old. Request fresh QA.');
  if (computeScore(report).status !== 'passed') reasons.push('Required checks or findings still need attention.');
  for (const id of ['release-artifact','release-platform','release-artifact-stability','release-input-stability']) if (!report.checks.some(c => c.id === id && c.method === 'automated' && c.required && c.status === 'passed')) reasons.push(`Missing passing release gate: ${id}`);
  if (!report.checks.some(c => !c.id.startsWith('release-') && c.required && c.method === 'automated')) reasons.push('No required product tests establish release readiness.');
  return { eligible: reasons.length === 0, reasons, expiresAt: Number.isFinite(completed) ? new Date(completed + 3600000).toISOString() : null };
}
