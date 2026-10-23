const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const Module=require('node:module');
const contract=require('../resources/work-items/managed-v1.json');
const {MANAGED_VERSION,MANAGED_PERMISSIONS}=require('../vscode-client/out/managedWorkItemsClient');
const {command,response,queue,W,I}=require('./fixtures/managed_contract');

test('Native managed controller preserves exact targets, grants, artifacts and uncertain request identity across reconnect',async()=>{
    // Real client/HTTP/files, simulated Runtime DTO/domain and VS Code dialogs.
    // This is not an installed Extension Host or managed SQL worker proof.
    const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'managed-view-'));
    const secret=new Map(),state=new Map(),posted=[],calls=[],confirmations=[];
    let inputs=[],save=path.join(scratch,'artifact.txt'),disconnect=false,denied=false,replay=false;
    const payload=Buffer.from('proof');
    const artifact={handle:'synthetic-artifact',run_id:I,digest:'sha256:'+crypto.createHash('sha256').update(payload).digest('hex'),size:payload.length};
    const item=response(command('items.get')).result.item;item.run_ids=[I];
    const proposal=command('reviews.decide').proposal;
    const permissions=[...new Set(Object.values(MANAGED_PERMISSIONS))];
    const server=http.createServer((req,res)=>{
        res.setHeader('Content-Type','application/json');
        assert.equal(req.headers.authorization,'Bearer synthetic-token');
        if(req.url.endsWith('/schema'))return res.end(JSON.stringify(contract));
        if(req.url.includes('/capabilities?'))return res.end(JSON.stringify({schema_version:MANAGED_VERSION,runtime_version:'1.1.0a13',sdk_version:'0.5.0a1',workspace_id:W,operations:Object.keys(MANAGED_PERMISSIONS),permissions,backend:'sqlite',time_authority:'database',modes:['reviewed','producer']}));
        let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{
            const c=JSON.parse(raw);calls.push(c);
            if(denied){res.statusCode=403;return res.end(JSON.stringify({schema_version:MANAGED_VERSION,error:{code:'forbidden'}}));}
            if(disconnect&&c.operation==='items.enqueue'){disconnect=false;req.socket.destroy();return;}
            const out=response(c);
            if(c.operation==='queues.list')out.result.queues=[{queue,label:'Authorized synthetic queue',mode:'producer',permissions,counts:{PENDING:1}}];
            if(c.operation==='items.list')out.result.items=[item];
            if(c.operation==='items.get')out.result.item=item;
            if(c.operation==='reviews.list')out.result.reviews=[{proposal,state:'pending',work_item_id:null}];
            if(c.operation==='runs.get'){out.result.run.artifacts=[artifact];out.result.run.attempts=[];}
            if(c.operation==='runs.logs')out.result.lines=[{offset:0,text:'synthetic log'}];
            if(c.operation==='artifacts.read')out.result={artifact,offset:0,data_base64:payload.toString('base64'),eof:true,next_cursor:null};
            if(c.operation==='items.enqueue')out.result.replay=replay;
            res.end(JSON.stringify(out));
        });
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const endpoint=`http://127.0.0.1:${server.address().port}`;
    const context={globalStorageUri:{fsPath:scratch},workspaceState:{get:(key,fallback)=>state.get(key)||fallback,update:async(key,value)=>state.set(key,value)},secrets:{get:async key=>secret.get(key),store:async(key,value)=>secret.set(key,value)}};
    const vscode={window:{showInputBox:async()=>inputs.shift(),showWarningMessage:async(message,_,option)=>{confirmations.push(message);return option;},showSaveDialog:async()=>({fsPath:save})}};
    const load=Module._load;
    Module._load=function(name,parent,main){if(name==='vscode'&&parent?.filename.endsWith('/managedWorkItemsView.js'))return vscode;return load.call(this,name,parent,main);};
    let View;try{View=require('../vscode-client/out/managedWorkItemsView').ManagedWorkItemsView;}finally{Module._load=load;}
    const create=()=>new View(context,'/synthetic/action/package.yaml',async message=>{posted.push(JSON.parse(JSON.stringify(message)));return true;});
    let view=create();
    async function connect(){inputs=[endpoint,W,'synthetic-token'];await view.handle({op:'managed.connect'});}
    try{
        await connect();assert.equal(posted.at(-1).queues.length,1);
        await view.handle({op:'managed.queue',queue:JSON.stringify(queue)});
        await view.handle({op:'managed.item',id:I});
        await view.handle({op:'managed.run',id:I});
        await view.handle({op:'managed.logs',id:I});assert.equal(posted.at(-1).logs.lines[0].text,'synthetic log');
        await view.handle({op:'managed.artifact',handle:artifact.handle});assert.equal(await fs.readFile(save,'utf8'),'proof');
        await assert.rejects(view.handle({op:'managed.artifact',handle:artifact.handle}),/EEXIST/);
        assert.equal(await fs.readFile(save,'utf8'),'proof');
        const before=calls.length;
        await assert.rejects(view.handle({op:'managed.retry',reason:'test'}),/terminal Work Item epoch/);
        assert.equal(calls.length,before);
        await view.handle({op:'managed.review',id:proposal.review_id});
        await view.handle({op:'managed.decide',decision:'approve'});
        const approved=calls.find(c=>c.operation==='reviews.decide');assert.deepEqual(approved.proposal,proposal);
        await view.handle({op:'managed.item',id:I});
        disconnect=true;
        await assert.rejects(view.handle({op:'managed.enqueue',payload:{value:7}}),/connection failed/);
        const first=calls.filter(c=>c.operation==='items.enqueue').at(-1);
        assert.equal(posted.at(-1).pending.length,1);
        await assert.rejects(view.handle({op:'managed.enqueue',payload:{value:7}}),/Reconcile/);
        view=create();await connect();assert.equal(posted.at(-1).pending[0].key,first.idempotency_key);
        replay=true;await view.handle({op:'managed.reconcile',key:first.idempotency_key});
        const second=calls.filter(c=>c.operation==='items.enqueue').at(-1);assert.deepEqual(second,first);
        assert.equal(posted.at(-1).pending.length,0);
        denied=true;await assert.rejects(view.handle({op:'managed.item',id:I}),/denied/);
        assert.equal(posted.at(-1).capabilities,undefined);assert.deepEqual(posted.at(-1).items,[]);
        assert.ok(!JSON.stringify(posted).includes('synthetic-token'));
        assert.ok(confirmations.some(message=>message.includes('Reconcile the exact retained')));
    }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(scratch,{recursive:true,force:true});}
});
