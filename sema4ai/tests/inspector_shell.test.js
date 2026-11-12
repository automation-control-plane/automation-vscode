const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Browser failure survives closed/initializing and unrelated routes until an actual opened state',()=>{
    const {webInspectorFailure}=require('../resources/runbook/legacy-shell.js');
    const event=(status,data,message)=>({type:'event',event:{type:'browserState',status,data,message}});
    const error='Chromium1169 download failed: ECONNREFUSED <script>inert</script>';
    let state=webInspectorFailure(undefined,event('failure','closed',error));assert.equal(state,error);
    for(const message of [event('success','closed'),event('success','initializing'),inspectorEvent('/image-inspector/'),{type:'event',event:{type:'snippingToolState',status:'success',data:'opened'}}]) {
        state=webInspectorFailure(state,message);assert.equal(state,error);
    }
    assert.equal(webInspectorFailure(state,event('success','opened')),undefined);
    assert.equal(webInspectorFailure(state,event('failure','closed','x'.repeat(17000))).length,16384);
    function inspectorEvent(route){return {type:'event',event:{type:'gotoInspectorApp',status:'success',data:route}};}
});

test('Maintained Inspector shell renders the engine error as persistent inert text with prerequisite guidance',()=>{
    const fs=require('node:fs'),vm=require('node:vm');
    const markup=fs.readFileSync('resources/runbook/inspector-shell.html','utf8');
    const ids=new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
    const nodes=new Map([...ids].map(id=>[id,{hidden:true,textContent:'',set innerHTML(_){assert.fail('Engine errors must remain inert text');}}]));
    nodes.set('automation-surface-context',{textContent:JSON.stringify({startRoute:'/web-inspector/',packageName:'Synthetic',packageType:'action'})});
    const receivers=[];
    const document={readyState:'complete',getElementById:id=>nodes.get(id),querySelectorAll:()=>[],
        createElement:()=>({style:{},remove(){}}),body:{dataset:{automationSurface:'inspector'},classList:{contains:()=>false},style:{removeProperty(){}}}};
    const window={document,location:{hash:'#/web-inspector/'},addEventListener:(name,callback)=>{if(name==='message')receivers.push(callback);}};
    vm.runInNewContext(fs.readFileSync('resources/runbook/legacy-shell.js','utf8'),{window,MutationObserver:class{observe(){}}});
    const send=event=>receivers.forEach(callback=>callback({data:{type:'event',event}}));
    const banner=nodes.get('automation-inspector-error'),message=nodes.get('automation-inspector-error-message');
    assert.equal(banner.hidden,true);
    const error='Chromium1169 failed: ECONNREFUSED <script>inert</script>';
    send({type:'browserState',status:'failure',message:error,data:'closed'});
    assert.equal(banner.hidden,false);assert.equal(message.textContent,error);
    send({type:'browserState',status:'success',data:'closed'});assert.equal(banner.hidden,false);
    send({type:'gotoInspectorApp',status:'success',data:'/image-inspector/'});assert.equal(banner.hidden,true);
    send({type:'gotoInspectorApp',status:'success',data:'/web-inspector/'});assert.equal(banner.hidden,false);
    send({type:'browserState',status:'success',data:'opened'});assert.equal(banner.hidden,true);assert.equal(message.textContent,'');
    assert.match(markup,/role="alert"/);assert.match(markup,/Playwright environment/);assert.match(markup,/choose <strong>Start/);
    assert.match(markup,/Chromium sandboxing is required/);
    const result=nodes.get('automation-inspector-validation');
    const validation={id:'one',state:'pending',locator:{strategy:'css',value:'<img onerror=alert(1)>',url:'http://127.0.0.1/owned'}};
    const update=state=>receivers.forEach(callback=>callback({data:{type:'automation.webValidation',validation:{...validation,...state}}}));
    update({});assert.equal(result.hidden,false);assert.equal(nodes.get('automation-validation-summary').textContent,'Checking strategy…');
    update({state:'complete',matches:0});assert.equal(nodes.get('automation-validation-summary').textContent,'No matching elements');
    assert.equal(nodes.get('automation-validation-locator').textContent,'css: <img onerror=alert(1)>');
    send({type:'gotoInspectorApp',status:'success',data:'/image-inspector/'});assert.equal(result.hidden,true);
    send({type:'gotoInspectorApp',status:'success',data:'/web-inspector/'});assert.equal(result.hidden,false);
    update({state:'failed',message:'Selector failed <script>inert</script>'});
    assert.equal(nodes.get('automation-validation-summary').textContent,'Validation failed');
    assert.equal(nodes.get('automation-validation-message').textContent,'Selector failed <script>inert</script>');
    send({type:'urlChange',status:'success',data:'http://127.0.0.1/another'});assert.equal(result.hidden,true);
});

test('Inspector navigation emits only an existing route event, never starts a picker', () => {
    const { inspectorRouteEvent } = require('../resources/runbook/legacy-shell.js');
    for (const route of ['/locators-manager/', '/web-inspector/', '/windows-inspector/', '/image-inspector/', '/java-inspector/']) {
        assert.deepEqual(inspectorRouteEvent(route), { type: 'event', id: '', event: { type: 'gotoInspectorApp', status: 'success', data: route } });
    }
    assert.equal(inspectorRouteEvent('/api-inspector/'), undefined);
    assert.equal(inspectorRouteEvent('javascript:alert(1)'), undefined);
});

test('the Inspector context distinguishes Actions and Robot Tasks without inferred success or credentials', () => {
    const { packageContext } = require('../resources/runbook/legacy-shell.js');
    assert.deepEqual(packageContext({ packageName: 'Import records', packageType: 'action', directory: '/synthetic/actions' }), { name: 'Import records', kind: 'Action Package', directory: '/synthetic/actions' });
    assert.equal(packageContext({ packageName: 'Import records', packageType: 'robot', directory: '/synthetic/robots' }).kind, 'Robot Task');
    assert.equal(packageContext({}).name, 'No package selected');
});

test('Inspector keyboard navigation reaches every real route and wraps without invoking inspection', () => {
    const { nextInspectorRoute } = require('../resources/runbook/legacy-shell.js');
    assert.equal(nextInspectorRoute('/web-inspector/', 'ArrowRight'), '/windows-inspector/');
    assert.equal(nextInspectorRoute('/locators-manager/', 'ArrowLeft'), '/java-inspector/');
    assert.equal(nextInspectorRoute('/image-inspector/', 'Home'), '/locators-manager/');
    assert.equal(nextInspectorRoute('/image-inspector/', 'End'), '/java-inspector/');
    assert.equal(nextInspectorRoute('/image-inspector/', 'Enter'), undefined);
});

test('high-contrast color bridging reads rendered RGB channels without accepting arbitrary CSS', () => {
    const { rgbChannels } = require('../resources/runbook/legacy-shell.js');
    assert.equal(rgbChannels('rgb(255, 191, 36)'), '255, 191, 36');
    assert.equal(rgbChannels('rgb(0 0 0)'), '0, 0, 0');
    assert.equal(rgbChannels('rgba(255, 255, 255, 1)'), '255, 255, 255');
    assert.equal(rgbChannels('url(http://example.com)'), undefined);
    assert.equal(rgbChannels('rgb(999, 1, 2)'), undefined);
});

test('Output shell follows the selected log identity and never equates stream closure with success', () => {
    const { outputMessage } = require('../resources/runbook/legacy-shell.js');
    const initial = { runId: undefined, label: '' };
    const selected = outputMessage(initial, { type: 'request', command: 'setContents', runId: 'run-b', allRunIdsToLabel: { 'run-a': 'First', 'run-b': 'Second' }, initialContents: '' });
    assert.deepEqual(selected, { runId: 'run-b', label: 'Second' });
    assert.equal(outputMessage(selected, { type: 'request', command: 'updateLabel', runId: 'run-a', label: 'First (finished)' }), selected);
    assert.deepEqual(outputMessage(selected, { type: 'request', command: 'updateLabel', runId: 'run-b', label: 'Second (finished)' }), { runId: 'run-b', label: 'Second (finished)' });
    assert.equal(outputMessage(selected, { type: 'request', command: 'appendContents', runId: 'run-b', appendContents: 'log' }), selected);
});

test('Validation result remains labelled and ignores out-of-order replies; navigation clears its current-page claim',()=>{
    const {webValidation}=require('../resources/runbook/legacy-shell.js');
    const message=(id,state,rest={})=>({type:'automation.webValidation',validation:{id,state,locator:{strategy:'id',value:'owned',url:'http://127.0.0.1/fixture'},...rest}});
    let state=webValidation(undefined,message('a','pending'));
    state=webValidation(state,message('b','pending'));
    assert.equal(webValidation(state,message('a','complete',{matches:1})),state);
    state=webValidation(state,message('b','complete',{matches:0}));
    assert.equal(state.matches,0);assert.equal(state.locator.value,'owned');
    assert.equal(webValidation(state,{type:'event',event:{type:'gotoInspectorApp',status:'success',data:'/image-inspector/'}}),state);
    assert.equal(webValidation(state,{type:'event',event:{type:'urlChange',status:'success',data:'http://127.0.0.1/new'}}),undefined);
    assert.equal(webValidation(state,{type:'event',event:{type:'browserState',status:'success',data:'closed'}}),undefined);
});

test('Validation retains its pending identity when its own command opens or navigates the browser',()=>{
    const {webValidation}=require('../resources/runbook/legacy-shell.js');
    const pending={type:'automation.webValidation',validation:{id:'opening',state:'pending',locator:{strategy:'id',value:'probe',url:'http://127.0.0.1/requested'}}};
    for(const reply of [{state:'complete',matches:1},{state:'failed',message:'Sandbox unavailable'}]){
        let state=webValidation(undefined,pending);
        for(const event of [
            {type:'browserState',status:'success',data:'initializing'},
            {type:'browserState',status:'success',data:'opened'},
            {type:'urlChange',status:'success',data:pending.validation.locator.url},
            {type:'urlChange',status:'success',data:pending.validation.locator.url+'/'},
            {type:'urlChange',status:'success',data:'http://127.0.0.1/redirected'},
            {type:'browserState',status:'success',data:'closed'},
        ]) state=webValidation(state,{type:'event',event});
        state=webValidation(state,{type:'automation.webValidation',validation:{...pending.validation,...reply}});
        assert.equal(state.state,reply.state);
    }
});
