import { z } from 'zod';
export const memberRoles = ['admin', 'qa', 'viewer'] as const;
export type AccessRole = 'owner' | typeof memberRoles[number];
export const roleRank = { viewer: 0, qa: 1, admin: 2, owner: 3 };
export const SlackSettingsSchema = z.object({ enabled: z.boolean(), channelId: z.string().regex(/^(?:[CG][A-Z0-9]{8,30})?$/), events: z.array(z.enum(['queued','started','completed','blocked','cancelled'])).max(5).refine(v => new Set(v).size === v.length) }).strict().refine(v => !v.enabled || Boolean(v.channelId), 'Choose a Slack channel before enabling updates.');
export const slackDefaults = { enabled: false, channelId: '', events: ['completed','blocked'] as Array<'completed'|'blocked'> };
export const PeopleSchema = z.object({ requestedBy: z.string().max(100).optional(), author: z.string().max(100).optional(), mergedBy: z.string().max(100).optional(), releasedBy: z.string().max(100).optional(), builtBy: z.string().max(100).optional(), source: z.enum(['github','runner','unavailable']) }).strict();
