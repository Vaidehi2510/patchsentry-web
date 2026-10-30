import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Runtime} from './runtime';
import type {JobInput} from '../jobs';
import type {HostedAdapter,HostedSandbox} from './hosted';
import {providerKey} from './provider-vault';
import {JobError} from './jobs';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export type HostedUnitResult={status:'passed'|'failed'|'blocked';tests:number;failed:number;skipped:number;durationMs:number;revision:string;sourceDigests:string[];details:string};
async function output(value:unknown){const r=value as {exitCode?:number;stdout?:()=>Promise<string>};if(!r||!Number.isInteger(r.exitCode)||typeof r.stdout!=='function')throw new Error('Missing VM command evidence');const text=await r.stdout();if(text.length>128000)throw new Error('Unit result too large');return {code:r.exitCode!,text};}
export async function executeHostedUnits(r:Runtime,adapter:HostedAdapter,id:string,projectId:string,job:JobInput):Promise<HostedUnitResult|null>{
 const started=Date.now();
 const tests=job.unitTests||[];if(!tests.length)return null;
 if(tests.some(t=>digest(t.source)!==t.sha256))throw new JobError(409,'Authored test source changed.');
 let vm:HostedSandbox|undefined;
 const base={tests:0,failed:0,skipped:0,revision:job.revision,sourceDigests:tests.map(t=>t.sha256)};
 try{
  vm=await adapter.create('github.com');if(!vm.updateNetworkPolicy)throw Error('Network isolation is unavailable');
  const registered=await r.database.query("UPDATE qa_jobs SET sandbox_id=$2 WHERE id=$1 AND status='running' RETURNING id",[id,vm.name]);if(!registered.rows.length)throw Error('Cancelled');
  const token=(await r.database.query("SELECT project_id FROM qa_provider_credentials WHERE project_id=$1 AND provider='github'",[projectId])).rows.length?(await providerKey(r,projectId,'github')).apiKey:undefined;
  await vm.writeFiles([{path:'/vercel/sandbox/unit-input.json',content:Buffer.from(JSON.stringify({repository:job.repository,revision:job.revision,gitHubToken:token}))},{path:'/vercel/sandbox/unit-prepare.cjs',content:await readFile(join(process.cwd(),'scripts/hosted-unit-prepare.cjs'))},...tests.map(t=>({path:'/vercel/sandbox/tests/'+t.id+'.test.cjs',content:Buffer.from(t.source)}))]);
  const prepared=await output(await vm.runCommand({cmd:'node',args:['/vercel/sandbox/unit-prepare.cjs'],timeoutMs:120000}));if(prepared.code!==0)throw Error('Source unavailable');
  // The provider enforces no network before any authored code executes.
  await vm.updateNetworkPolicy('deny-all');
  const result=await output(await vm.runCommand({cmd:'sudo',args:['-u','nobody','--','env','-i','PATH=/usr/local/bin:/usr/bin:/bin','HOME=/tmp','QA_PRODUCT_ROOT=/vercel/sandbox/product','node','--max-old-space-size=128','--permission','--allow-fs-read=/vercel/sandbox/product','--allow-fs-read=/vercel/sandbox/tests','--test-reporter=tap','--eval','for(const filename of process.argv.slice(1))require(filename);','--',...tests.map(t=>'/vercel/sandbox/tests/'+t.id+'.test.cjs')],timeoutMs:65000}));
  const count=(name:string)=>{const m=[...result.text.matchAll(new RegExp('^# '+name+' (\\d+)$','gm'))];return m.length===1?Number(m[0][1]):null;};
  const total=count('tests'),failed=count('fail'),pass=count('pass'),skipped=count('skipped'),cancelled=count('cancelled');
  if(total===null||failed===null||pass===null||skipped===null||cancelled===null||total<1||total!==failed+pass+skipped+cancelled)throw Error('Missing complete test evidence');
  return {...base,durationMs:Date.now()-started,status:failed||cancelled||result.code!==0?'failed':skipped?'blocked':'passed',tests:total,failed:failed+cancelled,skipped,details:`Offline hosted Node unit tests: ${pass}/${total} passed; ${failed+cancelled} failed/cancelled; ${skipped} skipped. Exact source revision and authored test hashes retained. No dependencies were installed and no product build scripts ran.`};
 }catch{return {...base,durationMs:Date.now()-started,status:'blocked',details:'Hosted unit execution lacked complete evidence or its isolated source preparation failed. No passing result is inferred.'};}
 finally{if(vm)await vm.stop().catch(()=>{});}
}
