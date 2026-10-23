const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
let models=[],consent=true,requests=[],trusted=true;
const model={name:'Existing local test model',vendor:'existing-provider',sendRequest:async(messages,options)=>{
    requests.push({messages,options});return {text:(async function*(){yield '{"value":';yield '7}';})()};
}};
const vscode={workspace:{get isTrusted(){return trusted;}},lm:{selectChatModels:async()=>models},
    window:{showQuickPick:async items=>items[0],showInformationMessage:async(_,__,option)=>consent?option:undefined,
        withProgress:async(_,fn)=>fn({}, {onCancellationRequested:()=>({dispose(){}})})},
    ProgressLocation:{Notification:1},CancellationTokenSource:class{token={};cancel(){}dispose(){}},LanguageModelChatMessage:{User:content=>({role:'user',content})}};
const load=Module._load;Module._load=function(name,parent,main){if(name==='vscode'&&parent?.filename.endsWith('/workItemProposals.js'))return vscode;return load.call(this,name,parent,main);};
let propose;try{propose=require('../vscode-client/out/workItemProposals').proposeWorkItemPayload;}finally{Module._load=load;}
test('Existing model proposal requires user selection/consent and returns draft text without tools or execution',async()=>{
    await assert.rejects(propose(''),/Describe/);await assert.rejects(propose('A value field'),/No existing VS Code/);assert.equal(requests.length,0);
    models=[model];consent=false;assert.equal(await propose('A value field'),undefined);assert.equal(requests.length,0);
    consent=true;const result=await propose('A value field set to seven');assert.equal(result,'{"value":7}');assert.equal(requests.length,1);
    assert.deepEqual(requests[0].options.tools,[]);assert.match(requests[0].messages[0].content,/draft only/);
    assert.ok(!requests[0].messages[0].content.includes('/workspace/'));trusted=false;await assert.rejects(propose('A value field'),/trust/);
});
