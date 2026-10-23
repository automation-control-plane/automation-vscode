const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

test('Managed editor keeps queue/review/Run identity separate and gates controls by actual grants',()=>{
    const nodes=new Map(),messages=[],receivers=[];
    const ids=new Set([...fs.readFileSync('resources/work-items/panel.html','utf8').matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
    function element(){return {value:'',textContent:'',children:[],disabled:false,hidden:false,
        append(...values){this.children.push(...values);},replaceChildren(...values){this.children=values;},
        set innerHTML(_){assert.fail('Runtime content must never become HTML');}};}
    const document={getElementById(id){assert.ok(ids.has(id),'Panel must contain '+id);if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:element};
    const scope={document,acquireVsCodeApi:()=>({postMessage:message=>{messages.push(JSON.parse(JSON.stringify(message)));if(message.op==='restoreEditorDraft')receivers.forEach(callback=>callback({data:{type:'editorDraftRestore'}}));}}),window:{addEventListener:(_,callback)=>receivers.push(callback)}};
    vm.runInNewContext(fs.readFileSync('resources/work-items/form.js','utf8')+'\n'+fs.readFileSync('resources/work-items/editor.js','utf8')+'\n'+fs.readFileSync('resources/work-items/managed-editor.js','utf8'),scope);
    const get=document.getElementById;
    get('mode').value='managed';get('mode').onchange();
    assert.equal(get('local-root').hidden,true);assert.equal(get('managed-root').hidden,false);
    get('connect').onclick();assert.equal(messages.at(-1).op,'managed.connect');
    const queue={workspace_id:'workspace',deployment:{workspace_id:'workspace',deployment_id:'deployment',revision_id:'revision'},queue_id:'opaque-queue'};
    const review={proposal:{review_id:'review-identity',binding:{run_id:'run-identity',result_digest:'sha256:exact-result',scope:{deployment:queue.deployment}}},state:'pending',work_item_id:null};
    const state={type:'managed-state',endpoint:'https://runtime.example',workspace:'workspace',
        capabilities:{runtime_version:'1.1.0a13',sdk_version:'0.5.0a1',backend:'sqlite',modes:['reviewed'],operations:['queues.list','reviews.list','reviews.decide','runs.get'],permissions:['work_items.read','work_items.review']},
        queue:{queue,label:'Reviewed queue',mode:'reviewed',counts:{},permissions:['work_items.read','work_items.review']},queues:[],items:[],reviews:[review],review,pending:[]};
    for(const receive of receivers)receive({data:state});
    get('stage-prepare').onclick();get('managed-reviews').children[0].onclick();
    assert.equal(get('managed-inspect-view').hidden,false);
    assert.deepEqual(messages.at(-1),{op:'managed.review',id:'review-identity'});
    assert.equal(get('managed-items').children.length,0); // no invented pending business item
    assert.equal(get('managed-approve').disabled,false);
    assert.equal(get('managed-claim').disabled,true);
    assert.equal(get('managed-complete').disabled,true);
    get('managed-approve').onclick();assert.deepEqual(messages.at(-1),{op:'managed.decide',decision:'approve'});
    get('managed-runs').children[0].onclick();assert.deepEqual(messages.at(-1),{op:'managed.run',id:'run-identity'});
    for(const receive of receivers)receive({data:{...state,capabilities:undefined,queue:undefined,review:undefined,reviews:[],message:'Forbidden; reconnect'}});
    assert.equal(get('managed-approve').disabled,true);assert.match(get('managed-status').textContent,/Forbidden/);
    get('mode').value='published';get('mode').onchange();get('connect').onclick();
    assert.equal(messages.at(-1).op,'connect');assert.equal(get('local-root').hidden,false);
});
