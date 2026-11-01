const path=require('node:path'),os=require('node:os');
if(!process.env.PATCHSENTRY_ENGINE_DIR)throw Error('Set PATCHSENTRY_ENGINE_DIR to a reviewed engine checkout with dependencies installed.');
const {chromium}=require(path.join(process.env.PATCHSENTRY_ENGINE_DIR,'node_modules/playwright-core'));
const origin=process.env.PS_REVIEW_ORIGIN||'http://127.0.0.1:3115',parsed=new URL(origin);
if(!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw Error('Record only an explicit loopback public preview.');
const fs=require('node:fs/promises');
(async()=>{
 await fs.mkdir('artifacts',{recursive:true});
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:'reduce',recordVideo:{dir:path.join(os.tmpdir(),'patchsentry-award-video'),size:{width:1280,height:720}}});
 const page=await context.newPage();page.setDefaultTimeout(20000);const timing=[],start=Date.now();
 async function scene(name,fn,ms){await fn();timing.push({scene:name,startsMs:Date.now()-start,durationMs:ms});await new Promise(resolve=>setTimeout(resolve,ms));}
 await scene('Public reviewer guide',async()=>{await page.goto(origin+'/open-source');await page.getByRole('heading',{name:'See the evidence. Run it yourself.'}).waitFor();},12000);
 await scene('No-key reproduction commands',async()=>{await page.locator('#reproduce').scrollIntoViewIfNeeded();},16000);
 await scene('Captured real shipping-boundary failure',async()=>{await page.locator('#example').scrollIntoViewIfNeeded();await page.screenshot({path:'public/review/walkthrough-poster.png'});},16000);
 await scene('Illustrative dashboard',async()=>{await page.goto(origin+'/demo');await page.getByRole('button',{name:/Add express checkout to the cart/}).first().waitFor();},16000);
 await scene('Illustrative report presentation',async()=>{await page.getByRole('button',{name:/Add express checkout to the cart/}).first().click();await page.getByRole('heading',{name:/Add express checkout to the cart/}).waitFor();},16000);
 await scene('Evidence and remaining limits',async()=>{await page.goto(origin+'/open-source#evidence');await page.locator('#evidence').scrollIntoViewIfNeeded();},16000);
 await scene('Three-repository architecture',async()=>{await page.locator('#architecture').scrollIntoViewIfNeeded();},16000);
 await scene('Authentic contribution paths',async()=>{await page.locator('#contribute').scrollIntoViewIfNeeded();},12000);
 const video=page.video();await context.close();await video.saveAs('public/review/patchsentry-walkthrough.webm');await browser.close();await fs.writeFile('artifacts/award-record-timing.json',JSON.stringify({scope:'Actual local production-build screen recording. Guide contains captured real fixture results; workspace demo is illustrative. No customer or model/provider operation.',timing},null,2));process.stdout.write('Recorded reviewer walkthrough with eight scenes and captions/transcript.\n');
})().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
