const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const root='/vercel/sandbox';
let stage='network isolation';
function fail(e){console.log(JSON.stringify({error:'Hosted diagnostic failed',stage,exitStatus:e.status||null,detail:String(e.stderr||e.message||'').slice(0,1000)}));process.exit(1);}
try{if(fs.existsSync('/proc/sys/net/ipv6/conf/all/disable_ipv6'))execFileSync('sudo',['sysctl','-w','net.ipv6.conf.all.disable_ipv6=1','net.ipv6.conf.default.disable_ipv6=1'],{stdio:'pipe',timeout:10000});}catch(e){fail(e);}
stage='npm installation';
fs.writeFileSync(root+'/package.json',JSON.stringify({private:true,dependencies:{'playwright-core':'1.63.0'}}));
try{execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund'],{cwd:root,stdio:'pipe',timeout:60000});}catch(e){fail(e);}
stage='browser installation';
try{execFileSync('node',[root+'/node_modules/playwright-core/cli.js','install','--with-deps','chromium','firefox','webkit'],{cwd:root,stdio:'pipe',timeout:180000});}catch(e){fail(e);}
stage='browser launch';
(async()=>{const pw=require(root+'/node_modules/playwright-core');const checks=[];for(const name of ['chromium','firefox','webkit']){const browser=await pw[name].launch({headless:true,...(name==='chromium'?{chromiumSandbox:true}:{})});try{const page=await browser.newPage();await page.setContent('<!doctype html><html lang="en"><head><title>Hosted QA</title></head><body><h1>Hosted QA works</h1></body></html>');if(await page.locator('h1').textContent()!=='Hosted QA works')throw new Error('Browser assertion failed');checks.push(name);}finally{await browser.close();}}console.log(JSON.stringify({browsers:checks,sourceWrites:false,modelRequests:0}));})().catch(e=>fail(e));
