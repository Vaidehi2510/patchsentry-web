// Local-only real PostgreSQL scheduler + actual Patchsentry release-test processes.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {createDatabase} from '../../src/lib/server/database';
import {createAuth,migrateDatabase} from '../../src/lib/server/auth';
import {defaultPool,savePool,saveTenant,claimHosted,releaseReservation} from '../../src/lib/server/capacity';
import {createJob} from '../../src/lib/server/jobs';
import {settingsDefaults} from '../../src/lib/contracts';
import {TestingProfileSchema} from '../../src/lib/jobs';
import type {Runtime} from '../../src/lib/server/runtime';
const url=new URL(process.env.DATABASE_URL||'http://invalid');if(process.env.PS_ALLOW_FIXTURE_RECOVERY!=='1'||url.hostname!=='127.0.0.1'||!['/ps_fixture_launch','/ps_fixture_launch_final'].includes(url.pathname))throw Error('Explicit isolated loopback database required.');
const source=process.env.PS_QA_SOURCE;if(!source?.startsWith('/private/tmp/ps-launch-source-'))throw Error('Use an isolated source snapshot.');
const out=process.env.PS_LAUNCH_OUTPUT||'/private/tmp/ps-launch-results';await mkdir(out,{recursive:true});
const database=await createDatabase({DATABASE_URL:url.href,NODE_ENV:'test'}),config={origin:'https://load.fixture',secret:'launch-fixture-only-secret-at-least-32-characters',production:false},r:Runtime={database,config,auth:createAuth(database,config)};
const started=Date.now(),observed:any[]=[],samples:any[]=[],admission:any[]=[];let active=0,maxActive=0;
try{
 await migrateDatabase(database,config);assert.equal(Number((await database.query<any>('SELECT count(*) AS n FROM projects')).rows[0].n),0,'Use a fresh fixture database');
 const limits={monthlyStarts:100,active:1,queued:6,cpuSeconds:1000000,memoryGbSeconds:2000000,infrastructureUsd:100};
 await savePool(r,{...defaultPool,mode:'fair',limits:{...limits,active:2,queued:20},defaultTenant:limits,maxStartsPerMinute:10,providerAllocationPerMinute:40});
 const queued=new Map<string,number>();for(let t=0;t<3;t++){
  const owner=randomUUID(),id=randomUUID(),tenant=randomUUID(),settings={...settingsDefaults,roles:['planner' as const],model:'fixture/qa',maxCostUsd:0},testing_profile=TestingProfileSchema.parse({previewUrlTemplate:'https://preview.fixture',goals:{schemaVersion:1,goals:[{id:'health',name:'Health',start:'/',requirement:'Healthy view',assertions:[{id:'title',action:'expectText',selector:'h1',text:'Healthy'}]}]}});
  await database.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',[owner,'Fixture '+t,'load'+t+'@fixture.invalid']);
  await database.query("INSERT INTO projects(id,owner_id,name,repository,settings,testing_profile,execution_mode) VALUES($1,$2,'Isolated release QA',$3,$4::jsonb,$5::jsonb,'hosted')",[id,owner,'fixture/load-'+t,JSON.stringify(settings),JSON.stringify(testing_profile)]);
  await database.query("INSERT INTO qa_provider_credentials(project_id,provider,encrypted,suffix) VALUES($1,'openrouter',$2,'fake')",[id,Buffer.from('not-a-key')]);await saveTenant(r,owner,{tenantKey:tenant,limits,expectedVersion:0});
  const p={id,owner_id:owner,agent_last_seen:null,settings,testing_profile,execution_mode:'hosted' as const,repository:'fixture/load-'+t};
  for(let i=0;i<(t===0?7:2);i++){try{const {job}=await createJob(database,p,{dedupeKey:randomUUID(),prNumber:1,revision:'a'.repeat(40)},'Load fixture');queued.set(job.id,Date.now());admission.push({tenant:t,accepted:true,id:job.id});}catch(e){admission.push({tenant:t,accepted:false,reason:(e as Error).message});}}
 }
 async function worker(row:any,index:number){active++;maxActive=Math.max(maxActive,active);const begin=Date.now(),name='ps-launch-worker-'+index;const args=['run','--name',name,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256','--cpus','2','--memory','4g','--tmpfs','/tmp:rw,nosuid,nodev,size=2g,uid=1000,gid=1000','--mount',`type=bind,source=${source},target=/workspace,readonly`,'patchsentry-release-qa:launch','critical'];
  const child=spawn('docker',args,{stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',v=>{output+=v;});child.stderr.on('data',v=>{output+=v;});const timer=setInterval(()=>{const s=spawnSync('docker',['stats','--no-stream','--format','{{json .}}',name],{encoding:'utf8',timeout:5000});if(s.status===0&&s.stdout.trim())try{samples.push({at:Date.now(),...JSON.parse(s.stdout)});}catch{}},2000);
  const code=await new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});clearInterval(timer);await writeFile(out+'/'+name+'.tap',output);spawnSync('docker',['rm',name],{stdio:'ignore'});
  const ended=Date.now();await database.query("UPDATE qa_jobs SET status=$2,lease_expires_at=NULL,message='Isolated actual release-test process; not a provider attestation' WHERE id=$1",[row.id,code===0?'completed':'blocked']);await releaseReservation(r,row.id,true,code===0?'fixture-stopped':'fixture-failed');observed.push({id:row.id,tenant:row.payload.repository,queueMs:begin-queued.get(row.id)!,runtimeMs:ended-begin,exitCode:code,tests:Number(output.match(/# tests (\d+)/)?.[1]||0),failed:Number(output.match(/# fail (\d+)/)?.[1]||0)});active--;
 }
 let index=0;const running=new Set<Promise<void>>();while(observed.length<queued.size){const claims=await Promise.all(Array.from({length:8},()=>claimHosted(r)));for(const row of claims.filter(Boolean)){const task=worker(row,index++);running.add(task);task.finally(()=>running.delete(task));}if(running.size)await Promise.race(running);else throw Error('Queue stalled unexpectedly');}await Promise.all(running);
 const sorted=observed.map(j=>j.queueMs).sort((a,b)=>a-b),elapsedMs=Date.now()-started,result={schemaVersion:1,scope:'Isolated PostgreSQL 16 (10-connection application pool) + Docker Linux/arm64 Node24; actual Patchsentry critical backend release tests. Not cloud microVM, browser, Entra, AWS or AI validation.',startedAt:new Date(started).toISOString(),elapsedMs,completed:observed.filter(j=>j.exitCode===0).length,attempts:observed.length,maxActive,throughputPerMinute:observed.length/(elapsedMs/60000),queueMs:{p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)},admission,jobs:observed,samples,humanMinutes:null,modelInference:'not executed',actualProviderCostUsd:null};await writeFile(out+'/load.json',JSON.stringify(result,null,2));assert.equal(result.completed,queued.size);assert.ok(maxActive<=2);assert.ok(admission.some(a=>!a.accepted));console.log(JSON.stringify({...result,samples:result.samples.length,jobs:result.jobs.length,admission:result.admission.length}));
}finally{await database.end();}
