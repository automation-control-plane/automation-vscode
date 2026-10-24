// Simulated VS Code bridge tests. These are not native Extension Host or desktop acceptance.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const uri = fsPath => ({fsPath, toString() {return 'file://' + fsPath;}});
const dispose = () => ({dispose() {}});
class EventEmitter {
    listeners = [];
    event = callback => {this.listeners.push(callback); return {dispose: () => {this.listeners = this.listeners.filter(item => item !== callback);}};};
    fire = value => {for (const callback of this.listeners) callback(value);};
    dispose() {this.listeners = [];}
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const READY_STARTUP = {status:'ready',title:'Automation is ready',message:'Language services are available.'};
const STARTING_STARTUP = {status:'starting',title:'Starting Automation',message:'Preparing the language server Python environment.'};
const FAILED_STARTUP = {status:'failed',title:'Automation could not start',
    message:'Language server bootstrap could not download its Python environment because network access was blocked. Review diagnostic logs and your tooling settings before retrying.',reason:'network'};

function host({trusted = true, duplicateActions = false, startup = READY_STARTUP} = {}) {
    const requests = [], effects = [], posted = [], registrations = new Map(), opened = [], receivers = [];
    const providerRootCalls = [], providerCalls = [];
    const selectionChanged = new EventEmitter();
    const treeChanged = new EventEmitter();
    const startupChanged = new EventEmitter();
    const packageInfo = (directory, kind, name) => ({directory, packageType:kind, name,
        filePath:path.join(directory,kind === 'action' ? 'package.yaml' : 'robot.yaml'),
        yamlContents:kind === 'action' ? {dependencies:{pypi:['actions-work-items=0.4.4']}} : {tasks:{consume:{}}}});
    const infos = [packageInfo('/workspace/action-a','action','Same name'),packageInfo('/workspace/robot-b','task','Same name')];
    let roots = infos.map(robot => ({robot,label:robot.name,uri:uri(robot.filePath),type:robot.packageType === 'action' ? 'ActionPackage' : 'Robot'}));
    let selected = roots[0];
    let childResolver;
    const childrenFor = root => {
        const action = root.robot.packageType === 'action';
        const item = {robot:root.robot, parent:root, label:'consume',type:action ? 'Action' : 'Task',
            uri:uri(action ? path.join(root.robot.directory,'first.py') : root.robot.filePath),
            ...(action ? {actionName:'consume',action_package_uri:root.uri} : {taskName:'consume'})};
        return action && duplicateActions ? [item,{...item,uri:uri(path.join(root.robot.directory,'second.py'))}] : [item];
    };
    class RobotsTreeDataProvider {
        onDidChangeTreeData = treeChanged.event;
        async getValidCachedOrComputeChildren(root) {
            providerCalls.push(root?.robot?.filePath || null);
            if (!root) {providerRootCalls.push(null);return roots;}
            return childResolver ? childResolver(root, childrenFor) : childrenFor(root);
        }
    }
    const provider = new RobotsTreeDataProvider();
    const packageTree = {reveal:async entry => {effects.push(['reveal',entry.robot.filePath]);},dispose() {}};
    const globalOutputViewState = {uniqueRunIds:['run-1'],runIdToContents:new Map([['run-1',{label:'Actual retained run'}]]),
        setCurrentRunId:async target => effects.push(['select-run',target])};
    let runtimeStatus = {kind:'unknown-listener',message:'Not verified'};
    const vscode = {
        EventEmitter, TreeItem:class {constructor(label) {this.label=label;}},ThemeIcon:class {},ThemeColor:class {},
        TreeItemCollapsibleState:{None:0},ViewColumn:{Active:1},Uri:{file:uri,parse:value=>({toString:()=>value})},
        workspace:{isTrusted:trusted,getConfiguration:()=>({get:(_key,fallback)=>fallback}),onDidChangeConfiguration:()=>dispose()},
        commands:{registerCommand:(id,handler)=>{registrations.set(id,handler);return dispose();},executeCommand:async(id,...args)=>{
            requests.push([id,...args]);if(registrations.has(id))return registrations.get(id)(...args);
        }},
        env:{openExternal:async target=>opened.push(target.toString())},
        window:{createTreeView:()=>dispose(),showTextDocument:async document=>effects.push(['document',document.fsPath]),
            createWebviewPanel:()=>({title:'',reveal(){},onDidDispose:()=>dispose(),
                webview:{html:'',postMessage:async message=>{posted.push(message);return true;},
                    onDidReceiveMessage:handler=>{receivers.push(handler);return dispose();}}})},
    };
    const dependencies = {
        vscode,
        './channel':{logError() {}},
        './viewsCommon':{RobotEntryType:{Action:'Action',Task:'Task'},
            treeViewIdToTreeDataProvider:new Map([['packages-tree',provider]]),treeViewIdToTreeView:new Map([['packages-tree',packageTree]])},
        './viewsRobots':{RobotsTreeDataProvider},
        './viewsSelection':{getSelectedRobot:()=>selected,onSelectedRobotChanged:selectionChanged.event,
            onChangedRobotSelection:async(_tree,_provider,entries)=>{selected=entries[0];selectionChanged.fire(selected);}},
        './robocorpViews':{TREE_VIEW_SEMA4AI_TASK_PACKAGES_TREE:'packages-tree'},
        './activities':{resolveInterpreter:async manifest=>{effects.push(['resolve',manifest]);return {success:true,result:{pythonExe:'/verified/python'}};}},
        './runtimePaths':{runtimeHomes:()=>({actions:'/isolated/actions',robots:'/isolated/robots'})},
        './languageServerStartup':{getLanguageServerStartup:()=>startup,onLanguageServerStartupChanged:startupChanged.event},
        './output/outViewRunIntegration':{globalOutputViewState},
        './actionServer':{getRuntimeStatus:async directory=>{effects.push(['runtime-status',directory.fsPath]);return runtimeStatus;},
            reconnectActionServer:async directory=>{effects.push(['runtime-reconnect',directory.fsPath]);return true;}},
    };
    const modulePath = require.resolve('../vscode-client/out/runbookView');
    delete require.cache[modulePath];
    const load = Module._load;
    Module._load = function(name,parent,main) {
        if(parent?.filename===modulePath && Object.hasOwn(dependencies,name))return dependencies[name];
        return load.call(this,name,parent,main);
    };
    let register;
    try {register=require(modulePath).registerRunbookWorkspace;} finally {Module._load=load;}
    register({extensionPath:path.resolve(__dirname,'..'),subscriptions:[]});
    const open = async(route='packages')=>{await registrations.get('automation.runbook.open')(route);await tick();};
    const send = async message=>{assert.equal(receivers.length,1);await receivers[0](message);await tick();};
    const state = ()=>posted.filter(message=>message.type==='state').at(-1);
    return {open,send,state,requests,effects,posted,opened,infos,roots,childrenFor,providerRootCalls,providerCalls,
        setStartup:async value=>{startup=value;startupChanged.fire(value);await tick();},
        setSelection:async index=>{selected=roots[index];selectionChanged.fire(selected);await tick();},
        removeSelected:()=>{roots=roots.filter(root=>root!==selected);},
        deferChildren:fn=>{childResolver=fn;},setRuntime:value=>{runtimeStatus=value;},
        businessRequests:()=>requests.filter(([id])=>id!=='automation.runbook.open')};
}

test('Runbook mount and refresh discover real-shaped packages and runnables without launch or interpreter side effects', async()=>{
    const h=host();await h.open();await h.send({op:'refresh'});
    assert.deepEqual(h.businessRequests(),[]);assert.deepEqual(h.effects,[]);
    assert.deepEqual(h.state().packages.map(pkg=>pkg.kind),['Action','Robot']);
    assert.equal(h.state().runnable[0].name,'consume');assert.equal(h.state().runnable[0].source,'/workspace/action-a/first.py');
    await h.open('environments');
    assert.deepEqual(h.effects,[['runtime-status','/workspace/action-a']]);
    assert.deepEqual(h.businessRequests(),[]);
});

test('Package selection and explicit Action/Robot operations pass authoritative discovered entries, not webview arguments',async()=>{
    const h=host();await h.open();
    const action=h.state().runnable[0];
    await h.send({op:'action',action:'run',target:action.id,command:'workbench.action.terminal.new',args:['malicious'],directory:'/outside'});
    assert.equal(h.businessRequests().at(-1)[0],'sema4ai.robotsViewActionRun');
    assert.equal(h.businessRequests().at(-1)[1].robot.filePath,h.infos[0].filePath);
    assert.equal(h.businessRequests().at(-1).length,2);
    await h.send({op:'selectPackage',target:h.infos[1].filePath});
    assert.equal(h.state().selected.kind,'Robot');
    const task=h.state().runnable[0];await h.send({op:'action',action:'debug',target:task.id});
    assert.equal(h.businessRequests().at(-1)[0],'sema4ai.robotsViewTaskDebug');
    assert.equal(h.businessRequests().at(-1)[1].robot.filePath,h.infos[1].filePath);
});

test('Unknown and stale runnable/package/settings/run IDs cannot redirect host commands',async()=>{
    const h=host();await h.open();const old=h.state().runnable[0].id;
    await h.send({op:'selectPackage',target:h.infos[1].filePath});h.requests.length=0;
    for(const request of [{op:'selectPackage',target:'/outside/package.yaml'},
        {op:'action',action:'run',target:old},{op:'action',action:'debug',target:'/outside.py'},
        {op:'action',action:'edit-setting',target:'security.workspace.trust.enabled'},
        {op:'action',action:'open-run',target:'invented-run'}, {op:'action',action:'eval',target:'x'},
        {op:'execute',command:'workbench.action.terminal.new'}]) await h.send(request);
    assert.deepEqual(h.businessRequests(),[]);assert.equal(h.state().selected.kind,'Robot');
});

test('Runtime open rechecks ownership on click and ignores a forged endpoint',async()=>{
    const h=host();await h.open('environments');
    await h.send({op:'action',action:'runtime-open',target:'https://evil.invalid',endpoint:'https://evil.invalid'});
    assert.deepEqual(h.opened,[]);
    h.setRuntime({kind:'owned-running',endpoint:'http://127.0.0.1:18447',canReconnect:true});
    await h.send({op:'action',action:'runtime-open',endpoint:'https://evil.invalid'});
    assert.deepEqual(h.opened,['http://127.0.0.1:18447']);
    assert.ok(h.effects.filter(([kind])=>kind==='runtime-status').length>=3);
});

test('Untrusted workspace cannot run, resolve, or open inspectors through a spoofed bridge action',async()=>{
    const h=host({trusted:false});await h.open();
    const target=h.state().runnable[0].id;
    for(const action of ['run','debug','check-environment','runtime-start','web-inspector','terminal'])await h.send({op:'action',action,target});
    assert.deepEqual(h.businessRequests(),[]);assert.deepEqual(h.effects,[]);assert.match(h.state().error,/Trust this workspace/);
});

test('Recorder uses the selected package even if a different package has an active source editor',async()=>{
    const h=host();await h.open('inspectors');await h.send({op:'action',action:'recorder'});
    assert.deepEqual(h.businessRequests().at(-1),['sema4ai.openPlaywrightRecorder',true]);
});

test('Same-named Actions from different source files retain distinct runnable identities and source targets',async()=>{
    const h=host({duplicateActions:true});await h.open();
    const [first,second]=h.state().runnable;
    assert.notEqual(first.id,second.id,'manifest + name alone aliases distinct source entries');
    await h.send({op:'action',action:'source',target:first.id});
    await h.send({op:'action',action:'source',target:second.id});
    assert.deepEqual(h.effects.filter(([kind])=>kind==='document'),[['document',first.source],['document',second.source]]);
});

test('An obsolete selected package removed from discovery cannot still launch through the bridge',async()=>{
    const h=host();await h.open();h.removeSelected();await h.send({op:'refresh'});h.requests.length=0;
    await h.send({op:'action',action:'runtime-start'});
    assert.deepEqual(h.businessRequests(),[]);assert.match(h.state().error,/package|workspace|Refresh/i);
});

test('Robot task targets cannot enter Action-only input configuration through forged actions',async()=>{
    const h=host();await h.open();await h.send({op:'selectPackage',target:h.infos[1].filePath});h.requests.length=0;
    await h.send({op:'action',action:'action-inputs',target:h.state().runnable[0].id});
    assert.deepEqual(h.businessRequests(),[]);assert.match(h.state().error,/Action/);
});

test('Robot packages cannot invoke Action-only export or Runtime recovery through forged actions',async()=>{
    const h=host();await h.open();await h.send({op:'selectPackage',target:h.infos[1].filePath});h.requests.length=0;h.effects.length=0;
    for(const action of ['export','metadata','runtime-start','runtime-reconnect'])await h.send({op:'action',action});
    assert.deepEqual(h.businessRequests(),[]);
    assert.equal(h.effects.some(([kind])=>kind==='runtime-reconnect'),false);
    assert.match(h.state().error,/Action/);
});

test('Delayed discovery for an old package cannot overwrite the newly selected package view',async()=>{
    const h=host();await h.open();let release;
    const waiting=new Promise(resolve=>{release=resolve;});
    h.deferChildren(async(root,normal)=>{if(root.robot===h.infos[0])await waiting;return normal(root);});
    const staleRefresh=h.send({op:'refresh'});
    await tick();await h.setSelection(1);assert.equal(h.state().selected.id,h.infos[1].filePath);
    release();await staleRefresh;await tick();
    assert.equal(h.state().selected.id,h.infos[1].filePath);
    assert.ok(h.state().runnable.every(task=>task.id.startsWith(h.infos[1].filePath)));
});

test('Stale failed package discovery cannot overwrite a newer selected package success',async()=>{
    const h=host();await h.open();let release;
    const waiting=new Promise(resolve=>{release=resolve;});
    h.deferChildren(async(root,normal)=>{
        if(root.robot===h.infos[0]){await waiting;throw Error('old package discovery failed');}
        return normal(root);
    });
    const staleRefresh=h.send({op:'refresh'});
    await tick();await h.setSelection(1);
    assert.equal(h.state().selected.id,h.infos[1].filePath);
    release();await staleRefresh;
    assert.notEqual(h.posted.at(-1).type,'error','a stale failure must not supersede successful selected-package state');
    assert.equal(h.state().error,'');
});

test('A package switch during pre-action refresh cannot redirect a previously clicked terminal action',async()=>{
    const h=host();await h.open();let release;
    const waiting=new Promise(resolve=>{release=resolve;});
    h.deferChildren(async(root,normal)=>{if(root.robot===h.infos[0])await waiting;return normal(root);});
    const pending=h.send({op:'action',action:'terminal'});
    await tick();await h.setSelection(1);release();await pending;
    assert.deepEqual(h.businessRequests(),[],'an Action-package click must not open a Robot-package terminal after selection races');
    assert.match(h.state().error,/selected|selection|changed|package/i);
});

for (const startup of [STARTING_STARTUP,FAILED_STARTUP]) {
    test(`${startup.status} bootstrap does not query package providers on any Runbook route`,async()=>{
        const h=host({startup});
        for(const route of ['packages','environments','runs','inspectors','settings','work-items']) {
            await h.open(route);await h.send({op:'refresh'});
            assert.deepEqual(h.state().startup,startup);
            assert.deepEqual(h.state().packages,[]);
            assert.deepEqual(h.state().runnable,[]);
        }
        assert.deepEqual(h.providerRootCalls,[]);
        assert.deepEqual(h.providerCalls,[]);
        assert.deepEqual(h.businessRequests(),[]);
        assert.deepEqual(h.effects,[]);
    });

    test(`${startup.status} bootstrap rejects forged package actions and package selection`,async()=>{
        const h=host({startup});await h.open();
        for(const action of ['create-action','create-robot','create-agent','configure','dependencies','terminal',
            'check-environment','rebuild','runtime-start','runtime-reconnect','runtime-open','work-items',
            'run','debug','action-inputs','source','export','metadata','locators','web-inspector',
            'windows-inspector','image-inspector','java-inspector','recorder','reveal']) {
            await h.send({op:'action',action,target:'/workspace/action-a/package.yaml::stale'});
        }
        await h.send({op:'selectPackage',target:h.infos[1].filePath});
        assert.deepEqual(h.businessRequests(),[]);
        assert.deepEqual(h.effects,[]);
        assert.deepEqual(h.opened,[]);
        assert.deepEqual(h.providerCalls,[]);
    });
}

test('Failed bootstrap can become ready and discover packages through a normal refresh',async()=>{
    const h=host({startup:FAILED_STARTUP});await h.open();
    assert.deepEqual(h.providerRootCalls,[]);
    await h.setStartup(READY_STARTUP);await h.send({op:'refresh'});
    assert.deepEqual(h.state().startup,READY_STARTUP);
    assert.ok(h.providerRootCalls.length>0);
    assert.deepEqual(h.state().packages.map(pkg=>pkg.kind),['Action','Robot']);
    assert.equal(h.state().runnable[0].name,'consume');
    assert.deepEqual(h.businessRequests(),[]);
    assert.deepEqual(h.effects,[]);
});

test('A previously discovered runnable cannot launch after bootstrap fails',async()=>{
    const h=host();await h.open();const target=h.state().runnable[0].id;
    h.providerCalls.length=0;h.providerRootCalls.length=0;h.requests.length=0;h.effects.length=0;
    await h.setStartup(FAILED_STARTUP);
    for(const action of ['run','debug','action-inputs','terminal','runtime-start','work-items']) {
        await h.send({op:'action',action,target});
    }
    assert.deepEqual(h.state().startup,FAILED_STARTUP);
    assert.deepEqual(h.state().runnable,[]);
    assert.deepEqual(h.businessRequests(),[]);
    assert.deepEqual(h.effects,[]);
    assert.deepEqual(h.providerCalls,[]);
});

test('Failed bootstrap permits diagnostics and native Settings; explicit retry only reloads the window',async()=>{
    const h=host({startup:FAILED_STARTUP});await h.open();
    await h.send({op:'action',action:'diagnostics'});
    await h.send({op:'action',action:'native-settings'});
    assert.deepEqual(h.businessRequests(),[
        ['sema4ai.showOutput'],['workbench.action.openSettings','@ext:automation-control-plane.automation-vscode'],
    ]);
    await h.send({op:'action',action:'retry-startup',command:'sema4ai.createRobot',args:['ignored']});
    assert.deepEqual(h.businessRequests().at(-1),['workbench.action.reloadWindow']);
    assert.equal(h.businessRequests().length,3);
    assert.deepEqual(h.providerCalls,[]);
    assert.deepEqual(h.effects,[]);
});

for(const startup of [STARTING_STARTUP,READY_STARTUP]) {
    test(`Startup retry does not reload while bootstrap is ${startup.status}`,async()=>{
        const h=host({startup});await h.open();h.requests.length=0;
        await h.send({op:'action',action:'retry-startup'});
        assert.deepEqual(h.businessRequests(),[]);
    });
}

function workspaceDOM() {
    const messages=[],receivers=[],nodes=[];let saved;
    function element(tag){const node={tag,children:[],textContent:'',attributes:{},className:'',disabled:false,
        append(...children){for(const child of children){child.parent=this;this.children.push(child);}},
        prepend(...children){for(const child of children)child.parent=this;this.children.unshift(...children);},
        replaceChildren(...children){this.children=[];this.append(...children);},
        replaceWith(next){const index=this.parent.children.indexOf(this);this.parent.children.splice(index,1,next);next.parent=this.parent;},
        setAttribute(name,value){this.attributes[name]=value;},
        get lastChild(){return this.children.at(-1);},
        classList:{add(name){node.className+=' '+name;}},
        set innerHTML(_){assert.fail('Workspace content must use text nodes, not injected markup');}};nodes.push(node);return node;}
    const app=element('div');
    const scope={document:{createElement:element,getElementById:id=>{assert.equal(id,'app');return app;}},
        acquireVsCodeApi:()=>({postMessage:message=>messages.push(JSON.parse(JSON.stringify(message))),getState:()=>saved,setState:value=>{saved=value;}}),
        window:{addEventListener:(_,callback)=>receivers.push(callback)}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../resources/runbook/workspace.js'),'utf8'),scope);
    const all=node=>[node,...node.children.flatMap(all)];
    return {messages,receive:state=>receivers.forEach(fn=>fn({data:state})),all:()=>all(app),button:label=>all(app).find(node=>node.tag==='button'&&node.textContent===label&&node.className.includes('primary'))};
}

test('Owned navigation has a compact initial share and long package paths remain available without wrapping the context rail',async()=>{
    const views=JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8')).contributes.views['sem4ai-packages'];
    assert.equal(views.find(view=>view.id==='automation-navigation').initialSize,1);
    assert.equal(views.find(view=>view.id==='sema4ai-task-packages-tree').initialSize,4);
    const h=host();await h.open();const dom=workspaceDOM();dom.receive(h.state());
    const manifest=h.state().selected.manifest;
    const pathDetail=dom.all().find(node=>node.tag==='dd'&&node.textContent===manifest);
    assert.equal(pathDetail.title,manifest);
    const css=fs.readFileSync(path.join(__dirname,'../resources/runbook/workspace.css'),'utf8');
    assert.match(css,/\.context-rail \.detail dd\{[^}]*text-overflow:ellipsis/);
});

test('Workspace DOM mount only asks to refresh; explicit Run sends only the displayed target identity',async()=>{
    const h=host();await h.open();const dom=workspaceDOM();
    assert.deepEqual(dom.messages,[{op:'refresh'}]);dom.receive(h.state());
    assert.deepEqual(dom.messages,[{op:'refresh'}]);dom.button('Run').onclick();
    assert.deepEqual(dom.messages.at(-1),{op:'action',action:'run',target:h.state().runnable[0].id});
    assert.equal(dom.all().some(node=>node.textContent==='Same name'),true);
});

test('Every workspace route renders host state without issuing an execution, capture, configuration, or connection request',async()=>{
    const h=host();const dom=workspaceDOM();
    for(const route of ['packages','environments','runs','inspectors','settings']){
        await h.open(route);dom.receive(h.state());
        assert.deepEqual(dom.messages,[{op:'refresh'}],route);
    }
    await h.setSelection(-1);await h.open('packages');dom.receive(h.state());
    assert.ok(dom.all().some(node=>node.textContent==='Start with a package'));
    assert.deepEqual(dom.messages,[{op:'refresh'}]);
});

test('Host paths and result labels remain inert text, and package search changes no execution state',async()=>{
    const h=host();await h.open();const dom=workspaceDOM();const state=h.state();
    state.selected={...state.selected,name:'<script>not executable</script>'};dom.receive(state);
    assert.ok(dom.all().some(node=>node.textContent==='<script>not executable</script>'));
    const search=dom.all().find(node=>node.tag==='input'&&node.type==='search');
    search.value='robot-b';search.oninput();
    const packages=dom.all().filter(node=>node.tag==='button'&&node.className.includes('package-row'));
    assert.equal(packages.length,1);packages[0].onclick();
    assert.deepEqual(dom.messages.at(-1),{op:'selectPackage',target:h.infos[1].filePath});
    assert.equal(dom.messages.some(message=>message.op==='action'),false);
});

test('Bootstrap failure DOM explains the network cause without raw command IDs and exposes only explicit recovery controls',async()=>{
    const h=host();await h.open();const dom=workspaceDOM();
    const state={...h.state(),startup:FAILED_STARTUP,
        error:"command 'sema4ai.localListRobots.internal' not found"};
    dom.receive(state);
    const text=dom.all().map(node=>node.textContent).join('\n');
    assert.ok(text.includes(FAILED_STARTUP.title));
    assert.match(text,/bootstrap/i);assert.match(text,/network/i);
    assert.doesNotMatch(text,/sema4ai\.localListRobots\.internal|command .*not found/);
    assert.equal(dom.all().some(node=>node.tag==='button'&&!node.disabled&&['Run','Debug','Prepare Work Items','Create a package'].includes(node.textContent)),false);
    assert.deepEqual(dom.messages,[{op:'refresh'}],'rendering failure must not automatically retry or run');
    for(const [label,action] of [['Retry startup','retry-startup'],['Diagnostic logs','diagnostics'],['Open Settings','native-settings']]) {
        const button=dom.all().find(node=>node.tag==='button'&&node.textContent===label);
        assert.ok(button,label);assert.equal(button.disabled,false,label);button.onclick();
        assert.deepEqual(dom.messages.at(-1),{op:'action',action});
    }
});

test('Starting bootstrap DOM has no retry or package execution controls; ready state restores real runnables',async()=>{
    const h=host();await h.open();const dom=workspaceDOM();
    dom.receive({...h.state(),startup:STARTING_STARTUP});
    assert.ok(dom.all().some(node=>node.textContent===STARTING_STARTUP.title));
    assert.equal(dom.all().some(node=>node.tag==='button'&&node.textContent==='Retry startup'),false);
    assert.equal(dom.all().some(node=>node.tag==='button'&&!node.disabled&&['Run','Debug','Prepare Work Items','Create a package'].includes(node.textContent)),false);
    assert.deepEqual(dom.messages,[{op:'refresh'}]);
    dom.receive({...h.state(),startup:READY_STARTUP});
    assert.ok(dom.button('Run'));
    assert.equal(dom.all().some(node=>node.textContent===STARTING_STARTUP.title),false);
    dom.button('Run').onclick();
    assert.deepEqual(dom.messages.at(-1),{op:'action',action:'run',target:h.state().runnable[0].id});
});
