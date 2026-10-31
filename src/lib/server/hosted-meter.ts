import {randomUUID} from 'node:crypto';
import type {Runtime} from './runtime';
import type {HostedAdapter,HostedSandbox} from './hosted';
import {JobError} from './jobs';
/** A provider create is recorded before calling it. Ambiguous creates/stops
 * cannot release the job's reserved slot or be retried as though nothing ran. */
export function meteredHosted(r:Runtime,jobId:string,base:HostedAdapter):HostedAdapter{
 const wrap=(vm:HostedSandbox,stageId:string):HostedSandbox=>({name:vm.name,writeFiles:f=>vm.writeFiles(f),runCommand:c=>vm.runCommand(c),...(vm.updateNetworkPolicy?{updateNetworkPolicy:(p:'deny-all')=>vm.updateNetworkPolicy!(p)}:{}),stop:async()=>{
  try{await vm.stop();await r.database.query("UPDATE qa_hosted_stages SET status='stopped',stopped_at=now() WHERE id=$1",[stageId]);}catch(e){await r.database.query("UPDATE qa_hosted_stages SET status='stop-uncertain' WHERE id=$1",[stageId]);throw e;}
 }});
 return {async create(host,artifact){const c=await r.database.connect(),stageId=randomUUID();try{await c.query('BEGIN');const row=(await c.query<{status:string}>('SELECT status FROM qa_jobs WHERE id=$1 FOR UPDATE',[jobId])).rows[0];if(row?.status!=='running')throw new JobError(409,'Job was cancelled before provider creation.');const reservation=(await c.query<{vm_stages:number;release_after:string}>('SELECT vm_stages,release_after FROM qa_hosted_reservations WHERE job_id=$1 FOR UPDATE',[jobId])).rows[0];const count=Number((await c.query<{n:string}>('SELECT count(*) AS n FROM qa_hosted_stages WHERE job_id=$1',[jobId])).rows[0].n);if(!reservation||Date.parse(reservation.release_after)<=Date.now()||count>=reservation.vm_stages)throw new JobError(409,'Reserved provider stage budget is exhausted or expired.');await c.query("UPDATE qa_hosted_reservations SET release_after=GREATEST(release_after,now()+interval '16 minutes') WHERE job_id=$1",[jobId]);await c.query("INSERT INTO qa_hosted_stages(id,job_id,status) VALUES($1,$2,'creating')",[stageId,jobId]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  let vm:HostedSandbox;try{vm=await base.create(host,artifact);}catch(e){await r.database.query("UPDATE qa_hosted_stages SET status='create-uncertain' WHERE id=$1",[stageId]);throw e;}
  await r.database.query("UPDATE qa_hosted_stages SET status='running',vm_id=$2 WHERE id=$1",[stageId,vm.name]);await r.database.query("UPDATE qa_hosted_reservations SET release_after=GREATEST(release_after,now()+interval '16 minutes') WHERE job_id=$1",[jobId]);const tracked=wrap(vm,stageId);
  if(!(await r.database.query("SELECT id FROM qa_jobs WHERE id=$1 AND status='running'",[jobId])).rows.length){await tracked.stop().catch(()=>{});throw new JobError(409,'Job cancelled while provider was starting.');}
  return tracked;
 },async get(name){const stage=(await r.database.query<{id:string}>('SELECT id FROM qa_hosted_stages WHERE job_id=$1 AND vm_id=$2',[jobId,name])).rows[0];const vm=await base.get(name);return stage?wrap(vm,stage.id):vm;}};
}
export async function closeHostedReservation(r:Runtime,jobId:string,status:string){
 const pending=(await r.database.query("SELECT id FROM qa_hosted_stages WHERE job_id=$1 AND status<>'stopped' LIMIT 1",[jobId])).rows.length;
 await r.database.query("UPDATE qa_hosted_reservations SET released_at=CASE WHEN $2 THEN released_at ELSE now() END,finish_status=$3,wall_ms=GREATEST(0,extract(epoch FROM(now()-started_at))*1000)::bigint WHERE job_id=$1",[jobId,Boolean(pending),status]);
}
