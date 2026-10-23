/* Named Action argument cases. The host alone owns files, metadata and save conflicts. */
const api=acquireVsCodeApi(),byId=id=>document.getElementById(id);
let cases=[],selectedKey,sourceRevision,sequence=0,dirty=false,ready=false,nativeDirty=false,saving=false;
const editor=new WorkItemForms.Editor(byId('fields'),{onChange:()=>{dirty=true;updatePreview();stash();renderCases();persist();}});
function current(){return cases.find(entry=>entry.key===selectedKey);}
function stash(){const entry=current();if(entry){entry.name=byId('case-name').value;entry.state=editor.getState();}}
function persist(){if(!ready)return;stash();api.postMessage({op:'draft',state:{version:1,revision:sourceRevision,cases,selectedKey,dirty}});updateControls();}
function updatePreview(){try{byId('json').value=editor.getJSON();byId('validation').textContent='';}catch(error){byId('validation').textContent=error.message;}}
function updateControls(){byId('save').disabled=!ready||nativeDirty||saving;byId('case-name').disabled=saving;byId('apply-json').disabled=saving;byId('json').readOnly=saving;byId('new-case').disabled=!ready||cases.length>=100||saving;byId('remove-case').disabled=!ready||cases.length<=1||saving;byId('draft-state').textContent=dirty?'Unsaved draft':'Saved';}
function renderCases(){byId('cases').replaceChildren();for(const entry of cases){const button=document.createElement('button');button.className='list-item';button.textContent=entry.name||'Unnamed case';button.ariaCurrent=String(entry.key===selectedKey);button.disabled=saving;button.onclick=()=>select(entry.key);byId('cases').append(button);}}
function select(key){stash();selectedKey=key;const entry=current();if(!entry)return;editor.setState(entry.state);byId('case-name').value=entry.name;updatePreview();renderCases();updateControls();if(ready)persist();}
function valueFor(entry){if(entry.state.error)throw Error(entry.name+': '+entry.state.error);return WorkItemForms.toValue(entry.state.root);}
byId('case-name').oninput=()=>{dirty=true;stash();renderCases();persist();};
byId('new-case').onclick=()=>{stash();let number=cases.length+1,name='input-'+number;while(cases.some(entry=>entry.name===name))name='input-'+(++number);const entry={key:'case-'+(++sequence),index:null,name,state:{root:WorkItemForms.fromValue({})}};cases.push(entry);dirty=true;select(entry.key);persist();byId('case-name').focus?.();};
byId('remove-case').onclick=()=>api.postMessage({op:'remove',key:selectedKey});
byId('advanced').onclick=()=>api.postMessage({op:'advanced'});
byId('reload').onclick=()=>api.postMessage({op:'reload'});
byId('apply-json').onclick=()=>{try{editor.setJSON(byId('json').value);}catch(error){byId('validation').textContent=error.message;}};
byId('save').onclick=()=>{try{stash();const names=new Set();const inputs=cases.map(entry=>{if(!entry.name.trim()||names.has(entry.name))throw Error('Give every case a unique name.');names.add(entry.name);return {index:entry.index,inputName:entry.name,inputValue:valueFor(entry)};});saving=true;editor.setReadOnly(true);updateControls();renderCases();api.postMessage({op:'save',revision:sourceRevision,inputs});byId('status').textContent='Saving inputs…';}catch(error){byId('validation').textContent=error.message;}};
window.addEventListener('message',({data})=>{
    if(data.type==='unsupported'){ready=false;byId('status').className='error';byId('status').textContent=data.message;updateControls();return;}
    if(data.type==='error'){saving=false;editor.setReadOnly(false);byId('status').className='error';byId('status').textContent=data.message;updateControls();return;}
    if(data.type==='saved'){byId('status').className='';byId('status').textContent='Inputs saved. Run or Debug the Action when ready.';dirty=false;updateControls();return;}
    if(data.type==='removed'){if(cases.length<=1)return;cases=cases.filter(entry=>entry.key!==data.key);dirty=true;if(selectedKey===data.key){selectedKey=undefined;select(cases[0].key);}renderCases();persist();return;}
    if(data.type!=='state')return;
    ready=false;saving=false;editor.setReadOnly(false);nativeDirty=!!data.nativeDirty;byId('action-title').textContent=data.actionName;byId('action-source').textContent=(data.metadata.actionRelativePath||'Action')+' · Named input cases';byId('file-path').textContent=data.path;byId('action-kind').textContent=(data.metadata.kind||'action')+' · '+data.metadata.inputFileVersion;byId('metadata').textContent=JSON.stringify(data.metadata,null,2);byId('schema-help').replaceChildren();
    for(const line of data.metadata.schemaDescription||[]){const text=document.createElement('p');text.textContent=String(line);byId('schema-help').append(text);}
    const draft=data.draft;
    if(draft?.version===1&&Array.isArray(draft.cases)&&draft.cases.length){cases=draft.cases;selectedKey=undefined;sourceRevision=draft.revision;dirty=!!draft.dirty;sequence=Math.max(...cases.map(entry=>Number(String(entry.key).replace('case-',''))||0));select(cases.find(entry=>entry.key===draft.selectedKey)?.key||cases[0].key);}
    else {cases=data.inputs.map((entry,index)=>({key:'case-'+(++sequence),index,name:entry.inputName,state:{root:WorkItemForms.fromValue(entry.inputValue)}}));selectedKey=undefined;sourceRevision=data.revision;dirty=false;select(cases[0].key);}
    const conflict=nativeDirty?'The native JSON editor has unsaved changes. Save or revert there, then reload this form.':sourceRevision!==data.revision?'The saved file changed while this draft was closed. Your draft is preserved; reload before saving, or review advanced JSON.':'';
    byId('conflict').textContent=conflict;byId('conflict').hidden=!conflict;byId('status').className='';byId('status').textContent=dirty?'Unsaved draft restored. Saved inputs are unchanged.':'';ready=true;updateControls();
});
updateControls();api.postMessage({op:'ready'});
