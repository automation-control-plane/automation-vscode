const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

function editor(initialState) {
    const nodes=new Map(),messages=[],receivers=[];
    const ids=new Set([...fs.readFileSync('resources/work-items/panel.html','utf8').matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
    function element(tag){return {tag,value:'',textContent:'',children:[],disabled:false,hidden:false,
        append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},
        set innerHTML(_){assert.fail('Business fields must not become HTML');}};}
    const document={getElementById(id){assert.ok(ids.has(id),'Panel must contain '+id);if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:element};
    const scope={document,acquireVsCodeApi:()=>({postMessage:message=>{messages.push(JSON.parse(JSON.stringify(message)));if(message.op==='restoreEditorDraft')receivers.forEach(callback=>callback({data:{type:'editorDraftRestore',state:initialState}}));}}),window:{addEventListener:(_,callback)=>receivers.push(callback)}};
    vm.runInNewContext(fs.readFileSync('resources/work-items/form.js','utf8')+'\n'+fs.readFileSync('resources/work-items/editor.js','utf8')+'\n'+fs.readFileSync('resources/work-items/managed-editor.js','utf8'),scope);
    return {get:document.getElementById,messages,receive:data=>receivers.forEach(callback=>callback({data}))};
}
function fieldGroup(env){return env.get('payload-fields').children[0];}
function add(env,name,kind,value){
    fieldGroup(env).children.find(node=>node.textContent==='Add field').onclick();
    let row=fieldGroup(env).children.filter(node=>node.className==='work-item-form-field').at(-1);
    row.children[0].value=name;row.children[0].oninput();
    row.children[1].value=kind;row.children[1].onchange();
    row=fieldGroup(env).children.filter(node=>node.className==='work-item-form-field').at(-1);
    if(kind==='string'||kind==='number'){row.children[2].value=String(value);row.children[2].oninput();}
    return row;
}

test('Empty input -> field/value form -> create -> save/debug -> output without JSON or schema editing',()=>{
    const e=editor();assert.equal(e.messages.find(message=>message.op==='mode').mode,'file');
    add(e,'value','number',7);
    e.get('create').onclick();assert.deepEqual(e.messages.at(-1).payload,{value:7});
    e.receive({type:'state',mode:'file',package:'/workspace/action/package.yaml',selectId:'input#0',items:[{id:'input#0',name:'invoice',role:'input',payload:{value:7},files:['invoice.txt'],revision:'abc',state:'LOCAL_FIXTURE'}],receipts:[]});
    const row=fieldGroup(e).children.find(node=>node.className==='work-item-form-field');
    row.children[2].value='8';row.children[2].oninput();
    e.get('debug').onclick();assert.equal(e.messages.at(-1).op,'debug');assert.deepEqual(e.messages.at(-1).payload,{value:8});assert.deepEqual(e.messages.at(-1).parameters,{});
    e.get('files').children[0].onclick();assert.equal(e.messages.at(-1).op,'download');
    e.receive({type:'state',mode:'file',package:'/workspace/action/package.yaml',items:[{id:'input#0',name:'invoice',role:'input',payload:{value:8},files:[],revision:'new',state:'LOCAL_FIXTURE'},
        {id:'devdata/work-items-out/native-run1/work-items.json#0',role:'output',payload:{observed:8},files:[],state:'LOCAL_FIXTURE'}],receipts:[{id:'run1',mode:'file',input:'input#0',state:'EXITED',exit_code:0}]});
    const card=e.get('receipts').children[0];assert.equal(card.children[0].textContent,'Succeeded · exit 0');card.children[2].onclick();
    assert.equal(e.get('save').disabled,true);assert.equal(e.get('payload-apply-json').disabled,true);
});

test('Duplicate form names block submission; nested objects/arrays and own names are authored through controls',()=>{
    const e=editor();add(e,'value','number',7);const duplicate=add(e,'value','string','duplicate');
    const count=e.messages.length;e.get('create').onclick();assert.equal(e.messages.length,count);assert.match(e.get('validation').textContent,/Duplicate/);
    duplicate.children[0].value='description';duplicate.children[0].oninput();
    add(e,'__proto__','string','business data');
    const nested=add(e,'nested','object');
    const group=nested.children[2];group.children.find(node=>node.textContent==='Add field').onclick();
    const inner=fieldGroup(e).children.filter(node=>node.className==='work-item-form-field').at(-1).children[2].children[0];
    inner.children[0].value='enabled';inner.children[0].oninput();inner.children[1].value='boolean';inner.children[1].onchange();
    e.get('create').onclick();const payload=e.messages.at(-1).payload;
    assert.equal(payload.nested.enabled,false);assert.ok(Object.hasOwn(payload,'__proto__'));assert.equal(payload.__proto__,'business data');assert.equal({}.polluted,undefined);
    const array=add(e,'lines','array');array.children[2].children.find(node=>node.textContent==='Add item').onclick();
    e.get('create').onclick();assert.deepEqual(e.messages.at(-1).payload.lines,['']);
});

test('AI proposal is review/apply only; malformed proposals and mode changes cannot apply to another draft',()=>{
    const e=editor();const business=()=>e.messages.filter(message=>message.op!=='editorDraftState').length;const before=business();
    e.receive({type:'payload-proposal',mode:'file',json:'{"value":7,"nested":[true,null]}'});
    assert.equal(business(),before);assert.equal(e.get('proposal-review').hidden,false);
    e.get('apply-proposal').onclick();assert.equal(business(),before);
    e.get('create').onclick();assert.deepEqual(e.messages.at(-1).payload,{value:7,nested:[true,null]});
    e.receive({type:'payload-proposal',mode:'file',json:'{"value":1,"value":2}'});
    assert.equal(e.get('proposal-review').hidden,true);assert.match(e.get('proposal-status').textContent,/Duplicate/);
    e.receive({type:'payload-proposal',mode:'sqlite',json:'{"value":10}'});e.get('apply-proposal').onclick();assert.match(e.get('proposal-status').textContent,/original draft/);
});

test('Optional advanced JSON has faithful roundtrip and rejects malformed edits without replacing the form',()=>{
    const e=editor();add(e,'value','number',7);
    e.get('payload').value='{"value":8,"array":[true,null,{"text":"hello"}]}';e.get('payload-apply-json').onclick();
    e.get('create').onclick();assert.deepEqual(e.messages.at(-1).payload,{value:8,array:[true,null,{text:'hello'}]});
    e.get('payload').value='{"value":1,"value":2}';e.get('payload-apply-json').onclick();assert.match(e.get('validation').textContent,/Duplicate/);
    e.get('create').onclick();assert.equal(e.messages.at(-1).payload.value,8);
});

test('Metadata refresh preserves an unsaved form draft and its original conflict revision',()=>{
    const e=editor();add(e,'value','number',7);
    e.receive({type:'state',mode:'file',package:'/workspace/action/package.yaml',contract:{value:'integer'},items:[],receipts:[]});
    e.get('create').onclick();assert.equal(e.messages.at(-1).payload.value,7);
    e.receive({type:'state',mode:'file',selectId:'input#0',package:'/workspace/action/package.yaml',items:[{id:'input#0',role:'input',payload:{value:7},files:[],revision:'original'}],receipts:[]});
    const row=fieldGroup(e).children[0];row.children[2].value='8';row.children[2].oninput();
    e.receive({type:'state',mode:'file',package:'/workspace/action/package.yaml',contract:{value:'integer'},items:[{id:'input#0',role:'input',payload:{value:99},files:[],revision:'external-change'}],receipts:[]});
    e.get('save').onclick();assert.equal(e.messages.at(-1).payload.value,8);assert.equal(e.messages.at(-1).revision,'original');
    e.get('reload-payload').onclick();e.get('save').onclick();assert.equal(e.messages.at(-1).payload.value,99);assert.equal(e.messages.at(-1).revision,'external-change');
});

test('Closing/reopening restores unsaved name, fields and invalid values using editor state only',()=>{
    const first=editor();first.get('name').value='unsaved-invoice';first.get('name').oninput();
    add(first,'value','number','not-a-number');
    const state=first.messages.filter(message=>message.op==='editorDraftState').at(-1).state;
    const reopened=editor(state);
    reopened.receive({type:'state',mode:'file',package:'/workspace/action/package.yaml',items:[],receipts:[]});
    assert.equal(reopened.get('name').value,'unsaved-invoice');assert.match(reopened.get('validation').textContent,/valid number/);
    const row=fieldGroup(reopened).children[0];assert.equal(row.children[0].value,'value');assert.equal(row.children[2].value,'not-a-number');
    assert.ok(reopened.messages.every(message=>!['create','save','run','debug','proposePayload','managed.connect','managed.enqueue','managed.claim'].includes(message.op)));
    row.children[2].value='7';row.children[2].oninput();reopened.get('create').onclick();assert.equal(reopened.messages.at(-1).payload.value,7);
});

test('Closing/reopening keeps an existing-item draft bound to its original saved revision',()=>{
    const first=editor();first.receive({type:'state',mode:'file',selectId:'input#0',items:[{id:'input#0',role:'input',payload:{value:7},files:[],revision:'original'}],receipts:[]});
    const row=fieldGroup(first).children[0];row.children[2].value='8';row.children[2].oninput();
    const state=first.messages.filter(message=>message.op==='editorDraftState').at(-1).state;
    const reopened=editor(state);reopened.receive({type:'state',mode:'file',items:[{id:'input#0',role:'input',payload:{value:99},files:[],revision:'external-change'}],receipts:[]});
    reopened.get('save').onclick();assert.equal(reopened.messages.at(-1).payload.value,8);assert.equal(reopened.messages.at(-1).revision,'original');
});

test('Selection scopes results, sidebar state and genuinely read-only output controls',()=>{
    const e=editor();
    const input={id:'in#0',name:'invoice-123456789abc',role:'input',payload:{value:7},files:[],revision:'a',state:'LOCAL_FIXTURE'};
    const output={id:'devdata/work-items-out/native-r1/work-items.json#0',role:'output',payload:{observed:7,nested:{value:8}},files:['result.txt'],state:'LOCAL_FIXTURE'};
    e.receive({type:'state',mode:'file',selectId:input.id,items:[input,output],receipts:[{id:'r1',input:input.id,state:'EXITED',exit_code:0}]});
    assert.equal(e.get('items').children.length,1);assert.equal(e.get('items').children[0].ariaCurrent,'true');
    assert.equal(e.get('items').children[0].children[0].textContent,'invoice');
    assert.equal(e.get('run').hidden,false);assert.equal(e.get('recover').hidden,true);assert.equal(e.get('connect').hidden,true);
    assert.equal(e.get('last-execution').textContent,'Succeeded · exit 0');
    e.get('new').onclick();assert.equal(e.get('last-execution').textContent,'Not run');
    assert.equal(e.get('run').hidden,true);assert.equal(e.get('create').hidden,false);
    e.get('show-outputs').onclick();e.get('items').children[0].onclick();
    for(const id of ['run','debug','create','save','attach','reload-payload','parameters-section','proposal-tools'])assert.equal(e.get(id).hidden,true,id);
    const all=node=>[node,...node.children.flatMap(all)];
    assert.ok(all(e.get('payload-fields')).every(node=>!['button','input','select'].includes(node.tag)));
    assert.equal(e.get('replay').className,'primary');assert.equal(e.get('last-execution').textContent,'Succeeded · exit 0');
});

test('Replay opens an editable persistent draft; submission copies source attachments without editing the source',()=>{
    const e=editor();const source={id:'completed-source',queue_name:'input.outputs',payload:{value:7},files:['proof.txt'],state:'COMPLETED'};
    e.receive({type:'state',mode:'sqlite',selectId:source.id,items:[source],receipts:[]});
    const before=e.messages.filter(message=>message.op==='replay').length;
    e.get('replay').onclick();assert.equal(e.messages.filter(message=>message.op==='replay').length,before);
    assert.equal(e.get('selection-state').textContent,'Replay draft');assert.equal(e.get('files').children[0].textContent,'proof.txt');
    const row=fieldGroup(e).children[0];row.children[2].value='8';row.children[2].oninput();
    const saved=e.messages.filter(message=>message.op==='editorDraftState').at(-1).state;
    const reopened=editor(saved);reopened.receive({type:'state',mode:'sqlite',items:[source],receipts:[]});
    reopened.get('create').onclick();const request=reopened.messages.at(-1);
    assert.equal(request.op,'replay');assert.equal(request.id,source.id);assert.deepEqual(request.payload,{value:8});assert.deepEqual(request.source_payload,{value:7});
    assert.deepEqual(source.payload,{value:7});
});

test('New draft survives navigation and queue switches; discard requires host confirmation',()=>{
    const e=editor();add(e,'value','number',7);e.get('name').value='kept';e.get('name').oninput();
    e.receive({type:'state',mode:'file',items:[{id:'saved',role:'input',payload:{value:99},files:[],revision:'a'}],receipts:[]});
    e.get('items').children[0].onclick();e.get('new').onclick();e.get('create').onclick();assert.equal(e.messages.at(-1).payload.value,7);assert.equal(e.get('name').value,'kept');
    e.get('discard-draft').onclick();assert.equal(e.messages.at(-1).op,'discardDraft');e.get('create').onclick();assert.equal(e.messages.at(-1).payload.value,7);
    e.receive({type:'draftDiscarded'});e.get('create').onclick();assert.deepEqual(e.messages.at(-1).payload,{});
    e.get('mode').value='sqlite';e.get('mode').onchange();add(e,'value','number',1);
    e.get('queue').value='second';e.get('apply-queue').onclick();e.get('create').onclick();assert.deepEqual(e.messages.at(-1).payload,{});
    e.get('queue').value='input';e.get('apply-queue').onclick();e.get('create').onclick();assert.equal(e.messages.at(-1).payload.value,1);
});

test('Runbook stage navigation never executes a workload and keeps the selected output immutable',()=>{
    const e=editor();
    const output={id:'out#0',role:'output',payload:{observed:7,description:'<script>not markup</script>'},files:['result.txt'],state:'COMPLETED'};
    e.receive({type:'state',mode:'file',package:'/workspace/action/package.yaml',selectId:output.id,items:[output],receipts:[]});
    assert.equal(e.get('stage-inspect').ariaCurrent,'step');
    assert.equal(e.get('result-view').hidden,false);
    const before=e.messages.filter(message=>message.op!=='editorDraftState').length;
    e.get('stage-prepare').onclick();e.get('tab-files').onclick();e.get('stage-run').onclick();
    assert.equal(e.messages.filter(message=>message.op!=='editorDraftState').length,before);
    assert.equal(e.get('run').hidden,true);
    assert.equal(e.get('payload-apply-json').disabled,true);
    const all=node=>[node,...node.children.flatMap(all)];
    assert.ok(all(e.get('result-data')).some(node=>node.textContent==='<script>not markup</script>'));
});

test('Runbook result and context follow selected receipt, never another input success',()=>{
    const e=editor();
    const first={id:'input-a',role:'input',payload:{value:7},files:[],state:'LOCAL_FIXTURE'};
    const second={id:'input-b',role:'input',payload:{value:9},files:[],state:'LOCAL_FIXTURE'};
    const output={id:'devdata/work-items-out/native-r1/work-items.json#0',role:'output',payload:{observed:7},files:[],state:'LOCAL_FIXTURE'};
    e.receive({type:'state',mode:'file',selectId:first.id,items:[first,second,output],receipts:[{id:'r1',input:first.id,state:'EXITED',exit_code:0,created_at:'2026-10-23T10:00:00Z',updated_at:'2026-10-23T10:00:12Z'}]});
    assert.match(e.get('context-receipt').textContent,/r1/);
    assert.equal(e.get('result-outcome').textContent,'Completed successfully');
    e.get('items').children[1].onclick();
    assert.equal(e.get('context-receipt').textContent,'No execution receipt');
    assert.equal(e.get('result-outcome').textContent,'Ready to run');
    assert.equal(e.get('result-data').children.length,0);
});

for (const state of ['IN_PROGRESS', 'RESERVED']) test(`${state} local queue items identify the SDK claim and cannot be launched again`,()=>{
    const e=editor();
    e.receive({type:'state',mode:'sqlite',selectId:'reserved-123',items:[{id:'reserved-123',queue_name:'input',state,payload:{value:7},files:[]}],receipts:[]});
    assert.equal(e.get('run').disabled,true);assert.equal(e.get('debug').disabled,true);
    assert.equal(e.get('selection-state').textContent,'In progress');
    assert.match(e.get('selection-note').textContent,/reserved-123/);
    assert.match(e.get('selection-note').textContent,/SDK/);
    assert.match(e.get('selection-note').textContent,/30 minutes/);
});

test('Runbook presentation state is restored without losing dirty input fields',()=>{
    const e=editor();add(e,'value','number',7);e.get('tab-files').onclick();
    const state=e.messages.filter(message=>message.op==='editorDraftState').at(-1).state;
    assert.equal(state.runbookView.tab,'files');
    const reopened=editor(state);reopened.receive({type:'state',mode:'file',items:[],receipts:[]});
    assert.equal(reopened.get('files-view').hidden,false);
    reopened.get('create').onclick();assert.deepEqual(reopened.messages.at(-1).payload,{value:7});
});

test('Returning from debug derives Inspect from a newly completed receipt, including legacy saved views',()=>{
    const input={id:'input-a',role:'input',payload:{value:7},files:[],revision:'a',state:'LOCAL_FIXTURE'};
    const stateFor=state=>({type:'state',mode:'file',selectId:input.id,items:[input],receipts:[{id:'debug-1',input:input.id,state,exit_code:state==='EXITED'?0:undefined}]});
    const first=editor();first.receive(stateFor('STARTED'));
    assert.equal(first.get('stage-run').ariaCurrent,'step');
    const saved=first.messages.filter(message=>message.op==='editorDraftState').at(-1).state;
    for (const state of [saved,{...saved,receiptKey:undefined}]) {
        const reopened=editor(state);reopened.receive(stateFor('EXITED'));
        assert.equal(reopened.get('stage-inspect').ariaCurrent,'step');
        assert.equal(reopened.get('stage-run').ariaCurrent,'false');
        assert.equal(reopened.get('result-outcome').textContent,'Completed successfully');
        assert.ok(reopened.messages.every(message=>!['run','debug'].includes(message.op)));
    }
});

test('Restoring the same completed receipt preserves explicit Prepare and Files navigation',()=>{
    const input={id:'input-a',role:'input',payload:{value:7},files:[],revision:'a',state:'LOCAL_FIXTURE'};
    const state={type:'state',mode:'file',selectId:input.id,items:[input],receipts:[{id:'run-1',input:input.id,state:'EXITED',exit_code:0}]};
    const first=editor();first.receive(state);first.get('stage-prepare').onclick();first.get('tab-files').onclick();
    const saved=first.messages.filter(message=>message.op==='editorDraftState').at(-1).state;
    const reopened=editor(saved);reopened.receive(state);
    assert.equal(reopened.get('stage-prepare').ariaCurrent,'step');
    assert.equal(reopened.get('files-view').hidden,false);
    reopened.receive(state);
    assert.equal(reopened.get('stage-prepare').ariaCurrent,'step');
});

test('Output record arrays are readable tables derived only from actual payload columns',()=>{
    const e=editor();const output={id:'out#0',role:'output',payload:{records:[{reference:'A-1',expected:7,actual:7},{reference:'B-2',expected:8,actual:9}]},files:[],state:'COMPLETED'};
    e.receive({type:'state',mode:'file',selectId:output.id,items:[output],receipts:[]});
    const all=node=>[node,...node.children.flatMap(all)];const rows=all(e.get('result-data'));
    assert.ok(rows.some(node=>node.tag==='th' && node.textContent==='reference'));
    assert.ok(rows.some(node=>node.tag==='td' && node.textContent==='B-2'));
    assert.ok(rows.every(node=>!['invoice','Matched','Needs review'].includes(node.textContent)));
});
