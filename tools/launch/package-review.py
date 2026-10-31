"""Build a reproducible internal handoff; it is not an independent assessment."""
import pathlib,subprocess,os,hashlib,json,tarfile,io,gzip
root=pathlib.Path(__file__).resolve().parents[2];output=root/'artifacts/enterprise-review';output.mkdir(parents=True,exist_ok=True)
repos={'website':root}
if os.environ.get('PATCHSENTRY_ENGINE_DIR'):repos['engine']=pathlib.Path(os.environ['PATCHSENTRY_ENGINE_DIR']).resolve()
if os.environ.get('PATCHSENTRY_LEDGER_DIR'):repos['java-ledger']=pathlib.Path(os.environ['PATCHSENTRY_LEDGER_DIR']).resolve()
archive=output/'patchsentry-review.tar.gz';files={};metadata={'classification':'Internal reproducible reviewer handoff; independent assessment not performed','repositories':{}}
for label,directory in repos.items():
 head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=directory).decode().strip();metadata['repositories'][label]={'head':head}
 names=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=directory).decode().split('\0')
 for name in sorted(set(names)):
  if not name or any(part in ('.git','.aws','.azure','.ssh','.npmrc','.netrc','.vercel','.local','node_modules','.next','artifacts','target') or part.startswith('.env') for part in pathlib.PurePosixPath(name).parts):continue
  p=directory/name
  if p.is_file() and not p.is_symlink():files[label+'/'+name]=p.read_bytes()
 files[label+'/candidate.diff']=subprocess.check_output(['git','diff','--no-ext-diff','--no-textconv','HEAD'],cwd=directory)
files['REVIEW.json']=json.dumps(metadata,sort_keys=True,indent=2).encode()
files['SHA256SUMS']=''.join(hashlib.sha256(data).hexdigest()+'  '+name+'\n' for name,data in sorted(files.items())).encode()
with archive.open('wb') as target, gzip.GzipFile(filename='',fileobj=target,mode='wb',mtime=0) as zipped, tarfile.open(fileobj=zipped,mode='w') as tar:
 for name,data in sorted(files.items()):
  info=tarfile.TarInfo(name);info.size=len(data);info.mtime=0;info.mode=0o644;tar.addfile(info,io.BytesIO(data))
digest=hashlib.sha256(archive.read_bytes()).hexdigest();(output/'archive.sha256').write_text(digest+'  '+archive.name+'\n');print(json.dumps({'archive':str(archive),'sha256':digest,'files':len(files),'independentReview':'not performed'}))
