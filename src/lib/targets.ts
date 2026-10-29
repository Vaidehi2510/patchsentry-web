import { z } from 'zod';
export const platforms = ['web', 'api', 'android', 'ios', 'macos', 'windows', 'linux'] as const;
export const platformLabels: Record<typeof platforms[number], string> = { web: 'Web', api: 'API / service', android: 'Android', ios: 'iOS', macos: 'macOS', windows: 'Windows', linux: 'Linux' };
export const AssessmentTargetSchema = z.object({ kind: z.enum(['build', 'release']), name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._+:/-]{0,119}$/), platform: z.enum(platforms), artifactSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type AssessmentTarget = z.infer<typeof AssessmentTargetSchema>;
export type Subject = { pr?: { number: number; title?: string }; target?: AssessmentTarget };
export function subjectLabel(value: Subject) { return value.target ? `${value.target.kind === 'release' ? 'Release' : 'Build'} ${value.target.name}` : `PR #${value.pr?.number ?? '—'}`; }
export function subjectTitle(value: Subject) { return value.target ? `${subjectLabel(value)} · ${platformLabels[value.target.platform]}` : value.pr?.title || subjectLabel(value); }
export function sameSubject(left: Subject, right: Subject) { return left.target || right.target ? Boolean(left.target && right.target && JSON.stringify(AssessmentTargetSchema.parse(left.target)) === JSON.stringify(AssessmentTargetSchema.parse(right.target))) : left.pr?.number === right.pr?.number; }
