const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const root='/vercel/sandbox';
let stage='network isolation';
const command=(cmd,args,options={})=>execFileSync(cmd,args,{cwd:root,stdio:'pipe',timeout:60000,maxBuffer:2*1024*1024,...options});
function fail(e){const stdout=String(e.stdout||'').slice(-700),stderr=String(e.stderr||'').slice(-500);console.log(JSON.stringify({error:'Hosted diagnostic failed',stage,exitStatus:e.status||null,detail:[stdout.slice(-500),stderr.slice(-500)].filter(Boolean).join(' ')||(e.message||'').slice(-1000)}));process.exit(1);}
(async()=>{
  require('./hosted-system.cjs')();
  stage='npm installation';
  fs.writeFileSync(root+'/package.json',JSON.stringify({private:true,dependencies:{'playwright-core':'1.63.0'}}));
  command('npm',['install','--ignore-scripts','--no-audit','--no-fund']);
  stage='browser installation';
  command('node',[root+'/node_modules/playwright-core/cli.js','install','--with-deps','chromium','firefox','webkit'],{timeout:180000});
  const pw=require(root+'/node_modules/playwright-core'),checks=[];
  for(const name of ['chromium','firefox','webkit']){
    stage=name+' browser launch';
    const browser=await pw[name].launch({headless:true,...(name==='chromium'?{chromiumSandbox:true}:{})});
    try{const page=await browser.newPage();await page.setContent('<!doctype html><html lang="en"><head><title>Hosted QA</title></head><body><h1>Hosted QA works</h1></body></html>');if(await page.locator('h1').textContent()!=='Hosted QA works')throw Error('Browser assertion failed');checks.push(name);}finally{await browser.close();}
  }
  stage='pinned engine download';
  const revision=fs.readFileSync(root+'/engine-revision.txt','utf8').trim();if(!/^[a-f0-9]{40}$/.test(revision))throw Error('Invalid engine pin');
  command('git',['-c','core.hooksPath=/dev/null','clone','--no-checkout','--filter=blob:none','https://github.com/Vaidehi2510/QA-testbot.git',root+'/engine']);
  command('git',['-c','core.hooksPath=/dev/null','checkout','--detach',revision],{cwd:root+'/engine'});
  command('npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:root+'/engine'});
  stage='real engine goal and independent replay';
  command('node',['--test','test/portal-bridge.test.js'],{cwd:root+'/engine',timeout:120000,env:{...process.env,QA_PORTAL_BROWSER_TEST:'1'}});
  console.log(JSON.stringify({browsers:checks,engineBridge:'passed',productSourceWrites:false,externalInferenceRequests:0,syntheticLocalInference:true}));
})().catch(fail);
