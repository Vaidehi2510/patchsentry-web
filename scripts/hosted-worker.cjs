// Trusted bootstrap only. Product Git objects are inspected as data; no product
// install scripts, build commands, hooks, or tests run with provider credentials.
const fs=require('node:fs/promises');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const crypto=require('node:crypto');
const exec=promisify(execFile),root='/vercel/sandbox';
const started=Date.now();
let input,stage='initializing',gitAskpass;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function command(cmd,args,cwd=root){return exec(cmd,args,{cwd,timeout:180000,maxBuffer:1024*1024,env:{PATH:process.env.PATH,HOME:process.env.HOME,CI:'1',GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_LFS_SKIP_SMUDGE:'1',...(gitAskpass?{GIT_ASKPASS:gitAskpass}:{})}});}
async function callback(suffix,body,headers={}){const r=await fetch(input.callbackUrl+suffix,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:'Bearer '+input.callbackToken,'content-type':'application/json',...headers},body:typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body)});if(!r.ok){await r.body?.cancel();throw new Error('Result delivery failed');}return r;}
async function deliver(result){let safe=JSON.stringify(result).split(input.apiKey).join('[REDACTED]').split(input.callbackToken).join('[REDACTED]');if(input.gitHubToken)safe=safe.split(input.gitHubToken).join('[REDACTED]');for(let i=0;i<3;i++){try{await callback('',safe);return;}catch{if(i===2)throw new Error('Result delivery interrupted');await new Promise(r=>setTimeout(r,1000*(i+1)));}}}
async function artifact(url,expected){const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(45000)});if(!r.ok||!r.body)throw new Error('Build artifact unavailable');const reader=r.body.getReader(),parts=[];let n=0;for(;;){const p=await reader.read();if(p.done)break;n+=p.value.length;if(n>64*1024*1024){await reader.cancel();throw new Error('Artifact exceeds 64 MiB');}parts.push(Buffer.from(p.value));}const bytes=Buffer.concat(parts);if(!bytes.length||sha(bytes)!==expected)throw new Error('Artifact digest mismatch');await fs.writeFile(root+'/build-artifact',bytes,{mode:0o600});}
async function main(){
  input=JSON.parse(await fs.readFile(root+'/qa-input.json','utf8'));await fs.chmod(root+'/qa-input.json',0o600);
  const {hostedArtifactUrl,...job}=input.job;
  if(!/^[\w.-]+\/[\w.-]+$/.test(job.repository)||!/^\w[\w./-]{0,119}$/.test(job.base)||job.base.includes('..')||!/^[a-f0-9]{40}$/.test(job.revision)||!/^[a-f0-9]{40}$/.test(input.engineRevision))throw new Error('Invalid immutable inputs');
  stage='enforcing hosted network isolation';
  if(require('node:fs').existsSync('/proc/sys/net/ipv6/conf/all/disable_ipv6'))await command('sudo',['sysctl','-w','net.ipv6.conf.all.disable_ipv6=1','net.ipv6.conf.default.disable_ipv6=1']);
  stage='preparing the QA engine';
  await command('git',['-c','core.hooksPath=/dev/null','clone','--no-checkout','--filter=blob:none','https://github.com/Vaidehi2510/QA-testbot.git',root+'/engine']);
  await command('git',['-c','core.hooksPath=/dev/null','checkout','--detach',input.engineRevision],root+'/engine');
  await command('npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],root+'/engine');
  stage='preparing browser engines';
  await command('node',['node_modules/playwright-core/cli.js','install','--with-deps',...job.testingProfile.browsers],root+'/engine');
  stage='reading the requested source revision';
  if(input.gitHubToken){gitAskpass=root+'/git-askpass.cjs';await fs.writeFile(gitAskpass,"#!/usr/bin/env node\nconst fs=require('node:fs');const token=JSON.parse(fs.readFileSync('/vercel/sandbox/qa-input.json','utf8')).gitHubToken;process.stdout.write(/username/i.test(process.argv[2]||'')?'x-access-token':token);",{mode:0o700});}
  await command('git',['init','--bare',root+'/product.git']);
  const git=args=>command('git',['-c','core.hooksPath=/dev/null',...args],root+'/product.git');
  await git(['remote','add','origin','https://github.com/'+job.repository+'.git']);
  await git(['fetch','--no-tags','--depth=1','origin',job.base]);
  if(!/^[a-f0-9]{40}$/.test(job.base))await git(['update-ref',job.base,(await git(['rev-parse','FETCH_HEAD'])).stdout.trim()]);
  await git(['fetch','--no-tags','--depth=1','origin',job.revision]);
  if((await git(['rev-parse','FETCH_HEAD'])).stdout.trim()!==job.revision)throw new Error('Source revision mismatch');
  const config={enabled:false,targetAccess:'read-only',runners:[],specificationPaths:[],ai:{enabled:true,...job.settings,maxInputChars:100000,maxOutputTokens:2000,provider:{data_collection:'deny',allow_fallbacks:false,require_parameters:true}}};
  await fs.writeFile(root+'/qa-config.json',JSON.stringify(config),{mode:0o600});
  const preview=new URL(job.testingProfile.previewUrlTemplate.replaceAll('{sha}',job.revision).replaceAll('{pr}',String(job.pr?.number||0)));
  const policy={schemaVersion:1,repository:job.repository,repoCheckout:root+'/product.git',base:job.base,allowedPreviewOrigins:[preview.origin],allowedBrowsers:job.testingProfile.browsers,maxPages:job.testingProfile.maxPages,maxGoals:8,maxAssertions:30,maxCostUsd:job.settings.maxCostUsd,maxCallsPerRun:job.settings.maxCallsPerRun,allowedBackends:['openrouter'],allowImages:job.settings.allowImages,allowMutations:job.testingProfile.allowMutations,allowSemanticMaintenance:false,executeBaseline:false,timeoutMs:300000,configPath:root+'/qa-config.json',regressionDir:root+'/qa-evidence'};
  if(job.target){stage='verifying the build artifact';if(job.target.platform!=='web'||!hostedArtifactUrl)throw new Error('Hosted release needs a web preview and immutable artifact URL');await artifact(hostedArtifactUrl,job.target.artifactSha256);await fs.mkdir(root+'/manifests');await fs.writeFile(root+'/manifests/'+job.target.artifactSha256+'.json',JSON.stringify({schemaVersion:1,repository:job.repository,revision:job.revision,artifactSha256:job.target.artifactSha256,artifactPath:root+'/build-artifact',platform:'web',[job.target.kind==='release'?'version':'buildId']:job.target.name}));policy.allowedPlatforms=['web'];policy.releaseManifestDir=root+'/manifests';policy.executeBaseline=true;}
  stage='executing QA';
  const {runPortal}=require(root+'/engine/src/autonomy/portal.js');
  const report=await runPortal({job,policy,policyPath:root+'/policy.json',outputDir:root+'/output',env:{PATH:process.env.PATH,HOME:process.env.HOME,OPENROUTER_API_KEY:input.apiKey}});
  report.limitations=report.limitations.filter(v=>!v.startsWith('Local runner evidence;'));
  report.limitations.push('Executed in an isolated hosted worker. Source was read without executing product commands. Existing product unit/API/native suites were not run. Hosted public-preview coverage is bounded by the saved expectations; it is not exhaustive.');
  await deliver({status:'completed',report,message:'Hosted QA finished. Review checks and findings before shipping.',durationMs:Date.now()-started});
  if(input.allowEvidenceUploads){try{const manifest=JSON.parse(await fs.readFile(root+'/output/portal-evidence.json','utf8'));for(const entry of manifest.evidence||manifest.files||[]){const meta=entry.metadata||entry;const file=entry.file||entry.path;if(typeof file!=='string'||!/^[a-f0-9-]{36}\.(png|json|txt)$/.test(file.split('/').pop()))continue;const bytes=await fs.readFile(root+'/output/'+file);if(sha(bytes)!==meta.sha256)continue;await callback('/evidence/'+meta.id,bytes,{'content-type':meta.mime,'x-patchsentry-evidence':Buffer.from(JSON.stringify(meta)).toString('base64url')});}}catch{/* The report remains complete; absent evidence is visible in the dashboard. */}}
}
main().catch(async()=>{if(input)await deliver({status:'blocked',message:'Hosted QA stopped while '+stage+'. Check repository visibility, preview identity headers, artifact availability, model credits and cloud browser support. No automatic model retry was made.',durationMs:Math.min(900000,Date.now()-started)}).catch(()=>{});}).finally(async()=>{if(input){await fs.rm(root+'/qa-input.json',{force:true});await callback('/stop',{}).catch(()=>{});}process.exitCode=0;});
