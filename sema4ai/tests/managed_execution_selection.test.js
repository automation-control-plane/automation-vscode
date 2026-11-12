const {test}=require('node:test');
const assert=require('node:assert/strict');
const {command,W,D,I,digest}=require('./fixtures/managed_contract');
const api=()=>require('../vscode-client/out/managedExecutionSelection');

function fixture(){
    const snapshot=command('items.enqueue').snapshot;
    snapshot.deployment.revision_id=digest;snapshot.runtime_kind='rcc';
    const queue={workspace_id:W,deployment:structuredClone(snapshot.deployment),queue_id:'input'};
    const descriptor={bindingId:'inspect_records',mode:'generic',snapshot,inputMode:'claim',inputQueue:queue,standaloneAllowed:false,inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value']}};
    const inspection={applicationId:D,activeRevisionId:digest,invocationDescriptors:[descriptor],invocationAvailability:'authorized',invocationReadiness:'not-checked'};
    return {inspection,descriptor,context:{workspace:W,applicationId:D},item:{id:I,snapshot:structuredClone(snapshot),queue:structuredClone(queue),queue_state:'IN_PROGRESS',claim:{queue:structuredClone(queue),item_id:I,owner_id:I,epoch:3}}};
}

test('Canonical Canvas discovery produces immutable typed UI selections without defaulting snapshot authority',()=>{
    assert.doesNotThrow(()=>{
        const {parseCanvasApplications,parseManagedInvocationDescriptors}=api();
        const apps=parseCanvasApplications({applications:[{applicationId:D,title:'NDJSON records',activeRevisionId:digest}]});
        assert.deepEqual(apps,[{applicationId:D,title:'NDJSON records',activeRevisionId:digest}]);
        const f=fixture(),selected=parseManagedInvocationDescriptors(f.inspection,f.context);
        assert.deepEqual(selected,[f.descriptor]);
        assert.equal(Object.hasOwn(selected[0].snapshot,'capability_authority'),false);
        assert.ok(Object.isFrozen(selected[0].snapshot.deployment));
        f.descriptor.snapshot.deployment.revision_id='changed';
        assert.equal(selected[0].snapshot.deployment.revision_id,digest);
    });
});

test('Discovery refuses cross-workspace/revision/queue descriptors and unknown authority or mode',()=>{
    const {parseManagedInvocationDescriptors:parse}=api();
    for(const mutate of [
        f=>f.inspection.applicationId=I,
        f=>f.descriptor.snapshot.deployment.workspace_id=I,
        f=>f.descriptor.snapshot.deployment.revision_id='sha256:'+'b'.repeat(64),
        f=>f.descriptor.inputQueue.workspace_id=I,
        f=>f.descriptor.inputQueue.deployment.deployment_id=I,
        f=>f.descriptor.mode='detached',
        f=>{
            Object.assign(f.descriptor.snapshot,{runtime_kind:'direct',capability_authority:'package-revision'});
            f.descriptor.snapshot.capability.capability_id='robot.task';
        },
        f=>f.descriptor.inputMode='future',
        f=>f.descriptor.snapshot.capability_authority='future',
        f=>f.descriptor.worker_id=I,
        f=>f.descriptor.inputQueue='invented',
        f=>f.descriptor.standaloneAllowed='true',
        f=>f.inspection.invocationReadiness='ready',
        f=>f.inspection.invocationDescriptors.push(structuredClone(f.descriptor)),
    ]){const f=fixture();mutate(f);assert.throws(()=>parse(f.inspection,f.context));}
    const f=fixture();f.inspection.invocationDescriptors=[];f.inspection.invocationAvailability='unavailable';
    assert.deepEqual(parse(f.inspection,f.context),[]);
    const projected=fixture();projected.descriptor.inputMode='required';projected.descriptor.standaloneAllowed=true;
    assert.equal(parse(projected.inspection,projected.context)[0].standaloneAllowed,true,'Preserve the server projection; mode is not a grant');
});

test('Claim invocation carries only the exact discovered snapshot and selected live claim',()=>{
    const {parseManagedInvocationDescriptors,buildManagedClaimInvocation}=api(),f=fixture();
    const [selected]=parseManagedInvocationDescriptors(f.inspection,f.context);
    const result=buildManagedClaimInvocation(selected,f.item);
    assert.deepEqual(result,{mode:'generic',snapshot:f.descriptor.snapshot,claim:f.item.claim});
    assert.ok(Object.isFrozen(result.claim));
    assert.equal(Object.hasOwn(result,'actor'),false);assert.equal(Object.hasOwn(result,'audience'),false);
    assert.equal(Object.hasOwn(result.snapshot,'capability_authority'),false);
    assert.deepEqual(f.item.claim,{queue:f.descriptor.inputQueue,item_id:I,owner_id:I,epoch:3});
});

test('Claim invocation rejects another item, changed snapshot, stale terminal state and forged owner fields',()=>{
    const {parseManagedInvocationDescriptors,buildManagedClaimInvocation}=api();
    for(const mutate of [
        f=>f.item.claim=null,
        f=>f.item.queue_state='DONE',
        f=>f.item.id=D,
        f=>f.item.claim.epoch=0,
        f=>f.item.claim.queue.queue_id='other',
        f=>f.item.queue.workspace_id=I,
        f=>f.item.snapshot.capability_authority='package-revision',
        f=>f.item.claim.actor={id:I},
    ]){const f=fixture();const [selected]=parseManagedInvocationDescriptors(f.inspection,f.context);mutate(f);assert.throws(()=>buildManagedClaimInvocation(selected,f.item));}
});

test('Canvas selection rejects duplicate IDs, excessive schemas and metadata masquerading as discovery',()=>{
    const {parseCanvasApplications,parseManagedInvocationDescriptors}=api();
    const app={applicationId:D,title:'NDJSON records',activeRevisionId:digest};
    assert.throws(()=>parseCanvasApplications({applications:[app,app]}));
    assert.throws(()=>parseCanvasApplications({_meta:{'actions.canvas':{applications:[app]}}}));
    assert.deepEqual(parseCanvasApplications({applications:[{...app,activeRevisionId:null}]}),[{...app,activeRevisionId:null}]);
    const f=fixture();f.descriptor.inputSchema.description='x'.repeat(33*1024);
    assert.throws(()=>parseManagedInvocationDescriptors(f.inspection,f.context));
});
