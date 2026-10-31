"""Synthetic localhost rehearsal. Container/database names are intentionally fixed."""
import subprocess, time, json, os, pathlib
root=pathlib.Path(__file__).resolve().parents[2]
out=pathlib.Path('/private/tmp/ps-launch-recovery');out.mkdir(exist_ok=True)
container='ps-launch-postgres'
base=dict(os.environ,PS_ALLOW_FIXTURE_RECOVERY='1',PS_RESTORE_EXPECTED='/private/tmp/ps-launch-recovery-expected.json')
measure=[]
def run(args, **kwargs):return subprocess.run(args,check=True,capture_output=True,**kwargs)
def sql(db,statement):return run(['docker','exec',container,'psql','-v','ON_ERROR_STOP=1','-U','postgres','-d',db,'-c',statement])
def verify(db,label,source=root,expected=True):
 start=time.monotonic();env=dict(base,DATABASE_URL='postgresql://postgres:launch-fixture-only@127.0.0.1:55438/'+db)
 p=subprocess.run(['node','--import','tsx',str(source/'scripts/enterprise-restore-fixture.ts'),'verify'],cwd=source,env=env,capture_output=True)
 (out/(label+'.log')).write_bytes(p.stdout+p.stderr)
 assert (p.returncode==0)==expected,(label,p.stderr.decode()[-1000:]);measure.append(dict(step=label,ms=round((time.monotonic()-start)*1000),exitCode=p.returncode))
rehearsal_start=time.monotonic();start=rehearsal_start;dump=run(['docker','exec',container,'pg_dump','-U','postgres','-Fc','--no-owner','--no-acl','ps_fixture_recovery_seed']).stdout
(out/'synthetic.dump').write_bytes(dump);measure.append(dict(step='backup',ms=round((time.monotonic()-start)*1000),bytes=len(dump)))
for db,label in [('ps_fixture_recovered','database-restore'),('ps_fixture_artifacts','artifact-recovery')]:
 start=time.monotonic();run(['docker','exec',container,'createdb','-U','postgres',db]);run(['docker','exec','-i',container,'pg_restore','-U','postgres','-d',db,'--exit-on-error','--single-transaction','--no-owner','--no-acl'],input=dump)
 measure.append(dict(step=label,ms=round((time.monotonic()-start)*1000)));verify(db,label+'-verify')
 if db=='ps_fixture_recovered':
  sql(db,"UPDATE qa_evidence SET encrypted=decode('00','hex')");verify(db,'lost-artifact-detected',expected=False)
# An interrupted transactional migration must not leave a half-created schema.
sql('ps_fixture_artifacts','BEGIN; CREATE TABLE ps_interrupted_release(id integer); ROLLBACK;')
assert b'ps_interrupted_release' not in sql('ps_fixture_artifacts',"SELECT tablename FROM pg_tables WHERE tablename='ps_interrupted_release'").stdout
measure.append(dict(step='interrupted-transaction-no-partial-schema',passed=True))
# Prior deployed source can still read the expanded schema and decrypt restored data.
prior=pathlib.Path('/private/tmp/ps-launch-prior-release')
if prior.exists():verify('ps_fixture_artifacts','prior-release-rollback',prior)
result=dict(scope='Local PostgreSQL16 synthetic recovery, same fixed test key; no production backup cadence, key escrow, Neon failover or Vercel traffic routing tested.',totalMs=round((time.monotonic()-rehearsal_start)*1000),steps=measure)
(out/'recovery.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
