import {z} from 'zod';
import type {Runtime} from './runtime';
import {JobError} from './jobs';
import {rate} from './session-security';
import {audit} from './team';
import {sealProvider} from './provider-vault';

export async function repositoryConnection(runtime:Runtime,id:string){
  const r=(await runtime.database.query('SELECT suffix,version,verified_at FROM qa_provider_credentials WHERE project_id=$1 AND provider=\'github\'',[id])).rows[0];return {configured:Boolean(r),credential:r||null};
}
export async function connectRepository(runtime:Runtime,id:string,repository:string,body:unknown,actor:string){
  const parsed=z.object({token:z.string().min(20).max(256).regex(/^[!-~]+$/),consent:z.literal(true)}).strict().safeParse(body);
  if(!parsed.success)throw new JobError(400,'Provide a repository-scoped GitHub token and authorize read-only source inspection.');
  const input=parsed.data;
  await rate(runtime,'hosted-github-connect:'+id,5);
  let valid=false;
  async function read(url:string){
    const response=await(runtime.repositoryFetch||fetch)(url,{headers:{Authorization:'Bearer '+input.token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok){await response.body?.cancel();throw Error('Read access unavailable');}
    const reader=response.body?.getReader(),parts:Buffer[]=[];let n=0;if(!reader)throw Error();
    try{for(;;){const part=await reader.read();if(part.done)break;n+=part.value.length;if(n>64000){await reader.cancel();throw Error();}parts.push(Buffer.from(part.value));}}finally{reader.releaseLock();}
    return JSON.parse(Buffer.concat(parts).toString());
  }
  try{
    const repo=await read('https://api.github.com/repos/'+repository);
    if(typeof repo.full_name==='string'&&repo.full_name.toLowerCase()===repository.toLowerCase()&&typeof repo.private==='boolean'&&repo.permissions?.pull===true&&typeof repo.default_branch==='string'&&repo.default_branch.length<=240){
      // Metadata alone does not prove this token has Contents: read permission.
      const ref=await read('https://api.github.com/repos/'+repository+'/git/ref/heads/'+encodeURIComponent(repo.default_branch));
      valid=ref.ref==='refs/heads/'+repo.default_branch&&ref.object?.type==='commit'&&/^[a-f0-9]{40}$/.test(ref.object.sha||'');
    }
  }catch{/* Never expose credential-bearing provider errors. */}
  if(!valid)throw new JobError(400,'GitHub could not verify read access to this repository. Use a fine-grained token for this exact repository with Contents: read-only and Metadata: read-only.');
  await runtime.database.query('INSERT INTO qa_provider_credentials (project_id,provider,encrypted,suffix,version) VALUES ($1,\'github\',$2,$3,nextval(\'qa_provider_generation\')) ON CONFLICT(project_id,provider) DO UPDATE SET encrypted=EXCLUDED.encrypted,suffix=EXCLUDED.suffix,version=nextval(\'qa_provider_generation\'),verified_at=now()',[id,sealProvider(runtime,id,input.token,'github'),input.token.slice(-4)]);
  await audit(runtime.database.query.bind(runtime.database),id,actor,'repository.connection_verified','Hosted read access verified for '+repository+'. No source-write endpoint is used.');return repositoryConnection(runtime,id);
}
export async function disconnectRepository(runtime:Runtime,id:string,actor:string){await runtime.database.query("DELETE FROM qa_provider_credentials WHERE project_id=$1 AND provider='github'",[id]);await audit(runtime.database.query.bind(runtime.database),id,actor,'repository.connection_removed','Future hosted workers will use anonymous public access only. Revoke the GitHub token to stop existing access.');return {removed:true};}
