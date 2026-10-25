// Reviewed public schemas from Actions 7e0fa8d0 (native-invocation.md at
// 9340bc8a). Reuses the SAME reference definitions as the pinned managed API.
// This is a source-derived contract, never a pin learned from a live endpoint.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const definitions = structuredClone(require('../resources/work-items/managed-v1.json').commands.$defs);
const ref = name => ({$ref:'#/$defs/' + name});
const model = (title, properties) => ({additionalProperties:false, properties, required:Object.keys(properties), title, type:'object'});
definitions.ReviewedDispatch = model('ReviewedDispatch', {
    bindingId:{pattern:'^[A-Za-z][A-Za-z0-9_-]{0,63}$',title:'Bindingid',type:'string'}, proposal:ref('ReviewProposal')
});
const common = {mode:{const:'generic',title:'Mode',type:'string'},snapshot:ref('ExecutionSnapshot')};
definitions.GenericClaimInvocation = model('GenericClaimInvocation', {...common,claim:ref('ClaimRef')});
definitions.GenericStandaloneInvocation = model('GenericStandaloneInvocation', {...common,
    inputs:{additionalProperties:ref('JsonValue'),title:'Inputs',type:'object'},
    idempotencyKey:{maxLength:128,minLength:1,title:'Idempotencykey',type:'string'}
});
const used = {};
function collect(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {const key=value.$ref.slice(8);if (!Object.hasOwn(used,key)) {used[key]=definitions[key];if (!used[key]) throw Error(key);collect(used[key]);}}
    for (const child of Object.values(value)) collect(child);
}
const invoke = {anyOf:['ReviewedDispatch','GenericClaimInvocation','GenericStandaloneInvocation'].map(ref),type:'object',
    description:'Invoke an exact immutable generic capability as the authenticated model, or preserve the explicit human-reviewed invocation variant. Generic input is either an exact existing claim or standalone inputs and an idempotency key. No request chooses worker identity, source, credentials or profiles. An existing uncertain launch requires reconciliation; it is not retried.'};
collect(invoke);
const schemas = {
    canvas_open:{type:'object',properties:{},additionalProperties:false},
    canvas_inspect:{type:'object',description:'Inspect authorized immutable revision history and identify the active revision. Each returned revision includes its authored CanvasSpec, not private binding targets or source.',properties:{appId:{type:'string',format:'uuid',description:'Authorized Canvas application UUID.'}},required:['appId'],additionalProperties:false},
    capability_invoke:{$defs:used,...invoke}
};
fs.writeFileSync(path.join(root,'resources/work-items/managed-mcp-schemas.json'),JSON.stringify(schemas,null,2)+'\n');
