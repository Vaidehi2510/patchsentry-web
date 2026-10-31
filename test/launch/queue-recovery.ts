import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createDatabase} from '../../src/lib/server/database';
import {createAuth,migrateDatabase} from '../../src/lib/server/auth';
import {createJob} from '../../src/lib/server/jobs';
import {claimHosted,releaseReservation,archiveCapacity} from '../../src/lib/server/capacity';
import {recoverExecutions} from '../../src/lib/server/operations';
const url=new URL(process.env.DATABASE_URL||'http://invalid');if(process.env.PS_ALLOW_FIXTURE_RECOVERY!=='1'||url.hostname!=='127.0.0.1'||url.pathname!=='/ps_fixture_launch')throw Error('Fixture database only');
const database=await createDatabase({DATABASE_URL:url.href,NODE_ENV:'test'}),config={origin:'https://load.fixture',secret:'launch-fixture-only-secret-at-least-32-characters',production:false},r={database,config,auth:createAuth(database,config)},started=Date.now();
try{
 await migrateDatabase(database,config);
 const projects=(await database.query<any>('SELECT * FROM projects ORDER BY repository LIMIT 2')).rows;assert.equal(projects.length,2);
 for(const p of projects)await createJob(database,p,{dedupeKey:randomUUID(),prNumber:1,revision:'a'.repeat(40)},'Recovery fixture');
 await database.query("UPDATE qa_jobs SET created_at=now()-interval '10 minutes' WHERE status='queued'");await recoverExecutions(r);assert.equal((await database.query("SELECT id FROM qa_jobs WHERE status='queued'")).rows.length,2,'Deployment interruption must not expire a valid queued job after five minutes');
 const job:any=await claimHosted(r);assert.ok(job);await archiveCapacity(r,job);const child=spawn('docker',['run','--name','ps-launch-interrupted','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256','--cpus','2','--memory','4g','--tmpfs','/tmp:rw,nosuid,nodev,size=2g,uid=1000,gid=1000','--mount','type=bind,source=/private/tmp/ps-launch-source-candidate,target=/workspace,readonly','patchsentry-release-qa:launch','full'],{stdio:'ignore'});const exited=new Promise(resolve=>child.on('exit',resolve));await new Promise(resolve=>setTimeout(resolve,1200));const killed=spawnSync('docker',['kill','ps-launch-interrupted'],{stdio:'ignore'});assert.equal(killed.status,0);await exited;spawnSync('docker',['rm','ps-launch-interrupted'],{stdio:'ignore'});
 await database.query("UPDATE qa_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[job.id]);const before=Date.now(),result=await recoverExecutions(r),recoveryMs=Date.now()-before;assert.equal(result.recovered,1);assert.equal((await database.query<any>('SELECT status FROM qa_jobs WHERE id=$1',[job.id])).rows[0].status,'blocked');assert.ok((await database.query("SELECT id FROM qa_assessment_ledger WHERE event_type='execution-ended'")).rows.length);
 await releaseReservation(r,job.id,false,'killed-unreconciled');assert.ok((await database.query('SELECT job_id FROM qa_hosted_reservations WHERE job_id=$1 AND released_at IS NULL',[job.id])).rows.length);
 const next:any=await claimHosted(r);assert.ok(next);assert.notEqual(next.project_id,job.project_id,'Another company may progress while one failed company retains its safety slot');await database.query("UPDATE qa_jobs SET status='blocked',message='Queue recovery probe; provider execution deliberately not requested' WHERE id=$1",[next.id]);await releaseReservation(r,next.id,true,'no-provider-created');await releaseReservation(r,job.id,true,'local-container-stop-confirmed');
 const report={scope:'Actual local test worker killed; PostgreSQL durable queue and recovery controller; lease deadline advanced in fixture SQL, not elapsed in real time. No Vercel deployment/traffic switch tested.',queueSurvivedSimulatedDeploymentPause:true,workerInterrupted:true,automaticRetry:false,failedAssessmentBecamePass:false,otherTenantProgressed:true,recoveryControllerMs:recoveryMs,totalMs:Date.now()-started};await writeFile('/private/tmp/ps-launch-results/queue-recovery.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await database.end();}
