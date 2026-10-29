import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createPGliteDatabase } from '../src/lib/server/database';
import { createAuth, migrateDatabase } from '../src/lib/server/auth';
import { handleRequest } from '../src/lib/server/api';
import { settingsDefaults } from '../src/lib/contracts';
import { JobInputSchema, TestingProfileSchema } from '../src/lib/jobs';
import type { Runtime } from '../src/lib/server/runtime';
const mail = new Map<string,string>();
const config={origin:'https://portal.example',secret:'product-qa-fixture-secret-with-at-least-32-characters',production:false,sendSignInLink:async({email,url}:{email:string;url:string})=>{mail.set(email,url);}};
let runtime:Runtime, alice:string,bob:string;
async function call(endpoint:string,method='GET',body?:unknown,cookie?:string,token?:string) { return handleRequest(new Request(config.origin+endpoint,{method,headers:{origin:config.origin,'content-type':'application/json',...(cookie?{cookie}:{}),...(token?{authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),runtime); }
async function signup(name:string) {const email=`${name}@example.test`;assert.equal((await call('/api/auth/sign-in/magic-link','POST',{name,email})).status,200);const u=new URL(mail.get(email)!);const r=await call(u.pathname+u.search);assert.equal(r.status,302);return r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');}
before(async()=>{const database=await createPGliteDatabase();await migrateDatabase(database,config);runtime={database,config,auth:createAuth(database,config)};alice=await signup('product-alice');bob=await signup('product-bob');});
after(async()=>{await runtime?.database.end();});
const runner={id:'b'.repeat(64),executeJobs:true,ready:true,missing:[],browsers:['chromium'],backends:['local'],maxPages:4,maxCostUsd:2,maxCallsPerRun:20,platforms:['web','api','android','ios','macos','windows','linux'],workspaceTests:true};
const target={kind:'release',name:'v1.4.0',platform:'windows',artifactSha256:'d'.repeat(64)};
const code="const test=require('node:test'); const assert=require('node:assert/strict'); test('fixture',()=>assert.equal(2+2,4));";
async function project(owner=alice,capabilities:Record<string,unknown>={}) { const created=await call('/api/projects','POST',{name:'Personal product',repository:`builder/product-${randomUUID()}`},owner);assert.equal(created.status,201);const p=(await created.json()).project;const token=(await(await call(`/api/projects/${p.id}/token`,'POST',{},owner)).json()).token;assert.equal((await call('/api/agent/heartbeat','POST',{models:[{id:'qa:8b',name:'QA',contextLength:8192,tools:true,vision:false}],runner:{...runner,...capabilities}},undefined,token)).status,200);assert.equal((await call(`/api/projects/${p.id}`,'PATCH',{settings:{...settingsDefaults,backend:'local',model:'qa:8b'}},owner)).status,200);return {...p,token};}
const queued=(p:any,subject:unknown={target})=>call(`/api/projects/${p.id}/jobs`,'POST',{...(subject as object),revision:'a'.repeat(40),dedupeKey:randomUUID()},alice);

test('complete versions and CI builds queue and claim without a fabricated PR or browser requirement',async()=>{
 const p=await project();for(const kind of ['release','build']) {const response=await queued(p,{target:{...target,kind,name:kind==='build'?'build-842':target.name}});assert.equal(response.status,201);const job=(await response.json()).job;assert.equal(job.pr,undefined);assert.equal(job.target.kind,kind);assert.equal(job.status,'queued');const {status,attempts,createdAt,updatedAt,leaseExpiresAt,message,recordId,...payload}=job;JobInputSchema.parse(payload);}
 const claimed=await call('/api/agent/jobs/claim','POST',{runnerId:runner.id},undefined,p.token);assert.equal(claimed.status,200);assert.equal((await claimed.json()).job.target.name,'v1.4.0');
 assert.equal((await queued(p,{prNumber:42,target})).status,400);
 assert.equal((await queued(p,{})).status,400);
});

test('unregistered platforms and web releases using PR-only previews stay blocked',async()=>{
 const p=await project(alice,{platforms:[]});const blocked=(await(await queued(p)).json()).job;assert.equal(blocked.status,'blocked');assert.match(blocked.message,/platform/);
 const q=await project();const profile=TestingProfileSchema.parse({previewUrlTemplate:'https://pr-{pr}.example.test',goals:{schemaVersion:1,goals:[{id:'home',name:'Welcome',start:'/',requirement:'Welcome appears',assertions:[{id:'welcome',action:'expectText',selector:'body',text:'Welcome'}]}]}});
 assert.equal((await call(`/api/projects/${q.id}`,'PATCH',{testingProfile:profile},alice)).status,200);
 const web=(await(await queued(q,{target:{...target,platform:'web'}})).json()).job;assert.equal(web.status,'blocked');assert.match(web.message,/without a PR placeholder/);
});

test('unit test library is owner scoped, preserves source, versions edits and freezes enabled source into jobs',async()=>{
 const p=await project();const created=await call(`/api/projects/${p.id}/tests`,'POST',{name:'Boundary',framework:'node',source:code,enabled:true},alice);assert.equal(created.status,201);const testcase=(await created.json()).test;assert.equal(testcase.sha256,createHash('sha256').update(code).digest('hex'));
 assert.equal((await call(`/api/projects/${p.id}/tests`,'GET',undefined,bob)).status,404);assert.equal((await call(`/api/projects/${p.id}/tests/${testcase.id}`,'PATCH',{version:1,test:{name:'Hijack',framework:'node',source:code,enabled:false}},bob)).status,404);
 assert.equal((await call(`/api/projects/${p.id}/tests`,'GET',undefined,undefined,p.token)).status,401);
 const body={target,revision:'a'.repeat(40),dedupeKey:randomUUID()};const first=await call(`/api/projects/${p.id}/jobs`,'POST',body,alice);const job=(await first.json()).job;assert.equal(job.unitTests[0].source,code);
 const updated={name:'Boundary v2',framework:'node',source:code+'\n// Updated assertion context',enabled:true};
 const change=await call(`/api/projects/${p.id}/tests/${testcase.id}`,'PATCH',{version:1,test:updated},alice);assert.equal(change.status,200);assert.equal((await change.json()).test.version,2);
 assert.equal((await call(`/api/projects/${p.id}/tests/${testcase.id}`,'PATCH',{version:1,test:updated},alice)).status,409);
 const duplicate=(await(await call(`/api/projects/${p.id}/jobs`,'POST',body,alice)).json()).job;assert.equal(duplicate.unitTests[0].source,code);
 const next=(await(await queued(p)).json()).job;assert.equal(next.unitTests[0].source,updated.source);
 assert.equal((await call(`/api/projects/${p.id}/tests/${testcase.id}`,'DELETE',undefined,bob)).status,404);
 assert.equal((await call(`/api/projects/${p.id}/tests/${testcase.id}`,'DELETE',undefined,alice)).status,200);
 assert.equal((await(await call(`/api/projects/${p.id}/jobs`,'GET',undefined,alice)).json()).jobs.find((j:any)=>j.id===job.id).unitTests[0].source,code);
});

test('test source is bounded, non-Node drafts export only, and authored execution needs local enrollment',async()=>{
 const p=await project(alice,{workspaceTests:false});
 assert.equal((await call(`/api/projects/${p.id}/tests`,'POST',{name:'Python',framework:'pytest',source:'def test_boundary(): assert True',enabled:true},alice)).status,400);
 assert.equal((await call(`/api/projects/${p.id}/tests`,'POST',{name:'Python',framework:'pytest',source:'def test_boundary(): assert True',enabled:false},alice)).status,201);
 for(const change of [{source:'x'.repeat(24001)},{source:'\0'},{command:'sh'}]) assert.equal((await call(`/api/projects/${p.id}/tests`,'POST',{name:'Bounded',framework:'node',source:code,enabled:false,...change},alice)).status,400);
 assert.equal((await call(`/api/projects/${p.id}/tests`,'POST',{name:'Node',framework:'node',source:code,enabled:true},alice)).status,201);
 const job=(await(await queued(p)).json()).job;assert.equal(job.status,'blocked');assert.match(job.message,/authored unit tests/);
});

test('enabled test count and byte budgets cannot silently omit tests from new jobs',async()=>{
 const p=await project();for(let i=0;i<8;i++)assert.equal((await call(`/api/projects/${p.id}/tests`,'POST',{name:`Boundary ${i}`,framework:'node',source:code,enabled:true},alice)).status,201);
 assert.equal((await call(`/api/projects/${p.id}/tests`,'POST',{name:'Too many',framework:'node',source:code,enabled:true},alice)).status,409);
 const job=(await(await queued(p)).json()).job;assert.equal(job.unitTests.length,8);
});

test('release ACK and deployment gate require the exact artifact and version, fresh complete checks and no unresolved findings',async()=>{
 const p=await project();const job=(await(await queued(p)).json()).job;const claim=(await(await call('/api/agent/jobs/claim','POST',{runnerId:runner.id},undefined,p.token)).json());
 const checks=['release-artifact','release-platform','release-artifact-stability','release-input-stability','runner-platform-smoke'].map(id=>({id,name:id,method:'automated',required:true,status:'passed'}));
 const report={schemaVersion:1,recordId:'1'.repeat(64),repository:p.repository,target:{...target,artifactSha256:'e'.repeat(64)},revision:'a'.repeat(40),createdAt:new Date().toISOString(),completedAt:new Date().toISOString(),phase:'completed',checks,findings:[],ai:{backend:'local',model:'qa:8b',costUsd:0,costIsEstimate:false,calls:0},limitations:[]};
 assert.equal((await call(`/api/agent/runs/${report.recordId}`,'PUT',report,undefined,p.token)).status,200);
 const complete={runnerId:runner.id,leaseToken:claim.leaseToken,status:'completed',recordId:report.recordId};assert.equal((await call(`/api/agent/jobs/${job.id}/complete`,'POST',complete,undefined,p.token)).status,409);
 report.recordId='2'.repeat(64);report.target=target;assert.equal((await call(`/api/agent/runs/${report.recordId}`,'PUT',report,undefined,p.token)).status,200);assert.equal((await call(`/api/agent/jobs/${job.id}/complete`,'POST',{...complete,recordId:report.recordId},undefined,p.token)).status,200);
 const params=new URLSearchParams({recordId:report.recordId,revision:report.revision,...target});
 assert.equal((await(await call(`/api/agent/release-gate?${params}`,'GET',undefined,undefined,p.token)).json()).eligible,true);
 params.set('name','v2.0');assert.equal((await(await call(`/api/agent/release-gate?${params}`,'GET',undefined,undefined,p.token)).json()).eligible,false);
 params.set('name',target.name);const other=await project(bob);assert.equal((await call(`/api/agent/release-gate?${params}`,'GET',undefined,undefined,other.token)).status,404);
 const old={...report,recordId:'3'.repeat(64),completedAt:new Date(Date.now()-7200000).toISOString()};assert.equal((await call(`/api/agent/runs/${old.recordId}`,'PUT',old,undefined,p.token)).status,200);params.set('recordId',old.recordId);assert.equal((await(await call(`/api/agent/release-gate?${params}`,'GET',undefined,undefined,p.token)).json()).eligible,false);
});
