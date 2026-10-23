const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const Module=require('node:module');
const F=require('../resources/work-items/form');
let selected;
const commands=new Map(),panels=[],stored=new Map();
function disposable(){return {dispose(){}};}
const vscode={workspace:{isTrusted:true},ViewColumn:{Active:1},commands:{registerCommand:(id,fn)=>{commands.set(id,fn);return disposable();}},
    debug:{registerDebugAdapterTrackerFactory:disposable,onDidStartDebugSession:disposable,onDidTerminateDebugSession:disposable},
    window:{createWebviewPanel:()=>{const posts=[];let receive,close;const panel={posts,webview:{html:'',postMessage:async value=>{posts.push(value);return true;},onDidReceiveMessage:fn=>{receive=fn;return disposable();}},onDidDispose:fn=>{close=fn;return disposable();},reveal(){},receive:value=>receive(value),dispose:()=>close()};panels.push(panel);return panel;}}};
const load=Module._load;Module._load=function(name,parent,main){
    if(parent?.filename.endsWith('/workItemsNative.js')) {
        if(name==='vscode')return vscode;
        if(name==='./activities')return {resolveInterpreter:()=>assert.fail('Draft restore must not resolve or execute a package')};
        if(name==='./viewsSelection')return {getSelectedRobot:()=>selected};
        if(name==='./managedWorkItemsView')return {ManagedWorkItemsView:class{}};
        if(name==='./workItemProposals')return {proposeWorkItemPayload:()=>assert.fail('Draft restore must not request a model')};
    }
    return load.call(this,name,parent,main);
};
let register;try{register=require('../vscode-client/out/workItemsNative').registerNativeWorkItems;}finally{Module._load=load;}
function context(){return {extensionPath:path.resolve('.'),subscriptions:[],workspaceState:{get:key=>stored.get(key),update:async(key,value)=>stored.set(key,value)}};}
test('Existing VS Code memento restores closed drafts, survives host recreation and isolates Action/Robot packages',async()=>{
    register(context());selected={robot:{filePath:'/synthetic/action/package.yaml'}};
    await commands.get('automation.workItems.open')();let panel=panels.at(-1);
    const state={version:1,mode:'file',queue:'input',name:'unsaved-invoice',activeKey:'file:new',dirty:true,root:F.fromValue({value:7}),parameters:{root:F.fromValue({})},managedRoot:{root:F.fromValue({})},drafts:[]};
    panel.receive({op:'editorDraftState',state});await Promise.resolve();assert.equal(stored.size,1);
    panel.dispose();await commands.get('automation.workItems.open')();panel=panels.at(-1);panel.receive({op:'restoreEditorDraft'});
    assert.deepEqual(panel.posts.at(-1),{type:'editorDraftRestore',state});
    panel.dispose();register(context());await commands.get('automation.workItems.open')();panel=panels.at(-1);panel.receive({op:'restoreEditorDraft'});
    assert.deepEqual(panel.posts.at(-1).state,state);
    selected={robot:{filePath:'/synthetic/robot/robot.yaml'}};await commands.get('automation.workItems.open')();panel=panels.at(-1);panel.receive({op:'restoreEditorDraft'});
    assert.equal(panel.posts.at(-1).state,undefined);
    panel.receive({op:'editorDraftState',state:{...state,token:'must-not-store'}});assert.equal(stored.size,1);assert.equal(panel.posts.at(-1).type,'error');
});
