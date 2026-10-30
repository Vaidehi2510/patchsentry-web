// Fixed preparation of the disposable worker OS, never the product repository.
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
module.exports=function prepareHostedSystem(){
  const root=(args,options={})=>execFileSync('sudo',args,{stdio:'pipe',timeout:15000,...options});
  if(fs.existsSync('/proc/sys/net/ipv6/conf/all/disable_ipv6'))root(['sysctl','-w','net.ipv6.conf.all.disable_ipv6=1','net.ipv6.conf.default.disable_ipv6=1']);
  // Domain-based egress policies authenticate HTTPS. Ubuntu's default apt
  // sources use HTTP, so upgrade them before Playwright installs dependencies.
  for(const directory of ['/etc/apt/sources.list.d'])if(fs.existsSync(directory))for(const name of fs.readdirSync(directory)){
    if(!/\.(list|sources)$/.test(name))continue;
    const filename=directory+'/'+name,content=fs.readFileSync(filename,'utf8');
    if(content.includes('ubuntu.com'))root(['tee',filename],{input:content.replaceAll('http://','https://')});
    else root(['mv',filename,filename+'.qa-disabled']);
  }
  if(fs.existsSync('/etc/apt/sources.list')){const content=fs.readFileSync('/etc/apt/sources.list','utf8');root(['tee','/etc/apt/sources.list'],{input:content.replaceAll('http://','https://')});}
  root(['tee','/etc/apt/apt.conf.d/99patchsentry-network'],{input:'Acquire::Retries "3";\nAcquire::https::Pipeline-Depth "0";\nAcquire::http::Pipeline-Depth "0";\n'});
  // Keep Chromium's own namespace sandbox enabled inside the isolated VM.
  if(fs.existsSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns'))root(['sysctl','-w','kernel.apparmor_restrict_unprivileged_userns=0']);
};
