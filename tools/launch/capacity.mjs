// Operator-only configuration client. No credentials belong in arguments or files.
import {readFile} from 'node:fs/promises';
const origin=new URL(process.env.PATCHSENTRY_PORTAL_URL||'https://patchsentry.vercel.app');
if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw Error('Use the exact trusted HTTPS portal origin.');
const secret=process.env.PATCHSENTRY_OPERATOR_SECRET;if(!secret)throw Error('Set the existing operator bearer secret securely in the process environment.');
const [action='get',filename,owner]=process.argv.slice(2);if(!['get','pool','tenant','pulse'].includes(action))throw Error('Use get, pool FILE, tenant FILE OWNER_ID or pulse.');
const endpoint=action==='pulse'?'/api/internal/hosted/drain':action==='tenant'?'/api/internal/capacity/tenants/'+encodeURIComponent(owner||''):'/api/internal/capacity';
const body=['pool','tenant'].includes(action)?JSON.parse(await readFile(filename,'utf8')):undefined;
const r=await fetch(new URL(endpoint,origin),{method:action==='get'?'GET':action==='pulse'?'POST':'PUT',redirect:'error',signal:AbortSignal.timeout(30000),headers:{authorization:'Bearer '+secret,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const result=await r.json();if(!r.ok)throw Error(result.error||`Operator request failed (${r.status}).`);console.log(JSON.stringify(result,null,2));
