#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {createHmac,randomUUID} from 'node:crypto';
// CI calls this after producing an immutable build. No product source writes.
const args=process.argv.slice(2),filename=args[0];
try{
 if(!filename||args.slice(1).some(a=>a!=='--no-wait'))throw Error('Usage: node scripts/publish-ci-assessment.mjs manifest.json [--no-wait]');
 const secret=process.env.QA_AUTOMATION_SECRET,url=new URL(process.env.QA_AUTOMATION_URL||''),portal=new URL(process.env.QA_PORTAL_URL||'https://patchsentry.vercel.app');
 if(!secret||secret.length<32||url.origin!==portal.origin||url.protocol!=='https:'||!/^\/api\/automation\/[a-f0-9-]{36}\/ci$/.test(url.pathname)||url.username||url.password||url.search||url.hash)throw Error('Configure the project’s HTTPS QA_AUTOMATION_URL, QA_AUTOMATION_SECRET and optional QA_PORTAL_URL in CI secrets.');
 const manifest=JSON.parse(await readFile(filename,'utf8')),body=JSON.stringify(manifest),delivery=process.env.QA_EVENT_ID||randomUUID();if(Buffer.byteLength(body)>512000)throw Error('Manifest exceeds 512KB');
 async function send(endpoint,payload){const response=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json','x-github-delivery':delivery,'x-hub-signature-256':'sha256='+createHmac('sha256',secret).update(payload).digest('hex')},body:payload});if(!response.ok)throw Error('QA endpoint rejected the request (HTTP '+response.status+'). Check configuration in the dashboard.');return response.json();}
 const accepted=await send(url.href,body);console.log('QA event accepted: '+accepted.id);
 if(!args.includes('--no-wait')){
  const deadline=Date.now()+20*60*1000;let finished=false;
  while(Date.now()<deadline){const result=await send(url.href.replace(/\/ci$/,'/result'),JSON.stringify({deliveryId:delivery}));if(result.rollout?.mode==='advisory'){console.log('Advisory QA is non-gating and does not authorize deployment. Follow the assessment in Patchsentry.');finished=true;break;}if(result.canProceed){console.log('Required QA evidence passed for the requested assessment.');finished=true;break;}if(['completed','failed','blocked','cancelled'].includes(result.job?.status)||!result.job&&['blocked','excluded'].includes(result.event.status))throw Error('QA did not approve this assessment. Review the dashboard before deploying.');await new Promise(r=>setTimeout(r,10000));}
  if(!finished)throw Error('QA did not finish within 20 minutes. Deployment must remain blocked.');
 }
}catch(error){console.error(error.message||'CI QA publication failed.');process.exitCode=1;}
