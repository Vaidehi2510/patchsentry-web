import {createHash,randomBytes,randomUUID,createDecipheriv,hkdfSync} from 'node:crypto';
import * as oidc from 'openid-client';
import {serializeSignedCookie} from 'better-call';
import {z} from 'zod';
import type {Runtime} from './runtime';
import {JobError} from './jobs';
import {sealProvider} from './provider-vault';
import {restrictedDomain,domainAllowsUser,matchesDomain} from './domain-policy';
import {securityState,proof,rate} from './session-security';
import {audit} from './team';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const uuid=z.uuid();
type Connection={project_id:string;tenant_id:string;client_id:string;secret:Uint8Array;generation:string;enforced:boolean};
const cookieName=(r:Runtime)=>r.config.production?'__Host-ps-sso':'ps-sso';
const redirectUri=(r:Runtime)=>r.config.origin+'/api/enterprise/callback';
function decrypt(r:Runtime,c:Connection){const b=Buffer.from(c.secret),k=Buffer.from(hkdfSync('sha256',r.config.secret,c.project_id,'patchsentry-provider-vault-v1',32)),d=createDecipheriv('aes-256-gcm',k,b.subarray(0,12));d.setAAD(Buffer.from(c.project_id+':entra'));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString();}
async function connection(r:Runtime,id:string){const c=(await r.database.query<Connection>('SELECT * FROM qa_sso_connections WHERE project_id=$1',[id])).rows[0];if(!c)throw new JobError(409,'The project owner must configure Microsoft Entra ID first.');return c;}
function configuration(r:Runtime,c:Connection){
  const base='https://login.microsoftonline.com/'+c.tenant_id;
  const config=new oidc.Configuration({issuer:base+'/v2.0',authorization_endpoint:base+'/oauth2/v2.0/authorize',token_endpoint:base+'/oauth2/v2.0/token',jwks_uri:base+'/discovery/v2.0/keys',id_token_signing_alg_values_supported:['RS256'],response_types_supported:['code'],subject_types_supported:['pairwise']},c.client_id,{id_token_signed_response_alg:'RS256'},oidc.ClientSecretPost(decrypt(r,c)));
  config.timeout=15;
  // Test transport is injected server-side only; browsers cannot choose endpoints.
  if(r.ssoFetch)config[oidc.customFetch]=(url,options)=>r.ssoFetch!(url,options as RequestInit);
  oidc.enableNonRepudiationChecks(config);
  return config;
}
export async function ssoStatus(r:Runtime,id:string,userId:string){const row=(await r.database.query('SELECT tenant_id,client_id,generation,enforced,scim_hash IS NOT NULL AS directory_configured FROM qa_sso_connections WHERE project_id=$1',[id])).rows[0];return {connection:row||null,redirectUri:redirectUri(r),projectId:id,linked:Boolean((await r.database.query('SELECT user_id FROM qa_sso_identities WHERE project_id=$1 AND user_id=$2 AND active=true AND generation=(SELECT generation FROM qa_sso_connections WHERE project_id=$1)',[id,userId])).rows.length),identities:(await r.database.query('SELECT i.user_id,u.email,i.active FROM qa_sso_identities i JOIN "user" u ON u.id=i.user_id WHERE i.project_id=$1',[id])).rows,scimUrl:r.config.origin+'/api/scim/'+id+'/v2'};}
export async function configureSso(r:Runtime,id:string,body:unknown,actor:string){
  const input=z.object({tenantId:uuid,clientId:uuid,clientSecret:z.string().min(8).max(2048)}).strict().safeParse(body);if(!input.success)throw new JobError(400,'Enter the Entra tenant ID, application client ID and client secret value.');
  const domain=await restrictedDomain(r.database.query.bind(r.database),id);if(!domain?.verified_at)throw new JobError(409,'Enable the verified company domain restriction before connecting Entra.');
  await r.database.query(`INSERT INTO qa_sso_connections(project_id,tenant_id,client_id,secret,generation) VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,client_id=EXCLUDED.client_id,secret=EXCLUDED.secret,generation=EXCLUDED.generation,enforced=false,scim_hash=NULL`,[id,input.data.tenantId.toLowerCase(),input.data.clientId.toLowerCase(),sealProvider(r,id,input.data.clientSecret,'entra'),randomUUID()]);
  await r.database.query('DELETE FROM qa_sso_identities WHERE project_id=$1',[id]);
  await audit(r.database.query.bind(r.database),id,actor,'sso.configured','Tenant-pinned Entra connection replaced; existing SSO sessions and directory tokens invalidated.');
}
export async function ssoAllows(r:Runtime,request:Request,id:string,userId:string){
  const c=(await r.database.query<{generation:string;enforced:boolean}>('SELECT generation,enforced FROM qa_sso_connections WHERE project_id=$1',[id])).rows[0];
  const blocked=(await r.database.query('SELECT user_id FROM qa_sso_identities WHERE project_id=$1 AND user_id=$2 AND active=false',[id,userId])).rows.length;
  const email=(await r.database.query<{email:string}>('SELECT email FROM "user" WHERE id=$1',[userId])).rows[0]?.email;
  if(blocked||(await r.database.query('SELECT id FROM qa_directory_users WHERE project_id=$1 AND email=lower($2) AND active=false',[id,email||''])).rows.length)return false;
  if(!c?.enforced)return true;
  const session=await r.auth.api.getSession({headers:request.headers});
  return Boolean(session&&(await r.database.query('SELECT session_id FROM qa_sso_sessions WHERE session_id=$1 AND project_id=$2 AND generation=$3',[session.session.id,id,c.generation])).rows.length);
}
export async function enforceSso(r:Runtime,id:string,request:Request,enabled:boolean,actor:string){
  const c=await connection(r,id),state=await securityState(request,r);
  if(enabled){
    if(!state.session||(await r.database.query('SELECT session_id FROM qa_sso_sessions WHERE session_id=$1 AND project_id=$2 AND generation=$3',[state.session.session.id,id,c.generation])).rows.length===0)throw new JobError(409,'Sign in through this Entra connection and complete MFA before requiring SSO.');
    const unlinked=await r.database.query(`SELECT u.id FROM "user" u WHERE u.id IN(SELECT owner_id FROM projects WHERE id=$1 UNION SELECT user_id FROM qa_members WHERE project_id=$1) AND NOT EXISTS(SELECT 1 FROM qa_sso_identities i WHERE i.project_id=$1 AND i.user_id=u.id AND i.active=true)`,[id]);
    if(unlinked.rows.length)throw new JobError(409,'All current members must link their Entra identity first. Remove incompatible members before requiring SSO.');
  }
  await r.database.query('UPDATE qa_sso_connections SET enforced=$2 WHERE project_id=$1',[id,enabled]);await audit(r.database.query.bind(r.database),id,actor,'sso.enforcement',enabled?'Entra sign-in required.':'Entra sign-in optional.');
}
export async function beginSso(r:Runtime,request:Request,body:unknown){
  const input=z.object({projectId:uuid,link:z.boolean().default(false)}).strict().safeParse(body);if(!input.success)throw new JobError(400,'Use the project sign-in ID supplied by its owner.');
  await rate(r,'sso-start:'+(request.headers.get('x-forwarded-for')||'anonymous'),10);
  const id=input.data.projectId,c=await connection(r,id),domain=await restrictedDomain(r.database.query.bind(r.database),id);if(!domain?.verified_at)throw new JobError(409,'The verified domain restriction must remain active for company sign-in.');
  const state=input.data.link?await securityState(request,r):null;
  if(input.data.link&&(!state?.session||state.step!=='complete'||!state.proof?.mfa_verified_at||Date.now()-Date.parse(state.proof.mfa_verified_at)>15*60000||!await domainAllowsUser(r.database.query.bind(r.database),id,state.session.user.id)||(await r.database.query('SELECT id FROM projects WHERE id=$1 AND(owner_id=$2 OR EXISTS(SELECT 1 FROM qa_members WHERE project_id=$1 AND user_id=$2))',[id,state.session.user.id])).rows.length===0))throw new JobError(403,'Sign in as a project member and verify MFA for account changes before linking Entra.');
  const config=configuration(r,c),verifier=oidc.randomPKCECodeVerifier(),nonce=oidc.randomNonce(),stateValue=oidc.randomState(),browser=randomBytes(32).toString('base64url');
  await r.database.query('DELETE FROM qa_sso_flows WHERE expires_at<=now()');
  await r.database.query("INSERT INTO qa_sso_flows(state_hash,project_id,browser_hash,generation,verifier,nonce,link_user,link_session,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '10 minutes')",[hash(stateValue),id,hash(browser),c.generation,verifier,nonce,state?.session?.user.id||null,state?.session?.session.id||null]);
  const url=oidc.buildAuthorizationUrl(config,{redirect_uri:redirectUri(r),scope:'openid profile email',state:stateValue,nonce,code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',prompt:'select_account'});
  return Response.json({url:url.href},{headers:{'cache-control':'no-store','set-cookie':`${cookieName(r)}=${browser}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${r.config.production?'; Secure':''}`}});
}
export async function finishSso(r:Runtime,request:Request){
  const url=new URL(request.url),value=url.searchParams.get('state')||'',browser=(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName(r)+'='))?.slice(cookieName(r).length+1)||'';
  if(!/^[A-Za-z0-9_-]{32,128}$/.test(value)||!/^[A-Za-z0-9_-]{43}$/.test(browser))throw new JobError(400,'The company sign-in expired. Start again in this browser.');
  const row=(await r.database.query<{project_id:string;generation:string;verifier:string;nonce:string;link_user:string|null;link_session:string|null}>('DELETE FROM qa_sso_flows WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() RETURNING *',[hash(value),hash(browser)])).rows[0];if(!row)throw new JobError(400,'This company sign-in was already used or expired.');
  const c=await connection(r,row.project_id);if(c.generation!==row.generation)throw new JobError(409,'The company sign-in configuration changed. Start again.');
  let claims;try{const tokens=await oidc.authorizationCodeGrant(configuration(r,c),url,{expectedState:value,expectedNonce:row.nonce,pkceCodeVerifier:row.verifier,idTokenExpected:true});claims=tokens.claims();}catch{throw new JobError(401,'Microsoft sign-in could not be verified. Check tenant, app credentials and callback configuration.');}
  if(!claims||claims.tid!==c.tenant_id||!uuid.safeParse(claims.oid).success||typeof claims.sub!=='string')throw new JobError(403,'The identity did not belong to the configured Entra tenant.');
  let userId:string;
  if(row.link_user){
    const state=await securityState(request,r);if(state.step!=='complete'||state.session?.session.id!==row.link_session||state.session.user.id!==row.link_user||!state.proof?.mfa_verified_at||Date.now()-Date.parse(state.proof.mfa_verified_at)>15*60000)throw new JobError(403,'Your verified linking session expired.');
    const email=state.session.user.email.toLowerCase(),domain=await restrictedDomain(r.database.query.bind(r.database),row.project_id);
    if(!domain?.verified_at||![claims.email,claims.preferred_username].some(v=>typeof v==='string'&&v.toLowerCase()===email&&matchesDomain(v,domain.domain)))throw new JobError(403,'Microsoft must return the same company email as your verified Patchsentry account. Ask your identity administrator to configure the email claim.');
    await r.database.query('INSERT INTO qa_sso_identities(project_id,user_id,tenant_id,object_id,subject,generation) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(project_id,user_id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,object_id=EXCLUDED.object_id,subject=EXCLUDED.subject,generation=EXCLUDED.generation,active=true',[row.project_id,row.link_user,c.tenant_id,claims.oid,claims.sub,c.generation]);
    userId=row.link_user;
    await audit(r.database.query.bind(r.database),row.project_id,state.session.user.name,'sso.identity_linked','Explicit account linking after local MFA and verified Microsoft authentication.');
    return new Response(null,{status:303,headers:{location:r.config.origin+'/app?tab=account','cache-control':'no-store','set-cookie':`${cookieName(r)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${r.config.production?'; Secure':''}`}});
  }else{
    const identity=(await r.database.query<{user_id:string}>('SELECT user_id FROM qa_sso_identities WHERE project_id=$1 AND tenant_id=$2 AND object_id=$3 AND subject=$4 AND generation=$5 AND active=true',[row.project_id,c.tenant_id,claims.oid,claims.sub,c.generation])).rows[0];if(!identity)throw new JobError(403,'Link this Microsoft identity from your verified Patchsentry account first.');userId=identity.user_id;
  }
  if(!await domainAllowsUser(r.database.query.bind(r.database),row.project_id,userId)||(await r.database.query('SELECT id FROM projects WHERE id=$1 AND(owner_id=$2 OR EXISTS(SELECT 1 FROM qa_members WHERE project_id=$1 AND user_id=$2))',[row.project_id,userId])).rows.length===0)throw new JobError(403,'Your project access is no longer active.');
  const ctx=await r.auth.$context,user=await ctx.internalAdapter.findUserById(userId);if(!user?.emailVerified)throw new JobError(403,'Verify your Patchsentry email first.');
  const session=await ctx.internalAdapter.createSession(userId);if(!session)throw new JobError(401,'Sign-in could not be completed.');
  await r.database.query('INSERT INTO qa_sso_sessions(session_id,project_id,generation) VALUES($1,$2,$3)',[session.id,row.project_id,c.generation]);
  await proof(r,{session,user},false); // Entra is factor one. Local MFA remains required at every SSO login.
  const response=new Response(null,{status:303,headers:{location:r.config.origin+'/auth/setup','cache-control':'no-store'}}),cookie=ctx.authCookies.sessionToken;
  response.headers.append('set-cookie',await serializeSignedCookie(cookie.name,session.token,ctx.secret,{...cookie.attributes,maxAge:7*86400}));
  response.headers.append('set-cookie',`${cookieName(r)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${r.config.production?'; Secure':''}`);
  return response;
}
