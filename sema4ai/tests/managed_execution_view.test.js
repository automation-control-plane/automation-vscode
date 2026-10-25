const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const Module=require('node:module');
const {fixture,tools}=require('./fixtures/managed_execution');
const {command,response,W,D,I}=require('./fixtures/managed_contract');
const {MANAGED_VERSION,MANAGED_PERMISSIONS}=require('../vscode-client/out/managedWorkItemsClient');
const contract=require('../resources/work-items/managed-v1.json');

test('Native selection, explicit claim Run, authoritative lineage and read-only uncertain recovery',async()=>{
    // Actual client HTTP/journal/control flow; synthetic Runtime authority and VS Code dialogs.
    const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'native-execution-view-'));
    const f=fixture(),queue=f.descriptor.inputQueue,permissions=[...new Set(Object.values(MANAGED_PERMISSIONS))];
    const item={...response(command('items.get')).result.item,...structuredClone(f.item),payload:{records:'one\ntwo\n'},run_ids:[],claim:null,queue_state:'PENDING',business_state:'ready'};
    let inputs=[],cancel=false,lose=false,changed=false;const calls=[],posts=[],confirmations=[];
    const server=http.createServer((req,res)=>{
        res.setHeader('Content-Type','application/json');
        if(req.url.endsWith('/schema'))return res.end(JSON.stringify(contract));
        if(req.url.includes('/capabilities?'))return res.end(JSON.stringify({schema_version:MANAGED_VERSION,runtime_version:'1.1.0a40',sdk_version:'0.5.0a2',workspace_id:W,operations:Object.keys(MANAGED_PERMISSIONS),permissions,backend:'sqlite',time_authority:'database',modes:['required-input']}));
        let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
            const c=JSON.parse(raw);calls.push(c);
            if(req.url==='/mcp'){
                let result;
                if(c.method==='server/discover')result={supportedVersions:['2026-07-28'],capabilities:{tools:{}},_meta:{'io.modelcontextprotocol/serverInfo':{name:'Action Server'}}};
                if(c.method==='tools/list')result={tools:tools()};
                if(c.params.name==='canvas_open')result={structuredContent:{applications:[{applicationId:D,title:'Synthetic records',activeRevisionId:f.inspection.activeRevisionId}]}};
                if(c.params.name==='canvas_inspect') {const inspected=structuredClone(f.inspection);if(changed)inspected.invocationDescriptors[0].inputSchema={type:'object',required:['new']};result={structuredContent:inspected};}
                if(c.params.name==='capability_invoke'){
                    assert.deepEqual(c.params.arguments,{mode:'generic',snapshot:f.descriptor.snapshot,claim:item.claim});
                    const epoch=item.claim.epoch;item.claim=null;item.lease_deadline_ms=null;item.queue_state='DONE';item.business_state='completed';item.run_ids=[I];
                    result={structuredContent:{execution:{state:'completed',runStatus:2,attemptState:'succeeded',workItemState:'COMPLETED',runId:I,attemptId:D,attemptEpoch:1,workItemId:I,workItemEpoch:epoch}}};
                    if(lose){req.socket.destroy();return;}
                }
                return res.end(JSON.stringify({jsonrpc:'2.0',id:c.id,result}));
            }
            const out=response(c);out.runtime_version='1.1.0a40';
            if(c.operation==='queues.list')out.result.queues=[{queue,label:'Synthetic input',mode:'required-input',permissions,counts:{PENDING:1}}];
            if(c.operation==='items.list')out.result.items=[item];
            if(c.operation==='items.get'||c.operation==='items.enqueue')out.result.item=item;
            if(c.operation==='reviews.list')out.result.reviews=[];
            if(c.operation==='items.claim'){
                item.claim=structuredClone(f.item.claim);item.lease_deadline_ms='10000';item.queue_state='IN_PROGRESS';item.business_state='running';
                out.result.item=item;out.result.claim=item.claim;out.result.lease_deadline_ms='10000';
            }
            if(c.operation==='runs.get')out.result.run={id:I,snapshot:f.descriptor.snapshot,state:'succeeded',artifacts:[],attempts:[{id:D,epoch:1,state:'succeeded',owner_id:I,lease_deadline_ms:'10000'}]};
            res.end(JSON.stringify(out));
        });
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const endpoint=`http://127.0.0.1:${server.address().port}`,secrets=new Map();
    const context={globalStorageUri:{fsPath:scratch},workspaceState:{get:(_k,f)=>f,update:async()=>{}},secrets:{get:async k=>secrets.get(k),store:async(k,v)=>secrets.set(k,v)}};
    const vscode={window:{showInputBox:async()=>inputs.shift(),showWarningMessage:async(message,_,action)=>{confirmations.push(message);return cancel?undefined:action;}}};
    const original=Module._load;let View;
    Module._load=function(name,parent,...args){if(name==='vscode'&&parent?.filename.endsWith('managedWorkItemsView.js'))return vscode;return original.call(this,name,parent,...args);};
    try{View=require('../vscode-client/out/managedWorkItemsView').ManagedWorkItemsView;}finally{Module._load=original;}
    const create=()=>new View(context,'/synthetic/package.yaml',async msg=>{posts.push(structuredClone(msg));return true;});let view=create();
    const invokeCalls=()=>calls.filter(c=>c.params?.name==='capability_invoke');
    async function connect(){inputs=[endpoint,W,'synthetic-token'];await view.handle({op:'managed.connect'});}
    async function select(){await view.handle({op:'managed.discoverExecutions'});await view.handle({op:'managed.application',id:D});await view.handle({op:'managed.capability',id:'records'});}
    try{
        await connect();assert.equal(calls.some(c=>c.jsonrpc),false,'Connecting queues never invokes MCP');
        await select();assert.deepEqual(posts.at(-1).snapshot,f.descriptor.snapshot);assert.equal(posts.at(-1).execution.canRun,false);
        assert.equal(calls.some(c=>c.operation==='items.claim'),false,'Discovery never claims');
        await view.handle({op:'managed.enqueue',payload:{records:'one\ntwo\n'}});
        const enqueue=calls.find(c=>c.operation==='items.enqueue');assert.deepEqual(enqueue.snapshot,f.descriptor.snapshot);assert.equal(enqueue.payload.records,'one\ntwo\n');
        await view.handle({op:'managed.claim',lease_seconds:60});assert.equal(posts.at(-1).item.id,I);assert.equal(posts.at(-1).execution.canRun,true);
        cancel=true;const before=calls.length;await view.handle({op:'managed.invoke'});assert.equal(calls.length,before);assert.match(posts.at(-1).message,/cancelled/i);cancel=false;
        changed=true;await assert.rejects(view.handle({op:'managed.invoke'}),/capability changed/);assert.equal(invokeCalls().length,0);changed=false;
        await view.handle({op:'managed.invoke',snapshot:{forged:true},actor:'ignored'});
        assert.equal(invokeCalls().length,1);assert.equal(posts.at(-1).execution.pending.length,0);
        assert.equal(posts.at(-1).run.id,I);assert.equal(posts.at(-1).run.attempts[0].id,D);assert.equal(posts.at(-1).execution.result.state,'completed');
        assert.equal(posts.at(-1).execution.canRun,false);assert.equal(posts.at(-1).item.claim,null);
        await assert.rejects(view.handle({op:'managed.invoke'}));assert.equal(invokeCalls().length,1);
        // New explicit test claim, lost HTTP result after server execution.
        item.queue_state='PENDING';item.business_state='ready';item.run_ids=[];
        await select();await view.handle({op:'managed.claim',lease_seconds:60});lose=true;
        await assert.rejects(view.handle({op:'managed.invoke'}),/connection failed/);
        const pending=posts.at(-1).execution.pending[0];assert.ok(pending.key);assert.equal(invokeCalls().length,2);
        view=create();await connect();assert.equal(posts.at(-1).execution.pending[0].key,pending.key);
        const count=invokeCalls().length;await view.handle({op:'managed.inspectInvocation',key:pending.key});
        assert.equal(invokeCalls().length,count);assert.equal(posts.at(-1).item.queue_state,'DONE');
        assert.equal(posts.at(-1).execution.pending[0].key,pending.key,'No request-to-epoch mapping is invented');
        await select();await assert.rejects(view.handle({op:'managed.claim',lease_seconds:60}),/Reconcile/);
        assert.ok(!JSON.stringify(posts).includes('synthetic-token'));
        assert.ok(confirmations.some(text=>text.includes('claim epoch 3')));
    }finally{await new Promise(r=>server.close(r));await fs.rm(scratch,{recursive:true,force:true});}
});
