import test from 'node:test';
import assert from 'node:assert/strict';
import {createPGliteDatabase} from '../src/lib/server/database';
import {createAuth,migrateDatabase,authOptions,type AuthConfig} from '../src/lib/server/auth';
import {handleRequest} from '../src/lib/server/api';
import {cookieJar,totp,secureSession} from './auth-session';
const password='Correct horse galaxy battery 2026!';
async function fixture(t:any){const database=await createPGliteDatabase();t.after(()=>database.end());const links:any[]=[],codes:any[]=[];let failDelivery=false;const config:AuthConfig={origin:'https://auth.example',secret:'mfa-fixture-only-secret-at-least-32-characters',production:false,sendSignInLink:async m=>{links.push(m);},sendSecurityCode:async m=>{if(failDelivery)throw new Error('Private provider failure');codes.push(m);}};await migrateDatabase(database,config);const runtime={database,config,auth:createAuth(database,config)};let cookie='';
 const call=async(path:string,body?:unknown,customCookie?:string)=>{const r=await handleRequest(new Request(config.origin+path,{method:body===undefined?'GET':'POST',headers:{origin:config.origin,'content-type':'application/json',cookie:customCookie??cookie,'x-forwarded-for':'192.0.2.100'},...(body===undefined?{}:{body:JSON.stringify(body)})}),runtime);if(customCookie===undefined)cookie=cookieJar(cookie,r);return r;};
 const signup=async()=>{assert.equal((await call('/api/auth/sign-in/magic-link',{email:'builder@example.test',name:'Builder'})).status,200);assert.equal((await database.query('SELECT id FROM "user"')).rows.length,0);const u=new URL(links.at(-1).url);const r=await call(u.pathname+u.search);assert.equal(r.status,302);assert.equal(new URL(r.headers.get('location')!).pathname,'/auth/setup');};
 return {runtime,database,links,codes,call,signup,getCookie:()=>cookie,clear:()=>{cookie='';},fail:()=>{failDelivery=true;}};
}
test('signup requires verified email, a password and a verified authenticator before any project access; every login requires the second factor',async t=>{
 const f=await fixture(t);await f.signup();assert.equal((await(await f.call('/api/security/status')).json()).step,'password');assert.equal((await f.call('/api/projects')).status,401);
 assert.equal((await f.call('/api/security/enroll',{method:'totp',password})).status,403);assert.equal((await f.call('/api/security/password',{password:'short',confirmPassword:'short'})).status,400);
 assert.equal((await f.call('/api/security/password',{password,confirmPassword:password})).status,200);assert.equal((await f.call('/api/projects')).status,401);
 const setup=await f.call('/api/security/enroll',{method:'totp',password});const data=await setup.json();assert.equal(setup.status,200,JSON.stringify(data));assert.match(data.qrCode,/^data:image\/png;base64,/);assert.equal(data.backupCodes.length,10);
 const before=f.getCookie();assert.equal((await f.call('/api/security/verify',{code:'000000'})).status,401);assert.equal((await f.call('/api/projects')).status,401);
 const enrollmentCode=totp(data.totpURI);assert.equal((await f.call('/api/security/verify',{code:enrollmentCode})).status,200);assert.equal((await f.call('/api/projects')).status,200);assert.equal((await f.call('/api/projects',undefined,before)).status,401);
 assert.equal((await f.call('/api/auth/two-factor/disable',{password})).status,404);assert.equal((await f.call('/api/auth/sign-up/email',{email:'bypass@example.test',password,name:'Bypass'})).status,404);
 await f.call('/api/auth/sign-out',{});f.clear();assert.equal((await f.call('/api/auth/sign-in/email',{email:'builder@example.test',password:'WrongPassword'})).status,401);
 assert.equal((await f.call('/api/auth/sign-in/email',{email:'builder@example.test',password})).status,200);assert.equal((await f.call('/api/projects')).status,401);assert.equal((await(await f.call('/api/security/status')).json()).step,'verify');
 assert.equal((await f.call('/api/security/verify',{code:enrollmentCode})).status,401,'Authenticator codes are not reusable across logins');
 assert.equal((await f.call('/api/security/verify',{code:enrollmentCode,trustDevice:true})).status,400,'A client cannot bypass the next login challenge');
 // Recovery codes are single-use and cannot skip password authentication.
 assert.equal((await f.call('/api/security/verify',{code:data.backupCodes[0],recovery:true})).status,200);assert.equal((await f.call('/api/projects')).status,200);
 await f.call('/api/auth/sign-out',{});f.clear();assert.equal((await f.call('/api/security/verify',{code:data.backupCodes[1],recovery:true})).status,401);
 assert.equal((await f.call('/api/auth/sign-in/email',{email:'builder@example.test',password})).status,200);
 const replay=await f.call('/api/security/verify',{code:data.backupCodes[0],recovery:true});assert.equal(replay.ok,false);assert.equal((await f.call('/api/projects')).status,401);
});

test('password recovery revokes sessions, retains MFA and consumes its reset token once',async t=>{
 const f=await fixture(t);await f.signup();await f.call('/api/security/password',{password,confirmPassword:password});await f.call('/api/security/enroll',{method:'email',password});await f.call('/api/security/verify',{code:f.codes.at(-1).code});assert.equal((await f.call('/api/projects')).status,200);
 assert.equal((await f.call('/api/auth/request-password-reset',{email:'builder@example.test'})).status,200);const link=new URL(f.links.at(-1).url);const redirected=await f.call(link.pathname+link.search);assert.equal(redirected.status,302);const token=new URL(redirected.headers.get('location')!).searchParams.get('token');const replacement=password+' renewed';
 assert.equal((await f.call('/api/auth/reset-password',{token,newPassword:replacement})).status,200);assert.equal((await f.call('/api/projects')).status,401);assert.equal((await f.call('/api/auth/reset-password',{token,newPassword:replacement})).ok,false);
 f.clear();assert.equal((await f.call('/api/auth/sign-in/email',{email:'builder@example.test',password})).status,401);assert.equal((await f.call('/api/auth/sign-in/email',{email:'builder@example.test',password:replacement})).status,200);assert.equal((await f.call('/api/projects')).status,401);assert.equal((await f.call('/api/security/send-code',{})).status,200);assert.equal((await f.call('/api/security/verify',{code:f.codes.at(-1).code})).status,200);assert.equal(f.links.length,2,'Normal login sends no new email-verification link');
});

test('even a native magic-link session issued before migration cannot bypass password and MFA assurance',async t=>{
 const f=await fixture(t);await f.signup();await f.call('/api/security/password',{password,confirmPassword:password});await f.call('/api/security/enroll',{method:'email',password});await f.call('/api/security/verify',{code:f.codes.at(-1).code});
 await f.runtime.auth.handler(new Request(f.runtime.config.origin+'/api/auth/sign-in/magic-link',{method:'POST',headers:{origin:f.runtime.config.origin,'content-type':'application/json'},body:JSON.stringify({email:'builder@example.test',callbackURL:'/auth/setup'})}));f.clear();const u=new URL(f.links.at(-1).url);assert.equal((await f.call(u.pathname+u.search)).status,302);assert.equal((await f.call('/api/projects')).status,401);assert.equal((await(await f.call('/api/security/status')).json()).step,'login');assert.equal((await f.call('/api/security/enroll',{method:'email',password})).status,403);
});
test('email factor verifies a delivered code, hashes stored codes, blocks reuse and requires password plus a fresh code on login',async t=>{
 const f=await fixture(t);await f.signup();await f.call('/api/security/password',{password,confirmPassword:password});
 assert.equal((await f.call('/api/security/enroll',{method:'email',password})).status,200);const first=f.codes.at(-1).code;assert.equal((await f.call('/api/projects')).status,401);
 const stored=(await f.database.query('SELECT value FROM verification WHERE identifier LIKE \'2fa-otp-%\'')).rows;assert.ok(stored.length);assert.ok(!JSON.stringify(stored).includes(first));
 assert.equal((await f.call('/api/security/verify',{code:first})).status,200);assert.equal((await f.call('/api/projects')).status,200);
 await f.call('/api/auth/sign-out',{});f.clear();await f.call('/api/auth/sign-in/email',{email:'builder@example.test',password});assert.equal((await f.call('/api/projects')).status,401);
 assert.equal((await f.call('/api/security/send-code',{})).status,200);assert.equal((await f.call('/api/security/verify',{code:first})).ok,false);assert.equal((await f.call('/api/projects')).status,401);
 assert.equal((await f.call('/api/security/verify',{code:f.codes.at(-1).code})).status,200);assert.equal((await f.call('/api/projects')).status,200);
 const n=f.links.length;await f.call('/api/auth/sign-in/magic-link',{email:'builder@example.test'});assert.equal(f.links.length,n,'Enrolled accounts do not receive a passwordless bypass link');
});
test('failed code delivery reports failure and incomplete/old sessions cannot access the dashboard',async t=>{
 const f=await fixture(t);await f.signup();const old=f.getCookie();await f.call('/api/security/password',{password,confirmPassword:password});f.fail();const r=await f.call('/api/security/enroll',{method:'email',password});assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/Private provider/);assert.equal((await f.call('/api/projects')).status,401);
 await f.database.query('DELETE FROM qa_auth_proofs');assert.equal((await f.call('/api/projects',undefined,old)).status,401);assert.equal((await(await f.call('/api/session')).json()).user,null);
});

test('expired email codes, expired login challenges and cancelled verification cannot authenticate',async t=>{
 const f=await fixture(t);await f.signup();await f.call('/api/security/password',{password,confirmPassword:password});await f.call('/api/security/enroll',{method:'email',password});
 await f.database.query('UPDATE verification SET "expiresAt"=now()-interval \'1 second\' WHERE identifier LIKE \'2fa-otp-%\'');assert.equal((await f.call('/api/security/verify',{code:f.codes.at(-1).code})).ok,false);assert.equal((await f.call('/api/projects')).status,401);
 await f.call('/api/security/send-code',{});assert.equal((await f.call('/api/security/verify',{code:f.codes.at(-1).code})).status,200);await f.call('/api/auth/sign-out',{});f.clear();await f.call('/api/auth/sign-in/email',{email:'builder@example.test',password});
 await f.database.query("UPDATE qa_auth_challenges SET expires_at=now()-interval '1 second'");assert.equal((await(await f.call('/api/security/status')).json()).step,'login');assert.equal((await f.call('/api/security/verify',{code:'123456'})).status,401);
 await f.call('/api/auth/sign-in/email',{email:'builder@example.test',password});assert.equal((await(await f.call('/api/security/status')).json()).step,'verify');await f.call('/api/auth/sign-out',{});assert.equal((await(await f.call('/api/security/status')).json()).step,'login');assert.equal((await f.call('/api/security/verify',{code:'123456'})).status,401);
});

test('migration preserves legacy verified accounts and projects while blocking old passwordless access until password and MFA setup',async t=>{
 const {betterAuth}=await import('better-auth'),{getMigrations}=await import('better-auth/db/migration');const database=await createPGliteDatabase();t.after(()=>database.end());let link='';const config:AuthConfig={origin:'https://legacy.example',secret:'legacy-migration-fixture-secret-at-least-32-characters',production:false,sendSignInLink:async m=>{link=m.url;}};
 const options=authOptions(database,config);options.plugins=options.plugins!.filter(p=>p.id!=='two-factor');options.emailAndPassword={enabled:false};await(await getMigrations(options)).runMigrations();const legacy=betterAuth(options);
 await legacy.handler(new Request(config.origin+'/api/auth/sign-in/magic-link',{method:'POST',headers:{origin:config.origin,'content-type':'application/json'},body:JSON.stringify({email:'legacy@example.test',name:'Existing owner',callbackURL:'/app'})}));const response=await legacy.handler(new Request(link));const cookie=cookieJar('',response);const user=(await database.query<{id:string}>('SELECT id FROM "user"')).rows[0];
 await database.query(`CREATE TABLE projects(id text PRIMARY KEY,owner_id text NOT NULL REFERENCES "user"(id),name text NOT NULL,repository text NOT NULL,settings jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),agent_token_hash text,agent_last_seen timestamptz,local_models jsonb NOT NULL DEFAULT '[]'::jsonb)`);
 const {settingsDefaults}=await import('../src/lib/contracts');await database.query('INSERT INTO projects(id,owner_id,name,repository,settings) VALUES ($1,$2,$3,$4,$5::jsonb)',['12345678-1234-4234-8234-123456789abc',user.id,'Existing product','owner/existing',JSON.stringify(settingsDefaults)]);
 await migrateDatabase(database,config);const runtime={database,config,auth:createAuth(database,config)};const get=(c:string)=>handleRequest(new Request(config.origin+'/api/projects',{headers:{cookie:c}}),runtime);assert.equal((await get(cookie)).status,401);const current=await secureSession(runtime,cookie);const projects=(await(await get(current)).json()).projects;assert.equal(projects.length,1);assert.equal(projects[0].name,'Existing product');assert.equal(projects[0].id,'12345678-1234-4234-8234-123456789abc');assert.equal((await database.query('SELECT id FROM "user"')).rows.length,1);
});
