import { createRequire } from 'node:module';
const login=value=>typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(value)?value:undefined;
/** Optional read-only GitHub enrichment. Identities are accepted only for this exact revision. */
/** @param {any} job @param {{token?:string,fetchImpl?:typeof fetch}} options @returns {Promise<{source:string,requestedBy?:string,author?:string,mergedBy?:string,releasedBy?:string,builtBy?:string}>} */
export async function githubPeople(job,{token,fetchImpl=fetch}={}) {
  const people={...(job.requestedBy?{requestedBy:job.requestedBy}:{}),source:'unavailable'};
  if(!token)return people;
  const get=async endpoint=>{const r=await fetchImpl(`https://api.github.com/repos/${job.repository}${endpoint}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('GitHub metadata unavailable');const text=await r.text();if(text.length>256*1024)throw new Error('Metadata exceeds limit');return JSON.parse(text);};
  try {
    if(job.pr){const pr=await get(`/pulls/${job.pr.number}`);if(pr.head?.sha!==job.revision)return people;return {...people,source:'github',...(login(pr.user?.login)?{author:pr.user.login}:{}),...(login(pr.merged_by?.login)?{mergedBy:pr.merged_by.login}:{})};}
    if(job.target?.kind==='release'){const tag=encodeURIComponent(job.target.name);const commit=await get(`/commits/${tag}`);if(commit.sha!==job.revision)return people;const release=await get(`/releases/tags/${tag}`);if(!release.draft && login(release.author?.login))return {...people,source:'github',releasedBy:release.author.login};}
    if(job.target?.kind==='build' && /^actions-\d+$/.test(job.target.name)){const run=await get(`/actions/runs/${job.target.name.slice(8)}`);if(run.head_sha===job.revision && login(run.triggering_actor?.login || run.actor?.login))return {...people,source:'github',builtBy:run.triggering_actor?.login || run.actor.login};}
  }catch{/* Missing permission or mismatched identities never invent a release author. */}
  return people;
}
/** Slack credentials stay on the connector and never enter QA child processes or portal storage. */
/** @param {{bot:any,portal:any,env:Record<string,string|undefined>,enabled:boolean,trustedPath:Function,send?:Function}} options */
export async function drainTeamUpdates({bot,portal,env,enabled,trustedPath,send}) {
  if(!enabled || /^(true|1|yes)$/i.test(env.DRY_RUN || ''))return {status:'disabled',sent:0};
  const cfg=bot.config?.teamUpdates;
  if(!cfg?.enabled || !/^[CG][A-Z0-9]{8,30}$/.test(cfg.channelId || '') || !env.SLACK_BOT_TOKEN)return {status:'setup_required',sent:0};
  const {SlackAdapter,assessmentMessage}=createRequire(import.meta.url)(await trustedPath(bot.botDir,'src/slack.js'));
  const adapter=new SlackAdapter({botToken:env.SLACK_BOT_TOKEN,channelId:cfg.channelId,dryRun:false});
  let sent=0;
  for(let i=0;i<10;i++){
    const claim=await portal.request('POST','/api/agent/notifications/claim',{channelId:cfg.channelId});if(!claim.notification)break;
    const {notification}=claim;
    if(!/^[a-f0-9-]{36}$/.test(notification.id || '') || !/^[A-Za-z0-9_-]{43}$/.test(claim.claimToken || '') || notification.channelId!==cfg.channelId)throw new Error('Invalid notification delivery claim');
    try {
      const receipt=await (send || ((text,options)=>adapter.send(text,options)))(assessmentMessage(notification,env.QA_PORTAL_URL),{key:notification.id,threadTs:notification.threadTs});
      if(receipt.status!=='sent' || receipt.channel && receipt.channel!==cfg.channelId)throw new Error('Delivery not confirmed');
      await portal.request('POST',`/api/agent/notifications/${notification.id}/complete`,{claimToken:claim.claimToken,status:'sent',...(receipt.ts?{ts:receipt.ts}:{})});sent++;
    }catch{
      await portal.request('POST',`/api/agent/notifications/${notification.id}/complete`,{claimToken:claim.claimToken,status:'uncertain'}).catch(()=>{});
      return {status:'uncertain',sent};
    }
  }
  return {status:'ready',sent};
}
