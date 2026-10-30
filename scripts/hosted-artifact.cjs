const fs=require('node:fs/promises'),crypto=require('node:crypto');
async function downloadHostedArtifact({url,expectedSha,repository,gitHubToken,output,fetchImpl=fetch}){
 if(!/^[a-f0-9]{64}$/.test(expectedSha))throw Error('Invalid artifact digest');
 const first=new URL(url);if(first.protocol!=='https:'||first.username||first.password||first.search||first.hash||first.port&&first.port!=='443')throw Error('Invalid artifact origin');
 let current=first,deadline=Date.now()+45000;
 for(let hop=0;hop<4;hop++){
  const assetPath='/repos/'+repository+'/releases/assets/',authorized=current.origin==='https://api.github.com'&&current.pathname.startsWith(assetPath)&&/^\d+$/.test(current.pathname.slice(assetPath.length));
  const response=await fetchImpl(current.href,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(Math.max(1,deadline-Date.now())),headers:{accept:'application/octet-stream',...(authorized&&gitHubToken?{authorization:'Bearer '+gitHubToken}:{})}});
  if([301,302,303,307,308].includes(response.status)){
   const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('Artifact redirect is incomplete');const next=new URL(location,current);
   if(next.protocol!=='https:'||next.username||next.password||next.hash||next.port&&next.port!=='443'||next.origin!==first.origin&&!['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(next.hostname))throw Error('Artifact redirect left the approved origin and GitHub asset CDN');current=next;continue;
  }
  if(!response.ok||!response.body){await response.body?.cancel();throw Error('Artifact unavailable');}
  const reader=response.body.getReader(),parts=[];let n=0;try{for(;;){const p=await reader.read();if(p.done)break;n+=p.value.length;if(n>64*1024*1024){await reader.cancel();throw Error('Artifact exceeds 64 MiB');}parts.push(Buffer.from(p.value));}}finally{reader.releaseLock();}
  const bytes=Buffer.concat(parts);if(!bytes.length||crypto.createHash('sha256').update(bytes).digest('hex')!==expectedSha)throw Error('Artifact bytes do not match the approved SHA-256');await fs.writeFile(output,bytes,{mode:0o600});return;
 }
 throw Error('Artifact redirect limit reached');
}
module.exports={downloadHostedArtifact};
