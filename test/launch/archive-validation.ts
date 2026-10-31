// Archive measured internal results in the existing Ledger; never qualifies a release.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createDatabase} from '../../src/lib/server/database';
import {createAuth} from '../../src/lib/server/auth';
import {appendLedger,verifyLedger,ledgerPayload} from '../../src/lib/server/assessment-ledger';
import {canonical} from '../../src/lib/quality';
const url=new URL(process.env.DATABASE_URL||'http://invalid');if(process.env.PS_ALLOW_FIXTURE_RECOVERY!=='1'||url.hostname!=='127.0.0.1'||!['/ps_fixture_launch','/ps_fixture_launch_final'].includes(url.pathname))throw Error('Synthetic launch databases only');
const db=await createDatabase({DATABASE_URL:url.href,NODE_ENV:'test'}),config={origin:'https://load.fixture',secret:'launch-fixture-only-secret-at-least-32-characters',production:false},r={database:db,config,auth:createAuth(db,config)},directory='docs/evidence/launch',sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
try{
 const p=(await db.query<{id:string}>("SELECT id FROM projects WHERE repository='fixture/load-0'")).rows[0];assert.ok(p);
 const artifacts=[];for(const file of (await readdir(directory)).filter(n=>n.endsWith('.json')&&!n.startsWith('ledger-receipt')).sort()){const bytes=await readFile(directory+'/'+file);JSON.parse(bytes.toString());artifacts.push({file,sha256:sha(bytes),bytes:bytes.length});}
 const payload={classification:'Internal development execution evidence; not independent assurance, production readiness or project qualification',baseline:{website:'e067162',deployedCode:'37e9fba',engine:'d0ae18a',java:'6a15e90'},artifacts,readiness:{platform:'limited advisory pilot; external launch criteria outstanding',project:'No real project promoted or configuration activated',qaResponsibilities:'Own-product backend release QA and deterministic internal challenge; AI and human savings unmeasured'},notice:'Hash receipts bind these exact summaries; independent custody and authentic review are separate.'},digest=sha(canonical(payload));
 const c=await db.connect();let entry:any;try{await c.query('BEGIN');entry=await appendLedger(r,c.query.bind(c),p.id,'internal-launch-validation','launch-validation:'+digest,payload,'Internal release validation');await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 const chain=await verifyLedger(r,p.id);assert.equal(chain.valid,true);assert.equal(sha(canonical(await ledgerPayload(r,p.id,entry.id))),digest);const receipt={classification:'Existing hosted Ledger implementation exercised in a synthetic local project, not a production customer or deployed Java receipt',projectId:p.id,entryId:entry.id,eventType:entry.event_type,payloadDigest:digest,sequence:entry.sequence,entryHash:entry.entry_hash,verifiedChain:chain,artifactCount:artifacts.length};await writeFile(directory+'/ledger-receipt.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}finally{await db.end();}
