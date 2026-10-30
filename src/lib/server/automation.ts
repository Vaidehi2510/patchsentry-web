import {restrictedDomain} from './domain-policy';
import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {AutomationSettings,automationDefaults,matchesException,type AutomationPolicy} from '../automation';
import {canonical} from '../quality';
import {enabledUnitTests} from './test-cases';
import {JobRequestSchema,TestingProfileSchema,testingDefaults} from '../jobs';
import {createJob,JobError,type QueueProject} from './jobs';
import type {Runtime} from './runtime';
import {providerKey,sealProvider} from './provider-vault';
import {audit} from './team';
import {planSnapshot} from './quality';
import {startHosted} from './hosted';
import {computeScore,type RunInput} from '../contracts';
import {releaseGate} from '../release-gate';
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
type Project=QueueProject&{owner_id:string;name:string};
type Event={id:string;project_id:string;kind:string;payload:any;status:string;reason:string;job_id:string|null};
async function github(runtime:Runtime,repository:string,suffix:string,token:string,maximum=256000){
 const response=await(runtime.repositoryFetch||fetch)('https://api.github.com'+(suffix==='/user'?suffix:'/repos/'+repository+suffix),{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28'}});
 if(!response.ok){await response.body?.cancel();throw new JobError(409,'GitHub read access, event identity or integration administrator permission could not be verified. Check the token’s read scopes.');}
 const reader=response.body?.getReader();if(!reader)throw new JobError(409,'GitHub returned no verifiable event.');const parts:Buffer[]=[];let n=0;try{for(;;){const p=await reader.read();if(p.done)break;n+=p.value.length;if(n>maximum){await reader.cancel();throw new JobError(413,'GitHub verification exceeded the response limit.');}parts.push(Buffer.from(p.value));}}finally{reader.releaseLock();}return JSON.parse(Buffer.concat(parts).toString());
}
export async function automationPolicy(runtime:Runtime,id:string):Promise<AutomationPolicy>{const row=(await runtime.database.query<{payload:unknown}>('SELECT payload FROM qa_automation_settings WHERE project_id=$1',[id])).rows[0];return row?AutomationSettings.parse(row.payload):automationDefaults;}
async function authority(runtime:Runtime,p:Project){
 const token=(await providerKey(runtime,p.id,'github')).apiKey,repo=await github(runtime,p.repository,'',token),user=await github(runtime,p.repository,'/user',token);
 if(repo.full_name?.toLowerCase()!==p.repository||!Number.isSafeInteger(repo.id)||!Number.isSafeInteger(user.id)||!/^[A-Za-z0-9-]{1,39}$/.test(user.login||''))throw new JobError(403,'The integration repository or GitHub identity changed.');
 const permission=await github(runtime,p.repository,'/collaborators/'+user.login+'/permission',token);
 if(permission.permission!=='admin'||permission.user?.id!==user.id)throw new JobError(403,'Automatic QA must be connected by a GitHub repository administrator. The token can keep read-only scopes.');
 await runtime.database.query("INSERT INTO qa_repository_authorizations (project_id,owner_id,github_repository_id,github_user_id,github_login,mode) VALUES ($1,$2,$3,$4,$5,'admin') ON CONFLICT(project_id) DO UPDATE SET owner_id=EXCLUDED.owner_id,github_repository_id=EXCLUDED.github_repository_id,github_user_id=EXCLUDED.github_user_id,github_login=EXCLUDED.github_login,mode='admin',verified_at=now()",[p.id,p.owner_id,repo.id,user.id,user.login]);return {token,repo};
}
export async function automationView(runtime:Runtime,id:string){return {domainPolicy:await restrictedDomain(runtime.database.query.bind(runtime.database),id),settings:await automationPolicy(runtime,id),hookConfigured:Boolean((await runtime.database.query("SELECT project_id FROM qa_provider_credentials WHERE project_id=$1 AND provider='automation-hook'",[id])).rows.length),webhookUrl:runtime.config.origin+'/api/automation/'+id+'/github',ciUrl:runtime.config.origin+'/api/automation/'+id+'/ci',events:(await runtime.database.query('SELECT e.id,e.kind,e.payload,e.status,e.reason,e.job_id,e.created_at,j.status AS job_status FROM qa_automation_events e LEFT JOIN qa_jobs j ON j.id=e.job_id AND j.project_id=e.project_id WHERE e.project_id=$1 ORDER BY e.created_at DESC LIMIT 50',[id])).rows};}
export async function saveAutomation(runtime:Runtime,p:Project,body:unknown,actor:string){const parsed=AutomationSettings.safeParse(body);if(!parsed.success)throw new JobError(400,parsed.error.issues[0]?.message||'Review the automatic QA settings.');if((parsed.data.weeklyEmail||parsed.data.weeklySlack)&&await restrictedDomain(runtime.database.query.bind(runtime.database),p.id))throw new JobError(403,'Email and Slack QA reports are disabled for domain-restricted projects. Use the authenticated dashboard.');if(parsed.data.enabled){await authority(runtime,p);if(!(await runtime.database.query("SELECT project_id FROM qa_provider_credentials WHERE project_id=$1 AND provider='automation-hook'",[p.id])).rows.length)throw new JobError(409,'Issue the webhook signing secret before enabling automatic QA.');}
 await runtime.database.query('INSERT INTO qa_automation_settings(project_id,payload) VALUES($1,$2::jsonb) ON CONFLICT(project_id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()',[p.id,JSON.stringify(parsed.data)]);await audit(runtime.database.query.bind(runtime.database),p.id,actor,'automation.settings',parsed.data.enabled?'Automatic QA enabled with explicit event and exception policy.':'Automatic QA disabled.');return automationView(runtime,p.id);}
export async function rotateAutomationSecret(runtime:Runtime,id:string,actor:string){await runtime.database.query('INSERT INTO qa_automation_settings(project_id,payload) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING',[id,JSON.stringify(automationDefaults)]);const secret=randomBytes(32).toString('base64url');await runtime.database.query("INSERT INTO qa_provider_credentials(project_id,provider,encrypted,suffix,version) VALUES($1,'automation-hook',$2,$3,nextval('qa_provider_generation')) ON CONFLICT(project_id,provider) DO UPDATE SET encrypted=EXCLUDED.encrypted,suffix=EXCLUDED.suffix,version=nextval('qa_provider_generation'),verified_at=now()",[id,sealProvider(runtime,id,secret,'automation-hook'),secret.slice(-4)]);await audit(runtime.database.query.bind(runtime.database),id,actor,'automation.secret_rotated','Previous webhook and CI signatures are invalid. Existing jobs are unaffected.');return {secret,...await automationView(runtime,id)};}
async function rawBody(request:Request){if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))throw new JobError(415,'Use application/json.');if(!request.body)throw new JobError(400,'Event body required.');const reader=request.body.getReader(),parts:Buffer[]=[];let n=0;try{for(;;){const p=await reader.read();if(p.done)break;n+=p.value.length;if(n>512000){await reader.cancel();throw new JobError(413,'Event payload exceeds 512KB.');}parts.push(Buffer.from(p.value));}}finally{reader.releaseLock();}return Buffer.concat(parts);}
export async function receiveAutomation(runtime:Runtime,id:string,channel:'github'|'ci',request:Request){
 const p=(await runtime.database.query<Project>('SELECT * FROM projects WHERE id=$1',[id])).rows[0];if(!p)throw new JobError(404,'Integration not found.');
 let secret:string;try{secret=(await providerKey(runtime,id,'automation-hook')).apiKey;}catch{throw new JobError(403,'Webhook signing is not configured.');}
 const raw=await rawBody(request),signature=request.headers.get('x-hub-signature-256')||'',expected='sha256='+createHmac('sha256',secret).update(raw).digest('hex');if(!/^sha256=[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw new JobError(401,'Invalid event signature.');
 const delivery=request.headers.get('x-github-delivery')||'',kind=channel==='ci'?'ci':request.headers.get('x-github-event')||'';if(!/^[A-Za-z0-9_-]{16,100}$/.test(delivery)||!['ping','pull_request','workflow_run','deployment_status','release','ci'].includes(kind))throw new JobError(400,'Unsupported event or missing delivery identity.');
 let body:any;try{body=JSON.parse(raw.toString());if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{throw new JobError(400,'Invalid event JSON.');}if(typeof (channel==='ci'?body.repository:body.repository?.full_name)!=='string'||(channel==='ci'?body.repository:body.repository.full_name).toLowerCase()!==p.repository)throw new JobError(403,'This event belongs to a different repository.');
 const normalized=normalizeEvent(kind,body),fingerprint=hash(raw),eventId=randomUUID();
 const row=(await runtime.database.query<Event>('INSERT INTO qa_automation_events(id,project_id,delivery_id,body_hash,kind,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(project_id,delivery_id) DO NOTHING RETURNING *',[eventId,id,delivery,fingerprint,kind,JSON.stringify(normalized)])).rows[0];
 if(!row){const prior=(await runtime.database.query<{body_hash:string;id:string}>('SELECT body_hash,id FROM qa_automation_events WHERE project_id=$1 AND delivery_id=$2',[id,delivery])).rows[0];if(prior.body_hash!==fingerprint)throw new JobError(409,'A delivery ID cannot change its event body.');return {accepted:true,duplicate:true,id:prior.id};}
 return {accepted:true,duplicate:false,id:eventId};
}
function normalizeEvent(kind:string,b:any){
 if(kind==='ci'){const parsed=JobRequestSchema.safeParse({...b.request,dedupeKey:'00000000-0000-4000-8000-000000000001'});if(!parsed.success)throw new JobError(400,'CI events must identify the exact PR or build, full source SHA and artifact digest.');return {request:parsed.data,branch:String(b.branch||'').slice(0,120),labels:[],actor:String(b.actor||'CI').slice(0,100)};}
 const base={repositoryId:b.repository?.id,action:String(b.action||'').slice(0,60),actor:String(b.sender?.login||'GitHub').slice(0,100)};
 if(kind==='pull_request')return {...base,number:b.number};
 if(kind==='workflow_run')return {...base,runId:b.workflow_run?.id};
 if(kind==='deployment_status')return {...base,deploymentId:b.deployment?.id,statusId:b.deployment_status?.id};
 if(kind==='release')return {...base,releaseId:b.release?.id};
 return base;
}
async function resolveEvent(runtime:Runtime,p:Project,e:Event,policy:AutomationPolicy,token:string){
 const x=e.payload;for(const field of ['number','runId','deploymentId','statusId','releaseId'])if(x[field]!==undefined&&(!Number.isSafeInteger(x[field])||x[field]<1))throw new JobError(400,'Invalid numeric GitHub event identity.');let branch='',labels:string[]=[],draft=false,request:any,workflow='',environment='';
 async function pr(number:number){if(!Number.isSafeInteger(number)||number<1)throw new JobError(400,'Invalid PR identity.');const value=await github(runtime,p.repository,'/pulls/'+number,token);if(value.state!=='open')throw new JobError(422,'The PR is closed.');branch=String(value.head?.ref||'');labels=(value.labels||[]).map((l:any)=>String(l.name));draft=Boolean(value.draft);return {prNumber:number,revision:value.head?.sha};}
 if(e.kind==='pull_request'){if(!['opened','reopened','synchronize','ready_for_review','labeled','unlabeled'].includes(x.action))throw new JobError(422,'This PR action does not request QA.');request=await pr(x.number);}
 else if(e.kind==='workflow_run'){const run=await github(runtime,p.repository,'/actions/runs/'+x.runId,token);workflow=run.name;if(run.status!=='completed'||run.conclusion!=='success')throw new JobError(422,'CI is incomplete or unsuccessful.');if(!policy.workflows.includes(workflow))throw new JobError(422,'CI workflow is not explicitly selected.');if(run.pull_requests?.length!==1)throw new JobError(422,'This CI run needs a signed build manifest, or exactly one associated PR.');request=await pr(run.pull_requests[0].number);if(request.revision!==run.head_sha)throw new JobError(422,'CI tested an older PR revision.');}
 else if(e.kind==='deployment_status'){const deployment=await github(runtime,p.repository,'/deployments/'+x.deploymentId,token),status=await github(runtime,p.repository,'/deployments/'+x.deploymentId+'/statuses',token);environment=deployment.environment;if(deployment.production_environment===true)throw new JobError(422,'Production deployments are not disposable QA environments.');if(!policy.environments.includes(environment))throw new JobError(422,'Deployment environment is outside the selected preview environments.');if(!Array.isArray(status)||status[0]?.id!==x.statusId||status[0]?.state!=='success')throw new JobError(422,'Deployment is unsuccessful or this status is superseded.');if(!/^[a-f0-9]{40}$/.test(deployment.sha||''))throw new JobError(400,'Deployment source identity is missing.');const prs=await github(runtime,p.repository,'/commits/'+deployment.sha+'/pulls',token);if(!Array.isArray(prs)||prs.filter((v:any)=>v.state==='open').length!==1)throw new JobError(422,'Deployment needs one open PR, or a signed build/release manifest.');request=await pr(prs.find((v:any)=>v.state==='open').number);if(request.revision!==deployment.sha)throw new JobError(422,'Deployment does not match the current PR revision.');}
 else if(e.kind==='release'){
   if(x.action!=='published')throw new JobError(422,'Only published releases request QA.');
   if(!policy.releaseAssetPattern)throw new JobError(422,'Select a release artifact name pattern before automatic release QA.');
   const release=await github(runtime,p.repository,'/releases/'+x.releaseId,token);if(release.draft||typeof release.tag_name!=='string'||release.tag_name.length>120)throw new JobError(422,'Release metadata is incomplete or still a draft.');
   const assets=(release.assets||[]).filter((a:any)=>matchesException(String(a.name),[policy.releaseAssetPattern]));if(assets.length!==1||!Number.isSafeInteger(assets[0].id)||!/^sha256:[a-f0-9]{64}$/.test(assets[0].digest||''))throw new JobError(422,'Release QA needs exactly one matching uploaded artifact with a GitHub-verified SHA-256 digest.');
   let object=(await github(runtime,p.repository,'/git/ref/tags/'+encodeURIComponent(release.tag_name),token)).object;
   for(let i=0;object?.type==='tag'&&i<3;i++){if(!/^[a-f0-9]{40}$/.test(object.sha||''))throw new JobError(400,'Invalid tag identity.');object=(await github(runtime,p.repository,'/git/tags/'+object.sha,token)).object;}
   if(object?.type!=='commit'||!/^[a-f0-9]{40}$/.test(object.sha||''))throw new JobError(422,'The published tag could not be resolved to one immutable source commit.');
   request={revision:object.sha,target:{kind:'release',name:release.tag_name,platform:policy.releasePlatform,artifactSha256:assets[0].digest.slice(7)},hostedArtifactUrl:'https://api.github.com/repos/'+p.repository+'/releases/assets/'+assets[0].id};branch=release.tag_name;
 }
 else if(e.kind==='ci'){request=x.request;branch=x.branch;if(request.target){if(!branch)throw new JobError(400,'Build manifests must identify their source branch.');const ref=await github(runtime,p.repository,'/git/ref/heads/'+encodeURIComponent(branch),token);if(ref.object?.type!=='commit'||ref.object.sha!==request.revision)throw new JobError(422,'The CI build is not the current verified source branch revision.');}const commit=await github(runtime,p.repository,'/commits/'+request.revision,token);if(commit.sha!==request.revision)throw new JobError(409,'CI source revision is not verified in this repository.');if(request.prNumber){const current=await pr(request.prNumber);if(current.revision!==request.revision)throw new JobError(422,'CI manifest refers to an older PR revision.');}}
 else throw new JobError(422,'Webhook connection verified; ping starts no QA.');
 if(!/^[a-f0-9]{40}$/.test(request.revision||''))throw new JobError(400,'GitHub did not provide an exact source revision.');
 if(draft&&!policy.includeDrafts)throw new JobError(422,'Draft PRs are excluded.');if(matchesException(branch,policy.excludedBranches))throw new JobError(422,'Branch matches an explicit exception.');if(labels.some(label=>matchesException(label,policy.excludedLabels)))throw new JobError(422,'PR label matches an explicit exception.');if(request.prNumber&&policy.excludedPrs.includes(request.prNumber))throw new JobError(422,'PR is explicitly excluded.');if(request.target&&matchesException(request.target.name,policy.excludedBuilds))throw new JobError(422,'Build or release matches an explicit exception.');
 return {request,branch,labels,workflow,environment};
}
async function dispatchLocked(runtime:Runtime,projectId:string){
 const db=runtime.database,q=db.query.bind(db),p=(await q<Project>('SELECT * FROM projects WHERE id=$1',[projectId])).rows[0];if(!p)return;
 const policy=await automationPolicy(runtime,projectId);
 const events=(await q<Event>("SELECT * FROM qa_automation_events WHERE project_id=$1 AND (status IN ('received','waiting') OR status='blocked' AND job_id IN (SELECT id FROM qa_jobs WHERE project_id=$1 AND attempts=0 AND status='blocked')) ORDER BY created_at LIMIT 3",[projectId])).rows;
 for(const candidate of events){const e=(await q<Event>("UPDATE qa_automation_events SET status='processing',updated_at=now() WHERE id=$1 AND status IN ('received','waiting','blocked') RETURNING *",[candidate.id])).rows[0];if(!e)continue;
  try{
   if(!policy.enabled||!policy.events.includes(e.kind as AutomationPolicy['events'][number]))throw new JobError(422,'Automatic QA or this trigger is disabled.');
   const {token,repo}=await authority(runtime,p);if(e.payload.repositoryId!==undefined&&e.payload.repositoryId!==repo.id)throw new JobError(403,'Repository identity changed.');
   const resolved=await resolveEvent(runtime,p,e,policy,token);
   const used=Number((await q<{n:string}>("SELECT count(DISTINCT job_id) AS n FROM qa_automation_events WHERE project_id=$1 AND job_id IS NOT NULL AND admitted_at>=date_trunc('day',now())",[projectId])).rows[0].n);
   const plan=await planSnapshot(q,projectId);const digest=hash(canonical([p.repository,resolved.request,plan.digest,p.settings,p.testing_profile,p.execution_mode]));const currentKey=digest.slice(0,8)+'-'+digest.slice(8,12)+'-4'+digest.slice(13,16)+'-a'+digest.slice(17,20)+'-'+digest.slice(20,32);
   const oldJob=e.payload.dispatchKey?(await q<{attempts:number;status:string}>('SELECT attempts,status FROM qa_jobs WHERE project_id=$1 AND dedupe_key=$2',[projectId,e.payload.dispatchKey])).rows[0]:undefined;
   const dedupeKey=oldJob&&(oldJob.attempts>0||oldJob.status!=='blocked')?e.payload.dispatchKey:currentKey;
   if(e.payload.dispatchedRevision&&e.payload.dispatchedRevision!==resolved.request.revision)throw new JobError(422,'This interrupted event was superseded by a new source revision. A new GitHub event can request the new revision.');
   const prior=(await q('SELECT id FROM qa_jobs WHERE project_id=$1 AND dedupe_key=$2',[projectId,dedupeKey])).rows.length;
   if(used>=policy.maxNewJobsPerDay&&!prior)throw new JobError(429,'The project’s automatic daily job allowance is full.');
   await q('UPDATE qa_automation_events SET payload=payload||$2::jsonb WHERE id=$1',[e.id,JSON.stringify({dispatchKey:dedupeKey,dispatchedRevision:resolved.request.revision})]);

   const result=await createJob(db,p,{...resolved.request,dedupeKey},e.payload.actor||'Automation',{recoverUnstarted:true});
   await q("UPDATE qa_automation_events SET status=$2,reason=$3,job_id=$4,payload=payload||$5::jsonb,admitted_at=CASE WHEN $6 THEN COALESCE(admitted_at,now()) ELSE admitted_at END,updated_at=now() WHERE id=$1",[e.id,result.job.status==='blocked'?'blocked':'queued',result.job.message|| (result.duplicate?'Existing exact-revision job reused; no duplicate paid run.':'Automatic QA requested.'),result.job.id,JSON.stringify({revision:result.job.revision,branch:resolved.branch,workflow:resolved.workflow,environment:resolved.environment}),['queued','running'].includes(result.job.status)]);
   await audit(q,projectId,'Automation','automation.dispatched',e.id+' → '+result.job.id);
   if(p.execution_mode==='hosted'&&result.job.status==='queued')await startHosted(runtime,projectId,result.job.id);
  }catch(error){const known=error instanceof JobError,status=known&&[409,429].includes(error.status)?'waiting':known&&error.status===422?'excluded':'blocked';await q('UPDATE qa_automation_events SET status=$2,reason=$3,updated_at=now() WHERE id=$1',[e.id,status,known?error.message:'Event verification could not complete. No model work was automatically retried.']);}
 }
}

export async function dispatchAutomation(runtime:Runtime,projectId:string){const lease=(await runtime.database.query("UPDATE qa_automation_settings SET lease_until=now()+interval '6 minutes' WHERE project_id=$1 AND (lease_until IS NULL OR lease_until<=now()) RETURNING project_id",[projectId])).rows.length;if(!lease)return;try{await dispatchLocked(runtime,projectId);}finally{await runtime.database.query('UPDATE qa_automation_settings SET lease_until=NULL WHERE project_id=$1',[projectId]);}}

export async function automationResult(runtime:Runtime,projectId:string,request:Request){
 const secret=(await providerKey(runtime,projectId,'automation-hook')).apiKey,raw=await rawBody(request),signature=request.headers.get('x-hub-signature-256')||'',expected='sha256='+createHmac('sha256',secret).update(raw).digest('hex');if(!/^sha256=[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw new JobError(401,'Invalid result request signature.');
 let parsed;try{parsed=z.object({deliveryId:z.string().regex(/^[A-Za-z0-9_-]{16,100}$/)}).strict().parse(JSON.parse(raw.toString()));}catch{throw new JobError(400,'Provide the accepted CI delivery ID.');}
 const q=runtime.database.query.bind(runtime.database),event=(await q<Event>('SELECT * FROM qa_automation_events WHERE project_id=$1 AND delivery_id=$2',[projectId,parsed.deliveryId])).rows[0];if(!event)throw new JobError(404,'Delivery not found.');
 const job=event.job_id?(await q<{id:string;payload:any;status:string;record_id:string;message:string}>('SELECT id,payload,status,record_id,message FROM qa_jobs WHERE project_id=$1 AND id=$2',[projectId,event.job_id])).rows[0]:null;
 const report=job?.record_id?(await q<{payload:RunInput}>('SELECT payload FROM qa_runs WHERE project_id=$1 AND record_id=$2',[projectId,job.record_id])).rows[0]?.payload:null;
 const reasons:string[]=[];let score=null;
 if(!report||job?.status!=='completed')reasons.push('A completed exact-assessment report is required.');
 else{
  const current=(await q<{testing_profile:unknown;settings:unknown}>('SELECT testing_profile,settings FROM projects WHERE id=$1',[projectId])).rows[0];
  if(canonical(job.payload.testingProfile)!==canonical(TestingProfileSchema.parse(current.testing_profile||testingDefaults))||canonical(job.payload.unitTests||[])!==canonical(await enabledUnitTests(q,projectId))||canonical(job.payload.settings)!==canonical(current.settings))reasons.push('The saved test or model-review configuration changed after this assessment.');
  score=computeScore(report);if(score.status!=='passed'||!report.checks.some(c=>c.required&&c.method==='automated'))reasons.push('Required executed product checks or findings still need attention.');
  const plan=await planSnapshot(q,projectId);if(job.payload.qualityPlan?job.payload.qualityPlan.digest!==plan.digest:plan.requirements.length||plan.brief)reasons.push('The current approved product plan differs from this assessment.');
  const bugs=await q<{n:string}>("SELECT count(*) AS n FROM qa_bugs WHERE project_id=$1 AND status IN ('open','confirmed','reopened') AND payload->>'severity' IN ('critical','high')",[projectId]);if(Number(bugs.rows[0].n))reasons.push('Unresolved high-risk bugs or flaky-check investigations remain.');
  if(job.payload.target)reasons.push(...releaseGate(report,{revision:job.payload.revision,target:job.payload.target}).reasons);
 }
 return {event:{id:event.id,status:event.status,reason:event.reason},job:job?{id:job.id,status:job.status,message:job.message,revision:job.payload.revision,target:job.payload.target}:null,recordId:report?.recordId||null,score,canProceed:reasons.length===0,reasons};
}

async function reconcileOpenPullRequests(runtime:Runtime,projectId:string){
 const policy=await automationPolicy(runtime,projectId);if(!policy.enabled||!policy.reconcilePullRequests||!policy.events.includes('pull_request'))return;
 const p=(await runtime.database.query<Project&{reconcile_page:number}>('SELECT p.*,s.reconcile_page FROM projects p JOIN qa_automation_settings s ON s.project_id=p.id WHERE p.id=$1',[projectId])).rows[0];
 try{const {token,repo}=await authority(runtime,p),page=Math.max(1,Math.min(100,p.reconcile_page));const prs=await github(runtime,p.repository,'/pulls?state=open&per_page=20&page='+page,token,1024000);if(!Array.isArray(prs))throw Error();
 const plan=await planSnapshot(runtime.database.query.bind(runtime.database),projectId),configuration=hash(canonical([plan.digest,p.settings,p.testing_profile,p.execution_mode]));
 for(const pr of prs){if(!Number.isSafeInteger(pr.number)||!/^[a-f0-9]{40}$/.test(pr.head?.sha||''))continue;const payload={repositoryId:repo.id,action:'synchronize',number:pr.number,actor:'Scheduled repository reconciliation'},delivery='reconcile_'+hash(canonical([repo.id,pr.number,pr.head.sha,configuration]));await runtime.database.query('INSERT INTO qa_automation_events(id,project_id,delivery_id,body_hash,kind,payload) VALUES($1,$2,$3,$4,\'pull_request\',$5::jsonb) ON CONFLICT(project_id,delivery_id) DO NOTHING',[randomUUID(),projectId,delivery,hash(canonical(payload)),JSON.stringify(payload)]);}
 await runtime.database.query('UPDATE qa_automation_settings SET reconcile_page=$2 WHERE project_id=$1',[projectId,prs.length===20&&page<100?page+1:1]);await audit(runtime.database.query.bind(runtime.database),projectId,'Automation','automation.reconciled',`Open PR page ${page}: ${prs.length} current references inspected. Exclusions and budgets still apply.`);
 }catch{await audit(runtime.database.query.bind(runtime.database),projectId,'Automation','automation.reconciliation_blocked','GitHub permission or open-PR enumeration was unavailable. No coverage is inferred.');}
}
export async function automationMaintenance(runtime:Runtime){
 await runtime.database.query("UPDATE qa_automation_events SET status='waiting',reason='Event dispatch was interrupted before acknowledgement; its saved job identity will be reused.',updated_at=now() WHERE status='processing' AND updated_at<now()-interval '10 minutes'");
 await runtime.database.query("UPDATE qa_weekly_reports SET email_status='uncertain' WHERE email_status='sending' AND email_claimed_at<now()-interval '10 minutes'");
 const configured=(await runtime.database.query<{project_id:string}>("SELECT project_id FROM qa_automation_settings WHERE payload->>'enabled'='true' ORDER BY project_id LIMIT 20")).rows;for(const p of configured)await reconcileOpenPullRequests(runtime,p.project_id);
 const ids=(await runtime.database.query<{project_id:string}>("SELECT project_id FROM qa_automation_events WHERE status IN ('received','waiting') OR status='blocked' AND job_id IN(SELECT id FROM qa_jobs WHERE attempts=0 AND status='blocked') GROUP BY project_id ORDER BY min(created_at) LIMIT 10")).rows;
 for(const row of ids)await dispatchAutomation(runtime,row.project_id);
 const {scheduledWeekly}=await import('./weekly');await scheduledWeekly(runtime);
 const {deliverCloudNotifications}=await import('./slack-cloud');
 const notifications=(await runtime.database.query<{project_id:string}>("SELECT DISTINCT project_id FROM qa_notifications WHERE status='pending' ORDER BY project_id LIMIT 20")).rows;
 for(const row of notifications)await deliverCloudNotifications(runtime,row.project_id);
}
