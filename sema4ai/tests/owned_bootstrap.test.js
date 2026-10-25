const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('Every shipped bootstrap descriptor and RCC caller uses owned dependency/controller provenance',()=>{
    const files=fs.readdirSync('bin/create_env').filter(name=>/^conda.*\.yaml$/.test(name));assert.equal(files.length,4);
    for(const name of files){const text=fs.readFileSync(path.join('bin/create_env',name),'utf8');assert.match(text,/actions-http-helper==1\.0\.3/);assert.doesNotMatch(text,/sema4ai-(http-helper|common)/);}
    for(const file of ['src/sema4ai_code/rcc.py','src/sema4ai_code_debug_adapter/launch_process.py','vscode-client/out/rcc.js','vscode-client/out/clear.js']){
        const text=fs.readFileSync(file,'utf8');assert.match(text,/AutomationCode/);assert.doesNotMatch(text,/Sema4aiCode|rcc\.sema4aicode/);
    }
    const data=fs.readFileSync('src/sema4ai_code/data/data_server_connection.py','utf8');
    assert.match(data,/import actions_http/);assert.doesNotMatch(data,/sema4ai_http/);
    assert.doesNotMatch(fs.readFileSync('src/sema4ai_code/_lint.py','utf8'),/sema4ai\.common/);
});
