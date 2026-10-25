const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

function createEditor(){
    const nodes=new Map(),messages=[],receivers=[];
    const ids=new Set([...fs.readFileSync('resources/work-items/panel.html','utf8').matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
    function element(){return {value:'',textContent:'',children:[],disabled:false,hidden:false,
        append(...values){this.children.push(...values);},replaceChildren(...values){this.children=values;},
        set innerHTML(_){assert.fail('Runtime content must never become HTML');}};}
    const document={getElementById(id){assert.ok(ids.has(id),'Panel must contain '+id);if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:element};
    const scope={document,acquireVsCodeApi:()=>({postMessage:message=>{messages.push(JSON.parse(JSON.stringify(message)));if(message.op==='restoreEditorDraft')receivers.forEach(callback=>callback({data:{type:'editorDraftRestore'}}));}}),window:{addEventListener:(_,callback)=>receivers.push(callback)}};
    vm.runInNewContext(fs.readFileSync('resources/work-items/form.js','utf8')+'\n'+fs.readFileSync('resources/work-items/editor.js','utf8')+'\n'+fs.readFileSync('resources/work-items/managed-editor.js','utf8'),scope);
    return {get:document.getElementById,messages,receivers};
}

test('Managed editor keeps queue/review/Run identity separate and gates controls by actual grants',()=>{
    const {get,messages,receivers}=createEditor();
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
    const required={...state,review:undefined,reviews:[],queue:{queue,label:'Required fixture',mode:'required-input',counts:{},permissions:['work_items.read']},
        capabilities:{...state.capabilities,modes:['required-input'],operations:['queues.list','items.list','items.get'],permissions:['work_items.read']},
        snapshot:{capability_authority:'package-revision'}};
    const before=messages.length;
    for(const receive of receivers)receive({data:required});
    assert.equal(messages.length,before,'Rendering/discovery must never submit or claim');
    assert.match(get('managed-queue-policy').textContent,/existing input|required/i);
    assert.match(get('managed-snapshot-authority').textContent,/Package revision/);
    for(const id of ['managed-enqueue','managed-claim','managed-retry','managed-approve']) assert.equal(get(id).disabled,true,id);
    required.capabilities.operations.push('items.enqueue');required.capabilities.permissions.push('work_items.enqueue');
    for(const receive of receivers)receive({data:required});assert.equal(get('managed-enqueue').disabled,true,'Global operation is not a queue grant');
    required.queue.permissions.push('work_items.enqueue');
    for(const receive of receivers)receive({data:required});assert.equal(get('managed-enqueue').disabled,false);
    assert.equal(get('managed-claim').disabled,true);assert.equal(get('managed-retry').disabled,true);assert.equal(get('managed-approve').disabled,true);
    required.snapshot={};for(const receive of receivers)receive({data:required});
    assert.match(get('managed-snapshot-authority').textContent,/Legacy action/);assert.deepEqual(required.snapshot,{});
    required.queue={...required.queue,mode:'reviewed'};
    for(const receive of receivers)receive({data:required});assert.equal(get('managed-enqueue').disabled,true,'Reviewed mode cannot bypass exact approval');
    for(const receive of receivers)receive({data:{...state,capabilities:undefined,queue:undefined,review:undefined,reviews:[],message:'Forbidden; reconnect'}});
    assert.equal(get('managed-approve').disabled,true);assert.match(get('managed-status').textContent,/Forbidden/);
    get('mode').value='published';get('mode').onchange();get('connect').onclick();
    assert.equal(messages.at(-1).op,'connect');assert.equal(get('local-root').hidden,false);
});

test('Managed logs distinguish an unloaded result, an empty page, and literal returned lines',()=>{
    const {get,messages,receivers}=createEditor();
    const render=state=>receivers.forEach(receive=>receive({data:{type:'managed-state',...state}}));
    render({});
    assert.match(get('managed-logs').textContent,/select.*logs/i);
    assert.equal(get('managed-more-logs').disabled,true);
    const before=messages.length;
    render({logs:{run_id:'run-identity',lines:[],next_cursor:null}});
    assert.match(get('managed-logs').textContent,/no log lines.*returned/i);
    assert.doesNotMatch(get('managed-logs').textContent,/select.*logs/i);
    assert.equal(get('managed-more-logs').disabled,true);
    render({logs:{run_id:'run-identity',lines:[],next_cursor:'next-page'}});
    assert.match(get('managed-logs').textContent,/no log lines.*returned/i);
    assert.equal(get('managed-more-logs').disabled,false,'An empty page does not imply end of pagination');
    assert.equal(messages.length,before,'Rendering logs must not fetch or mutate');
    get('managed-more-logs').onclick();
    assert.deepEqual(messages.at(-1),{op:'managed.logs',id:'run-identity',cursor:'next-page'});
    render({logs:{run_id:'run-identity',lines:[{offset:0,text:'<script>literal text</script>'}],next_cursor:null}});
    assert.equal(get('managed-logs').textContent,'0: <script>literal text</script>');
    assert.equal(get('managed-more-logs').disabled,true);
    render({});
    assert.match(get('managed-logs').textContent,/select.*logs/i,'A changed selection must not retain an earlier empty response');
});

test('A managed cancellation response clears Working without changing the payload draft',()=>{
    const {get,receivers}=createEditor();
    get('mode').value='managed';get('mode').onchange();
    get('managed-payload').value='{"value":7}';get('managed-payload-apply-json').onclick();
    for(const receive of receivers)receive({data:{type:'loading'}});
    assert.match(get('status').textContent,/Working/);
    for(const receive of receivers)receive({data:{type:'managed-state',message:'Request cancelled. Nothing was submitted.'}});
    assert.equal(get('status').textContent,'');
    assert.match(get('managed-status').textContent,/cancelled/);
    assert.deepEqual(JSON.parse(get('managed-payload').value),{value:7});
});
