// Schema-generated protocol fixtures; not Runtime storage/auth acceptance.
const contract = require('../../resources/work-items/managed-v1.json');
const {MANAGED_VERSION,managedCommandSchema}=require('../../vscode-client/out/managedWorkItemsClient');
const W = '11111111-1111-4111-8111-111111111111';
const D = '22222222-2222-4222-8222-222222222222';
const R = '33333333-3333-4333-8333-333333333333';
const I = '44444444-4444-4444-8444-444444444444';
const digest = 'sha256:' + 'a'.repeat(64);
const queue = {workspace_id:W,deployment:{workspace_id:W,deployment_id:D,revision_id:R},queue_id:'qa'};

// Schema-generated protocol fixtures, NOT a real SQL/auth/worker acceptance.
function example(schema, root=schema) {
    if (schema.$ref) {
        const name = schema.$ref.slice(8);
        if (name === 'WorkspaceId') return W;
        if (name === 'DeploymentId') return D;
        if (name === 'DeploymentRevisionId') return R;
        if (name === 'QueueRef') return structuredClone(queue);
        return example(root.$defs[name],root);
    }
    if ('const' in schema) return schema.const;
    if (schema.enum) return schema.enum[0];
    if (schema.anyOf || schema.oneOf) return example((schema.anyOf || schema.oneOf)[0],root);
    if (schema.type === 'object') return Object.fromEntries((schema.required||[]).map(key=>[key,example(schema.properties[key],root)]));
    if (schema.type === 'array') return [];
    if (schema.type === 'boolean') return false;
    if (schema.type === 'integer' || schema.type === 'number') return schema.minimum || 0;
    if (schema.type === 'string') {
        if (schema.format === 'uuid' || schema.pattern?.includes('[0-9a-f-]{36}')) return I;
        if (schema.pattern?.startsWith('^sha256:')) return digest;
        if (schema.pattern?.includes('[0-9]{1,20}')) return '1';
        return 'a'.repeat(Math.max(schema.minLength||1,1));
    }
    return null;
}
function command(op) {
    const value=example(managedCommandSchema(op)); value.operation=op; value.schema_version=MANAGED_VERSION;
    if (op==='queues.list') value.workspace_id=W;
    else value.queue=structuredClone(queue);
    if (op==='items.get' || op==='items.retry' || op==='items.cancel') value.item_id=I;
    if (value.claim) {value.claim.item_id=I;value.claim.owner_id=I;}
    if (op.startsWith('runs.')) value.run_id=I;
    if (op==='artifacts.read') value.artifact_handle='synthetic-artifact';
    return value;
}
function response(cmd) {
    const value=example(contract.results[cmd.operation]);
    if (value.item) {
        value.item.id=cmd.item_id || I;
        value.item.claim=null;value.item.lease_deadline_ms=null;
        if (cmd.operation==='items.claim'||cmd.operation==='items.renew') {
            const claim={queue:structuredClone(queue),item_id:I,owner_id:I,epoch:1};
            value.item.claim=claim;value.item.lease_deadline_ms='100';value.claim=claim;value.lease_deadline_ms='100';
        }
    }
    if (value.review) {value.review.proposal=cmd.proposal;value.review.state=cmd.decision==='approve'?'approved':'rejected';value.review.work_item_id=null;}
    if (value.run) {value.run.id=I;value.run.artifacts=[];value.run.attempts=[];}
    if ('run_id'in value) value.run_id=I;
    if (value.artifact) {value.artifact.handle=cmd.artifact_handle;value.artifact.run_id=I;value.artifact.size=0;value.data_base64='';}
    return {schema_version:MANAGED_VERSION,operation:cmd.operation,runtime_version:'1.1.0a13',result:value};
}

module.exports={command,response,queue,W,D,R,I,digest};
