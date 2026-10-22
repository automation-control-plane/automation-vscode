import json,os,subprocess,sys
from pathlib import Path
root=Path('/workspace/port-acceptance/qualified-871151ce/automation-published-smoke-tgcynd46');child={**os.environ,**json.loads((root/'action-environment.json').read_text())}
if '--worker' not in sys.argv:raise SystemExit(subprocess.run([sys.executable,__file__,'--worker'],env=child).returncode)
extension=Path('/workspace/port-acceptance/qualified-871151ce/extensions/automation-control-plane.automation-vscode-2.20.1');sys.path.insert(0,str(extension/'src'));sys.path.insert(0,str(extension/'src/sema4ai_code/vendored'))
from sema4ai_code.action_server import ActionServer
from sema4ai_ls_core.config import Config
import yaml
class Provider:
 def __init__(self):self.config=Config();self.config.update({'sema4ai.actionServer.location':'/tmp/automation-vscode-port/actions-runtime-1.0.4-linux64'})
class Endpoint:pass
provider,endpoint=Provider(),Endpoint();server=ActionServer(provider,endpoint);templates=server.get_action_templates();assert templates.success,templates.message
out=Path('/workspace/port-acceptance/qualified-871151ce/templates');out.mkdir(exist_ok=False);report=[]
for template in templates.result:
 name=template['name'];created=server.create_action_package(str(out/name),name,'Template smoke '+name)
 row={'template':name,'success':created.success,'message':created.message}
 if created.success:
  package=yaml.safe_load((out/name/'package.yaml').read_text());deps=package['dependencies'].get('pypi',[]);row['actions_dependencies']=[d for d in deps if 'action' in d or 'work-items' in d];assert 'actions-core=1.0.3' in deps
 report.append(row);print(json.dumps(row),flush=True)
(out/'result.json').write_text(json.dumps(report,indent=2));assert all(r['success'] for r in report)
