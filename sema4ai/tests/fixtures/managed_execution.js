const assert=require('node:assert/strict');
const http=require('node:http');
const schemas=require('../../resources/work-items/managed-mcp-schemas.json');
const {command,W,D,I,digest}=require('./managed_contract');
const version='2026-07-28';
function fixture(){
    const snapshot=command('items.enqueue').snapshot;snapshot.deployment.revision_id=digest;snapshot.runtime_kind='rcc';
    const queue={workspace_id:W,deployment:structuredClone(snapshot.deployment),queue_id:'input'};
    const descriptor={bindingId:'records',mode:'generic',snapshot,inputMode:'claim',inputQueue:queue,standaloneAllowed:false,inputSchema:{type:'object'}};
    const item={id:I,snapshot,queue,queue_state:'IN_PROGRESS',claim:{queue,item_id:I,owner_id:I,epoch:3},run_ids:[]};
    return {descriptor,item,inspection:{applicationId:D,activeRevisionId:digest,invocationDescriptors:[descriptor],invocationAvailability:'authorized',invocationReadiness:'not-checked'}};
}
function tools(){return Object.entries(schemas).map(([name,inputSchema])=>({name,inputSchema:structuredClone(inputSchema),_meta:{ui:{visibility:name==='capability_invoke'?['model']:['model','app']}},annotations:{readOnlyHint:name!=='capability_invoke'}}));}
async function serverFor(run){
    const calls=[];let override;
    const server=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
        const body=JSON.parse(raw);calls.push(body);
        assert.equal(req.url,'/mcp');assert.equal(req.headers.authorization,'Bearer synthetic-token');
        assert.equal(req.headers['mcp-protocol-version'],version);assert.equal(req.headers['mcp-method'],body.method);
        assert.equal(body.params._meta['io.modelcontextprotocol/protocolVersion'],version);
        assert.deepEqual(body.params._meta['io.modelcontextprotocol/clientCapabilities'],{});
        if(body.method==='tools/call')assert.equal(req.headers['mcp-name'],body.params.name);
        res.setHeader('Content-Type','application/json');
        const f=fixture();
        const results={'server/discover':{resultType:'complete',supportedVersions:[version],capabilities:{tools:{}},cacheScope:'private',ttlMs:0,_meta:{'io.modelcontextprotocol/serverInfo':{name:'Action Server',version:'2.3.0'}}},'tools/list':{tools:tools()}};
        let result=results[body.method];
        if(body.method==='tools/call')result={isError:false,content:[],structuredContent:body.params.name==='canvas_open'?{applications:[{applicationId:D,title:'Records',activeRevisionId:digest}]}:body.params.name==='canvas_inspect'?f.inspection:{execution:{state:'completed',runStatus:2,attemptState:'succeeded',workItemState:'COMPLETED',runId:I,attemptId:D,attemptEpoch:1,workItemId:I,workItemEpoch:3}}};
        if(override){const altered=override({body,result,req,res});if(altered===false)return;if(altered)result=altered;}
        res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));
    });});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    try{await run({endpoint:`http://127.0.0.1:${server.address().port}`,calls,setOverride:f=>override=f});}
    finally{await new Promise(r=>server.close(r));}
}

module.exports={fixture,tools,serverFor};
