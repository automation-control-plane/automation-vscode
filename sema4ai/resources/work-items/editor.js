/* Form-first Work Items; advanced JSON is optional and never executed. */
const api = acquireVsCodeApi();
const byId = id => document.getElementById(id);
let selected, items = [], mode = 'file', contractRevision, contract = {};
let activeDraftKey, payloadDirty = false, proposalTarget;
const drafts = new Map();
function copyNode(value) {return value === undefined ? undefined : JSON.parse(JSON.stringify(value));}
function showPayloadValue(editor, preview, validation) {
    try {byId(preview).value = editor.getJSON(); byId(validation).textContent = '';}
    catch (error) {byId(validation).textContent = error.message;}
}
const payloadEditor = new WorkItemForms.Editor(byId('payload-fields'), {onChange: editor => {payloadDirty = true; showPayloadValue(editor,'payload','validation');}});
const parametersEditor = new WorkItemForms.Editor(byId('parameters-fields'), {onChange: editor => showPayloadValue(editor,'parameters','parameters-validation')});
const proposalEditor = new WorkItemForms.Editor(byId('proposal-fields'));
function send(op, extra = {}) {api.postMessage({op, id: selected?.id, revision: selected?.revision, ...extra});}
function object(id) {
    const value = (id === 'parameters' ? parametersEditor : payloadEditor).getValue();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('This package expects an object payload. Add named fields in the form.');
    return value;
}
function stashDraft() {
    if (activeDraftKey && payloadDirty) drafts.set(activeDraftKey, {root:copyNode(payloadEditor.root), error:payloadEditor.error, revision:selected?.revision});
}
function select(item, fresh = false) {
    stashDraft();
    selected = item ? {...item} : undefined;
    activeDraftKey = mode + ':' + (item?.id || 'new');
    if (fresh) drafts.delete(activeDraftKey);
    const saved = drafts.get(activeDraftKey);
    let unchanged = false;
    if (saved?.root && item) try {unchanged = WorkItemForms.stringify(WorkItemForms.toValue(saved.root)) === WorkItemForms.stringify(item.payload);} catch {}
    if (saved && !unchanged) {
        payloadEditor.root = copyNode(saved.root); payloadEditor.error = saved.error; payloadEditor.render(); payloadDirty = true;
        if (selected) selected.revision = saved.revision;
    } else {
        drafts.delete(activeDraftKey); payloadEditor.setValue(item ? item.payload : {}); payloadDirty = false;
        if (!item) for (const [name, type] of Object.entries(contract)) {
            payloadEditor.root.entries.push({key:name,node:WorkItemForms.node(['integer','number'].includes(type) ? 'number' : type)});
        }
    }
    byId('selection').textContent = item ? (item.name || item.id) : 'New input';
    const output = item?.role === 'output' || item?.queue_name?.endsWith('.outputs');
    payloadEditor.setReadOnly(!!output || (!!item && mode !== 'file'));
    byId('payload').readOnly = payloadEditor.readOnly;
    byId('payload-apply-json').disabled = payloadEditor.readOnly;
    showPayloadValue(payloadEditor,'payload','validation');
    byId('details').textContent = item ? JSON.stringify(item, null, 2) : '';
    byId('files').replaceChildren();
    for (const name of item?.files || []) {
        const button = document.createElement('button'); button.textContent = name + ' — save copy';
        button.onclick = () => send('download', {name}); byId('files').append(button);
    }
    byId('save').disabled = !item || mode !== 'file' || item.role !== 'input';
    byId('attach').disabled = !item;
    byId('replay').disabled = !item || mode === 'managed' || mode === 'published';
    for (const id of ['run','debug']) byId(id).disabled = !item || !!output || mode === 'managed' || mode === 'published';
}
byId('payload-apply-json').onclick = () => {try {payloadEditor.setJSON(byId('payload').value);} catch(error) {byId('validation').textContent=error.message;}};
byId('parameters-apply-json').onclick = () => {try {parametersEditor.setJSON(byId('parameters').value);} catch(error) {byId('parameters-validation').textContent=error.message;}};
byId('reload-payload').onclick = () => select(items.find(item => item.id === selected?.id), true);
byId('propose-fields').onclick = () => send('proposePayload', {instructions:byId('proposal-instructions').value});
byId('apply-proposal').onclick = () => {
    try {
        if(!proposalTarget || proposalTarget.mode !== mode || proposalTarget.input_id !== selected?.id)throw Error('Return to the original draft before applying this proposal.');
        const target=mode==='managed'?managedPayloadEditor:payloadEditor;
        if(target.readOnly)throw Error('Create a new input draft before applying a proposal.');
        target.setValue(proposalEditor.getValue());
        if(mode==='managed')showPayloadValue(target,'managed-payload','managed-payload-validation');
        else {payloadDirty=true;showPayloadValue(target,'payload','validation');}
        byId('proposal-review').hidden=true;byId('status').textContent='Applied to draft only. Save or run requires a separate action.';
    }
    catch(error){byId('proposal-status').textContent=error.message;}
};
window.addEventListener('message', ({data}) => {
    if(data.type === 'proposal-cancelled'){byId('status').textContent='Proposal cancelled. Draft unchanged.';return;}
    if(data.type !== 'payload-proposal')return;
    byId('status').textContent='Proposal ready for review.';
    try {proposalEditor.setJSON(data.json);proposalTarget={mode:data.mode,input_id:data.input_id};byId('proposal-review').hidden=false;byId('proposal-status').textContent='Review these proposed fields and values, then explicitly apply them to the draft.';}
    catch(error){proposalTarget=undefined;byId('proposal-review').hidden=true;byId('proposal-status').textContent='Proposal rejected: '+error.message;}
});
for (const id of ['create','save','replay','attach','run','debug']) byId(id).onclick = () => {
    try {
        const extra = {name: byId('name').value};
        if (['create','save'].includes(id)) extra.payload = object('payload');
        if (['run','debug'].includes(id) && mode === 'file') extra.payload = object('payload');
        if (['run','debug'].includes(id)) extra.parameters = object('parameters');
        byId('validation').textContent = ''; send(id, extra);
    } catch (error) { byId('validation').textContent = error.message; }
};
byId('new').onclick = () => select(undefined, true);
byId('connect').onclick = () => send(mode === 'managed' ? 'managed.connect' : 'connect');
byId('recover').onclick = () => send('recover');
function showMode() {byId('local-root').hidden = mode === 'managed'; byId('managed-root').hidden = mode !== 'managed'; byId('local-queue-label').hidden = mode === 'managed';}
byId('refresh').onclick = () => send(mode === 'managed' ? 'managed.refresh' : 'mode', {mode: byId('mode').value, queue: byId('queue').value});
byId('mode').onchange = () => {mode = byId('mode').value; showMode(); items = []; byId('items').replaceChildren(); byId('receipts').replaceChildren(); select(undefined); send('mode', {mode, queue: byId('queue').value});};
window.addEventListener('message', ({data}) => {
    byId('status').className = data.type === 'error' ? 'error' : '';
    if (data.type === 'loading') {byId('status').textContent = 'Loading…'; return;}
    if (data.type === 'error' || data.type === 'unsupported') {byId('status').textContent = data.message; return;}
    if (data.type !== 'state') return;
    mode = data.mode; items = data.items || [];
    showMode();
    byId('mode').value = mode;
    byId('queue').value = data.queue || 'input';
    byId('recover').disabled = mode !== 'sqlite';
    byId('run').textContent = mode === 'sqlite' ? 'Run next input' : 'Save & Run selected input';
    byId('debug').textContent = mode === 'sqlite' ? 'Debug next input' : 'Save & Debug selected input';
    contractRevision = data.contract_revision; contract = data.contract || {};
    byId('validation-hints').textContent = Object.keys(contract).length ? 'Declared required fields: ' + Object.entries(contract).map(([name,type]) => name + ' (' + type + ')').join(', ') : 'Add fields and choose their value types. No schema is required.';
    byId('package').textContent = data.package; byId('authority').textContent = data.authority;
    byId('status').textContent = items.length ? items.length + ' inputs and outputs. Select an input to work with it.' : 'No items yet. Create an input with its payload, then add attachments and Run or Debug.';
    byId('items').replaceChildren();
    for (const item of items) {
        const replay = (data.replays || []).find(entry => entry.copy === item.id && entry.mode === mode);
        if (replay) item.local_replay_source = replay.source;
        const button = document.createElement('button'); button.textContent = (item.name || item.id) + ' · ' + (item.role || item.queue_name || '') + ' · ' + item.state;
        button.onclick = () => select(item); byId('items').append(button);
    }
    byId('receipts').replaceChildren();
    const latest=(data.receipts || []).at(-1);
    byId('last-execution').textContent=latest ? latest.state==='EXITED' ? 'Last execution '+(latest.exit_code===0?'succeeded':'failed')+' (exit '+latest.exit_code+').' : 'Last execution: '+latest.state+(latest.state==='TERMINATED'?' — exit code was not reported.':'') : '';
    byId('latest-outputs').replaceChildren();
    if(latest) for(const item of items.filter(item=>item.parent_id===latest.input || item.id.replaceAll('\\','/').includes('/native-'+latest.id+'/'))) {
        const button=document.createElement('button');
        const preview=item.payload && typeof item.payload==='object' ? Object.entries(item.payload).slice(0,3).map(([name,value])=>name+': '+(value===null?'null':typeof value==='object'?'structured value':String(value))).join(', ') : String(item.payload);
        button.textContent='Output · '+preview;button.onclick=()=>select(item);byId('latest-outputs').append(button);
    }
    for (const receipt of data.receipts || []) {
        const card = document.createElement('section');
        const title = document.createElement('h3'); title.textContent = (receipt.mode === 'sqlite' ? 'Local queue' : 'Local input') + ' · ' + ({STARTED:'Running',PREPARED:'Ready to run',CANCELLED:'Cancelled by you',LAUNCH_REJECTED:'Could not start',TERMINATED:'Finished; exit code unavailable',STOPPED:'Session ended',EXITED:'Finished'}[receipt.state] || receipt.state) + (receipt.exit_code !== undefined ? ' · exit ' + receipt.exit_code : ''); card.append(title);
        const input = document.createElement('button'); input.textContent = 'Input: ' + (items.find(item=>item.id===receipt.input)?.name || receipt.input);
        input.onclick = () => select(items.find(item => item.id === receipt.input)); card.append(input);
        const outputs = items.filter(item => item.parent_id === receipt.input || item.id.replaceAll('\\', '/').includes('/native-' + receipt.id + '/'));
        for (const output of outputs) {const button = document.createElement('button'); button.textContent = (receipt.mode === 'sqlite' ? 'Linked output: ' : 'Output: ') + output.id; button.onclick = () => select(output); card.append(button);}
        const detail = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Execution identity and provenance'; detail.append(summary);
        const raw = document.createElement('pre'); raw.textContent = JSON.stringify(receipt, null, 2); detail.append(raw); card.append(detail); byId('receipts').append(card);
        if (receipt.state === 'STARTED' && !receipt.session_active) {const note = document.createElement('p'); note.textContent = 'This execution belongs to a previous editor session. Refresh item status to see its saved results.'; byId('receipts').append(note);}
        if (receipt.session_active) {const button = document.createElement('button'); button.textContent = 'Stop ' + receipt.id; button.onclick = () => send('cancel', {id: receipt.id}); byId('receipts').append(button);}
    }
    select(items.find(item => item.id === (data.selectId || selected?.id)));
});
showPayloadValue(parametersEditor,'parameters','parameters-validation');select(undefined); send('refresh');
