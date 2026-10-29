import {createHmac} from 'node:crypto';
import assert from 'node:assert/strict';
import type {Runtime} from '../src/lib/server/runtime';
import {handleRequest} from '../src/lib/server/api';
export function cookieJar(cookie:string,response:Response){const jar=new Map(cookie.split(';').filter(Boolean).map(v=>{const [k,...rest]=v.trim().split('=');return [k,rest.join('=')];}));for(const value of response.headers.getSetCookie()){const [first]=value.split(';'),[key,...rest]=first.split('='),v=rest.join('=');if(v)jar.set(key,v);else jar.delete(key);}return [...jar].map(([k,v])=>`${k}=${v}`).join('; ');}
export function totp(uri:string,time=Date.now()){const value=new URL(uri).searchParams.get('secret')!,alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const c of value.toUpperCase().replace(/=+$/,''))bits+=alphabet.indexOf(c).toString(2).padStart(5,'0');const key=Buffer.from(bits.match(/.{8}/g)!.map(v=>parseInt(v,2)));const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(time/30000)));const digest=createHmac('sha1',key).update(counter).digest(),offset=digest.at(-1)!&15;return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');}
let address=30;
const recovery=new WeakMap<Runtime,Map<string,string[]>>();
export async function secureSession(runtime:Runtime,cookie:string,password='Fixture passphrase 2026!'){
 const ip=`192.0.2.${address++}`;
 const post=async(path:string,body:unknown)=>{const r=await handleRequest(new Request(runtime.config.origin+path,{method:'POST',headers:{origin:runtime.config.origin,'content-type':'application/json',cookie,'x-forwarded-for':ip},body:JSON.stringify(body)}),runtime);cookie=cookieJar(cookie,r);return r;};
 const set=await post('/api/security/password',{password,confirmPassword:password});assert.equal(set.status,200,await set.text());
 const setup=await post('/api/security/enroll',{method:'totp',password});const enrolled=await setup.json();assert.equal(setup.status,200,JSON.stringify(enrolled));
 const verified=await post('/api/security/verify',{code:totp(enrolled.totpURI)});assert.equal(verified.status,200,await verified.text());
 const user=await runtime.auth.api.getSession({headers:new Headers({cookie})});const records=recovery.get(runtime)||new Map();records.set(user!.user.email,enrolled.backupCodes);recovery.set(runtime,records);return cookie;
}
export async function loginSession(runtime:Runtime,email:string,cookie='',password='Fixture passphrase 2026!'){
 const ip=`192.0.2.${address++}`;const post=async(path:string,body:unknown)=>{const r=await handleRequest(new Request(runtime.config.origin+path,{method:'POST',headers:{origin:runtime.config.origin,'content-type':'application/json',cookie,'x-forwarded-for':ip},body:JSON.stringify(body)}),runtime);cookie=cookieJar(cookie,r);return r;};
 const signin=await post('/api/auth/sign-in/email',{email,password});assert.equal(signin.status,200,await signin.text());const code=recovery.get(runtime)?.get(email)?.shift();assert.ok(code,'Fixture recovery code must have been enrolled');const verified=await post('/api/security/verify',{code,recovery:true});assert.equal(verified.status,200,await verified.text());return cookie;
}
