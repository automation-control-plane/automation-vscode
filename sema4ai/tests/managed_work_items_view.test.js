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
    let inputs=[],connectEndpoint,save=path.join(scratch,'artifact.txt'),disconnect=false,denied=false,deniedStatus=403,replay=false,conflict,generic=false,cancelDialog=false,emptyLogs=false;
    const payload=Buffer.from('proof');
    const artifact={handle:'synthetic-artifact',run_id:I,digest:'sha256:'+crypto.createHash('sha256').update(payload).digest('hex'),size:payload.length};
    const item=response(command('items.get')).result.item;item.run_ids=[I];
    const proposal=command('reviews.decide').proposal;
    const permissions=[...new Set(Object.values(MANAGED_PERMISSIONS))];
    const server=http.createServer((req,res)=>{
        res.setHeader('Content-Type','application/json');
        assert.equal(req.headers.authorization,'Bearer synthetic-token');
        if(req.url.endsWith('/schema'))return res.end(JSON.stringify(contract));
        if(req.url.includes('/capabilities?'))return res.end(JSON.stringify({schema_version:MANAGED_VERSION,runtime_version:'1.1.0a13',sdk_version:'0.5.0a1',workspace_id:W,operations:generic?['queues.list','items.list','items.get']:Object.keys(MANAGED_PERMISSIONS),permissions:generic?['work_items.read']:permissions,backend:'sqlite',time_authority:'database',modes:generic?['required-input']:['reviewed','producer']}));
        let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{
            const c=JSON.parse(raw);calls.push(c);
            if(denied){res.statusCode=deniedStatus;return res.end(JSON.stringify({schema_version:MANAGED_VERSION,error:{code:deniedStatus===404?'not_found':deniedStatus===401?'not_authenticated':'forbidden'}}));}
            if(conflict&&c.operation==='items.retry'){res.statusCode=409;return res.end(JSON.stringify({schema_version:MANAGED_VERSION,error:{code:conflict}}));}
            if(disconnect&&c.operation==='items.enqueue'){disconnect=false;req.socket.destroy();return;}
            const out=response(c);
            if(c.operation==='queues.list')out.result.queues=[{queue,label:'Authorized synthetic queue',mode:generic?'required-input':'producer',permissions:generic?['work_items.read']:permissions,counts:{PENDING:1}}];
            if(c.operation==='items.list')out.result.items=[item];
            if(c.operation==='items.get')out.result.item=item;
            if(c.operation==='reviews.list')out.result.reviews=[{proposal,state:'pending',work_item_id:null}];
            if(c.operation==='runs.get'){out.result.run.artifacts=[artifact];out.result.run.attempts=[];}
            if(c.operation==='runs.logs'){out.result.lines=emptyLogs?[]:[{offset:0,text:'synthetic log'}];out.result.next_cursor=null;}
            if(c.operation==='artifacts.read')out.result={artifact,offset:0,data_base64:payload.toString('base64'),eof:true,next_cursor:null};
            if(c.operation==='items.enqueue')out.result.replay=replay;
            res.end(JSON.stringify(out));
        });
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const endpoint=`http://127.0.0.1:${server.address().port}`;
    const context={globalStorageUri:{fsPath:scratch},workspaceState:{get:(key,fallback)=>state.get(key)||fallback,update:async(key,value)=>state.set(key,value)},secrets:{get:async key=>secret.get(key),store:async(key,value)=>secret.set(key,value)}};
    const vscode={window:{showInputBox:async()=>inputs.shift(),showWarningMessage:async(message,_,option)=>{confirmations.push(message);return cancelDialog?undefined:option;},showSaveDialog:async()=>cancelDialog?undefined:({fsPath:save}),showOpenDialog:async()=>undefined}};
    const load=Module._load;
    Module._load=function(name,parent,main){if(name==='vscode'&&parent?.filename.endsWith('/managedWorkItemsView.js'))return vscode;return load.call(this,name,parent,main);};
    let View;try{View=require('../vscode-client/out/managedWorkItemsView').ManagedWorkItemsView;}finally{Module._load=load;}
    const create=()=>new View(context,'/synthetic/action/package.yaml',async message=>{posted.push(JSON.parse(JSON.stringify(message)));return true;});
    let view=create();
    async function connect(){inputs=[connectEndpoint||endpoint,W,'synthetic-token'];await view.handle({op:'managed.connect'});}
    try{
        await connect();assert.equal(posted.at(-1).queues.length,1);
        inputs=[`http://localhost:${server.address().port}`,W,''];
        await assert.rejects(view.handle({op:'managed.connect'}),/token is required/i,'a different origin must not reuse the saved origin token');
        await view.handle({op:'managed.queue',queue:JSON.stringify(queue)});
        await view.handle({op:'managed.item',id:I});
        await view.handle({op:'managed.run',id:I});
        await view.handle({op:'managed.logs',id:I});assert.equal(posted.at(-1).logs.lines[0].text,'synthetic log');
        emptyLogs=true;await view.handle({op:'managed.logs',id:I});
        assert.deepEqual(posted.at(-1).logs.lines,[]);assert.equal(posted.at(-1).logs.run_id,I);
        const journalFiles=async()=>fs.readdir(path.join(scratch,'managed-work-items',crypto.createHash('sha256').update('/synthetic/action/package.yaml\n'+endpoint+'\n'+W).digest('hex')));
        async function assertCancelled(message,{preserveQueue=true}={}){
            const prior=posted.at(-1),beforePosts=posted.length,beforeCalls=calls.length,beforeJournal=await journalFiles();
            await view.handle(message);
            assert.equal(posted.length,beforePosts+1,'Cancel must settle the loading state without Refresh');
            assert.equal(posted.at(-1).type,'managed-state');assert.match(posted.at(-1).message,/cancelled/i);
            for(const key of [...(preserveQueue?['queue']:[]),'item','logs','pending','snapshot','capabilities'])assert.deepEqual(posted.at(-1)[key],prior[key],'Cancel preserves '+key);
            assert.equal(calls.length,beforeCalls,'Cancel must not send even a refresh request');
            assert.deepEqual(await journalFiles(),beforeJournal,'Cancel must not create a request or receipt');
        }
        cancelDialog=true;
        await assertCancelled({op:'managed.claim',lease_seconds:60});
        assert.ok(confirmations.at(-1).includes('items.claim'),'Claim still requires explicit confirmation');
        assert.equal(calls.some(c=>c.operation==='items.claim'),false);
        await assertCancelled({op:'managed.snapshot'});
        await assertCancelled({op:'managed.artifact',handle:artifact.handle});
        for(const input of [[],[endpoint],[endpoint,W]]){inputs=input;await assertCancelled({op:'managed.connect'});}
        cancelDialog=false;
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
        const journalDir=path.join(scratch,'managed-work-items',crypto.createHash('sha256').update('/synthetic/action/package.yaml\n'+endpoint+'\n'+W).digest('hex'));
        await fs.writeFile(path.join(journalDir,first.idempotency_key+'.receipt.json'),'{' );
        const beforeRestore=calls.length;view=create();await assert.rejects(connect(),/JSON|receipt/i);
        await view.handle({op:'managed.refresh'});
        await assert.rejects(view.handle({op:'managed.enqueue',payload:{value:8} }));
        assert.equal(calls.slice(beforeRestore).some(c=>c.operation==='items.enqueue'),false,'failed journal restore leaves mutations disabled');
        await fs.rm(path.join(journalDir,first.idempotency_key+'.receipt.json'));
        await fs.writeFile(path.join(journalDir,first.idempotency_key+'.receipt.json'),JSON.stringify({schema_version:MANAGED_VERSION,operation:'items.enqueue',runtime_version:'1.1.0a13',result:{}}));
        view=create();await assert.rejects(connect(),/receipt|contract|invalid/i,'a syntactically valid but invalid result must not resolve uncertainty');
        await view.handle({op:'managed.refresh'});
        const afterInvalidRestore=calls.length;
        for(const op of ['managed.enqueue','managed.claim','managed.invoke']) await assert.rejects(view.handle({op,payload:{value:8},lease_seconds:60}));
        assert.equal(calls.length,afterInvalidRestore,'invalid retained result keeps every mutation path disabled');
        await fs.rm(path.join(journalDir,first.idempotency_key+'.receipt.json'));
        const legacyNamespace=crypto.createHash('sha256').update('/synthetic/action/package.yaml\n'+endpoint+'/\n'+W).digest('hex');
        const legacyDir=path.join(scratch,'managed-work-items',legacyNamespace);await fs.mkdir(legacyDir,{recursive:true});
        await fs.copyFile(path.join(journalDir,first.idempotency_key+'.request.json'),path.join(legacyDir,first.idempotency_key+'.request.json'));
        connectEndpoint=endpoint+'/';
        view=create();await connect();assert.equal(posted.at(-1).pending[0].key,first.idempotency_key);
        assert.ok((await fs.readdir(legacyDir)).includes(first.idempotency_key+'.request.json'),'legacy raw-origin journal remains preserved');
        connectEndpoint=undefined;
        for(deniedStatus of [401,403,404,413,422]){
            denied=true;
            await assert.rejects(view.handle({op:'managed.reconcile',key:first.idempotency_key}));
            assert.ok(posted.at(-1).pending.some(entry=>entry.key===first.idempotency_key),'failed reconciliation preserves the original uncertain request');
            denied=false;
            view=create();await connect();assert.equal(posted.at(-1).pending[0].key,first.idempotency_key);
        }
        deniedStatus=403;
        cancelDialog=true;await assertCancelled({op:'managed.reconcile',key:first.idempotency_key},{preserveQueue:false});cancelDialog=false;
        replay=true;await view.handle({op:'managed.reconcile',key:first.idempotency_key});
        const second=calls.filter(c=>c.operation==='items.enqueue').at(-1);assert.deepEqual(second,first);
        assert.equal(posted.at(-1).pending.length,0);
        item.claim={queue,item_id:I,owner_id:I,epoch:3};item.lease_deadline_ms='1000';item.queue_state='IN_PROGRESS';item.business_state='running';
        await view.handle({op:'managed.item',id:I});
        conflict='stale_claim';await assert.rejects(view.handle({op:'managed.retry',reason:'explicit test'}),/stale_claim/);
        assert.equal(posted.at(-1).pending.length,0);
        conflict='blocked_uncertain_effect';await assert.rejects(view.handle({op:'managed.retry',reason:'explicit test'}),/blocked_uncertain_effect/);
        assert.equal(posted.at(-1).pending.length,1);conflict=undefined;
        generic=true;item.claim=null;item.lease_deadline_ms=null;item.snapshot.capability_authority='package-revision';
        view=create();await connect();const genericStart=calls.length;
        await view.handle({op:'managed.queue',queue:JSON.stringify(queue)});
        await view.handle({op:'managed.item',id:I});
        assert.equal(posted.at(-1).queue.mode,'required-input');assert.equal(posted.at(-1).snapshot.capability_authority,'package-revision');
        assert.deepEqual(posted.at(-1).reviews,[]);
        for(const op of ['managed.enqueue','managed.claim']) await assert.rejects(view.handle({op,payload:{value:7},lease_seconds:60}),/not granted/);
        await assert.rejects(view.handle({op:'managed.retry',reason:'no epoch'}),/terminal Work Item epoch/);
        assert.deepEqual(calls.slice(genericStart).map(c=>c.operation),['items.list','items.get']);
        denied=true;await assert.rejects(view.handle({op:'managed.item',id:I}),/denied/);
        assert.equal(posted.at(-1).capabilities,undefined);assert.deepEqual(posted.at(-1).items,[]);
        assert.ok(!JSON.stringify(posted).includes('synthetic-token'));
        assert.ok(confirmations.some(message=>message.includes('Reconcile the exact retained')));
    }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(scratch,{recursive:true,force:true});}
});
