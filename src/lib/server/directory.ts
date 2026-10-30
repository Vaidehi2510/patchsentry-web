import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Runtime} from './runtime';
import type {Database} from './database';
import {JobError} from './jobs';
import {matchesDomain,restrictedDomain} from './domain-policy';
import {audit} from './team';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const schema='urn:ietf:params:scim:schemas:core:2.0:User';
type Row={id:string;project_id:string;external_id:string|null;email:string;active:boolean;created_at:string;updated_at:string};
function resource(r:Runtime,row:Row){return {schemas:[schema],id:row.id,...(row.external_id?{externalId:row.external_id}:{}),userName:row.email,emails:[{value:row.email,primary:true,type:'work'}],active:row.active,meta:{resourceType:'User',created:row.created_at,lastModified:row.updated_at,location:r.config.origin+'/api/scim/'+row.project_id+'/v2/Users/'+row.id}};}
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'content-type':'application/scim+json','cache-control':'no-store'}});
export async function rotateDirectoryToken(r:Runtime,id:string,actor:string){const token='psc_'+randomBytes(32).toString('base64url');const result=await r.database.query('UPDATE qa_sso_connections SET scim_hash=$2 WHERE project_id=$1 RETURNING project_id',[id,hash(token)]);if(!result.rows.length)throw new JobError(409,'Configure Entra first.');await audit(r.database.query.bind(r.database),id,actor,'directory.token_rotated','Project-scoped directory credential issued.');return {token};}
export async function syncDirectoryMembership(q:Database['query'],userId:string){
  await q(`INSERT INTO qa_members(project_id,user_id,role) SELECT d.project_id,u.id,'viewer' FROM qa_directory_users d JOIN "user" u ON lower(u.email)=d.email JOIN projects p ON p.id=d.project_id WHERE u.id=$1 AND u."emailVerified"=true AND d.active=true AND p.owner_id<>u.id ON CONFLICT(project_id,user_id) DO NOTHING`,[userId]);
}
async function revoke(q:Database['query'],projectId:string,email:string){
 await q('DELETE FROM qa_members WHERE project_id=$1 AND user_id IN(SELECT id FROM "user" WHERE lower(email)=$2)',[projectId,email]);
 await q('DELETE FROM qa_invites WHERE project_id=$1 AND lower(email)=$2',[projectId,email]);
 await q('UPDATE qa_sso_identities SET active=false WHERE project_id=$1 AND user_id IN(SELECT id FROM "user" WHERE lower(email)=$2)',[projectId,email]);
 await q('DELETE FROM "session" WHERE id IN(SELECT s.session_id FROM qa_sso_sessions s JOIN "session" a ON a.id=s.session_id JOIN "user" u ON u.id=a."userId" WHERE s.project_id=$1 AND lower(u.email)=$2)',[projectId,email]);
}
export async function scimEndpoint(r:Runtime,request:Request,id:string,path:string){
 try{
  const token=request.headers.get('authorization')?.match(/^Bearer (psc_[A-Za-z0-9_-]{43})$/)?.[1];
  if(!token||!(await r.database.query('SELECT project_id FROM qa_sso_connections WHERE project_id=$1 AND scim_hash=$2',[id,hash(token)])).rows.length)throw new JobError(401,'Invalid project directory credential.');
  const domain=await restrictedDomain(r.database.query.bind(r.database),id);if(!domain?.verified_at)throw new JobError(403,'Verified company-domain restrictions must remain enabled.');
  const url=new URL(request.url),method=request.method;
  if(path==='/ServiceProviderConfig'&&method==='GET')return json({schemas:['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],patch:{supported:true},bulk:{supported:false,maxOperations:0,maxPayloadSize:0},filter:{supported:true,maxResults:100},changePassword:{supported:false},sort:{supported:false},etag:{supported:false},authenticationSchemes:[{type:'oauthbearertoken',name:'Project bearer token',description:'Project-scoped directory token',primary:true}]});
  if(path==='/ResourceTypes'&&method==='GET')return json({schemas:['urn:ietf:params:scim:api:messages:2.0:ListResponse'],totalResults:1,startIndex:1,itemsPerPage:1,Resources:[{schemas:['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],id:'User',name:'User',endpoint:'/Users',schema,schemaExtensions:[]}]});
  const match=/^\/Users(?:\/([a-f0-9-]{36}))?$/.exec(path);if(!match)throw new JobError(404,'Only project User provisioning is supported. Group-to-admin mapping is intentionally unavailable.');
  const rowId=match[1],q=r.database.query.bind(r.database);
  if(method==='GET'){
   if(rowId){const row=(await q<Row>('SELECT * FROM qa_directory_users WHERE project_id=$1 AND id=$2',[id,rowId])).rows[0];if(!row)throw new JobError(404,'User not found.');return json(resource(r,row));}
   const filter=url.searchParams.get('filter');let column='id',value:string|null=null;
   if(filter){const f=/^(userName|externalId) eq "([^"\\\x00-\x1f]{1,254})"$/.exec(filter);if(!f)throw new JobError(400,'Supported filters: userName eq or externalId eq.');column=f[1]==='userName'?'email':'external_id';value=f[1]==='userName'?f[2].toLowerCase():f[2];}
   const start=z.coerce.number().int().min(1).safeParse(url.searchParams.get('startIndex')||1),count=z.coerce.number().int().min(0).max(100).safeParse(url.searchParams.get('count')||100);if(!start.success||!count.success)throw new JobError(400,'Use startIndex >= 1 and count between 0 and 100.');
   const where='project_id=$1'+(value!==null?` AND ${column}=$2`:''),values=value!==null?[id,value]:[id],total=(await q<{n:string}>(`SELECT count(*) AS n FROM qa_directory_users WHERE ${where}`,values)).rows[0].n;
   const rows=(await q<Row>(`SELECT * FROM qa_directory_users WHERE ${where} ORDER BY created_at,id LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,count.data,start.data-1])).rows;
   return json({schemas:['urn:ietf:params:scim:api:messages:2.0:ListResponse'],totalResults:Number(total),startIndex:start.data,itemsPerPage:rows.length,Resources:rows.map(row=>resource(r,row))});
  }
  let raw:any={};if(method!=='DELETE'){if(Number(request.headers.get('content-length')||0)>32000)throw new JobError(413,'Directory resource too large.');const chunks:Buffer[]=[];let size=0;const reader=request.body?.getReader();if(!reader)throw new JobError(400,'JSON body required.');for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>32000){await reader.cancel();throw new JobError(413,'Directory resource too large.');}chunks.push(Buffer.from(part.value));}try{raw=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new JobError(400,'Invalid JSON.');}}
  const c=await r.database.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[id]);
   const old=rowId?(await c.query<Row>('SELECT * FROM qa_directory_users WHERE project_id=$1 AND id=$2 FOR UPDATE',[id,rowId])).rows[0]:null;
   if(rowId&&!old)throw new JobError(404,'User not found.');
   if(method==='DELETE'){if(!old)throw new JobError(405,'Choose a User resource.');await revoke(c.query.bind(c),id,old.email);await c.query('UPDATE qa_directory_users SET active=false,updated_at=now() WHERE id=$1',[old.id]);await audit(c.query.bind(c),id,'Company directory','directory.deactivated',old.email);await c.query('COMMIT');return new Response(null,{status:204});}
   if(!['POST','PUT','PATCH'].includes(method)||method==='POST'&&rowId||method!=='POST'&&!old)throw new JobError(405,'Unsupported directory operation.');
   let proposed:any=method==='PATCH'?{userName:old!.email,externalId:old!.external_id,active:old!.active}:raw;
   if(method==='PATCH'){
    if(!Array.isArray(raw.Operations)||raw.Operations.length>10)throw new JobError(400,'Supply at most ten patch operations.');
    for(const op of raw.Operations){if(!['replace','add'].includes(String(op.op).toLowerCase()))throw new JobError(400,'Only add/replace patches are supported.');if(!op.path){if(!op.value||typeof op.value!=='object'||Object.keys(op.value).some(k=>!['active','userName','externalId'].includes(k)))throw new JobError(400,'Unsupported patch attribute.');proposed={...proposed,...op.value};}else if(['active','userName','externalId'].includes(op.path))proposed[op.path]=op.value;else throw new JobError(400,'Unsupported patch attribute. Map only userName, externalId and active for this project directory. Verified email changes use My account.');}
   }
   const input=z.object({userName:z.email().max(254).transform(v=>v.toLowerCase()),externalId:z.string().min(1).max(254).nullish(),active:z.boolean().default(true)}).safeParse(proposed);if(!input.success)throw new JobError(400,'A valid company userName email, externalId and boolean active are required.');
   if(!matchesDomain(input.data.userName,domain.domain))throw new JobError(403,'Directory users must match the verified project domain.');
   if(old?.external_id&&input.data.externalId!==old.external_id)throw new JobError(409,'A directory externalId is a stable person binding and cannot be replaced or cleared. Recycled addresses require explicit identity review; do not reactivate the old resource for a different person.');
   if(old&&!old.active&&input.data.active&&!old.external_id)throw new JobError(409,'An inactive directory identity without a stable externalId requires owner identity review before reactivation.');
   if(old&&old.email!==input.data.userName)throw new JobError(409,'Deactivate the old address and provision a new resource after the person verifies their new company email. Directory updates cannot change a verified Patchsentry account email.');
   const row=(await c.query<Row>('INSERT INTO qa_directory_users(id,project_id,external_id,email,active) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET external_id=EXCLUDED.external_id,active=EXCLUDED.active,updated_at=now() RETURNING *',[old?.id||randomUUID(),id,input.data.externalId||null,input.data.userName,input.data.active])).rows[0];
   if(!row.active)await revoke(c.query.bind(c),id,row.email);
   else{await c.query('UPDATE qa_sso_identities SET active=true WHERE project_id=$1 AND user_id IN(SELECT id FROM "user" WHERE lower(email)=$2)',[id,row.email]);const users=(await c.query<{id:string}>('SELECT id FROM "user" WHERE lower(email)=$1 AND "emailVerified"=true',[row.email])).rows;for(const u of users)await syncDirectoryMembership(c.query.bind(c),u.id);}
   await audit(c.query.bind(c),id,'Company directory',row.active?'directory.provisioned':'directory.deactivated',row.email);await c.query('COMMIT');return json(resource(r,row),old?200:201);
  }catch(e){await c.query('ROLLBACK');if((e as {code?:string}).code==='23505')throw new JobError(409,'This project already has that directory identity.');throw e;}finally{c.release();}
 }catch(e){const status=e instanceof JobError?e.status:500;return json({schemas:['urn:ietf:params:scim:api:messages:2.0:Error'],status:String(status),detail:e instanceof JobError?e.message:'Directory operation failed.'},status);}
}
