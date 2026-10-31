"""Copy repository files, never credentials/dependencies, into a read-only QA input."""
import pathlib,subprocess,shutil,hashlib,json,sys
root=pathlib.Path(__file__).resolve().parents[2];name=sys.argv[1] if len(sys.argv)>1 else 'candidate'
if name not in ('candidate','regression','shipping'):raise SystemExit('Use candidate, regression or shipping')
dest=pathlib.Path('/private/tmp/ps-launch-source-'+name);dest.mkdir(exist_ok=True)
files=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=root).decode().split('\0');manifest={}
for name in files:
 if not name or name.startswith(('.env','.vercel','.local','artifacts/')):continue
 p=root/name
 if p.is_file() and not p.is_symlink():
  target=dest/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target);manifest[name]=hashlib.sha256(p.read_bytes()).hexdigest()
(dest/'source-manifest.json').write_text(json.dumps(manifest,sort_keys=True,indent=2));print(str(dest))
