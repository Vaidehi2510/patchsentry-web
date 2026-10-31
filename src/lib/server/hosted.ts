import {meteredHosted,closeHostedReservation} from './hosted-meter';
import {poolState,claimHosted,archiveCapacity,releaseReservation} from './capacity';
import {triageAssessment} from './automatic-triage';
import {archiveAssessment,appendLedger} from './assessment-ledger';
import {currentVisualDigest,hostedBaselines} from './visual-baselines';
import {executeHostedUnits,type HostedUnitResult} from './hosted-unit';
import { createHash, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import {join} from 'node:path';
import { Sandbox } from '@vercel/sandbox';
import { z } from 'zod';
import { RunInputSchema, computeScore } from '../contracts';
import { jobReportMatches, type JobInput } from '../jobs';
import type { Runtime } from './runtime';
import { JobError,admitPolicy } from './jobs';
import { providerKey } from './provider-vault';
import { audit, queueNotification, resultSummary } from './team';
import {operatorAuthentication} from './maintenance';
import {rate} from './session-security';
import { policyFor } from './quality';

const bootstrapDomains=['github.com','api.github.com','registry.npmjs.org','*.ubuntu.com','cdn.playwright.dev','playwright.download.prss.microsoft.com','storage.googleapis.com','release-assets.githubusercontent.com','objects.githubusercontent.com'];
const hash = (v:string) => createHash('sha256').update(v).digest('hex');
// Deny special-use networks even when an allowed hostname resolves to one later.
export const deniedNetworks = ['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.0.0.0/24','192.0.2.0/24','192.168.0.0/16','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24','224.0.0.0/4','240.0.0.0/4'];
export function publicAddress(ip:string) {
  if (isIP(ip)===4) { const p=ip.split('.').map(Number);return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224||p[0]===100&&p[1]>=64&&p[1]<=127||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&(p[1]===168||p[1]===0||p[1]===2)||p[0]===198&&(p[1]===18||p[1]===19||p[1]===51)||p[0]===203&&p[1]===0&&p[2]===113); }
  // Hosted previews must use globally routable unicast; reject mapped IPv4 and transition mechanisms.
  return isIP(ip)===6 && /^2[0-9a-f]{3}:/i.test(ip) && !/^200[12]:/i.test(ip);
}
export async function hostedPreview(template:string,job:Pick<JobInput,'revision'|'pr'>,resolve:typeof lookup=lookup) {
  const url=new URL(template.replaceAll('{sha}',job.revision).replaceAll('{pr}',String(job.pr?.number||0)));
  if(url.protocol!=='https:'||url.port&&url.port!=='443'||url.username||url.password||url.search||url.hash||!url.hostname.includes('.')||isIP(url.hostname.replace(/^\[|\]$/g,'')))throw new JobError(400,'Hosted QA needs a public HTTPS preview hostname on port 443. Private previews use the optional private runner.');
  const addresses=await resolve(url.hostname,{all:true});if(!addresses.some(a=>a.family===4)||addresses.some(a=>!publicAddress(a.address)))throw new JobError(400,'This preview resolves to a private or reserved address. Use a public disposable preview for hosted QA.');
  return url;
}
export interface HostedSandbox {
  name:string;
  writeFiles(files:{path:string;content:Buffer}[]):Promise<unknown>;
  runCommand(args:{cmd:string;args:string[];cwd?:string;detached?:boolean;timeoutMs?:number}):Promise<unknown>;
  updateNetworkPolicy?(policy:"deny-all"):Promise<unknown>;
  stop():Promise<unknown>;
}
export interface HostedAdapter {
  create(previewHost:string,artifactHost?:string):Promise<HostedSandbox>;
  get(id:string):Promise<HostedSandbox>;
}
export const hostedAdapter:HostedAdapter={
  async create(host,artifactHost){return Sandbox.create({persistent:false,timeout:15*60_000,resources:{vcpus:2},image:'vercel/sandbox/universal:latest',networkPolicy:{allow:[host,...(artifactHost?[artifactHost]:[]),...bootstrapDomains,'openrouter.ai','patchsentry.vercel.app'],subnets:{deny:deniedNetworks}},tags:{app:'patchsentry',purpose:'hosted-qa'}});},
  async get(id){return Sandbox.get({name:id});},
};
type HostedRow={id:string;project_id:string;payload:JobInput;status:string;attempts:number;sandbox_id:string|null;callback_hash:string|null;hosted_expires_at:string|null;capacity_mode?:string;};
export async function startHosted(runtime:Runtime,projectId:string,jobId:string) {
 if((await poolState(runtime.database.query.bind(runtime.database))).mode==='fair'){await drainHosted(runtime);return;}
 return executeHosted(runtime,projectId,jobId);
}
export async function drainHosted(runtime:Runtime){
 const pool=await poolState(runtime.database.query.bind(runtime.database));if(pool.mode!=='fair')return {started:0};
 const claims:any[]=[];for(let i=0;i<Math.min(pool.limits.active,4);i++){const row=await claimHosted(runtime);if(!row)break;claims.push(row);}
 await Promise.allSettled(claims.map(async row=>{try{await archiveCapacity(runtime,row);await executeHosted(runtime,row.project_id,row.id,row);}catch{await runtime.database.query("UPDATE qa_jobs SET status='blocked',message='Hosted dispatch failed before a complete assessment was available.',updated_at=now() WHERE id=$1 AND status='running'",[row.id]);await releaseReservation(runtime,row.id,false,'dispatch-error');}}));
 return {started:claims.length};
}
async function executeHosted(runtime:Runtime,projectId:string,jobId:string,preclaimed?:any) {
  const q=runtime.database.query.bind(runtime.database),baseAdapter=runtime.hosted||hostedAdapter;
  const adapter=preclaimed?.capacity_mode==='fair'?meteredHosted(runtime,jobId,baseAdapter):baseAdapter;
  // Atomic claim prevents repeated requests, tabs, or deployment retries from starting paid duplicate work.
  const row:HostedRow|undefined=preclaimed||(await q<HostedRow>("UPDATE qa_jobs SET status='running',attempts=attempts+1,runner_id='hosted',lease_expires_at=now()+interval '16 minutes',message='Starting an isolated hosted QA worker.',updated_at=now() WHERE project_id=$1 AND id=$2 AND status='queued' AND attempts=0 AND execution_mode='hosted' RETURNING *",[projectId,jobId])).rows[0];
  if(!row)return;
  let sandbox:HostedSandbox|undefined;
  try {
    const policy=await policyFor(q,projectId),settings=row.payload.settings;
    await admitPolicy(q,projectId,settings,row.id);
    if(policy.requirePlanForRelease&&row.payload.target&&(!row.payload.qualityPlan?.requirements.length||row.payload.qualityPlan.requirements.some(r=>['critical','high'].includes(r.risk)&&!r.checkIds.length&&!r.goalIds.length)))throw new JobError(409,'Map the frozen release requirements before requesting a new hosted run.');
    if(!policy.allowedBackends.includes('openrouter')||policy.approvedModels.length&&[settings.model,...Object.values(settings.roleModels)].filter(Boolean).some(m=>!policy.approvedModels.includes(m!)))throw new JobError(403,'The selected model is outside the current project policy.');
    const preview=await hostedPreview(row.payload.testingProfile.previewUrlTemplate,row.payload,runtime.hostedLookup);
    const artifactHost=row.payload.hostedArtifactUrl?(await hostedPreview(row.payload.hostedArtifactUrl,row.payload,runtime.hostedLookup)).hostname:undefined;
    const credential=await providerKey(runtime,projectId);
    const hasRepositoryKey=(await q("SELECT project_id FROM qa_provider_credentials WHERE project_id=$1 AND provider='github'",[projectId])).rows.length>0;
    const gitHubToken=hasRepositoryKey?(await providerKey(runtime,projectId,'github')).apiKey:undefined;
    const callback=randomBytes(32).toString('base64url');
    const unitResult=await executeHostedUnits(runtime,adapter,row.id,projectId,row.payload);
    if(unitResult)await q('UPDATE qa_jobs SET hosted_unit_result=$2::jsonb WHERE id=$1',[row.id,JSON.stringify(unitResult)]);
    if(!(await q("SELECT id FROM qa_jobs WHERE project_id=$1 AND id=$2 AND status='running'",[projectId,jobId])).rows.length){await stopHosted(runtime,projectId,jobId);return;}
    sandbox=await adapter.create(preview.hostname,artifactHost);
    const registered=await q("UPDATE qa_jobs SET sandbox_id=$3,callback_hash=$4,hosted_expires_at=now()+interval '15 minutes',lease_expires_at=now()+interval '16 minutes',message='Hosted worker preparing browsers and reading the requested source revision.',updated_at=now() WHERE project_id=$1 AND id=$2 AND status='running' RETURNING id",[projectId,jobId,sandbox.name,hash(callback)]);
    if(!registered.rows.length){await sandbox.stop();return;}
    const visualBaselines=row.payload.testingProfile.visualRegression?await hostedBaselines(runtime,projectId):[];
    if(row.payload.testingProfile.visualRegression)await q('UPDATE qa_jobs SET hosted_visual_digest=$2 WHERE id=$1',[row.id,hash(JSON.stringify(visualBaselines.map(b=>[b.record.key,b.record.sha256]).sort((a,b)=>a[0].localeCompare(b[0]))))]);
    // Keys and job capabilities are private files, never command arguments, logs or product files.
    const worker=await readFile(join(process.cwd(),'scripts/hosted-worker.cjs'));
    const engineRevision=(await readFile(join(process.cwd(),'scripts/hosted-engine-revision.txt'),'utf8')).trim();
    if(!/^[a-f0-9]{40}$/.test(engineRevision))throw new Error('Unpinned engine');
    await sandbox.writeFiles([{path:'/vercel/sandbox/hosted-artifact.cjs',content:await readFile(join(process.cwd(),'scripts/hosted-artifact.cjs'))},{path:'/vercel/sandbox/hosted-system.cjs',content:await readFile(join(process.cwd(),'scripts/hosted-system.cjs'))},{path:'/vercel/sandbox/patchsentry-worker.cjs',content:worker},{path:'/vercel/sandbox/qa-input.json',content:Buffer.from(JSON.stringify({job:row.payload,apiKey:credential.apiKey,gitHubToken,callbackToken:callback,callbackUrl:runtime.config.origin+'/api/internal/hosted/'+row.id,engineRevision,allowEvidenceUploads:policy.allowEvidenceUploads,visualBaselines}))}]);
    await sandbox.runCommand({cmd:'node',args:['/vercel/sandbox/patchsentry-worker.cjs'],cwd:'/vercel/sandbox',detached:true,timeoutMs:14*60_000});
    // If cancellation raced with start, stop the VM after launching as well.
    if(!(await q("SELECT id FROM qa_jobs WHERE id=$1 AND project_id=$2 AND status='running'",[jobId,projectId])).rows.length)await sandbox.stop();
    await audit(q,projectId,'Hosted worker','qa.started',jobId);
    await queueNotification(q,projectId,'started',jobId+':hosted-started',{repository:row.payload.repository,revision:row.payload.revision,jobId,target:row.payload.target,pr:row.payload.pr,requestedBy:row.payload.requestedBy});
  }catch(e){let stopped=false;if(sandbox)try{await sandbox.stop();stopped=true;}catch{}const message=e instanceof JobError?e.message:'Hosted execution could not start. Cloud permissions, available quota or worker preparation need attention; no automatic retry was made.';await q("UPDATE qa_jobs SET status='blocked',message=$3,callback_hash=NULL,lease_expires_at=NULL,updated_at=now() WHERE project_id=$1 AND id=$2 AND status='running'",[projectId,jobId,message]);if(row.capacity_mode==='fair')await closeHostedReservation(runtime,jobId,'blocked');else await releaseReservation(runtime,jobId,stopped,'blocked');await audit(q,projectId,'Hosted worker','qa.hosted_blocked',jobId);}
}
export async function stopHosted(runtime:Runtime,projectId:string,jobId:string) {
 const row=(await runtime.database.query<{sandbox_id:string|null;status:string}>("SELECT sandbox_id,status FROM qa_jobs WHERE project_id=$1 AND id=$2 AND execution_mode='hosted'",[projectId,jobId])).rows[0];if(!row)return;
 const recorded=(await runtime.database.query<{vm_id:string}>("SELECT vm_id FROM qa_hosted_stages WHERE job_id=$1 AND vm_id IS NOT NULL AND status<>'stopped'",[jobId])).rows;
 const fair=(await runtime.database.query("SELECT job_id FROM qa_hosted_reservations WHERE job_id=$1",[jobId])).rows.length>0;
 let confirmed=false;const adapter=fair?meteredHosted(runtime,jobId,runtime.hosted||hostedAdapter):(runtime.hosted||hostedAdapter);
 for(const name of new Set([...recorded.map(s=>s.vm_id),...(row.sandbox_id?[row.sandbox_id]:[])])){try{await adapter.get(name).then(s=>s.stop());confirmed=true;}catch{/* Reservations remain held for uncertain provider termination. */}}
 if(fair)await closeHostedReservation(runtime,jobId,row.status);else await releaseReservation(runtime,jobId,confirmed,row.status);
 if(confirmed)await drainHosted(runtime);
}

const Completion=z.object({status:z.enum(['completed','blocked','failed']),report:RunInputSchema.optional(),message:z.string().max(600),durationMs:z.number().int().min(0).max(900000)}).strict();
export async function completeHosted(runtime:Runtime,jobId:string,request:Request,body:unknown){
  const input=Completion.safeParse(body);if(!input.success)throw new JobError(400,'Invalid hosted result.');
  const token=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];if(!token)throw new JobError(401,'Job capability required.');
  const binding=(await runtime.database.query<{project_id:string}>('SELECT project_id FROM qa_jobs WHERE id=$1 AND callback_hash=$2',[jobId,hash(token)])).rows[0];if(!binding)throw new JobError(403,'Invalid job capability.');
  const client=await runtime.database.connect();let projectId=binding.project_id;
  try{await client.query('BEGIN');await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[projectId]);const row=(await client.query<HostedRow>("SELECT * FROM qa_jobs WHERE id=$1 AND execution_mode='hosted' FOR UPDATE",[jobId])).rows[0];if(!row||row.callback_hash!==hash(token))throw new JobError(403,'Invalid job capability.');projectId=row.project_id;
    if(row.status==='completed'){await client.query('COMMIT');return {ok:true,duplicate:true};}
    if(row.status!=='running'||!row.hosted_expires_at||Date.parse(row.hosted_expires_at)<Date.now())throw new JobError(409,'Hosted job expired or was cancelled.');
    const result=input.data,report=result.report;let unitDurationMs=0;
    if(report&&row.payload.unitTests?.length){const units=(await client.query<{hosted_unit_result:HostedUnitResult|null}>("SELECT hosted_unit_result FROM qa_jobs WHERE id=$1",[jobId])).rows[0].hosted_unit_result;if(!units)throw new JobError(409,"Authored unit-test evidence is missing.");unitDurationMs=units.durationMs||0;report.checks=report.checks.filter(c=>!c.id.startsWith("runner-patchsentry-authored-unit-tests"));report.checks.push({id:"runner-patchsentry-authored-unit-tests",name:"Hosted authored Node unit tests",method:"automated",required:true,status:units.status,details:units.details});if(row.payload.qualityPlan){for(const req of row.payload.qualityPlan.requirements){const check=report.checks.find(c=>c.id==='requirement-'+req.id);if(!check)continue;const ids=[...new Set([...req.checkIds,...req.goalIds.flatMap(id=>['goal-'+id,'replay-'+id])])],actual=ids.map(id=>report.checks.find(c=>c.id===id));check.status=actual.some(c=>c?.status==='failed'||c?.status==='execution_error')?'failed':ids.length&&actual.every(c=>c?.method==='automated'&&c.status==='passed')?'passed':'blocked';}}}
    if(report&&row.payload.testingProfile.visualRegression){const saved=(await client.query<{hosted_visual_digest:string}>('SELECT hosted_visual_digest FROM qa_jobs WHERE id=$1',[jobId])).rows[0]?.hosted_visual_digest;report.checks.push({id:'hosted-visual-baseline-stability',name:'Approved visual baseline stability',method:'automated',required:true,status:saved===await currentVisualDigest(client.query.bind(client),projectId)?'passed':'blocked',details:'The approved project visual baselines must remain unchanged during this assessment.'});}
    if(result.status==='completed'&&(!report||!jobReportMatches(row.payload,report)||report.recordId!==hash(`portal:${row.id}:${row.payload.repository}:${row.payload.revision}`)))throw new JobError(409,'Hosted report does not match this exact job and revision.');
    if(report&&result.status==='completed'){
      await client.query('INSERT INTO qa_runs (project_id,record_id,payload) VALUES ($1,$2,$3::jsonb)',[projectId,report.recordId,JSON.stringify({...report,score:computeScore(report),receivedAt:new Date().toISOString()})]);
      await archiveAssessment(runtime,client.query.bind(client),projectId,report);
      await triageAssessment(runtime,client.query.bind(client),projectId,report,jobId,row.payload);
      await client.query('INSERT INTO qa_usage (project_id,record_id,payload) VALUES ($1,$2,$3::jsonb)',[projectId,report.recordId,JSON.stringify({durationMs:result.durationMs+unitDurationMs,unitDurationMs,inferenceUsd:report.ai.costUsd,infrastructureUsd:null,humanMinutes:null,costIsEstimate:report.ai.costIsEstimate,jobId})]);
      await appendLedger(runtime,client.query.bind(client),projectId,'usage-version','hosted-usage:'+jobId,{recordId:report.recordId,durationMs:result.durationMs+unitDurationMs,unitDurationMs,inferenceUsd:report.ai.costUsd,infrastructureUsd:null,humanMinutes:null,costIsEstimate:report.ai.costIsEstimate,source:'Hosted timing plus reported model usage; infrastructure and human time unknown.'},'Hosted worker',report.recordId);
    }
    await client.query("UPDATE qa_jobs SET status=$2,record_id=$3,message=$4,lease_expires_at=NULL,updated_at=now() WHERE id=$1",[jobId,result.status,result.status==='completed'?report!.recordId:null,result.message]);
    const q=client.query.bind(client);await audit(q,projectId,'Hosted worker','qa.'+result.status,jobId);await queueNotification(q,projectId,result.status==='completed'?'completed':'blocked',jobId+':hosted-complete',{repository:row.payload.repository,revision:row.payload.revision,target:row.payload.target,pr:row.payload.pr,requestedBy:row.payload.requestedBy,jobId,...(report?resultSummary(report):{}),message:result.message});
    await client.query('COMMIT');return {ok:true};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

// Operator-only diagnostic: no customer key, source or product traffic is used.
export async function verifyHostedInfrastructure(request:Request,runtime:Runtime){
  operatorAuthentication(request,runtime);await rate(runtime,'hosted-infrastructure-diagnostic',10,86400);
  let sandbox:Sandbox;
  try{sandbox=await Sandbox.create({persistent:false,timeout:300000,resources:{vcpus:2},image:'vercel/sandbox/universal:latest',networkPolicy:{allow:bootstrapDomains,subnets:{deny:deniedNetworks}},tags:{app:'patchsentry',purpose:'browser-diagnostic'}});}catch(e){const error=e as {name?:string;response?:Response;json?:{error?:{code?:string;message?:string}}};const name=/^[A-Za-z]{1,60}$/.test(error.name||'')?error.name:'UnknownError';const code=/^[a-z_]{1,60}$/.test(error.json?.error?.code||'')?error.json!.error!.code:'unspecified';const detail=error.response?.status===400?String(error.json?.error?.message||'').replace(/eyJ[A-Za-z0-9_.-]+/g,'[REDACTED]').slice(0,400):'';throw new JobError(503,`Hosted worker startup: ${name}; HTTP ${error.response?.status||0}; code ${code}. ${detail} No provider key or product data was used.`);}
  try{await sandbox.writeFiles([{path:'/vercel/sandbox/engine-revision.txt',content:await readFile(join(process.cwd(),'scripts/hosted-engine-revision.txt'))},{path:'/vercel/sandbox/hosted-system.cjs',content:await readFile(join(process.cwd(),'scripts/hosted-system.cjs'))},{path:'/vercel/sandbox/smoke.cjs',content:await readFile(join(process.cwd(),'scripts/hosted-smoke.cjs'))}]);const result=await sandbox.runCommand({cmd:'node',args:['/vercel/sandbox/smoke.cjs'],timeoutMs:270000});const output=(await result.stdout()).trim();if(result.exitCode!==0){let detail='';try{const d=JSON.parse(output);detail=String(d.stage)+': '+String(d.detail||'').slice(-900);}catch{}throw new JobError(503,'Hosted browser infrastructure check failed. '+detail);}return {ok:true,...JSON.parse(output)};}finally{await sandbox.stop();}
}
