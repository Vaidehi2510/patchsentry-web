import {createHash,randomBytes} from 'node:crypto';
import QRCode from 'qrcode';
import {z} from 'zod';
import type {Runtime} from './runtime';
import {factorDelivery} from './factor-delivery';
export class SecurityError extends Error{constructor(public status:number,message:string){super(message);}}
type Session={session:{id:string;createdAt:Date|string};user:{id:string;name:string;email:string;emailVerified:boolean;twoFactorEnabled?:boolean}};
type Profile={method:'totp'|'email'|null;pending_method:'totp'|'email'|null};
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const cookieName=(runtime:Runtime)=>runtime.config.production?'__Host-ps-mfa':'ps-mfa';
const nonce=(request:Request,runtime:Runtime)=>request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName(runtime)+'='))?.slice(cookieName(runtime).length+1);
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
function challengeCookie(runtime:Runtime,value:string,remove=false){return `${cookieName(runtime)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${remove?0:600}${runtime.config.production?'; Secure':''}`;}
export function mergedHeaders(request:Request,response:Response){const headers=new Headers(request.headers),pairs=new Map((headers.get('cookie')||'').split(';').map(p=>p.trim()).filter(Boolean).map(p=>{const at=p.indexOf('=');return [p.slice(0,at),p.slice(at+1)];}));for(const cookie of response.headers.getSetCookie()){const [part]=cookie.split(';'),at=part.indexOf('='),key=part.slice(0,at),value=part.slice(at+1);if(value)pairs.set(key,value);else pairs.delete(key);}headers.set('cookie',[...pairs].map(([k,v])=>`${k}=${v}`).join('; '));return headers;}
export async function credentialExists(runtime:Runtime,id:string){return Boolean((await runtime.database.query('SELECT id FROM "account" WHERE "userId"=$1 AND "providerId"=\'credential\' AND password IS NOT NULL',[id])).rows.length);}
async function profileFor(runtime:Runtime,id:string):Promise<Profile>{return (await runtime.database.query<Profile>('SELECT method,pending_method FROM qa_auth_profiles WHERE user_id=$1',[id])).rows[0] || {method:null,pending_method:null};}
export async function securityState(request:Request,runtime:Runtime){
 const session=await runtime.auth.api.getSession({headers:request.headers}) as Session|null;
 if(session?.user.emailVerified){
   const hasPassword=await credentialExists(runtime,session.user.id),profile=await profileFor(runtime,session.user.id),proof=(await runtime.database.query<{password_verified:boolean;mfa_verified:boolean}>('SELECT password_verified,mfa_verified FROM qa_auth_proofs WHERE session_id=$1',[session.session.id])).rows[0];
   const step=!hasPassword?'password':!proof?.password_verified?'login':!profile.method||!session.user.twoFactorEnabled?'enroll':!proof.mfa_verified?'verify':'complete';
   return {step,session,profile,userId:session.user.id,hasPassword};
 }
 const value=nonce(request,runtime);
 if(value && /^[A-Za-z0-9_-]{43}$/.test(value)){
   const row=(await runtime.database.query<{user_id:string}>('SELECT user_id FROM qa_auth_challenges WHERE id=$1 AND expires_at>now()',[hash(value)])).rows[0];
   if(row){const profile=await profileFor(runtime,row.user_id);if(profile.method)return {step:'verify',session:null,profile,userId:row.user_id,hasPassword:true};}
 }
 return {step:'login',session:null,profile:{method:null,pending_method:null} as Profile,userId:null,hasPassword:false};
}
async function rate(runtime:Runtime,key:string,maximum:number,seconds=60){const r=await runtime.database.query('INSERT INTO qa_security_limits (id,attempts,expires_at) VALUES ($1,1,now()+$3*interval \'1 second\') ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN qa_security_limits.expires_at<=now() THEN 1 ELSE qa_security_limits.attempts+1 END,expires_at=CASE WHEN qa_security_limits.expires_at<=now() THEN EXCLUDED.expires_at ELSE qa_security_limits.expires_at END WHERE qa_security_limits.expires_at<=now() OR qa_security_limits.attempts<$2 RETURNING id',[hash(key),maximum,seconds]);if(!r.rows.length)throw new SecurityError(429,'Too many attempts. Wait a minute before trying again.');}
export async function setupRequestLimit(request:Request,runtime:Runtime){await rate(runtime,'setup-email:'+(request.headers.get('x-forwarded-for')?.split(',')[0].trim()||request.headers.get('x-real-ip')||'anonymous'),3);}
export async function authCall(request:Request,runtime:Runtime,path:string,body?:unknown){const headers=new Headers(request.headers);headers.delete('content-length');headers.set('content-type','application/json');return runtime.auth.handler(new Request(runtime.config.origin+'/api/auth'+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})}));}
export async function securitySignOut(request:Request,runtime:Runtime){const value=nonce(request,runtime);if(value)await runtime.database.query('DELETE FROM qa_auth_challenges WHERE id=$1',[hash(value)]);const response=await authCall(request,runtime,'/sign-out',{});response.headers.append('set-cookie',challengeCookie(runtime,'',true));return response;}
export async function resetWithMfa(request:Request,runtime:Runtime,input:{token:string;newPassword:string}){const prior=(await runtime.database.query<{value:string}>('SELECT value FROM verification WHERE identifier=$1 AND "expiresAt">now()',['reset-password:'+input.token])).rows[0];const response=await authCall(request,runtime,'/reset-password',input);if(response.ok && prior){await runtime.database.query('DELETE FROM qa_auth_challenges WHERE user_id=$1',[prior.value]);await runtime.database.query('DELETE FROM verification WHERE value=$1 AND identifier LIKE \'2fa-%\'',[prior.value]);response.headers.append('set-cookie',challengeCookie(runtime,'',true));}return response;}
async function proof(runtime:Runtime,session:Session,mfa=false){await runtime.database.query('INSERT INTO qa_auth_proofs (session_id,password_verified,mfa_verified) VALUES ($1,true,$2) ON CONFLICT(session_id) DO UPDATE SET password_verified=true,mfa_verified=EXCLUDED.mfa_verified',[session.session.id,mfa]);}
async function responseSession(request:Request,runtime:Runtime,response:Response){return runtime.auth.api.getSession({headers:mergedHeaders(request,response)}) as Promise<Session|null>;}
const password=z.string().min(12,'Use at least 12 characters.').max(128,'Use no more than 128 characters.');
function parse<T>(schema:z.ZodType<T>,body:unknown):T{const result=schema.safeParse(body);if(!result.success)throw new SecurityError(400,result.error.issues[0]?.message||'Check the submitted fields.');return result.data;}
export async function passwordSignIn(request:Request,runtime:Runtime,body:unknown){
 const input=parse(z.object({email:z.email().max(254).transform(v=>v.toLowerCase()),password:z.string().min(1).max(128)}).strict(),body);await rate(runtime,'login-ip:'+(request.headers.get('x-forwarded-for')?.split(',')[0].trim()||request.headers.get('x-real-ip')||'anonymous'),5);await rate(runtime,'login:'+input.email,10);
 const response=await authCall(request,runtime,'/sign-in/email',input);if(!response.ok)return response;
 const data=await response.clone().json();
 if(data.twoFactorRedirect){const user=(await runtime.database.query<{id:string;emailVerified:boolean}>('SELECT id,"emailVerified" FROM "user" WHERE lower(email)=$1',[input.email])).rows[0];if(!user?.emailVerified)throw new SecurityError(401,'Verify your email before continuing.');
   const value=randomBytes(32).toString('base64url');await runtime.database.query("INSERT INTO qa_auth_challenges (id,user_id,expires_at) VALUES ($1,$2,now()+interval '10 minutes')",[hash(value),user.id]);
   const out=json({next:'/auth/setup',twoFactorRequired:true});for(const c of response.headers.getSetCookie())out.headers.append('set-cookie',c);out.headers.append('set-cookie',challengeCookie(runtime,value));return out;
 }
 const session=await responseSession(request,runtime,response);if(!session?.user.emailVerified)throw new SecurityError(401,'Sign-in could not be completed.');await proof(runtime,session);
 const out=json({next:'/auth/setup',twoFactorRequired:true});for(const c of response.headers.getSetCookie())out.headers.append('set-cookie',c);return out;
}
export async function securityEndpoint(request:Request,runtime:Runtime,body?:unknown){
 const path=new URL(request.url).pathname,state=await securityState(request,runtime);
 if(path==='/api/security/status' && request.method==='GET')return json({step:state.step,next:state.step==='complete'?'/app':state.step==='login'?'/login':'/auth/setup',method:state.profile.method || state.profile.pending_method,email:state.session?.user.email,name:state.session?.user.name,emailCodesReady:Boolean(runtime.config.sendSecurityCode),authenticatorReady:true});
 if(request.method!=='POST')throw new SecurityError(405,'Method not allowed.');
 if(!state.userId)throw new SecurityError(401,'Start again with your email and password.');
 await rate(runtime,'security:'+state.userId,20);
 if(path==='/api/security/password'){
   if(state.step!=='password'||!state.session)throw new SecurityError(409,'A password is already set. Sign in or request a password reset.');
   const input=parse(z.object({password,confirmPassword:z.string()}).strict().refine(v=>v.password===v.confirmPassword,'Passwords must match.'),body);
   await runtime.auth.api.setPassword({headers:request.headers,body:{newPassword:input.password}});await proof(runtime,state.session);return json({next:'enroll'});
 }
 if(path==='/api/security/enroll'){
   if(state.step!=='enroll'||!state.session)throw new SecurityError(403,'Complete password setup before enrolling your second factor.');
   const input=parse(z.object({method:z.enum(['totp','email']),password:z.string().min(1).max(128)}).strict(),body);
   if(input.method==='email'&&!runtime.config.sendSecurityCode)throw new SecurityError(503,'Email codes are unavailable. Choose an authenticator app.');
   const verified=await authCall(request,runtime,'/verify-password',{password:input.password});if(!verified.ok)throw new SecurityError(400,'Password confirmation failed.');
   await runtime.database.query('INSERT INTO qa_auth_profiles (user_id,pending_method) VALUES ($1,$2) ON CONFLICT(user_id) DO UPDATE SET pending_method=EXCLUDED.pending_method WHERE qa_auth_profiles.method IS NULL',[state.userId,input.method]);
   if(input.method==='email')return sendCode(request,runtime,state.userId);
   const response=await authCall(request,runtime,'/two-factor/enable',{password:input.password,method:'totp'});if(!response.ok)return response;
   const data=await response.json();const out=json({method:'totp',totpURI:data.totpURI,qrCode:await QRCode.toDataURL(data.totpURI,{width:240,margin:2}),backupCodes:data.backupCodes});for(const c of response.headers.getSetCookie())out.headers.append('set-cookie',c);return out;
 }
 if(path==='/api/security/send-code'){
   if(!['verify','enroll'].includes(state.step)||(state.profile.method||state.profile.pending_method)!=='email')throw new SecurityError(403,'Email codes are not the selected factor.');return sendCode(request,runtime,state.userId);
 }
 if(path==='/api/security/verify'){
   if(!['verify','enroll'].includes(state.step))throw new SecurityError(403,'There is no pending second-factor challenge.');
   const input=parse(z.object({code:z.string().min(6).max(32),recovery:z.boolean().optional()}).strict(),body),method=state.profile.method||state.profile.pending_method;
   if(!method || input.recovery && (method!=='totp'||state.step==='enroll'))throw new SecurityError(403,'Choose and verify your configured factor.');
   if(!input.recovery&&!/^\d{6}$/.test(input.code))throw new SecurityError(400,'Enter the six-digit code.');
   const endpoint=input.recovery?'/two-factor/verify-backup-code':method==='totp'?'/two-factor/verify-totp':'/two-factor/verify-otp';
   if(method==='totp'&&!input.recovery&&(await runtime.database.query('SELECT code_hash FROM qa_totp_used WHERE user_id=$1 AND code_hash=$2 AND expires_at>now()',[state.userId,hash(input.code)])).rows.length)throw new SecurityError(401,'This authenticator code has already been used. Wait for the next code.');
   const response=await authCall(request,runtime,endpoint,{code:input.code,trustDevice:false});if(!response.ok)return response;
   const session=await responseSession(request,runtime,response);if(!session||session.user.id!==state.userId||!session.user.emailVerified||!session.user.twoFactorEnabled)throw new SecurityError(401,'The second-factor session could not be confirmed. Start again.');
   if(method==='totp'&&!input.recovery){const claimed=await runtime.database.query("INSERT INTO qa_totp_used (user_id,code_hash,expires_at) VALUES ($1,$2,now()+interval '90 seconds') ON CONFLICT(user_id,code_hash) DO UPDATE SET expires_at=EXCLUDED.expires_at WHERE qa_totp_used.expires_at<=now() RETURNING user_id",[state.userId,hash(input.code)]);if(!claimed.rows.length){await runtime.database.query('DELETE FROM \"session\" WHERE id=$1',[session.session.id]);throw new SecurityError(401,'This authenticator code has already been used.');}}
   const selected=await runtime.database.query('UPDATE qa_auth_profiles SET method=COALESCE(method,$2),pending_method=NULL WHERE user_id=$1 AND (method IS NULL OR method=$2) RETURNING user_id',[state.userId,method]);if(!selected.rows.length){await runtime.database.query('DELETE FROM \"session\" WHERE id=$1',[session.session.id]);throw new SecurityError(409,'Your factor changed in another session. Sign in again.');}await proof(runtime,session,true);
   const value=nonce(request,runtime);if(value)await runtime.database.query('DELETE FROM qa_auth_challenges WHERE id=$1',[hash(value)]);
   const out=json({next:'/app'});for(const c of response.headers.getSetCookie())out.headers.append('set-cookie',c);out.headers.append('set-cookie',challengeCookie(runtime,'',true));return out;
 }
 throw new SecurityError(404,'Security endpoint not found.');
}
async function sendCode(request:Request,runtime:Runtime,userId:string){await rate(runtime,'factor-delivery:'+userId,3);return factorDelivery.run({failed:false},async()=>{const response=await authCall(request,runtime,'/two-factor/send-otp',{});if(factorDelivery.getStore()?.failed)throw new SecurityError(503,'We could not deliver your code. Try again shortly.');if(!response.ok)return response;return json({method:'email',sent:true});});}
