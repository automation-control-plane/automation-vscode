const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const load=Module._load;Module._load=function(name,parent,main){if(name==='vscode'&&parent?.filename.endsWith('/actionInputsEditor.js'))return {};return load.call(this,name,parent,main);};
let read,apply;try{const api=require('../vscode-client/out/actionInputsEditor');read=api.readActionInputs;apply=api.applyActionInputEdits;}finally{Module._load=load;}
const fixture=version=>({inputs:[{inputName:'first',inputValue:{value:7,'vscode:request:oauth2':{login:{type:'OAuth2Secret',provider:'example',scopes:['read']}}},customEntry:'keep'}],metadata:{inputFileVersion:version,actionName:'consume',actionRelativePath:'actions.py',schemaDescription:['value: integer'],managedParamsSchemaDescription:{login:{type:'OAuth2Secret'}},kind:'action',actionSignature:'exact-signature',extra:'unchanged'},customTop:{preserve:true}});
test('V2 and V3 field edits preserve exact metadata, unknown fields and OAuth descriptors',()=>{
 for(const version of ['v2','v3']){
  const source=fixture(version),document=read(JSON.stringify(source),'consume');
  const edited=apply(document,[{index:0,inputName:'renamed',inputValue:{...source.inputs[0].inputValue,value:8,nested:[true,null,{name:'x'}]}}]);
  assert.deepEqual(edited.metadata,source.metadata);assert.deepEqual(edited.customTop,source.customTop);assert.equal(edited.inputs[0].customEntry,'keep');
  assert.deepEqual(edited.inputs[0].inputValue['vscode:request:oauth2'],source.inputs[0].inputValue['vscode:request:oauth2']);assert.equal(edited.inputs[0].inputValue.value,8);assert.equal(source.inputs[0].inputValue.value,7);
 }
});
test('Input edits enforce unique variant names and valid existing indices without rewriting unsupported files',()=>{
 const source=fixture('v3'),document=read(JSON.stringify(source),'consume');
 assert.throws(()=>apply(document,[{index:0,inputName:'same',inputValue:{}},{index:null,inputName:'same',inputValue:{}}]),/unique/);
 assert.throws(()=>apply(document,[{index:9,inputName:'new',inputValue:{}}]),/index/);
 assert.throws(()=>apply(document,[]),/one input/);
 assert.throws(()=>read('{"value":7}','consume'),/V2 or V3/);
 assert.throws(()=>read(JSON.stringify({...source,inputs:[{inputName:'x',inputValue:9007199254740992}]}),'consume'),/exact supported range/);
 assert.throws(()=>read(JSON.stringify(source),'different'),/different Action/);
});
test('Adding and reordering named cases preserves the run loader wrapper contract',()=>{
 const document=read(JSON.stringify(fixture('v2')),'consume');
 const edited=apply(document,[{index:null,inputName:'new',inputValue:{nested:[1,2]}},{index:0,inputName:'first',inputValue:{value:9}}]);
 assert.deepEqual(edited.inputs.map(entry=>entry.inputName),['new','first']);assert.equal(edited.metadata.inputFileVersion,'v2');assert.deepEqual(edited.inputs[0].inputValue,{nested:[1,2]});
});
test('The form rejects oversized UTF-8 files before parsing or normalizing metadata',()=>{assert.throws(()=>read(' '.repeat(2*1024*1024+1),'consume'),/2 MiB/);});
