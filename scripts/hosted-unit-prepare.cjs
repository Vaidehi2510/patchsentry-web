// Trusted bootstrap. No product module, hook, install or authored test is executed.
const fs=require('node:fs/promises'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const exec=promisify(execFile),root='/vercel/sandbox';
(async()=>{
 const input=JSON.parse(await fs.readFile(root+'/unit-input.json','utf8'));
 if(!/^[\w.-]+\/[\w.-]+$/.test(input.repository)||!/^[a-f0-9]{40}$/.test(input.revision))throw Error('Invalid source identity');
 const env={PATH:process.env.PATH,HOME:'/tmp',GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_LFS_SKIP_SMUDGE:'1'};
 if(input.gitHubToken){const askpass=root+'/unit-askpass.cjs';await fs.writeFile(askpass,"#!/usr/bin/env node\nconst fs=require('node:fs');process.stdout.write(/username/i.test(process.argv[2]||'')?'x-access-token':JSON.parse(fs.readFileSync('/vercel/sandbox/unit-input.json')).gitHubToken);",{mode:0o700});env.GIT_ASKPASS=askpass;}
 const run=(cmd,args)=>exec(cmd,args,{cwd:root,env,timeout:90000,maxBuffer:1024*1024});
 try{
  await run('git',['-c','core.hooksPath=/dev/null','init',root+'/product']);
  await run('git',['-C',root+'/product','-c','core.hooksPath=/dev/null','fetch','--depth=1','--no-tags','https://github.com/'+input.repository+'.git',input.revision]);
  const actual=(await run('git',['-C',root+'/product','rev-parse','FETCH_HEAD'])).stdout.trim();if(actual!==input.revision)throw Error('Revision mismatch');
  await run('git',['-C',root+'/product','-c','core.hooksPath=/dev/null','-c','filter.lfs.required=false','checkout','--detach',actual]);
  await fs.rm(root+'/product/.git',{recursive:true,force:true});
  await fs.chmod(root,0o755);await fs.chmod(root+'/product',0o755);await fs.chmod(root+'/tests',0o755);
  let files=0,total=0;async function readonly(dir){await fs.chmod(dir,0o755);for(const entry of await fs.readdir(dir,{withFileTypes:true})){const target=dir+'/'+entry.name;if(entry.isSymbolicLink())continue;if(entry.isDirectory())await readonly(target);else{const stat=await fs.stat(target);if(++files>50000||(total+=stat.size)>64*1024*1024)throw Error('Source exceeds unit workspace limits');await fs.chmod(target,0o444);}}}await readonly(root+'/product');for(const name of await fs.readdir(root+'/tests')){if(!/^[a-f0-9-]{36}\.test\.cjs$/.test(name))throw Error('Unexpected test path');await fs.chmod(root+'/tests/'+name,0o444);}
 }finally{await fs.rm(root+'/unit-input.json',{force:true});await fs.rm(root+'/unit-askpass.cjs',{force:true});}
})().catch(()=>{console.error('Unit source preparation failed.');process.exitCode=1;});
