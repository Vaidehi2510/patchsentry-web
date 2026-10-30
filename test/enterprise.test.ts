import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {createPGliteDatabase} from '../src/lib/server/database';
import {createAuth,migrateDatabase} from '../src/lib/server/auth';
import {handleRequest} from '../src/lib/server/api';
import {cookieJar,totp} from './auth-session';
import type {Runtime} from '../src/lib/server/runtime';
import {createHash} from 'node:crypto';
import {policyDefaults} from '../src/lib/quality';
import {captureVisual} from '../src/lib/server/visual-baselines';
import {executeHostedUnits} from '../src/lib/server/hosted-unit';
const links=new Map<string,string>(),tenant=randomUUID(),client=randomUUID(),object=randomUUID();
const config={origin:'https://portal.example',secret:'enterprise-fixture-only-at-least-32-characters',production:false,sendSignInLink:async({email,url}:{email:string;url:string})=>{links.set(email,url);}};
let recovery:string;
let runtime:Runtime,owner='',member='',project='',uri='',nonce='',tokenTenant=tenant,tokenObject=object,tokenAudience=client,tokenEmail='owner@company.test',badSignature=false;
let signing:Awaited<ReturnType<typeof generateKeyPair>>,wrong:Awaited<ReturnType<typeof generateKeyPair>>,jwk:any,ip=50;
async function api(path:string,method='GET',body?:unknown,cookie=owner){return handleRequest(new Request(config.origin+path,{method,headers:{origin:config.origin,'content-type':'application/json',cookie,'x-forwarded-for':'192.0.2.'+ip++},...(body===undefined?{}:{body:JSON.stringify(body)})}),runtime);}
async function account(email:string){await api('/api/auth/sign-in/magic-link','POST',{email,name:email},'');const link=new URL(links.get(email)!);let cookie=cookieJar('',await api(link.pathname+link.search,'GET',undefined,''));let r=await api('/api/security/password','POST',{password:'Enterprise fixture passphrase!',confirmPassword:'Enterprise fixture passphrase!'},cookie);cookie=cookieJar(cookie,r);r=await api('/api/security/enroll','POST',{method:'totp',password:'Enterprise fixture passphrase!'},cookie);const data=await r.json();cookie=cookieJar(cookie,r);r=await api('/api/security/verify','POST',{code:totp(data.totpURI)},cookie);assert.equal(r.status,200,await r.clone().text());return {cookie:cookieJar(cookie,r),uri:data.totpURI,recovery:data.backupCodes[0]};}
async function start(link=false,cookie=owner){const r=await api('/api/enterprise/start','POST',{projectId:project,link},cookie);assert.equal(r.status,200,await r.clone().text());const u=new URL((await r.json()).url);nonce=u.searchParams.get('nonce')!;return {cookie:cookieJar(cookie,r),state:u.searchParams.get('state')!,url:u};}
async function finish(flow:Awaited<ReturnType<typeof start>>,cookie=flow.cookie){return api('/api/enterprise/callback?state='+flow.state+'&code=fixture-code','GET',undefined,cookie);}
before(async()=>{
 const db=await createPGliteDatabase();await migrateDatabase(db,config);runtime={database:db,config,auth:createAuth(db,config)};
 signing=await generateKeyPair('RS256');wrong=await generateKeyPair('RS256');jwk={...await exportJWK(signing.publicKey),kid:'fixture',use:'sig',alg:'RS256'};
 runtime.ssoFetch=async(url,options)=>{
  const u=new URL(String(url));assert.equal(u.hostname,'login.microsoftonline.com');
  if(u.pathname.endsWith('/keys'))return Response.json({keys:[jwk]});
  assert.ok(u.pathname.endsWith('/oauth2/v2.0/token'));const body=new URLSearchParams(String(options?.body));assert.equal(body.get('client_secret'),'fixture-secret-value');assert.equal(body.get('redirect_uri'),config.origin+'/api/enterprise/callback');assert.ok(body.get('code_verifier'));
  const jwt=await new SignJWT({tid:tokenTenant,oid:tokenObject,email:tokenEmail,preferred_username:tokenEmail,nonce}).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer('https://login.microsoftonline.com/'+tenant+'/v2.0').setAudience(tokenAudience).setSubject('subject-'+tokenObject).setIssuedAt().setExpirationTime('5m').sign(badSignature?wrong.privateKey:signing.privateKey);
  return Response.json({access_token:'fixture-unused-access',token_type:'Bearer',expires_in:300,id_token:jwt});
 };
 const a=await account('owner@company.test');owner=a.cookie;uri=a.uri;recovery=a.recovery;member=(await account('member@company.test')).cookie;
 const created=await api('/api/projects','POST',{name:'Enterprise fixture',repository:'fixture/enterprise'});project=(await created.json()).project.id;
 const domain=await(await api('/api/projects/'+project+'/domain','POST',{domain:'company.test'})).json();runtime.domainResolve=async()=>[[domain.domain.recordValue]];await api('/api/projects/'+project+'/domain/verify','POST',{});await api('/api/projects/'+project+'/domain','PATCH',{restricted:true});
});
after(async()=>runtime.database.end());
test('Entra configuration requires a verified restricted domain and owner; secrets never return',async()=>{
 const root='/api/projects/'+project+'/sso';
 assert.equal((await api(root,'POST',{tenantId:tenant,clientId:client,clientSecret:'fixture-secret-value'},member)).status,404);
 const r=await api(root,'POST',{tenantId:tenant,clientId:client,clientSecret:'fixture-secret-value'});assert.equal(r.status,200,await r.clone().text());assert.ok(!(await r.text()).includes('fixture-secret-value'));
 const saved=(await runtime.database.query<{secret:Uint8Array}>('SELECT secret FROM qa_sso_connections WHERE project_id=$1',[project])).rows[0];assert.ok(!Buffer.from(saved.secret).includes(Buffer.from('fixture-secret-value')));
 assert.equal((await api(root,'PATCH',{enforced:true})).status,409);
});
test('OIDC validates real signatures, issuer/audience, nonce and tenant and refuses email-only linking',async()=>{
 let flow=await start(false,'');assert.equal((await finish(flow)).status,403);
 flow=await start(true);assert.equal(flow.url.origin,'https://login.microsoftonline.com');assert.equal(flow.url.searchParams.get('code_challenge_method'),'S256');
 const withoutBrowser=await finish(flow,'');assert.equal(withoutBrowser.status,400);
 assert.equal((await finish(flow)).status,303);assert.equal((await finish(flow)).status,400);
 badSignature=true;flow=await start(false,'');assert.equal((await finish(flow)).status,401);badSignature=false;
 tokenAudience=randomUUID();flow=await start(false,'');assert.equal((await finish(flow)).status,401);tokenAudience=client;
 tokenTenant=randomUUID();flow=await start(false,'');assert.equal((await finish(flow)).status,403);tokenTenant=tenant;
 flow=await start(false,'');nonce='wrong-nonce';assert.equal((await finish(flow)).status,401);
 tokenObject=randomUUID();flow=await start(false,'');assert.equal((await finish(flow)).status,403);tokenObject=object;
});
test('SSO creates only factor-one proof, MFA completes login, and enforcement rejects password-only sessions',async()=>{
 const flow=await start(false,'');const r=await finish(flow);assert.equal(r.status,303,await r.clone().text());let cookie=cookieJar(flow.cookie,r);
 assert.equal((await api('/api/projects/'+project,'GET',undefined,cookie)).status,401);
 const factor=await api('/api/security/verify','POST',{code:recovery,recovery:true},cookie);assert.equal(factor.status,200,await factor.clone().text());cookie=cookieJar(cookie,factor);
 assert.equal((await api('/api/projects/'+project,'GET',undefined,cookie)).status,200);
 assert.equal((await api('/api/projects/'+project+'/sso','PATCH',{enforced:true},cookie)).status,200);
 assert.equal((await api('/api/projects/'+project,'GET')).status,404);
 assert.equal((await api('/api/projects/'+project+'/runs','GET')).status,404);
 const invitation=await(await api('/api/projects/'+project+'/team','POST',{email:'member@company.test',role:'viewer'},cookie)).json();
 assert.equal((await api('/api/invitations/accept','POST',{token:invitation.token},member)).status,200);
 assert.equal((await api('/api/projects/'+project,'GET',undefined,member)).status,404);
 tokenEmail='member@company.test';tokenObject=randomUUID();const linking=await start(true,member);assert.equal((await finish(linking)).status,303,'new members can explicitly link before they have an SSO session');tokenEmail='owner@company.test';tokenObject=object;

 assert.equal((await api('/api/projects/'+project+'/sso','PATCH',{enforced:false},cookie)).status,200);
});
test('SCIM is project scoped, supports Entra filters and deactivation, cannot grant admin or alter verified email',async()=>{
 const root='/api/projects/'+project+'/sso',issued=await api(root+'/directory-token','POST',{});assert.equal(issued.status,200,await issued.clone().text());const token=(await issued.json()).token,base='/api/scim/'+project+'/v2';
 async function directory(path:string,method='GET',body?:unknown,key=token){return handleRequest(new Request(config.origin+base+path,{method,headers:{authorization:'Bearer '+key,'content-type':'application/scim+json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),runtime);}
 assert.equal((await directory('/Users','GET',undefined,'bad')).status,401);
 const created=await directory('/Users','POST',{schemas:['urn:ietf:params:scim:schemas:core:2.0:User'],userName:'member@company.test',externalId:'entra-user-42',active:true,roles:[{value:'admin'}]});assert.equal(created.status,201,await created.clone().text());const user=(await created.json());
 assert.equal((await api('/api/projects/'+project,'GET',undefined,member)).status,200);
 const people=await(await api('/api/projects/'+project+'/team')).json();assert.equal(people.members.find((m:any)=>m.email==='member@company.test').role,'viewer');
 const filtered=await(await directory('/Users?filter='+encodeURIComponent('userName eq "member@company.test"'))).json();assert.equal(filtered.totalResults,1);
 assert.equal((await directory('/Users','POST',{userName:'outside@company.test.attacker.test'})).status,403);
 assert.equal((await directory('/Users/'+user.id,'PATCH',{Operations:[{op:'Replace',path:'active',value:false}]})).status,200);
 assert.equal((await api('/api/projects/'+project,'GET',undefined,member)).status,404);
 assert.equal((await directory('/Users/'+user.id,'PUT',{userName:'changed@company.test',active:true})).status,409);
 assert.equal((await directory('/Users/'+user.id,'PATCH',{Operations:[{op:'Replace',path:'active',value:true}]})).status,200);
 assert.equal((await api('/api/projects/'+project,'GET',undefined,member)).status,200);
 assert.equal((await directory('/Users/'+user.id,'DELETE')).status,204);
 assert.equal((await api('/api/projects/'+project,'GET',undefined,member)).status,404);
 await api(root+'/directory-token','POST',{});assert.equal((await directory('/Users')).status,401);
});

test('visual candidates require real report identities, explicit MFA review and compare-and-swap approval',async()=>{
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6r9sAAAAASUVORK5CYII=','base64'),sha=createHash('sha256').update(bytes).digest('hex'),record='e'.repeat(64),revision='a'.repeat(40),identity={repository:'fixture/enterprise',checkId:'web-primary',browser:'chromium',width:390,height:844},key=createHash('sha256').update(JSON.stringify(identity)).digest('hex');
 await runtime.database.query('UPDATE projects SET quality_policy=$2::jsonb WHERE id=$1',[project,JSON.stringify({...policyDefaults,allowEvidenceUploads:true})]);
 await runtime.database.query('INSERT INTO qa_runs(project_id,record_id,payload) VALUES($1,$2,$3::jsonb)',[project,record,JSON.stringify({repository:identity.repository,revision,checks:[{id:identity.checkId}]})]);
 const meta={schemaVersion:1,key,identity,sha256:sha,revision,revisionVerified:true,repository:identity.repository,image:'candidate.png',previousDigest:null};
 const req=(metadata:any)=>new Request(config.origin+'/upload',{method:'POST',headers:{'content-type':'image/png','x-patchsentry-visual':Buffer.from(JSON.stringify(metadata)).toString('base64url')},body:bytes});
 await assert.rejects(captureVisual(runtime,project,record,req({...meta,revision:'b'.repeat(40)})),/exact report/);
 assert.equal((await captureVisual(runtime,project,record,req(meta))).saved,true);
 const root='/api/projects/'+project+'/visual-baselines',state=await(await api(root)).json(),candidate=state.candidates[0];assert.ok(candidate.id);
 assert.equal((await api(root+'/'+candidate.id)).status,200);
 const input={candidateId:candidate.id,revision,expectedPreviousDigest:null};
 assert.equal((await api(root,'POST',{...input,revision:'c'.repeat(40)})).status,409);
 assert.equal((await api(root,'POST',input)).status,200);
 assert.equal((await api(root,'POST',input)).status,409);
 const baseline=(await(await api(root)).json()).baselines[0];assert.equal(baseline.metadata.sha256,sha);
 await api(root+'/'+candidate.id,'DELETE',{});assert.equal((await api(root+'/'+candidate.id)).status,200,'approved baseline survives candidate retention');
 const saved=(await runtime.database.query<{encrypted:Uint8Array}>('SELECT encrypted FROM qa_visual_baselines WHERE project_id=$1',[project])).rows[0];assert.ok(!Buffer.from(saved.encrypted).includes(bytes));
});

test('hosted unit execution denies network before untrusted code, receives no inference/callback keys and retains actual outcomes',async()=>{
 const source="const test=require('node:test');test('fixture',()=>{});",unit={id:randomUUID(),name:'Fixture',source,sha256:createHash('sha256').update(source).digest('hex')},id=randomUUID();
 const job:any={id,repository:'fixture/enterprise',revision:'a'.repeat(40),unitTests:[unit]};
 await runtime.database.query('INSERT INTO qa_jobs(id,project_id,dedupe_key,payload,status) VALUES($1,$2,$3,$4::jsonb,$5)',[id,project,randomUUID(),JSON.stringify(job),'running']);
 let isolated=false,stopped=false,files:any[]=[];
 const adapter:any={create:async()=>({name:'unit-fixture',writeFiles:async(f:any[])=>{files=f;},updateNetworkPolicy:async(p:string)=>{assert.equal(p,'deny-all');isolated=true;},runCommand:async(cmd:any)=>{if(cmd.cmd==='node')return {exitCode:0,stdout:async()=>''};assert.equal(isolated,true);assert.equal(cmd.cmd,'sudo');assert.ok(cmd.args.includes('nobody'));assert.ok(cmd.args.includes('--permission'));assert.ok(cmd.args.includes('--eval'));assert.ok(!cmd.args.includes('--allow-child-process'));return {exitCode:1,stdout:async()=> '# tests 2\n# pass 1\n# fail 1\n# skipped 0\n# cancelled 0\n'};},stop:async()=>{stopped=true;}})};
 const result=await executeHostedUnits(runtime,adapter,id,project,job);assert.equal(result?.status,'failed');assert.equal(result?.tests,2);assert.equal(stopped,true);assert.ok(!JSON.stringify(files).includes('OPENROUTER_API_KEY'));assert.ok(!JSON.stringify(files).includes('callbackToken'));
 const blocked=await executeHostedUnits(runtime,{create:async()=>({name:'no-isolation',stop:async()=>{},writeFiles:async()=>{},runCommand:async()=>{throw Error('must not run');}})} as any,id,project,job);assert.equal(blocked?.status,'blocked');
});

test('AWS Device Farm is opt-in, bounded, project scoped, deduplicated and reports only actual provider evidence',async()=>{
 const resource=randomUUID(),pool=randomUUID(),app=randomUUID(),tests=randomUUID(),aws='arn:aws:devicefarm:us-west-2:123456789012:',projectArn=aws+'project:'+resource,devicePoolArn=aws+'devicepool:'+resource+'/'+pool,appArn=aws+'upload:'+resource+'/'+app,testPackageArn=aws+'upload:'+resource+'/'+tests,runArn=aws+'run:'+resource+'/'+randomUUID(),root='/api/projects/'+project+'/device-farm';let schedules=0,passed=false;
 runtime.deviceFarmSend=async(command:any)=>{const input=command.input;switch(command.constructor.name){case 'GetProjectCommand':return {project:{arn:projectArn}};case 'GetDevicePoolCommand':return {devicePool:{arn:devicePoolArn}};case 'GetUploadCommand':return {upload:{arn:input.arn,status:'SUCCEEDED',type:input.arn===appArn?'ANDROID_APP':'APPIUM_NODE_TEST_PACKAGE'}};case 'GetDevicePoolCompatibilityCommand':return {compatibleDevices:[{device:{arn:'arn:aws:devicefarm:us-west-2::device:'+randomUUID()}}]};case 'ScheduleRunCommand':schedules++;assert.equal(input.executionConfiguration.jobTimeoutMinutes,15);assert.equal(input.deviceSelectionConfiguration.maxDevices,2);assert.equal(input.deviceSelectionConfiguration.filters[0].values.length,1);return {run:{arn:runArn}};case 'GetRunCommand':return {run:{arn:runArn,status:'COMPLETED',result:passed?'PASSED':'FAILED',counters:{total:2,passed:passed?2:1,failed:passed?0:1}}};case 'ListJobsCommand':return {jobs:[{status:'COMPLETED',device:{arn:'physical-device-42',name:'Real phone',os:'17',platform:'IOS'},result:passed?'PASSED':'FAILED'}]};default:return {};}};
 const configured=await api(root,'POST',{projectArn,devicePoolArn,credentials:{accessKeyId:'A'.repeat(20),secretAccessKey:'s'.repeat(40)},paidTestingConsent:true});assert.equal(configured.status,200,await configured.clone().text());assert.equal(schedules,0);
 const request={idempotencyKey:randomUUID(),revision:'a'.repeat(40),version:'v1',platform:'android',appArn,testPackageArn,artifactSha256:'b'.repeat(64),reviewedUploadProvenance:true};
 assert.equal((await api(root+'/runs','POST',{...request,appArn:appArn.replace('123456789012','999999999999')})).status,403);
 const started=await api(root+'/runs','POST',request);assert.equal(started.status,200,await started.clone().text());const id=(await started.json()).id;
 assert.equal((await api(root+'/runs','POST',request)).status,200);assert.equal(schedules,1);
 assert.equal((await api(root+'/runs','POST',{...request,revision:'c'.repeat(40)})).status,409,'idempotency cannot silently reuse a different build');
 const result=await(await api(root+'/runs/'+id,'POST',{})).json();assert.equal(result.result.status,'blocked');assert.equal(result.result.failed,1);assert.equal(result.result.devices.length,1);assert.ok(result.result.limitations.some((v:string)=>v.includes('not independently hashed')));
 passed=true;const green=await(await api(root+'/runs/'+id,'POST',{})).json();assert.equal(green.result.status,'passed');assert.equal(green.result.tests,2);assert.equal(green.result.limitations.length,3);
 assert.equal((await api(root+'/runs','POST',{...request,idempotencyKey:randomUUID()})).status,409);assert.equal(schedules,1);
 assert.equal((await api('/api/devicefarm/'+project+'/ci','POST',request,'')).status,403,'automatic paid testing stays disabled');
});
