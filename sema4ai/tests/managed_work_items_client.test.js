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
