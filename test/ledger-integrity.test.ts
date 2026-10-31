import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPGliteDatabase} from '../src/lib/server/database';
import {createAuth,migrateDatabase} from '../src/lib/server/auth';
import {appendLedger,ledgerPayload,verifyLedger} from '../src/lib/server/assessment-ledger';
import {encrypt} from '../src/lib/server/evidence';
import {connectLedger,deliverLedger} from '../src/lib/server/ledger-bridge';
import {settingsDefaults} from '../src/lib/contracts';
import type {Runtime} from '../src/lib/server/runtime';
let r:Runtime,entry:any;const owner=randomUUID(),project=randomUUID(),remote=randomUUID(),record='a'.repeat(64),payload={fixture:'original trusted snapshot'},config={origin:'https://ledger-integrity.fixture',secret:'ledger-integrity-fixture-secret-at-least-32-characters',production:false,ledgerAllowedOrigins:['https://ledger.fixture']};
before(async()=>{const database=await createPGliteDatabase();await migrateDatabase(database,config);r={database,config,auth:createAuth(database,config)};await database.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,\'Fixture\',\'owner@fixture.invalid\',true,now(),now())',[owner]);await database.query("INSERT INTO projects(id,owner_id,name,repository,settings) VALUES($1,$2,'Integrity fixture','fixture/ledger',$3::jsonb)",[project,owner,JSON.stringify(settingsDefaults)]);entry=await appendLedger(r,database.query.bind(database),project,'assessment','integrity-fixture',payload,'Fixture',record);});
after(()=>r.database.end());
test('well-formed encrypted Ledger payload is still rejected if its plaintext does not match the immutable receipt digest',async()=>{
 const original=(await r.database.query<{encrypted:Uint8Array}>('SELECT encrypted FROM qa_ledger_payloads WHERE entry_id=$1',[entry.id])).rows[0].encrypted;
 await r.database.query('UPDATE qa_ledger_payloads SET encrypted=$2 WHERE entry_id=$1',[entry.id,encrypt(r,project,entry.id,Buffer.from(JSON.stringify({fixture:'different valid plaintext'})))]);
 await assert.rejects(ledgerPayload(r,project,entry.id),/integrity/);assert.equal((await verifyLedger(r,project)).valid,true,'Receipt chain alone does not verify retained ciphertext contents');await r.database.query('UPDATE qa_ledger_payloads SET encrypted=$2 WHERE entry_id=$1',[entry.id,Buffer.from(original)]);assert.deepEqual(await ledgerPayload(r,project,entry.id),payload);
});
test('Java archive delivery rejects each mismatched receipt field before confirming a destination',async()=>{
 let mismatch:any={};r.ledgerFetch=async(url)=>{if(String(url).endsWith('/project'))return Response.json({projectId:remote,repository:'fixture/ledger',capabilities:['assessment-archive-v1']});return Response.json({projectId:remote,recordId:record,payloadDigest:entry.payload_digest,archived:true,...mismatch});};
 await connectLedger(r,project,{origin:'https://ledger.fixture',token:'psl_'+'x'.repeat(43),approveAssessmentTransfer:true},'Fixture');
 for(const invalid of [{projectId:randomUUID()},{recordId:'b'.repeat(64)},{payloadDigest:'c'.repeat(64)},{archived:false}]){mismatch=invalid;await r.database.query("UPDATE qa_ledger_delivery SET status='pending',attempts=0,receipt=NULL WHERE entry_id=$1",[entry.id]);assert.equal((await deliverLedger(r,project)).delivered,0,JSON.stringify(invalid));const row=(await r.database.query<any>('SELECT status,receipt FROM qa_ledger_delivery WHERE entry_id=$1',[entry.id])).rows[0];assert.notEqual(row.status,'confirmed');assert.equal(row.receipt,null);}
 mismatch={};await r.database.query("UPDATE qa_ledger_delivery SET status='pending',attempts=0 WHERE entry_id=$1",[entry.id]);assert.equal((await deliverLedger(r,project)).delivered,1);
});
