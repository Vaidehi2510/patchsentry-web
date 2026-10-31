const fs=require('node:fs'),{spawnSync}=require('node:child_process');
const suite=process.argv[2]||'full';if(!['full','critical'].includes(suite))throw Error('Unknown approved QA workload');
const root='/tmp/product';fs.cpSync('/workspace',root,{recursive:true,filter:p=>!['node_modules','.git','artifacts','.local','.vercel','.next'].includes(require('node:path').basename(p))});
fs.symlinkSync('/opt/qa/node_modules',root+'/node_modules','dir');
const tests=fs.readdirSync(root+'/test').filter(n=>n.endsWith('.test.ts')&&(suite==='full'||['assurance.test.ts','quality-workflow.test.ts','account-access.test.ts','enterprise.test.ts','capacity.test.ts'].includes(n))).map(n=>'test/'+n).sort();
const result=spawnSync(process.execPath,['--import','/opt/qa/node_modules/tsx/dist/loader.mjs','--test','--test-concurrency=2','--test-reporter=tap',...tests],{cwd:root,encoding:'utf8',timeout:240000,maxBuffer:2*1024*1024,env:{PATH:process.env.PATH,HOME:'/tmp',NODE_ENV:'test',CI:'1'}});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');if(result.error)process.stderr.write('QA process stopped without complete evidence.\n');process.exitCode=result.status??2;
