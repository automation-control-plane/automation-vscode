import datetime,hashlib,json,os,subprocess,sys,zipfile
from pathlib import Path
repository=Path('/workspace/automation-vscode');artifact=Path('/workspace/artifacts/automation-vscode-2.20.1-linux-x64.vsix');sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repository,text=True).strip();short=sha[:8]
root=Path('/workspace/port-acceptance')/('qualified-'+short);root.mkdir(exist_ok=False);extracted=root/'unpacked';installed=root/'extensions';home=root/'os-home';home.mkdir()
with zipfile.ZipFile(artifact) as z:
 assert z.testzip() is None
 for n in z.namelist():assert not Path(n).is_absolute() and '..' not in Path(n).parts
 for original,target in [('LICENSE','LICENSE.txt'),('COPYRIGHT','COPYRIGHT'),('ThirdPartyNotices.txt','ThirdPartyNotices.txt')]:assert z.read('extension/'+target)==(repository/original).read_bytes()
 assert not any('/.venv/' in n or (n.startswith('extension/bin/') and any(t in Path(n).name for t in ('rcc-','actions-runtime','action-server','agent-cli'))) for n in z.namelist())
 manifest=json.loads(z.read('extension/package.json'));assert (manifest['publisher'],manifest['name'],manifest['version'])==('automation-control-plane','automation-vscode','2.20.1')
 count=len(z.namelist());z.extractall(extracted)
env=os.environ.copy();env['HOME']=str(home);code='/workspace/port-acceptance/vscode/usr/share/code/bin/code';common=[code,'--user-data-dir='+str(root/'user-data'),'--extensions-dir='+str(installed)];results=[]
for argv in ([*common,'--install-extension',str(artifact)],[*common,'--list-extensions','--show-versions']):
 r=subprocess.run(argv,env=env,text=True,capture_output=True,timeout=60);results.append({'command':argv,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr});assert r.returncode==0,results
assert 'automation-control-plane.automation-vscode@2.20.1' in results[-1]['stdout']
extension=list(installed.glob('automation-control-plane.automation-vscode-*'));assert len(extension)==1;extension=extension[0];matching=0
with zipfile.ZipFile(artifact) as z:
 for name in z.namelist():
  if not name.startswith('extension/') or name.endswith('/'):continue
  relative=name[len('extension/'):]
  if relative=='package.json':
   actual=json.loads((extension/relative).read_text());expected=json.loads(z.read(name));assert actual.keys()-expected.keys()=={'__metadata'};actual.pop('__metadata');assert actual==expected
  else:assert (extension/relative).read_bytes()==z.read(name),relative
  matching+=1
report={'source_sha':sha,'artifact':str(artifact),'sha256':hashlib.sha256(artifact.read_bytes()).hexdigest(),'bytes':artifact.stat().st_size,'zip_entries':count,'license_matches_root':True,'bundled_managed_executables':False,'identity':{k:manifest[k] for k in ('publisher','name','version')},'qualified_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'toolchain':{'node':'24.21.0','python':'3.11.17','poetry':'2.1.3'},'extension_root':str(extension),'qualification_root':str(root),'installation':results,'matching_installed_runtime_files':matching,'installer_manifest_change':'__metadata only','extension_host':'blocked: SUID helper requires supported root-owned installation; no sandbox disabling applied'}
(root/'qualification.json').write_text(json.dumps(report,indent=2));Path('/workspace/artifacts/automation-vscode-2.20.1-provenance.json').write_text(json.dumps(report,indent=2));Path('/workspace/port-acceptance/active-qualification.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2),flush=True)
command=[sys.executable,str(repository/'sema4ai/tests/published_smoke.py'),'--rcc','/tmp/automation-vscode-port/rcc-linux64','--runtime','/tmp/automation-vscode-port/actions-runtime-1.0.4-linux64','--work-root',str(root),'--extension-root',str(extension)]
with (root/'live.log').open('w') as log:r=subprocess.run(command,env=os.environ.copy(),stdout=log,stderr=subprocess.STDOUT,timeout=1200)
print('FINAL_LIVE_EXIT',r.returncode,flush=True);raise SystemExit(r.returncode)
