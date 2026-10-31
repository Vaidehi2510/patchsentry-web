"""Execute pre-registered actual-release QA challenge. Never edits the source repository."""
import pathlib, json, shutil, subprocess, time, hashlib, concurrent.futures, re, os
root=pathlib.Path(__file__).resolve().parents[2];phase=os.environ.get('PS_EVALUATION_PHASE','discovery');assert phase in ('discovery','post-regression');source=pathlib.Path('/private/tmp/ps-launch-source-'+('candidate' if phase=='discovery' else 'regression'))
raw=(root/'test/launch/workload-cases.json').read_bytes();manifest=json.loads(raw)
out=pathlib.Path('/private/tmp/ps-launch-evaluation'+('' if phase=='discovery' else '-post-regression'));out.mkdir(exist_ok=True)
(out/'registered-cases.json').write_bytes(raw);(out/'registration.json').write_text(json.dumps(dict(sha256=hashlib.sha256(raw).hexdigest(),registeredAt=time.time())))
def trial(case):
 dest=pathlib.Path('/private/tmp/ps-launch-source-'+case['id']);shutil.copytree(source,dest,dirs_exist_ok=True)
 if 'file' in case:
  p=dest/case['file'];text=p.read_text()
  if 'before' in case:
   assert text.count(case['before'])==1; text=text.replace(case['before'],case['after'])
   if 'alsoBefore' in case:assert text.count(case['alsoBefore'])==1;text=text.replace(case['alsoBefore'],case['alsoAfter'])
  else:text+=case['append']
  p.write_text(text)
 start=time.monotonic();p=subprocess.run(['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256','--cpus','2','--memory','4g','--tmpfs','/tmp:rw,nosuid,nodev,size=2g,uid=1000,gid=1000','--mount',f'type=bind,source={dest},target=/workspace,readonly','patchsentry-release-qa:launch','full'],capture_output=True)
 log=(p.stdout+p.stderr).decode();(out/(case['id']+'.tap')).write_text(log)
 tests=int(re.search(r'# tests (\d+)',log).group(1)) if re.search(r'# tests (\d+)',log) else 0
 failures=int(re.search(r'# fail (\d+)',log).group(1)) if re.search(r'# fail (\d+)',log) else 0
 valid=tests>0 and 'SyntaxError' not in log and 'ERR_MODULE_NOT_FOUND' not in log and not any(x in log for x in ['JavaScript heap out of memory','QA process stopped without complete evidence'])
 return dict(id=case['id'],label=case['label'],exitCode=p.returncode,tests=tests,failures=failures,valid=valid,alarm=p.returncode!=0 and failures>0,runtimeMs=round((time.monotonic()-start)*1000),logSha256=hashlib.sha256(log.encode()).hexdigest())
start=time.monotonic()
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(trial,[c for c in manifest['cases'] if phase=='discovery' or c['id'] in ('payload-integrity-bypass','archive-receipt-bypass','healthy-original')]))
valid=[r for r in results if r['valid']];defects=[r for r in valid if r['label']=='defect'];healthy=[r for r in valid if r['label']=='healthy']
report=dict(phase=phase,interpretation='Internal development challenge' if phase=='discovery' else 'Regressions added after observing two misses; not new held-out recall evidence',scope=manifest['workload'],partition=manifest['partition'],caseManifestSha256=hashlib.sha256(raw).hexdigest(),results=results,detected=sum(r['alarm'] for r in defects),missed=sum(not r['alarm'] for r in defects),falseAlarms=sum(r['alarm'] for r in healthy),defects=len(defects),healthy=len(healthy),invalid=len(results)-len(valid),wallMs=round((time.monotonic()-start)*1000),humanInterventionMinutes=None,manualBaselineMinutes=None,staffingSavings=None,actualProviderCostUsd=None,ai=dict(status='not executed',reason='No authorized inference credential/local service',diagnosisAccuracy=None))
(out/'evaluation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
