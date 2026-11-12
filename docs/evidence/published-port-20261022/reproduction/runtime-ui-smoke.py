import hashlib,json,os,socket,subprocess,sys,time,urllib.request,uuid
from pathlib import Path
sys.path.insert(0,'/workspace/port-acceptance/qualified-871151ce/extensions/automation-control-plane.automation-vscode-2.20.1/src')
sys.path.insert(0,'/workspace/port-acceptance/qualified-871151ce/extensions/automation-control-plane.automation-vscode-2.20.1/src/sema4ai_code/vendored')
from sema4ai_code.playwright import robocorp_browser
root=Path('/workspace/port-acceptance/qualified-871151ce/automation-published-smoke-tgcynd46');out=Path('/workspace/port-acceptance/qualified-871151ce/runtime-ui');out.mkdir(exist_ok=False)
env={**os.environ,**json.loads((root/'action-environment.json').read_text()),'TMPDIR':'/workspace/port-acceptance/tmp','RC_ADD_SHUTDOWN_API':'1'}
with socket.socket() as probe:probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
data=Path(env['ACTIONS_HOME'])/'action-server'/('ui-smoke-'+uuid.uuid4().hex[:12]);base=f'http://127.0.0.1:{port}'
command=['/tmp/automation-vscode-port/actions-runtime-1.0.4-linux64','start','--address=127.0.0.1',f'--port={port}','--min-processes=1','--max-processes=2',f'--datadir={data}']
log=(out/'runtime.log').open('w');process=subprocess.Popen(command,cwd=root/'workspace/action-package',env=env,stdout=log,stderr=subprocess.STDOUT)
report={'scope':'Actual published Runtime web UI and synthetic HTTP action result; not VS Code Extension Host UI acceptance.','command':command,'source_sha':'871151ceafc7b07dc59f7715d9c4f70153734794','vsix_sha256':'daa4c3ffefb635358c8e945e82034eb10475e75ca4e5ee92b1618b7637ab34b0'}
try:
 deadline=time.monotonic()+180
 while True:
  try:
   with urllib.request.urlopen(base+'/openapi.json',timeout=1) as response:schema=json.load(response)
   paths=[p for p in schema['paths'] if 'welcome' in p]
   if paths:break
  except OSError:pass
  assert process.poll() is None,'Runtime stopped before ready'
  assert time.monotonic()<deadline,'Runtime did not become ready'
  time.sleep(.2)
 request=urllib.request.Request(base+paths[0],data=b'{"name":"Screenshot Dakota"}',headers={'Content-Type':'application/json'},method='POST')
 with urllib.request.urlopen(request,timeout=60) as response:
  result=json.load(response);run_id=response.headers.get('X-Action-Server-Run-Id')
 assert result=='Hello Screenshot Dakota',result
 with urllib.request.urlopen(base+'/config',timeout=5) as response:config=json.load(response)
 assert config['version']=='1.0.4'
 os.environ['AUTOMATION_BROWSER_EXECUTABLE']='/usr/bin/chromium'
 robocorp_browser.configure(headless=True,install=False)
 page=robocorp_browser.page();page.set_viewport_size({'width':1440,'height':1000})
 page.goto(base+'/runs',wait_until='networkidle',timeout=30000)
 page.get_by_text('welcome',exact=False).first.wait_for(timeout=20000)
 page.screenshot(path=str(out/'runtime-ui-original.png'),full_page=True)
 texts=page.locator('body').inner_text();report.update(runtime_version=config['version'],action_result=result,run_id=run_id,ui_url=page.url,ui_text=texts[:6000])
 # Box existing UI content only; do not insert any claim or generated result.
 target=page.get_by_text('welcome',exact=False).first
 assert target.count()>0
 target.evaluate("e=>{const r=(e.closest('tr')||e).getBoundingClientRect();const box=document.createElement('div');box.id='evidence-box';Object.assign(box.style,{position:'fixed',left:(r.x+2)+'px',top:(r.y+2)+'px',width:(r.width-4)+'px',height:(r.height-4)+'px',border:'4px solid #d12c2c',boxSizing:'border-box',zIndex:'2147483647',pointerEvents:'none'});document.body.appendChild(box);}")
 page.screenshot(path=str(out/'runtime-ui-boxed.png'),full_page=True)
 report['screenshots']={name:hashlib.sha256((out/name).read_bytes()).hexdigest() for name in ('runtime-ui-original.png','runtime-ui-boxed.png')}
 print(json.dumps(report,indent=2))
finally:
 try:robocorp_browser.browser().close()
 except Exception:pass
 try:urllib.request.urlopen(urllib.request.Request(base+'/api/shutdown/',data=b'{}',method='POST'),timeout=5).close()
 except OSError:pass
 try:process.wait(timeout=15)
 except subprocess.TimeoutExpired:process.terminate();process.wait(timeout=10);report['forced_termination']=True
 report['runtime_exit_code']=process.returncode;log.close();(out/'result.json').write_text(json.dumps(report,indent=2))
