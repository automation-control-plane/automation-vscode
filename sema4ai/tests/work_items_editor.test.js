const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

function editor() {
    const nodes=new Map(),messages=[],receivers=[];
    function element(){return {value:'',textContent:'',children:[],disabled:false,hidden:false,
        append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},
        set innerHTML(_){assert.fail('Business fields must not become HTML');}};}
    const document={getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:element};
    const scope={document,acquireVsCodeApi:()=>({postMessage:message=>messages.push(JSON.parse(JSON.stringify(message)))}),window:{addEventListener:(_,callback)=>receivers.push(callback)}};
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
    const e=editor();assert.equal(e.messages[0].op,'refresh');
    add(e,'value','number',7);
    e.get('create').onclick();assert.deepEqual(e.messages.at(-1).payload,{value:7});
    e.receive({type:'state',mode:'file',package:'/workspace/action/package.yaml',selectId:'input#0',items:[{id:'input#0',name:'invoice',role:'input',payload:{value:7},files:['invoice.txt'],revision:'abc',state:'LOCAL_FIXTURE'}],receipts:[]});
    const row=fieldGroup(e).children.find(node=>node.className==='work-item-form-field');
    row.children[2].value='8';row.children[2].oninput();
    e.get('debug').onclick();assert.equal(e.messages.at(-1).op,'debug');assert.deepEqual(e.messages.at(-1).payload,{value:8});assert.deepEqual(e.messages.at(-1).parameters,{});
    e.get('files').children[0].onclick();assert.equal(e.messages.at(-1).op,'download');
    e.receive({type:'state',mode:'file',package:'/workspace/action/package.yaml',items:[{id:'input#0',name:'invoice',role:'input',payload:{value:8},files:[],revision:'new',state:'LOCAL_FIXTURE'},
        {id:'devdata/work-items-out/native-run1/work-items.json#0',role:'output',payload:{observed:8},files:[],state:'LOCAL_FIXTURE'}],receipts:[{id:'run1',mode:'file',input:'input#0',state:'EXITED',exit_code:0}]});
    const card=e.get('receipts').children[0];assert.equal(card.children[0].textContent,'file · EXITED · exit 0');card.children[2].onclick();
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
    const e=editor();const before=e.messages.length;
    e.receive({type:'payload-proposal',mode:'file',json:'{"value":7,"nested":[true,null]}'});
    assert.equal(e.messages.length,before);assert.equal(e.get('proposal-review').hidden,false);
    e.get('apply-proposal').onclick();assert.equal(e.messages.length,before);
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
