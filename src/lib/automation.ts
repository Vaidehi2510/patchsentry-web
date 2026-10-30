import {z} from 'zod';
const text=(max:number)=>z.string().trim().max(max).refine(v=>!/[\x00-\x1f\x7f]/.test(v));
export const AutomationSettings=z.object({
  refreshExpiredAssessments:z.boolean().default(false),
  temporaryExceptions:z.array(z.object({id:z.uuid(),scope:z.enum(['pr','build','branch','label']),value:text(120).min(1),reason:text(500).min(1),expiresAt:z.iso.datetime()}).strict()).max(30).default([]),
  reconcilePullRequests:z.boolean().default(true),enabled:z.boolean(),events:z.array(z.enum(['pull_request','workflow_run','deployment_status','release','ci'])).max(5).refine(v=>new Set(v).size===v.length),
  workflows:z.array(text(120).min(1)).max(20),environments:z.array(text(120).min(1)).max(20),includeDrafts:z.boolean(),
  excludedBranches:z.array(text(120).min(1)).max(30),excludedLabels:z.array(text(80).min(1)).max(30),excludedPrs:z.array(z.number().int().positive()).max(100),excludedBuilds:z.array(text(120).min(1)).max(100),
  releaseAssetPattern:text(160).default(''),releasePlatform:z.enum(['web','api','android','ios','macos','windows','linux']).default('web'),
  maxNewJobsPerDay:z.number().int().min(1).max(20),weeklyReports:z.boolean(),weeklyEmail:z.boolean(),weeklySlack:z.boolean(),
}).strict().refine(v=>!v.enabled||v.events.length>0,'Choose at least one automatic trigger.');
export type AutomationPolicy=z.infer<typeof AutomationSettings>;
export const automationDefaults:AutomationPolicy={refreshExpiredAssessments:false,temporaryExceptions:[],reconcilePullRequests:true,enabled:false,events:['pull_request','workflow_run','deployment_status','ci'],workflows:[],environments:['preview','staging'],includeDrafts:false,excludedBranches:['dependabot/*'],excludedLabels:['skip-qa'],excludedPrs:[],excludedBuilds:[],releaseAssetPattern:'',releasePlatform:'web',maxNewJobsPerDay:3,weeklyReports:true,weeklyEmail:false,weeklySlack:false};
// Deliberately support only '*' globs; user-supplied regular expressions never execute.
export function matchesException(value:string,patterns:string[]){return patterns.some(pattern=>new RegExp('^'+pattern.split('*').map(v=>v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$','i').test(value));}
export const protectionDimensions=[
  ['requirements','Requirements, business rules, roles and critical journeys'],
  ['data','UI, API, authorization and resulting data assertions'],
  ['interface','Responsive UI, visual baselines, accessibility and keyboard interactions'],
  ['bugs','Reproduction, expected/actual, severity, affected build and suggested fixes'],
  ['execution','Disposable environments, synthetic data, parallel workers and devices'],
  ['governance','Repository authorization, roles, SSO/SCIM, audit and retention'],
  ['release','Tested scope, missed coverage, unresolved risk, cost and release evidence'],
] as const;
