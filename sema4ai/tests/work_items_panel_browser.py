"""Render/click the shipped panel with a simulated VS Code message host.

This is browser component qualification, NOT installed Extension Host or workload
acceptance. Chromium's sandbox stays enabled; no network other than loopback.
Run with an existing Playwright interpreter and --output <task-owned directory>.
"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import threading
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--extension-root', default=str(Path(__file__).resolve().parents[1]))
args = parser.parse_args()
root, out = Path(args.extension_root), Path(args.output)
out.mkdir(parents=True, exist_ok=False)
resources = root / 'resources/work-items'
stub = """window.sent=[];window.saved=undefined;window.acquireVsCodeApi=()=>({getState:()=>window.saved,setState:s=>window.saved=s,postMessage:m=>{window.sent.push(m);if(m.op==='restoreEditorDraft')setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'editorDraftRestore'}})),0);}});"""
theme = ''' :root{--vscode-font-size:13px;--vscode-font-family:Arial,sans-serif;--vscode-foreground:#cccccc;--vscode-editor-background:#1f1f1f;--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;--vscode-input-border:#3c3c3c;--vscode-button-background:#0078d4;--vscode-button-foreground:#ffffff;--vscode-button-secondaryBackground:#313131;--vscode-button-secondaryForeground:#cccccc;--vscode-button-hoverBackground:#026ec1;--vscode-panel-border:#343434;--vscode-focusBorder:#007fd4;--vscode-descriptionForeground:#9d9d9d;--vscode-list-activeSelectionBackground:#04395e;--vscode-list-activeSelectionForeground:#ffffff;--vscode-list-hoverBackground:#2a2d2e;--vscode-textLink-foreground:#4daafc;--vscode-editor-font-family:monospace;--vscode-errorForeground:#f48771;--vscode-badge-background:#313131;--vscode-badge-foreground:#cccccc;}'''
script = '\n'.join((resources / name).read_text() for name in ('form.js','editor.js','managed-editor.js'))
html = (resources/'panel.html').read_text().replace('{{nonce}}','preview').replace('{{style}}',(resources/'panel.css').read_text()+theme).replace('{{script}}',stub+script)
(out/'panel.html').write_text(html)
server = ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=str(out)))
threading.Thread(target=server.serve_forever,daemon=True).start()
report = {'source_sha':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(), 'extension':str(root),
          'scope':'Actual shipped DOM/CSS/scripts with a simulated VS Code message host. No Extension Host, workload, model or managed server acceptance.', 'checks':[]}
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,chromium_sandbox=True)
    report['browser'] = browser.version
    page = browser.new_page(viewport={'width':900,'height':800},device_scale_factor=1)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(f'http://127.0.0.1:{server.server_port}/panel.html');page.wait_for_timeout(100)
    def state(data):
        page.evaluate('(data)=>window.dispatchEvent(new MessageEvent("message",{data}))',data)
    state({'type':'state','mode':'file','package':'/synthetic/Invoice actions/package.yaml','items':[],'receipts':[]})
    page.locator('#name').fill('invoice')
    page.locator('#payload-fields').get_by_role('button',name='Add field',exact=True).click()
    assert page.locator('#payload-fields input').first.evaluate('(e)=>e===document.activeElement')
    page.locator('#payload-fields').get_by_role('textbox',name='Field name',exact=True).fill('value')
    page.locator('#payload-fields').get_by_role('combobox',name='Value type',exact=True).select_option('number')
    page.locator('#payload-fields').get_by_role('textbox',name='Field value',exact=True).fill('7')
    assert not page.locator('#payload-advanced').evaluate('(e)=>e.open')
    page.locator('#create').click()
    request=page.evaluate('window.sent.at(-1)');assert request['op']=='create' and request['payload']=={'value':7}
    report['checks'].append('Empty -> add field -> number 7 -> Create message, without JSON/schema; Add field focuses its name')
    input_item={'id':'devdata/work-items-in/invoice-123456789abc/work-items.json#0','name':'invoice-123456789abc','role':'input','payload':{'value':7,'customer':'Example customer'},'files':['invoice.txt'],'revision':'synthetic','state':'LOCAL_FIXTURE'}
    output={'id':'devdata/work-items-out/native-example/work-items.json#0','role':'output','payload':{'observed':7,'nested':{'count':1}},'files':['result.txt'],'state':'LOCAL_FIXTURE'}
    base={'type':'state','mode':'file','package':'/synthetic/Invoice actions/package.yaml','authority':'Local inputs and outputs for this package.','items':[input_item,output],'receipts':[]}
    state({**base,'selectId':input_item['id']})
    assert page.locator('#items button[aria-current="true"]').count()==1
    assert page.locator('button.primary:visible').count()==1
    assert page.locator('#run').bounding_box()['y']<150
    assert page.locator('#recover').is_hidden() and page.locator('#connect').is_hidden()
    assert page.locator('#last-execution').inner_text()=='Not run'
    page.screenshot(path=str(out/'input-original.png'),full_page=True)
    report['checks'].append('Selected input, one visible primary Run, secondary Debug, contextual maintenance and no false success')
    page.locator('#show-outputs').click();page.locator('#items button').first.click()
    assert page.locator('#payload-fields input, #payload-fields select, #payload-fields button').count()==0
    for name in ('run','debug','save','attach','create','payload-apply-json'):
        assert page.locator('#'+name).is_hidden(),name
    assert page.locator('button.primary:visible').count()==1
    page.screenshot(path=str(out/'output-original.png'),full_page=True)
    page.locator('#replay').click()
    assert page.locator('#selection-state').inner_text()=='Replay draft'
    assert page.locator('#payload-fields input').count()>0
    assert not any(m['op']=='replay' for m in page.evaluate('window.sent'))
    report['checks'].append('Read-only output has no form mutation controls; replay opens a draft without submitting')
    page.set_viewport_size({'width':480,'height':800})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(out/'draft-narrow-original.png'),full_page=True)
    page.set_viewport_size({'width':900,'height':800})
    page.evaluate('''()=>{document.querySelector('style').textContent+=' :root{--vscode-foreground:#333;--vscode-editor-background:#fff;--vscode-input-background:#fff;--vscode-input-foreground:#333;--vscode-input-border:#cecece;--vscode-button-secondaryBackground:#e5e5e5;--vscode-button-secondaryForeground:#333;--vscode-panel-border:#ddd;--vscode-descriptionForeground:#666;--vscode-list-activeSelectionBackground:#d6ebff;--vscode-list-activeSelectionForeground:#111;--vscode-badge-background:#eee;--vscode-badge-foreground:#333;--vscode-list-hoverBackground:#eee;--vscode-textLink-foreground:#006ab1;}';}''')
    page.screenshot(path=str(out/'draft-light-original.png'),full_page=True)
    report['checks'].append('480px responsive layout without horizontal overflow; light/dark theme token render')
    assert not errors, errors
    report['errors']=errors
    browser.close()
server.shutdown()
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
