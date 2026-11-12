const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
let decorate;
try{decorate=require('../vscode-client/out/runbookForms').decorateRunbookForm;}catch{}
test('Form presentation retains existing controls and scripts without creating executable operations',()=>{
 assert.equal(typeof decorate,'function');
 for(const name of ['mcp_server_form.html','submit_issue.html']){
  const source=fs.readFileSync(path.join(root,'vscode-client/templates',name),'utf8');
  const output=decorate(source,'body {color: red}', 'form {width: 100%}');
  assert.ok(output.includes('body {color: red}'));
  assert.deepEqual([...output.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]),[...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]));
  assert.deepEqual([...output.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]).filter(x=>x!=='automation-form-theme'),[...source.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]));
 }
});
