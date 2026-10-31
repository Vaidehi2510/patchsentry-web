import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPGliteDatabase} from '../src/lib/server/database';
import {createAuth,migrateDatabase} from '../src/lib/server/auth';
import {handleRequest} from '../src/lib/server/api';
import {defaultPool,savePool,saveTenant,poolState,claimHosted,releaseReservation,capacityView} from '../src/lib/server/capacity';
import {createJob} from '../src/lib/server/jobs';
import {settingsDefaults} from '../src/lib/contracts';
import {TestingProfileSchema} from '../src/lib/jobs';
import {recoverExecutions} from '../src/lib/server/operations';
import {enterpriseProfileState,applyEnterpriseProfile} from '../src/lib/server/enterprise-profile';
import {verifyLedger} from '../src/lib/server/assessment-ledger';
import {meteredHosted,closeHostedReservation} from '../src/lib/server/hosted-meter';
import type {Runtime} from '../src/lib/server/runtime';
let r:Runtime;const owners=Array.from({length:4},()=>randomUUID()),groups=[randomUUID(),randomUUID()],projects:any[]=[];
const config={origin:'https://capacity.fixture',secret:'capacity-fixture-secret-at-least-32-characters',production:false,cronSecret:'operator-fixture-at-least-32-characters'};
before(async()=>{const database=await createPGliteDatabase();await migrateDatabase(database,config);r={database,config,auth:createAuth(database,config)};for(const [i,id]of owners.entries()){await database.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',[id,'Fixture '+i,'owner'+i+'@fixture.invalid']);const p={id:randomUUID(),repository:'fixture/capacity-'+i,settings:{...settingsDefaults,roles:['planner'],model:'fixture/qa',maxCostUsd:0},execution_mode:'hosted',owner_id:id,agent_last_seen:null,testing_profile:TestingProfileSchema.parse({previewUrlTemplate:'https://preview.fixture',goals:{schemaVersion:1,goals:[{id:'health',name:'Health',start:'/',requirement:'Healthy view',inputs:{},assertions:[{id:'title',action:'expectText',selector:'h1',text:'Healthy'}]}]}})};projects.push(p);await database.query('INSERT INTO projects(id,owner_id,name,repository,settings,testing_profile,execution_mode) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)',[p.id,id,'Fixture',p.repository,JSON.stringify(p.settings),JSON.stringify(p.testing_profile),'hosted']);await database.query("INSERT INTO qa_provider_credentials(project_id,provider,encrypted,suffix) VALUES($1,'openrouter',$2,'fake')",[p.id,Buffer.from('fixture-not-a-key')]);}});
after(()=>r.database.end());
async function queue(p:any){return createJob(r.database,p,{dedupeKey:randomUUID(),prNumber:1,revision:'a'.repeat(40)},'Fixture');}
const limits={monthlyStarts:10,active:1,queued:3,cpuSeconds:20000,memoryGbSeconds:100000,infrastructureUsd:10};
test('legacy limits remain unchanged; only an authenticated operator can opt in to pool configuration',async()=>{
 assert.equal((await poolState(r.database.query.bind(r.database))).mode,'legacy');assert.equal(defaultPool.limits.monthlyStarts,8);assert.equal(defaultPool.limits.active,2);
 const denied=await handleRequest(new Request(config.origin+'/api/internal/capacity',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(defaultPool)}),r);assert.equal(denied.status,401);
 await savePool(r,{...defaultPool,mode:'fair',limits:{...defaultPool.limits,monthlyStarts:50,queued:10,cpuSeconds:100000,infrastructureUsd:50},defaultTenant:limits});
 assert.equal((await poolState(r.database.query.bind(r.database))).mode,'fair');await assert.rejects(savePool(r,{...defaultPool,mode:'fair'}),/changed/);
});
test('capacity enrollment is company-scoped, explicit and cannot be bypassed by adding projects or another company owner',async()=>{
 await assert.rejects(queue(projects[3]),/operator-approved/);
 await saveTenant(r,owners[0],{tenantKey:groups[0],limits,expectedVersion:0});await saveTenant(r,owners[1],{tenantKey:groups[0],limits,expectedVersion:1});await saveTenant(r,owners[2],{tenantKey:groups[1],limits,expectedVersion:0});
 await queue(projects[0]);await queue(projects[1]);await queue(projects[0]);
 await assert.rejects(queue(projects[1]),/queue is full/);
 const response=await handleRequest(new Request(config.origin+'/api/internal/capacity',{headers:{authorization:'Bearer '+config.cronSecret}}),r);assert.equal(response.status,200);
});
test('fair claims cannot be monopolized by the first company and remain atomic under duplicate drain attempts',async()=>{
 await queue(projects[2]);const claims=await Promise.all(Array.from({length:8},()=>claimHosted(r)));const accepted=claims.filter(Boolean) as any[];
 assert.equal(accepted.length,2);assert.equal(new Set(accepted.map(j=>j.id)).size,2);
 const allocation=(await r.database.query<any>('SELECT tenant_limits,pool_policy FROM qa_hosted_reservations LIMIT 1')).rows[0];assert.equal(allocation.tenant_limits.active,1);assert.equal(allocation.pool_policy.limits.active,2);
 const tenants=await r.database.query<{tenant_key:string}>('SELECT tenant_key FROM qa_hosted_reservations');assert.equal(new Set(tenants.rows.map(t=>t.tenant_key)).size,2);
 await assert.rejects(saveTenant(r,owners[0],{tenantKey:randomUUID(),limits,expectedVersion:0}),/cannot be reset/);
 assert.equal(await claimHosted(r),null);
});
test('completed/failed jobs do not release an uncertain provider slot and conservative budget usage is not erased',async()=>{
 const reservations=(await r.database.query<{job_id:string}>('SELECT job_id FROM qa_hosted_reservations')).rows;
 await r.database.query("UPDATE qa_jobs SET status='completed' WHERE id=$1",[reservations[0].job_id]);await releaseReservation(r,reservations[0].job_id,false,'provider-stop-uncertain');assert.equal(await claimHosted(r),null);
 await releaseReservation(r,reservations[0].job_id,true,'stopped');const pending=await claimHosted(r); // rate cap may intentionally keep it waiting
 assert.equal(pending,null,'Per-minute creation bound is independent of released concurrency.');
 const state=await capacityView(r,projects[0].id);assert.ok(Number(state.tenant.reserved.starts)>=1);
});
test('fair queues survive legacy five-minute startup recovery and expire only at their configured queue deadline',async()=>{
 const queued=(await r.database.query<{id:string}>("SELECT id FROM qa_jobs WHERE status='queued' LIMIT 1")).rows[0];assert.ok(queued);
 await r.database.query("UPDATE qa_jobs SET created_at=now()-interval '10 minutes',queue_expires_at=now()+interval '50 minutes' WHERE id=$1",[queued.id]);await recoverExecutions(r);assert.equal((await r.database.query<any>('SELECT status FROM qa_jobs WHERE id=$1',[queued.id])).rows[0].status,'queued');
 await r.database.query("UPDATE qa_jobs SET queue_expires_at=now()-interval '1 second' WHERE id=$1",[queued.id]);await recoverExecutions(r);assert.equal((await r.database.query<any>('SELECT status FROM qa_jobs WHERE id=$1',[queued.id])).rows[0].status,'blocked');
});
test('provider-create uncertainty and failed termination remain reserved; cancellation prevents another VM from being created',async()=>{
 const job=(await r.database.query<any>('SELECT job_id FROM qa_hosted_reservations LIMIT 1')).rows[0].job_id;await r.database.query("UPDATE qa_jobs SET status='running' WHERE id=$1",[job]);
 const base:any={create:async()=>{throw Error('Fixture ambiguous provider creation');},get:async()=>{throw Error('No confirmed VM');}};const adapter=meteredHosted(r,job,base);await assert.rejects(adapter.create('preview.fixture'));
 await r.database.query("UPDATE qa_jobs SET status='blocked' WHERE id=$1",[job]);await closeHostedReservation(r,job,'uncertain');const stage=(await r.database.query<any>('SELECT status FROM qa_hosted_stages WHERE job_id=$1',[job])).rows[0];assert.equal(stage.status,'create-uncertain');
 const before=(await r.database.query('SELECT id FROM qa_hosted_stages WHERE job_id=$1',[job])).rows.length;await assert.rejects(adapter.create('preview.fixture'),/cancelled/);assert.equal((await r.database.query('SELECT id FROM qa_hosted_stages WHERE job_id=$1',[job])).rows.length,before);
});

test('enterprise company profile is opt-in, prerequisite-gated, versioned and audited separately from product qualification',async()=>{
 const id=projects[3].id,state=await enterpriseProfileState(r,id);assert.equal(state.active,false);assert.ok(state.prerequisites.length>=3);
 const input={expectedVersion:0,expectedQualityVersion:state.qualityVersion,expectedAssuranceVersion:state.assuranceVersion,requirePhysicalDevices:true,requireArchiveAcknowledgment:false,approveEvidenceProcessing:true};
 await assert.rejects(applyEnterpriseProfile(r,id,input,owners[3]),/domain/);
 await r.database.query("INSERT INTO qa_work_domains(project_id,domain,challenge,verified_at,restricted) VALUES($1,'fixture.invalid','synthetic',now(),true)",[id]);
 await r.database.query("INSERT INTO qa_sso_connections(project_id,tenant_id,client_id,secret,generation,enforced,scim_hash) VALUES($1,$2,$3,$4,'synthetic',true,'fixture-only-hash')",[id,randomUUID(),randomUUID(),Buffer.from('fixture')]);
 await r.database.query("INSERT INTO qa_repository_authorizations(project_id,owner_id,github_repository_id,mode) VALUES($1,$2,42,'admin')",[id,owners[3]]);
 await r.database.query("UPDATE projects SET settings=jsonb_set(settings,'{roleModels}', '{\"planner\":\"fixture/role\"}'::jsonb) WHERE id=$1",[id]);
 const applied=await applyEnterpriseProfile(r,id,input,owners[3]);assert.equal(applied.mode,'advisory');const current=await enterpriseProfileState(r,id);assert.equal(current.active,true);assert.deepEqual(current.selectedModels,['fixture/qa','fixture/role']);assert.equal(current.projectGateQualification.eligible,false);assert.equal(current.projectGateQualification.mode,'advisory');assert.equal(current.qualityVersion,state.qualityVersion+1);
 assert.equal((await r.database.query<any>('SELECT quality_policy FROM projects WHERE id=$1',[id])).rows[0].quality_policy.retentionDays,30);
 assert.ok((await r.database.query("SELECT id FROM qa_assessment_ledger WHERE project_id=$1 AND event_type='enterprise-configuration'",[id])).rows.length);assert.equal((await verifyLedger(r,id)).valid,true);
 await assert.rejects(applyEnterpriseProfile(r,id,input,owners[3]),/changed/);
 await r.database.query("UPDATE projects SET settings=jsonb_set(settings,'{model}','\"fixture/changed\"'::jsonb) WHERE id=$1",[id]);assert.equal((await enterpriseProfileState(r,id)).active,false);
 await r.database.query("UPDATE qa_repository_authorizations SET verified_at=now()-interval '8 days' WHERE project_id=$1",[id]);assert.ok((await enterpriseProfileState(r,id)).prerequisites.some(v=>v.includes('authorization')));
});
test('fair dispatch fails closed when the compute budget cannot reserve another stage',async()=>{
 await r.database.query("UPDATE qa_hosted_reservations SET released_at=now(),started_at=now()-interval '2 minutes'");await r.database.query("UPDATE qa_jobs SET status='queued',attempts=0,queue_expires_at=now()+interval '1 hour' WHERE status='blocked' AND project_id=$1",[projects[0].id]);
 const pool=await poolState(r.database.query.bind(r.database));await savePool(r,{...pool,limits:{...pool.limits,cpuSeconds:0}});assert.equal(await claimHosted(r),null);assert.ok((await r.database.query("SELECT id FROM qa_jobs WHERE status='queued' AND message LIKE 'Awaiting monthly%'" )).rows.length);assert.equal((await r.database.query('SELECT id FROM qa_hosted_stages')).rows.length,1,'No additional provider creation occurs when budget is unavailable.');
});
test('switching scheduling modes and initial company enrollment preserve prior legacy resource usage',async()=>{
 await r.database.query("UPDATE qa_jobs SET status='blocked' WHERE status IN ('queued','running')");let pool=await poolState(r.database.query.bind(r.database));await savePool(r,{...pool,mode:'legacy'});
 const original=(await r.database.query<any>('SELECT * FROM qa_jobs LIMIT 1')).rows[0],id=randomUUID();await r.database.query("INSERT INTO qa_jobs(id,project_id,dedupe_key,payload,status,attempts,execution_mode) VALUES($1,$2,$3,$4::jsonb,'completed',1,'hosted')",[id,projects[3].id,randomUUID(),JSON.stringify({...original.payload,id})]);
 pool=await poolState(r.database.query.bind(r.database));await savePool(r,{...pool,mode:'fair'});assert.equal((await r.database.query<any>('SELECT finish_status FROM qa_hosted_reservations WHERE job_id=$1',[id])).rows[0].finish_status,'legacy-conservative-carryover');
 const company=randomUUID();await saveTenant(r,owners[3],{tenantKey:company,limits,expectedVersion:0});assert.equal((await r.database.query<any>('SELECT tenant_key FROM qa_hosted_reservations WHERE job_id=$1',[id])).rows[0].tenant_key,company);assert.ok(Number((await capacityView(r,projects[3].id)).tenant.reserved.cpu)>0);
});
