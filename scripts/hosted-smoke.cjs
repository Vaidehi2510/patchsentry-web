const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const root='/vercel/sandbox';
fs.writeFileSync(root+'/package.json',JSON.stringify({private:true,dependencies:{'playwright-core':'1.63.0'}}));
execFileSync('npm',['install','--ignore-scripts','--no-audit','--no-fund'],{cwd:root,stdio:'ignore',timeout:60000});
execFileSync('node',[root+'/node_modules/playwright-core/cli.js','install','--with-deps','chromium','firefox','webkit'],{cwd:root,stdio:'ignore',timeout:180000});
(async()=>{const pw=require(root+'/node_modules/playwright-core');const checks=[];for(const name of ['chromium','firefox','webkit']){const browser=await pw[name].launch({headless:true,...(name==='chromium'?{chromiumSandbox:true}:{})});try{const page=await browser.newPage();await page.setContent('<!doctype html><html lang="en"><head><title>Hosted QA</title></head><body><h1>Hosted QA works</h1></body></html>');if(await page.locator('h1').textContent()!=='Hosted QA works')throw new Error('Browser assertion failed');checks.push(name);}finally{await browser.close();}}console.log(JSON.stringify({browsers:checks,sourceWrites:false,modelRequests:0}));})().catch(()=>{console.log(JSON.stringify({error:'A hosted browser could not start'}));process.exitCode=1;});
