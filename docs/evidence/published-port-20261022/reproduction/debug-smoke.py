import json,sys,subprocess
from pathlib import Path
extension=Path('/workspace/port-acceptance/qualified-871151ce/extensions/automation-control-plane.automation-vscode-2.20.1')
sys.path.insert(0,str(extension/'src'));sys.path.insert(0,str(extension/'src/sema4ai_code/vendored'));sys.path.insert(0,'/workspace/automation-vscode/sema4ai/tests')
from sema4ai_code.compute_launch import compute_robot_launch_from_robocorp_code_launch
from dap_smoke import debug_workload
root=Path('/workspace/port-acceptance/qualified-871151ce/automation-published-smoke-tgcynd46');out=Path('/workspace/port-acceptance/qualified-871151ce/debug');out.mkdir(exist_ok=False)
report={'scope':'Real installed extension compute_launch profiles executed through debugpy DAP. Console changed to internalConsole for this headless client; not VS Code UI debug acceptance.','source_sha':'871151ceafc7b07dc59f7715d9c4f70153734794','vsix_sha256':'daa4c3ffefb635358c8e945e82034eb10475e75ca4e5ee92b1618b7637ab34b0','checks':{}}
for kind in ('action','robot'):
 env=json.loads((root/(kind+'-environment.json')).read_text());package=root/'workspace'/(kind+'-package');source=package/('smoke_actions.py' if kind=='action' else 'smoke_tasks.py')
 options={'package':str(package/'package.yaml'),'action_name':'welcome','uri':source.as_uri(),'json_input':str(package/'input.json')} if kind=='action' else {'task':'Smoke task','robot':str(package/'robot.yaml')}
 computed=compute_robot_launch_from_robocorp_code_launch(name='Installed '+kind+' smoke',request='launch',task=None,robot=None,additional_pythonpath_entries=[],env=env,python_exe=env['PYTHON_EXE'],**{k:v for k,v in options.items() if k not in ('task','robot')}) if kind=='action' else compute_robot_launch_from_robocorp_code_launch(name='Installed robot smoke',request='launch',additional_pythonpath_entries=[],env=env,python_exe=env['PYTHON_EXE'],**options)
 assert computed['success'],computed
 profile=computed['result'];line=next(i for i,text in enumerate(source.read_text().splitlines(),1) if ('greeting =' if kind=='action' else 'message =') in text)
 result=debug_workload(python=profile['python'],cwd=Path(profile['cwd']),env=profile['env'],source=source,line=line,args=profile['args'],program=Path(profile['program']) if profile.get('program') else None,module=profile.get('module'),log=out/(kind+'-adapter.log'))
 packages=['actions-core','actions-work-items','debugpy'] if kind=='action' else ['robocorp-tasks','debugpy']
 versions=json.loads(subprocess.check_output([env['PYTHON_EXE'],'-c','import importlib.metadata as m,json,sys;print(json.dumps({p:m.version(p) for p in sys.argv[1:]}))',*packages],env=env,text=True))
 if kind=='action':assert versions['actions-core']=='1.0.3' and versions['actions-work-items']=='0.4.4'
 report['checks'][kind]={'debug':result,'profile':{k:profile.get(k) for k in ('type','python','program','module','args','cwd')},'versions':versions,'home':env['ROBOCORP_HOME'],'RCC_VERSION':env['RCC_VERSION']}
(out/'result.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
