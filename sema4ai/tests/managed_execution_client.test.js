const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {fixture,tools,serverFor}=require('./fixtures/managed_execution');
const {W,D,I}=require('./fixtures/managed_contract');
test('Native MCP discovers exact schemas and invokes only the matching retained claim',async()=>serverFor(async({endpoint,calls})=>{
    const {ManagedExecutionClient}=require('../vscode-client/out/managedExecutionClient');
    const client=new ManagedExecutionClient(endpoint,'synthetic-token',W);
    await assert.rejects(client.applications(),/negotiate/i);await client.negotiate();
    assert.equal((await client.applications())[0].title,'Records');
    const [descriptor]=await client.descriptors(D);assert.deepEqual(descriptor,fixture().descriptor);
    const {buildManagedClaimInvocation}=require('../vscode-client/out/managedExecutionSelection');
    const request=buildManagedClaimInvocation(descriptor,fixture().item);
    const result=await client.invokeClaim(request,I);assert.equal(result.runId,I);
    const invoke=calls.find(c=>c.params.name==='capability_invoke');assert.equal(invoke.id,I);assert.deepEqual(invoke.params.arguments,request);
    assert.equal(calls.filter(c=>c.params.name==='capability_invoke').length,1);
    assert.deepEqual(Object.keys(invoke.params.arguments).sort(),['claim','mode','snapshot']);
}));
test('Live optional output metadata is not persisted as execution authority',async()=>serverFor(async({endpoint,setOverride})=>{
    setOverride(({body,result})=>{
        if(body.params.name==='capability_invoke')result.structuredContent.execution.outputs=[{handle:'synthetic-output',name:'robot-output.xml',mediaType:'application/xml',size:7}];
        return result;
    });
    const {ManagedExecutionClient}=require('../vscode-client/out/managedExecutionClient');
    const client=new ManagedExecutionClient(endpoint,'synthetic-token',W);await client.negotiate();
    const {buildManagedClaimInvocation}=require('../vscode-client/out/managedExecutionSelection'),f=fixture();
    const result=await client.invokeClaim(buildManagedClaimInvocation(f.descriptor,f.item),I);
    assert.equal(result.runId,I);assert.equal(Object.hasOwn(result,'outputs'),false);
}));
test('Unknown protocol, server identity, tool schema and app-only audience fail closed',async()=>{
    for(const change of [
        ({body,result})=>body.method==='server/discover'?{...result,supportedVersions:['2099-01-01']}:result,
        ({body,result})=>body.method==='server/discover'?{...result,_meta:{'io.modelcontextprotocol/serverInfo':{name:'Unknown'}}}:result,
        ({body,result})=>{if(body.method==='tools/list')result.tools[2].inputSchema.$defs.GenericClaimInvocation.properties.actor={type:'string'};return result;},
        ({body,result})=>{if(body.method==='tools/list')result.tools[2]._meta.ui.visibility=['app'];return result;},
        ({body,result})=>{if(body.method==='tools/list')result.tools=result.tools.slice(0,2);return result;},
    ])await serverFor(async({endpoint,calls,setOverride})=>{
        setOverride(change);const {ManagedExecutionClient}=require('../vscode-client/out/managedExecutionClient');const client=new ManagedExecutionClient(endpoint,'synthetic-token',W);
        await assert.rejects(client.negotiate());await assert.rejects(client.applications());assert.equal(calls.some(c=>c.method==='tools/call'),false);
    });
});
test('Lost invocation response has no automatic retry; malformed execution identity is refused',async()=>serverFor(async({endpoint,calls,setOverride})=>{
    const {ManagedExecutionClient}=require('../vscode-client/out/managedExecutionClient');const client=new ManagedExecutionClient(endpoint,'synthetic-token',W);await client.negotiate();
    const {buildManagedClaimInvocation}=require('../vscode-client/out/managedExecutionSelection');const f=fixture(),request=buildManagedClaimInvocation(f.descriptor,f.item);
    setOverride(({body,req})=>{if(body.params.name==='capability_invoke'){req.socket.destroy();return false;}});
    await assert.rejects(client.invokeClaim(request,I),/connection failed/);assert.equal(calls.filter(c=>c.params.name==='capability_invoke').length,1);
    setOverride(({body,result})=>{if(body.params.name==='capability_invoke')result.structuredContent.execution.workItemId=D;return result;});
    assert.equal(client.negotiated(),false);await client.negotiate();
    await assert.rejects(client.invokeClaim(request,D),/identity|contract/i);
}));
test('Retained invocation request, result and confirmation require exact typed identities and scope',()=>{
    const {validateManagedExecutionRequest,validateManagedExecutionResult,validateManagedExecutionConfirmation}=require('../vscode-client/out/managedExecutionClient');
    const f=fixture(),{buildManagedClaimInvocation}=require('../vscode-client/out/managedExecutionSelection');
    const request=buildManagedClaimInvocation(f.descriptor,f.item);
    const result={state:'completed',runId:I,attemptId:D,attemptEpoch:1,workItemId:I,workItemEpoch:3,runStatus:2,attemptState:'succeeded',workItemState:'COMPLETED'};
    const confirmation={runId:I,attemptId:D};
    assert.deepEqual(validateManagedExecutionRequest(request,W),request);
    assert.deepEqual(validateManagedExecutionResult(result,request),result);
    assert.deepEqual(validateManagedExecutionConfirmation(confirmation,result),confirmation);
    for(const invalid of [
        {...result,attemptEpoch:0},{...result,attemptEpoch:'1'},{...result,attemptId:'bad'},
        {...result,workItemId:D},{...result,workItemEpoch:4},{...result,extra:true},
    ])assert.throws(()=>validateManagedExecutionResult(invalid,request),/identity|contract/i);
    assert.throws(()=>validateManagedExecutionRequest(request,'00000000-0000-4000-8000-000000000000'),/scope/i);
    assert.throws(()=>validateManagedExecutionConfirmation({...confirmation,attemptId:I},result),/confirmation/i);
    assert.throws(()=>validateManagedExecutionConfirmation({...confirmation,extra:true},result),/confirmation/i);
});
module.exports={fixture,tools,serverFor};

test('Only top-level tool schema prose can vary; the authority contract stays exact',async()=>{
    await serverFor(async({endpoint,setOverride})=>{
        setOverride(({body,result})=>{if(body.method==='tools/list')result.tools[1].inputSchema.description='Authorized execution references (a38 wording)';return result;});
        const {ManagedExecutionClient}=require('../vscode-client/out/managedExecutionClient');
        const client=new ManagedExecutionClient(endpoint,'synthetic-token',W);
        await client.negotiate();assert.equal(client.negotiated(),true);
    });
    for(const mutate of [
        schema=>{schema.description={unexpected:true};},
        schema=>{schema.properties.description={type:'string'};},
        schema=>{schema.additionalProperties=true;},
        schema=>{schema.required=[];},
        schema=>{schema.properties.appId.default='synthetic';},
        schema=>{schema.properties.appId.enum=['synthetic'];},
    ])await serverFor(async({endpoint,calls,setOverride})=>{
        setOverride(({body,result})=>{if(body.method==='tools/list')mutate(result.tools[1].inputSchema);return result;});
        const {ManagedExecutionClient}=require('../vscode-client/out/managedExecutionClient');
        const client=new ManagedExecutionClient(endpoint,'synthetic-token',W);
        await assert.rejects(client.negotiate(),/contract/);assert.equal(client.negotiated(),false);
        assert.equal(calls.some(c=>c.method==='tools/call'),false);
    });
});
