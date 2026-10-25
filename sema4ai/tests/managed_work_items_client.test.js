const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const contract = require('../resources/work-items/managed-v1.json');
const {ManagedWorkItemsClient, MANAGED_PERMISSIONS, MANAGED_VERSION, managedCommandSchema, validateManagedValue} = require('../vscode-client/out/managedWorkItemsClient');
const {command,response,queue,W,D,I}=require('./fixtures/managed_contract');

test('Canonical generated commands reject extra authority, invalid lease/size and non-finite JSON', () => {
    const claim=command('items.claim');
    validateManagedValue(claim,contract.commands);
    assert.throws(()=>validateManagedValue({...claim,owner_id:I},contract.commands));
    assert.throws(()=>validateManagedValue(JSON.parse(JSON.stringify(claim).replace('"operation"','"__proto__":{"polluted":true},"operation"')),contract.commands));
    assert.throws(()=>validateManagedValue({...claim,lease_seconds:3601},contract.commands));
    assert.throws(()=>validateManagedValue({...claim,lease_seconds:0},contract.commands));
    assert.throws(()=>validateManagedValue({...claim,queue:{...queue,workspace_id:'not-a-uuid'}},contract.commands));
});

test('Negotiates canonical managed capabilities and all14 typed operations with no legacy requests or automatic retry',async()=>{
    let caps={schema_version:MANAGED_VERSION,runtime_version:'1.1.0a13',sdk_version:'0.5.0a1',workspace_id:W,
        operations:Object.keys(MANAGED_PERMISSIONS),permissions:[...new Set(Object.values(MANAGED_PERMISSIONS))],backend:'sqlite',time_authority:'database',modes:['reviewed']};
    const calls=[];let denied=false,wrongScope=false,unknownSchema=false;
    const server=http.createServer((req,res)=>{
        calls.push({method:req.method,route:req.url});
        assert.equal(req.headers.authorization,'Bearer synthetic-token');res.setHeader('Content-Type','application/json');
        if(req.url.endsWith('/schema'))return res.end(JSON.stringify(unknownSchema?{...contract,contract_version:'unknown'}:contract));
        if(req.url.includes('/capabilities?'))return res.end(JSON.stringify(caps));
        assert.equal(req.url,'/api/managed-work-items/v1/operations');
        if(denied){res.statusCode=403;return res.end(JSON.stringify({schema_version:MANAGED_VERSION,error:{code:'forbidden'}}));}
        let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{
            const cmd=JSON.parse(raw),out=response(cmd);
            if(wrongScope&&out.result.item)out.result.item.queue.workspace_id=D;
            res.end(JSON.stringify(out));
        });
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const c=new ManagedWorkItemsClient(`http://127.0.0.1:${server.address().port}`,'synthetic-token',W);
    try{
        await assert.rejects(c.execute(command('queues.list')),/Reconnect/);
        await c.negotiate();
        for(const op of Object.keys(MANAGED_PERMISSIONS)) {
            const result=await c.execute(command(op));assert.equal(result.operation,op);
        }
        const before=calls.length;
        await assert.rejects(c.execute({...command('items.enqueue'),payload:NaN}),/finite JSON/);
        await assert.rejects(c.execute({...command('items.get'),queue:{...queue,workspace_id:D}}),/Workspace scope/);
        assert.equal(calls.length,before);
        wrongScope=true;await assert.rejects(c.execute(command('items.get')),/queue scope/);wrongScope=false;
        denied=true;await assert.rejects(c.execute(command('items.get')),/denied/);
        const after=calls.length;await assert.rejects(c.execute(command('items.get')),/Reconnect/);assert.equal(calls.length,after);denied=false;
        caps={...caps,sdk_version:'0.4.4'};await assert.rejects(c.negotiate(),/below/);
        caps={...caps,sdk_version:'0.5.0a1',workspace_id:D};await assert.rejects(c.negotiate(),/scope/);
        caps={...caps,workspace_id:W};unknownSchema=true;await assert.rejects(c.negotiate(),/pinned contract/);
        assert.ok(calls.every(call=>!call.route.startsWith('/api/work-items')));
    }finally{await new Promise(resolve=>server.close(resolve));}
});

test('Pinned candidate schema has reviewed Git bytes and exactly the current generated queue vocabulary',()=>{
    const fs=require('node:fs'),crypto=require('node:crypto');
    const raw=fs.readFileSync('resources/work-items/managed-v1.json');
    assert.equal(crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${raw.length}\0`),raw])).digest('hex'),'3a34f69c7770de072427fddb79bf0d4cc39da06f');
    const {MANAGED_QUEUE_MODES}=require('../vscode-client/out/managedWorkItemsClient');
    assert.deepEqual([...MANAGED_QUEUE_MODES],contract.results['queues.list'].$defs.QueueView.properties.mode.enum);
});

test('Snapshot authority accepts only reviewed values and never inserts the legacy default into commands',()=>{
    const enqueue=command('items.enqueue');
    assert.equal(Object.hasOwn(enqueue.snapshot,'capability_authority'),false);
    validateManagedValue(enqueue,contract.commands);
    for(const authority of ['legacy-action','package-revision']) {
        const next=structuredClone(enqueue);next.snapshot.capability_authority=authority;
        validateManagedValue(next,contract.commands);
        for(const operation of ['items.get','items.enqueue','items.cancel','items.retry','runs.get']) {
            const out=response(command(operation)).result;
            (out.item||out.run).snapshot.capability_authority=authority;
            validateManagedValue(out,contract.results[operation]);
        }
    }
    assert.throws(()=>validateManagedValue({...enqueue,snapshot:{...enqueue.snapshot,capability_authority:'future-authority'}},contract.commands));
    assert.equal(Object.hasOwn(enqueue.snapshot,'capability_authority'),false);
});

test('Current required-input candidate negotiates without granting mutations and rejects semantic drift',async()=>{
    let schema=structuredClone(contract),mode='required-input',runtime='1.1.0a37',denied=false,responseAuthority='package-revision';
    let operations=['queues.list','items.list','items.get'],permissions=['work_items.read'];
    const calls=[],bodies=[];
    const server=http.createServer((req,res)=>{
        calls.push(req.url);res.setHeader('Content-Type','application/json');
        assert.equal(req.headers.authorization,'Bearer synthetic-token');
        if(denied){res.statusCode=403;return res.end('{}');}
        if(req.url.endsWith('/schema'))return res.end(JSON.stringify(schema));
        if(req.url.includes('/capabilities?'))return res.end(JSON.stringify({schema_version:MANAGED_VERSION,runtime_version:runtime,sdk_version:'0.5.0a2',workspace_id:W,operations,permissions,backend:'sqlite',time_authority:'database',modes:[mode]}));
        let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{
            const c=JSON.parse(raw);bodies.push(c);const out=response(c);out.runtime_version=runtime;
            if(c.operation==='queues.list')out.result.queues=[{queue,label:'Input queue',mode:'required-input',permissions,counts:{PENDING:1}}];
            if(out.result.item)out.result.item.snapshot.capability_authority=responseAuthority;
            res.end(JSON.stringify(out));
        });
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const c=new ManagedWorkItemsClient(`http://127.0.0.1:${server.address().port}`,'synthetic-token',W);
    try {
        await c.negotiate();
        assert.equal((await c.execute(command('queues.list'))).result.queues[0].mode,'required-input');
        assert.equal((await c.execute(command('items.get'))).result.item.snapshot.capability_authority,'package-revision');
        const before=calls.length;
        for(const op of ['items.enqueue','items.claim','items.retry','reviews.decide']) await assert.rejects(c.execute(command(op)),/unavailable or not granted/);
        assert.equal(calls.length,before);
        operations=[...operations,'items.enqueue'];permissions=[...permissions,'work_items.enqueue'];await c.negotiate();
        const enqueue=command('items.enqueue');
        enqueue.payload={records:'{"value":"東京 🙂"}\n{"quote":"\\"yes\\""}\n',nested:{text:'line one\nline two'},array:['café\n"quoted"']};
        await c.execute(enqueue);
        assert.deepEqual(bodies.at(-1),enqueue);assert.equal(Object.hasOwn(bodies.at(-1).snapshot,'capability_authority'),false);
        assert.equal(bodies.at(-1).payload.records.trimEnd().split('\n').map(line=>JSON.parse(line)).length,2);
        for(const authority of ['legacy-action','package-revision']) {
            enqueue.snapshot.capability_authority=authority;await c.execute(enqueue);assert.deepEqual(bodies.at(-1),enqueue);
        }
        responseAuthority='future';await assert.rejects(c.execute(command('items.get')),/contract validation/);responseAuthority='package-revision';
        operations.push('items.claim','items.renew','items.complete');permissions.push('work_items.claim','work_items.complete');await c.negotiate();
        for(const operation of ['items.claim','items.renew','items.complete']) await c.execute(command(operation));
        for(const operation of ['items.retry','reviews.decide']) await assert.rejects(c.execute(command(operation)),/not granted/);
        const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reorder(v)])):value;
        schema=reorder(contract);await c.negotiate();
        schema=structuredClone(contract);schema.commands.$defs.ExecutionSnapshot.properties.capability_authority.enum.push('future');
        let n=calls.length;await assert.rejects(c.negotiate(),/pinned contract/);assert.equal(calls.length,n+1);assert.equal(c.capabilities(),undefined);
        schema=structuredClone(contract);schema.results['queues.list'].$defs.QueueView.properties.mode.enum.push('future');await assert.rejects(c.negotiate(),/pinned contract/);
        schema=structuredClone(contract);
        delete schema.commands.$defs.ExecutionSnapshot.properties.capability_authority;
        for(const result of Object.values(schema.results)) if(result.$defs?.ExecutionSnapshot) delete result.$defs.ExecutionSnapshot.properties.capability_authority;
        schema.results['queues.list'].$defs.QueueView.properties.mode.enum.pop();
        await assert.rejects(c.negotiate(),/pinned contract/); // exact former schema remains unadmitted
        schema=structuredClone(contract);
        for(const invalid of ['future','required']) {mode=invalid;await assert.rejects(c.negotiate(),/capability set/);}
        mode='required-input';runtime='1.0.4';await assert.rejects(c.negotiate(),/below/);
        runtime='1.1.0a37';await c.negotiate();denied=true;await assert.rejects(c.negotiate(),/denied/);assert.equal(c.capabilities(),undefined);
        assert.ok(calls.every(route=>!route.startsWith('/api/work-items')&&route!=='/config'));
    } finally {await new Promise(resolve=>server.close(resolve));}
});
