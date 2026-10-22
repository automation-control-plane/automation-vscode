import json,os,subprocess,sys
from pathlib import Path
q=json.loads(Path('/workspace/port-acceptance/active-qualification.json').read_text());qr=Path(q['qualification_root']);live=Path(next(l.split('=',1)[1] for l in (qr/'live.log').read_text().splitlines() if l.startswith('SMOKE_ROOT=')))
if '--worker' not in sys.argv:
 child={**os.environ,**json.loads((live/'action-environment.json').read_text())};raise SystemExit(subprocess.run([sys.executable,__file__,'--worker'],env=child).returncode)
extension=Path(q['extension_root']);sys.path.insert(0,str(extension/'src'));sys.path.insert(0,str(extension/'src/sema4ai_code/vendored'))
from sema4ai_code.rcc import Rcc
from sema4ai_ls_core.config import Config
class Provider:
 def __init__(self):self.config=Config();self.config.update({'sema4ai.rcc.location':'/tmp/automation-vscode-port/rcc-linux64'})
provider=Provider();rcc=Rcc(provider);templates=rcc.get_template_names();assert templates.success,templates.message
out=qr/'robot-templates';out.mkdir(exist_ok=False);rows=[]
for item in templates.result:
 template=item['name'];created=rcc.create_robot(template,str(out/template));rows.append({'template':template,'success':created.success,'message':created.message});print(template,created.success,flush=True)
(out/'result.json').write_text(json.dumps(rows,indent=2));assert all(row['success'] for row in rows)
