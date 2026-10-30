import {policyDefaults} from '../src/lib/quality';
import {secureSession} from './auth-session';
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPGliteDatabase} from '../src/lib/server/database';
import {createAuth,migrateDatabase} from '../src/lib/server/auth';
import {handleRequest} from '../src/lib/server/api';
import {settingsDefaults} from '../src/lib/contracts';
import type {Runtime} from '../src/lib/server/runtime';
import {githubPeople,drainTeamUpdates} from '../scripts/team-updates.mjs';
const emails=new Map<string,string>();
const config={origin:'https://portal.example',secret:'team-qa-integration-test-secret-at-least-32-characters',production:false,sendSignInLink:async({email,url}:{email:string;url:string})=>{emails.set(email,url);}};
let runtime:Runtime;const accounts:Record<string,{cookie:string;id:string}>={};
async function api(path:string,method='GET',body?:unknown,as='owner',token?:string){return handleRequest(new Request(config.origin+path,{method,headers:{origin:config.origin,'x-forwarded-for':`192.0.2.${['owner','admin','engineer','viewer','outsider'].indexOf(as)+1}`,'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{cookie:accounts[as]?.cookie || ''})},...(body===undefined?{}:{body:JSON.stringify(body)})}),runtime);}
before(async()=>{const database=await createPGliteDatabase();await migrateDatabase(database,config);runtime={database,config,auth:createAuth(database,config)};
 for(const name of ['owner','admin','engineer','viewer','outsider']){const email=`${name}@example.test`;assert.equal((await api('/api/auth/sign-in/magic-link','POST',{email,name},name)).status,200);const u=new URL(emails.get(email)!);const r=await api(u.pathname+u.search);accounts[name]={cookie:await secureSession(runtime,r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')),id:''};const user=(await(await api('/api/session','GET',undefined,name)).json()).user;accounts[name].id=user.id;}
});
after(async()=>runtime.database.end());
const runner={id:'b'.repeat(64),executeJobs:true,ready:true,missing:[],browsers:['chromium'],backends:['local'],maxPages:4,maxCostUsd:2,maxCallsPerRun:20,platforms:['windows'],workspaceTests:true};
const target={kind:'release',name:'v3.0',platform:'windows',artifactSha256:'d'.repeat(64)};
async function project(){const p=(await(await api('/api/projects','POST',{name:'Company product',repository:`company/product-${randomUUID()}`})).json()).project;await runtime.database.query('UPDATE projects SET quality_policy=$2::jsonb WHERE id=$1',[p.id,JSON.stringify({...policyDefaults,requirePlanForRelease:false,monthlyInferenceBudgetUsd:100000})]);const token=(await(await api(`/api/projects/${p.id}/token`,'POST',{})).json()).token;await api('/api/agent/heartbeat','POST',{models:[{id:'qa:8b',name:'QA',contextLength:8192,tools:true,vision:false}],runner},'owner',token);await api(`/api/projects/${p.id}`,'PATCH',{settings:{...settingsDefaults,backend:'local',model:'qa:8b',roles:['planner']}},'owner');return {...p,token};}
async function add(p:any,who:string,role:string){const r=await api(`/api/projects/${p.id}/team`,'POST',{email:`${who}@example.test`,role});assert.equal(r.status,201);const {token}=await r.json();const joined=await api('/api/invitations/accept','POST',{token},who);assert.equal(joined.status,200);return token;}
async function queue(p:any,name=target.name){const r=await api(`/api/projects/${p.id}/jobs`,'POST',{target:{...target,name},revision:'a'.repeat(40),dedupeKey:randomUUID()});assert.equal(r.status,201);return (await r.json()).job;}

test('verified invitations create shared projects with enforced admin, QA engineer and viewer boundaries',async()=>{
 const p=await project();await add(p,'admin','admin');await add(p,'engineer','qa');await add(p,'viewer','viewer');
 for(const who of ['admin','engineer','viewer']){const projects=(await(await api('/api/projects','GET',undefined,who)).json()).projects;assert.equal(projects.find((x:any)=>x.id===p.id).accessRole,{admin:'admin',engineer:'qa',viewer:'viewer'}[who]);}
 const root=`/api/projects/${p.id}`;
 for(const [path,method,body] of [[root,'PATCH',{settings:settingsDefaults}],[root+'/jobs','POST',{target,revision:'a'.repeat(40),dedupeKey:randomUUID()}],[root+'/tests','POST',{name:'Test',framework:'node',source:'test();',enabled:false}],[root+'/slack','PATCH',{enabled:false,channelId:'',events:[]}],[root+'/team','POST',{email:'outsider@example.test',role:'viewer'}]] as const)assert.equal((await api(path,method,body,'viewer')).status,403,path);
 assert.equal((await api(root+'/runs','GET',undefined,'viewer')).status,200);
 assert.equal((await api(root+'/tests','POST',{name:'Boundary',framework:'node',source:"require('node:test')('boundary',()=>{});",enabled:false},'engineer')).status,201);
 assert.equal((await api(root+'/team','POST',{email:'outsider@example.test',role:'viewer'},'engineer')).status,403);
 assert.equal((await api(root+'/fleet','PATCH',{maxParallel:2},'admin')).status,200);
 assert.equal((await api(root+'/team','POST',{email:'outsider@example.test',role:'admin'},'admin')).status,403);
 assert.equal((await api(root+'/token','POST',{},'admin')).status,403);assert.equal((await api(root,'DELETE',undefined,'admin')).status,403);
 assert.equal((await api(root+'/team/'+accounts.admin.id,'DELETE',undefined,'admin')).status,404);
 assert.equal((await api(root+'/team/'+accounts.viewer.id,'DELETE')).status,200);assert.equal((await api(root+'/runs','GET',undefined,'viewer')).status,404);
});
test('invitations are email-bound, one-time, expiring and cannot grant project access to another verified user',async()=>{
 const p=await project(),root=`/api/projects/${p.id}`;const {token}=await(await api(root+'/team','POST',{email:'viewer@example.test',role:'viewer'})).json();
 assert.equal((await api('/api/invitations/accept','POST',{token},'outsider')).status,404);assert.equal((await api(root+'/runs','GET',undefined,'outsider')).status,404);
 assert.equal((await api('/api/invitations/accept','POST',{token},'viewer')).status,200);assert.equal((await api('/api/invitations/accept','POST',{token},'viewer')).status,404);
 const next=await(await api(root+'/team','POST',{email:'engineer@example.test',role:'qa'})).json();await runtime.database.query("UPDATE qa_invites SET expires_at=now()-interval '1 second' WHERE project_id=$1",[p.id]);assert.equal((await api('/api/invitations/accept','POST',{token:next.token},'engineer')).status,404);
});
test('optional Slack updates are durable, channel-bound, deduplicated, threaded and preserve actual failed QA outcomes',async()=>{
 const p=await project(),root=`/api/projects/${p.id}`;await queue(p,'before-slack');assert.equal((await runtime.database.query('SELECT id FROM qa_notifications WHERE project_id=$1',[p.id])).rows.length,0);
 assert.equal((await api(root+'/slack','PATCH',{enabled:true,channelId:'C0123456789',events:['queued','started','completed','blocked']})).status,200);
 const request={target,revision:'a'.repeat(40),dedupeKey:randomUUID()};const job=(await(await api(root+'/jobs','POST',request)).json()).job;await api(root+'/jobs','POST',request);assert.equal(job.requestedBy,'owner');
 assert.equal((await(await api('/api/agent/notifications/claim','POST',{channelId:'C9999999999'},'owner',p.token)).json()).notification,null);
 const claim=await(await api('/api/agent/notifications/claim','POST',{channelId:'C0123456789'},'owner',p.token)).json();assert.equal(claim.notification.target.name,target.name);
 assert.equal((await(await api('/api/agent/notifications/claim','POST',{channelId:'C0123456789'},'owner',p.token)).json()).notification,null);
 assert.equal((await api(`/api/agent/notifications/${claim.notification.id}/complete`,'POST',{claimToken:claim.claimToken,status:'sent',ts:'123.456'},'owner',p.token)).status,200);
 // Claim the older job first, then the current exact-version job.
 const first=await(await api('/api/agent/jobs/claim','POST',{runnerId:runner.id},'owner',p.token)).json();await api(`/api/agent/jobs/${first.job.id}/complete`,'POST',{runnerId:runner.id,leaseToken:first.leaseToken,status:'blocked',message:'Fixture setup blocked'},'owner',p.token);
 const active=await(await api('/api/agent/jobs/claim','POST',{runnerId:runner.id},'owner',p.token)).json();assert.equal(active.job.id,job.id);
 const report={schemaVersion:1,recordId:'e'.repeat(64),repository:p.repository,target,revision:'a'.repeat(40),createdAt:new Date().toISOString(),completedAt:new Date().toISOString(),phase:'completed',checks:[{id:'smoke',name:'Smoke',required:true,method:'automated',status:'failed'}],findings:[],ai:{backend:'local',model:'qa:8b',costUsd:0,costIsEstimate:false,calls:1},limitations:[],people:{source:'github',author:'dev'}};
 assert.equal((await api('/api/agent/runs/'+report.recordId,'PUT',report,'owner',p.token)).status,200);
 const ack={runnerId:runner.id,leaseToken:active.leaseToken,status:'completed',recordId:report.recordId};await api(`/api/agent/jobs/${job.id}/complete`,'POST',ack,'owner',p.token);await api(`/api/agent/jobs/${job.id}/complete`,'POST',ack,'owner',p.token);
 const rows=(await runtime.database.query<{payload:any}>('SELECT payload FROM qa_notifications WHERE project_id=$1',[p.id])).rows;assert.equal(rows.filter(r=>r.payload.event==='completed').length,1);assert.equal(rows.find(r=>r.payload.event==='completed')!.payload.result,'failed');
 let threaded=false;for(let i=0;i<6;i++){const n=await(await api('/api/agent/notifications/claim','POST',{channelId:'C0123456789'},'owner',p.token)).json();if(!n.notification)break;if(n.notification.jobId===job.id){assert.equal(n.notification.threadTs,'123.456');threaded=true;}await api(`/api/agent/notifications/${n.notification.id}/complete`,'POST',{claimToken:n.claimToken,status:'sent',ts:`${200+i}.123`},'owner',p.token);}assert.equal(threaded,true);
 assert.equal((await api('/api/agent/runs/'+report.recordId,'PUT',report,'owner',p.token)).status,200,'Same release report can be retried');assert.equal((await api('/api/agent/runs/'+report.recordId,'PUT',{...report,target:{...target,name:'wrong-version'}},'owner',p.token)).status,409);
});
test('fleet claims honor project capacity, one active job per worker, capabilities and token rotation',async()=>{
 const p=await project();const two={...runner,id:'c'.repeat(64)},wrong={...runner,id:'d'.repeat(64),platforms:['linux']};
 for(const r of [two,wrong])await api('/api/agent/heartbeat','POST',{models:[],runner:r},'owner',p.token);
 const first=await queue(p,'one'),second=await queue(p,'two');assert.equal(first.status,'queued');assert.equal(second.status,'queued');
 assert.equal((await(await api('/api/agent/jobs/claim','POST',{runnerId:wrong.id},'owner',p.token)).json()).job,null);
 const active=await(await api('/api/agent/jobs/claim','POST',{runnerId:runner.id},'owner',p.token)).json();assert.equal(active.job.id,first.id);
 assert.equal((await(await api('/api/agent/jobs/claim','POST',{runnerId:two.id},'owner',p.token)).json()).job,null);
 await api(`/api/projects/${p.id}/fleet`,'PATCH',{maxParallel:2});
 const claims=await Promise.all([1,2].map(()=>api('/api/agent/jobs/claim','POST',{runnerId:two.id},'owner',p.token).then(r=>r.json())));assert.equal(claims.filter(c=>c.job).length,1);assert.equal(claims.find(c=>c.job).job.id,second.id);
 assert.equal((await(await api('/api/agent/jobs/claim','POST',{runnerId:runner.id},'owner',p.token)).json()).job,null);
 await api(`/api/projects/${p.id}/token`,'POST',{});assert.equal((await runtime.database.query('SELECT id FROM qa_runners WHERE project_id=$1',[p.id])).rows.length,0);
});
test('GitHub enrichment pins source identity and leaves unavailable authors unknown instead of guessing',async()=>{
 const job={repository:'org/product',revision:'a'.repeat(40),pr:{number:42},requestedBy:'Owner'};
 const response=(v:any)=>async()=>new Response(JSON.stringify(v));
 assert.equal((await githubPeople(job,{token:'fixture',fetchImpl:response({head:{sha:'b'.repeat(40)},user:{login:'wrong-user'}})})).source,'unavailable');
 const people=await githubPeople(job,{token:'fixture',fetchImpl:response({head:{sha:job.revision},user:{login:'author'},merged_by:{login:'merger'}})});assert.equal(people.author,'author');assert.equal(people.mergedBy,'merger');
 assert.equal((await githubPeople(job,{fetchImpl:()=>assert.fail('Unenrolled GitHub request')})).source,'unavailable');
});

test('revoked invitations cannot be redeemed and uncertain Slack deliveries never silently resend',async()=>{
 const p=await project(),root=`/api/projects/${p.id}`;
 const invited=await(await api(root+'/team','POST',{email:'engineer@example.test',role:'qa'})).json();const team=await(await api(root+'/team')).json();assert.ok(!JSON.stringify(team).includes(invited.token));assert.equal((await api(root+'/team/'+team.pending[0].id,'DELETE')).status,200);assert.equal((await api('/api/invitations/accept','POST',{token:invited.token},'engineer')).status,404);
 await api(root+'/slack','PATCH',{enabled:true,channelId:'C0123456789',events:['queued']});await queue(p,'first');await queue(p,'second');
 const claim=await(await api('/api/agent/notifications/claim','POST',{channelId:'C0123456789'},'owner',p.token)).json();await runtime.database.query("UPDATE qa_notifications SET claimed_at=now()-interval '3 minutes' WHERE id=$1",[claim.notification.id]);
 const next=await(await api('/api/agent/notifications/claim','POST',{channelId:'C0123456789'},'owner',p.token)).json();assert.notEqual(next.notification.id,claim.notification.id);assert.equal((await runtime.database.query<{status:string}>('SELECT status FROM qa_notifications WHERE id=$1',[claim.notification.id])).rows[0].status,'uncertain');
 assert.equal((await api(`/api/agent/notifications/${claim.notification.id}/complete`,'POST',{claimToken:claim.claimToken,status:'sent'},'owner',p.token)).status,409);
 await api(`/api/agent/notifications/${next.notification.id}/complete`,'POST',{claimToken:next.claimToken,status:'uncertain'},'owner',p.token);assert.equal((await(await api('/api/agent/notifications/claim','POST',{channelId:'C0123456789'},'owner',p.token)).json()).notification,null);
 await api(root+'/slack','PATCH',{enabled:false,channelId:'C0123456789',events:['queued']});await queue(p,'third');assert.equal((await(await api('/api/agent/notifications/claim','POST',{channelId:'C0123456789'},'owner',p.token)).json()).notification,null);
});

test('connector Slack delivery requires both local enrollment and explicit activation, and reports uncertain sends once',async t=>{
 const fs=await import('node:fs/promises'),path=await import('node:path'),os=await import('node:os');const root=await fs.mkdtemp(path.join(os.tmpdir(),'qa-notify-connector-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const modulePath=path.join(root,'slack.cjs');await fs.writeFile(modulePath,"module.exports={SlackAdapter:class{},assessmentMessage:event=>JSON.stringify(event)};");
 const bot={botDir:root,config:{teamUpdates:{enabled:true,channelId:'C0123456789'}}};const calls:any[]=[];let sends=0,claimed=false;const portal={request:async(method:string,url:string,body:any)=>{calls.push({method,url,body});if(url.endsWith('/claim')){if(claimed)return {notification:null};claimed=true;return {notification:{id:'a'.repeat(8)+'-aaaa-4aaa-aaaa-aaaaaaaaaaaa',channelId:'C0123456789',event:'completed',result:'failed',threadTs:'123.456'},claimToken:'b'.repeat(43)};}return {ok:true};}};
 const options={bot,portal,env:{SLACK_BOT_TOKEN:'fixture-only-token',QA_PORTAL_URL:config.origin},enabled:false,trustedPath:async()=>modulePath,send:async(text:string,options:any)=>{sends++;assert.match(text,/failed/);assert.equal(options.threadTs,'123.456');return {status:'sent',ts:'124.456',channel:'C0123456789'};}};
 assert.equal((await drainTeamUpdates(options)).status,'disabled');assert.equal(calls.length,0);
 assert.equal((await drainTeamUpdates({...options,enabled:true,env:{}})).status,'setup_required');assert.equal(calls.length,0);
 assert.equal((await drainTeamUpdates({...options,enabled:true})).sent,1);assert.equal(sends,1);assert.equal(calls.find(c=>c.url.endsWith('/complete')).body.status,'sent');
 calls.length=0;claimed=false;assert.equal((await drainTeamUpdates({...options,enabled:true,send:async()=>{throw new Error('Network uncertain');}})).status,'uncertain');assert.equal(calls.filter(c=>c.url.endsWith('/claim')).length,1);assert.equal(calls.at(-1).body.status,'uncertain');
});
