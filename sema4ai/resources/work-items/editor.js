/* Native Work Items view. Host messages remain the only execution boundary. */
const api = acquireVsCodeApi();
const byId = id => document.getElementById(id);
let selected, items = [], receipts = [], mode = 'file', contract = {};
let activeDraftKey, activeRevision, payloadDirty = false, proposalTarget, editorReady = false, restoredSelection;
let replaySource, listKind = 'input', packagePath = '', loading = false, activeQueue = 'input';
const drafts = new Map();
const copyNode = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const isOutput = item => !!(item?.role === 'output' || item?.queue_name?.endsWith('.outputs'));
const draftKey = id => mode + ':' + activeQueue + ':' + (id || 'new');
function showPayloadValue(editor, preview, validation) {
    try { byId(preview).value = editor.getJSON(); byId(validation).textContent = ''; }
    catch (error) { byId(validation).textContent = error.message; }
}
const payloadEditor = new WorkItemForms.Editor(byId('payload-fields'), {onChange: editor => {
    payloadDirty = true; showPayloadValue(editor, 'payload', 'validation'); updateControls(); persistEditorState();
}});
const parametersEditor = new WorkItemForms.Editor(byId('parameters-fields'), {onChange: editor => {
    showPayloadValue(editor, 'parameters', 'parameters-validation'); persistEditorState();
}});
const proposalEditor = new WorkItemForms.Editor(byId('proposal-fields'));
function send(op, extra = {}) { api.postMessage({op, id: selected?.id, revision: selected?.revision, ...extra}); }
function object(id) {
    const value = (id === 'parameters' ? parametersEditor : payloadEditor).getValue();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('This package expects named fields. Choose an object payload.');
    return value;
}
function stashDraft() {
    if (activeDraftKey && payloadDirty) drafts.set(activeDraftKey, {
        ...payloadEditor.getState(), revision: activeRevision, name: byId('name').value, replaySource: copyNode(replaySource),
    });
}
function persistEditorState() {
    if (!editorReady) return;
    try {
        stashDraft();
        const state = {version:1, mode, queue:activeQueue, name:byId('name').value || 'input',
            activeKey:activeDraftKey, selectedId:selected?.id || restoredSelection, revision:activeRevision, dirty:payloadDirty,
            ...payloadEditor.getState(), parameters:parametersEditor.getState(), managedRoot:managedPayloadEditor.getState(),
            replaySource:copyNode(replaySource), drafts:[...drafts].filter(([key]) => key !== activeDraftKey)};
        api.setState?.(state); api.postMessage({op:'editorDraftState', state});
    } catch (error) {
        byId('validation').textContent = 'Unable to preserve this draft: ' + error.message + '. Keep this tab open and save the input.';
    }
}
function restoreEditorState(state) {
    if (state?.version === 1 && ['file','sqlite','published','managed'].includes(state.mode)) {
        mode = state.mode; activeQueue = state.queue || 'input'; byId('mode').value = mode; byId('queue').value = activeQueue; byId('name').value = state.name || 'input';
        drafts.clear(); for (const [key, value] of state.drafts || []) drafts.set(key, value);
        activeDraftKey = state.activeKey; activeRevision = state.revision; restoredSelection = state.selectedId;
        payloadDirty = !!state.dirty; replaySource = state.replaySource;
        payloadEditor.setState(state); parametersEditor.setState(state.parameters); managedPayloadEditor.setState(state.managedRoot);
        showPayloadValue(payloadEditor, 'payload', 'validation'); showPayloadValue(parametersEditor, 'parameters', 'parameters-validation');
        showPayloadValue(managedPayloadEditor, 'managed-payload', 'managed-payload-validation');
    }
    if (!byId('name').value) byId('name').value = 'input';
    if (!byId('queue').value) byId('queue').value = 'input';
    editorReady = true; showMode(); send('mode', {mode, queue:byId('queue').value});
}
function initializeWorkItemEditor() {
    const state = api.getState?.(); if (state) restoreEditorState(state); else send('restoreEditorDraft');
}
function preview(item) {
    return Object.entries(item?.payload || {}).slice(0, 2).map(([key, value]) => key + ': ' +
        (value === null ? 'null' : typeof value === 'object' ? Array.isArray(value) ? value.length + ' items' : 'object' : String(value))).join(' · ');
}
function title(item) {
    if (!item) return 'New input';
    if (item.name && !/^native-/.test(item.name)) return item.name.replace(/-[a-f0-9]{12}$/, '');
    return (isOutput(item) ? 'Output' : 'Input') + (preview(item) ? ' · ' + preview(item).slice(0, 60) : '');
}
function status(item) {
    return ({LOCAL_FIXTURE:'Ready',PENDING:'Waiting',COMPLETED:'Completed',FAILED:'Failed',RESERVED:'In progress',INVALID:'Invalid input'}[item?.state] || item?.state || 'Stored');
}
function actionButton(label, fn, className = 'quiet') {
    const button = document.createElement('button'); button.textContent = label; button.className = className; button.onclick = fn; return button;
}
function renderItems() {
    byId('show-inputs').ariaPressed = String(listKind === 'input'); byId('show-outputs').ariaPressed = String(listKind === 'output');
    byId('show-inputs').textContent = 'Inputs · ' + items.filter(item => !isOutput(item)).length;
    byId('show-outputs').textContent = 'Outputs · ' + items.filter(isOutput).length;
    byId('items').replaceChildren();
    for (const item of items.filter(item => isOutput(item) === (listKind === 'output'))) {
        const button = actionButton('', () => select(item), 'list-item'); button.ariaCurrent = String(item.id === selected?.id); button.title = item.id;
        const heading = document.createElement('span'); heading.className = 'item-title'; heading.textContent = title(item);
        const meta = document.createElement('span'); meta.className = 'item-meta'; meta.textContent = status(item) + (mode === 'file' ? '' : ' · ' + item.id.slice(0, 8));
        button.append(heading, meta); byId('items').append(button);
    }
    if (!byId('items').children.length) {
        const empty = document.createElement('p'); empty.className = 'empty';
        empty.textContent = listKind === 'input' ? 'Create an input to get started.' : 'Outputs appear here when your task creates them.'; byId('items').append(empty);
    }
}
function outputsFor(receipt) {
    return items.filter(item => isOutput(item) && (item.parent_id === receipt.input || item.id.replaceAll('\\','/').includes('/native-' + receipt.id + '/')));
}
function executionLabel(receipt) {
    if (receipt.state === 'EXITED') return receipt.exit_code === 0 ? 'Succeeded · exit 0' : 'Failed · exit ' + receipt.exit_code;
    return ({STARTED:'Running',PREPARED:'Ready to run',CANCELLED:'Cancelled by you',LAUNCH_REJECTED:'Could not start',TERMINATED:'Finished · exit code unavailable',STOPPED:'Session ended'}[receipt.state] || receipt.state);
}
function renderResult() {
    // A global latest receipt must never imply that a new/unrun input succeeded.
    const relevant = selected ? receipts.filter(receipt => receipt.input === selected.id || outputsFor(receipt).some(item => item.id === selected.id)) : [];
    const latest = relevant.at(-1);
    byId('result-heading').textContent = isOutput(selected) ? 'Source execution' : 'Result';
    byId('last-execution').textContent = latest ? executionLabel(latest) : isOutput(selected) ? 'No local execution receipt for this output.' : 'Not run';
    byId('result-time').textContent = latest?.created_at ? new Date(latest.created_at).toLocaleString() : '';
    byId('latest-outputs').replaceChildren();
    if (latest) for (const item of outputsFor(latest)) byId('latest-outputs').append(actionButton(title(item), () => select(item)));
    byId('receipts').replaceChildren();
    for (const receipt of [...receipts].reverse()) {
        const card = document.createElement('section'); card.className = 'receipt';
        const heading = document.createElement('h3'); heading.textContent = executionLabel(receipt); card.append(heading);
        const source = items.find(item => item.id === receipt.input);
        const input = actionButton('Input: ' + (source ? title(source) : receipt.input?.slice(-16) || 'Unavailable'), () => select(source));
        input.disabled = !source; card.append(input);
        for (const output of outputsFor(receipt)) card.append(actionButton(title(output), () => select(output)));
        const detail = document.createElement('details'), summary = document.createElement('summary'), raw = document.createElement('pre');
        summary.textContent = 'Execution details'; raw.textContent = JSON.stringify(receipt, null, 2); detail.append(summary, raw); card.append(detail);
        if (receipt.state === 'STARTED' && !receipt.session_active) {
            const note = document.createElement('p'); note.className = 'hint'; note.textContent = 'Previous session. Refresh to check saved results.'; card.append(note);
        }
        if (receipt.session_active) card.append(actionButton('Stop execution…', () => send('cancel', {id:receipt.id})));
        byId('receipts').append(card);
    }
}
function updateControls() {
    byId('local-root').ariaBusy = String(loading);
    const output = !!isOutput(selected), stored = !!selected, readonly = output || (stored && mode !== 'file');
    byId('create').hidden = stored; byId('create').disabled = loading;
    byId('create').textContent = mode === 'sqlite' ? 'Add to queue' : mode === 'published' ? 'Create in Runtime…' : 'Create input';
    const runnable = stored && !output && ['file','sqlite'].includes(mode) && selected.state !== 'INVALID';
    for (const id of ['run','debug']) {byId(id).hidden = !runnable; byId(id).disabled = loading || !runnable;}
    byId('run').textContent = mode === 'sqlite' ? 'Run next input' : 'Run'; byId('debug').textContent = 'Debug';
    byId('run').title = mode === 'file' ? 'Save changes and run this input' : 'Run the oldest waiting input in this queue';
    byId('debug').title = mode === 'file' ? 'Save changes and debug this input' : 'Debug the oldest waiting input in this queue';
    byId('save').hidden = !stored || readonly; byId('save').disabled = loading || readonly || !stored || !payloadDirty;
    byId('reload-payload').hidden = !stored || readonly;
    byId('discard-draft').hidden = stored || !payloadDirty;
    byId('replay').hidden = !stored || !['file','sqlite'].includes(mode);
    byId('replay').disabled = loading || byId('replay').hidden;
    byId('replay').className = output || (stored && selected.state === 'COMPLETED') ? 'primary' : 'quiet';
    if (stored && selected.state === 'COMPLETED' && mode === 'sqlite') for (const id of ['run','debug']) byId(id).hidden = true;
    byId('name-label').hidden = stored || mode === 'published';
    byId('selection-state').textContent = output ? 'Read-only output' : stored ? status(selected) : replaySource ? 'Replay draft' : 'Draft';
    byId('selection-note').textContent = output ? 'Replay to create an editable input. This output stays unchanged.' :
        stored && mode === 'sqlite' ? 'Saved in the queue. Replay to change fields; execution uses the oldest waiting input.' :
        replaySource ? 'Edit this copy, then create it. Attachments are copied when you save.' : '';
    byId('selection-note').hidden = !byId('selection-note').textContent;
    byId('parameters-section').hidden = output || /robot\.yaml$/.test(packagePath) || !['file','sqlite'].includes(mode);
    byId('payload').readOnly = readonly; byId('payload-apply-json').hidden = readonly; byId('payload-apply-json').disabled = readonly;
    byId('proposal-tools').hidden = readonly;
    byId('item-details').hidden = !stored;
    byId('attach').hidden = !stored || output || (mode === 'sqlite' && selected.state !== 'PENDING');
    byId('attach').disabled = loading || byId('attach').hidden;
    byId('field-count').textContent = payloadEditor.root?.kind === 'object' ? payloadEditor.root.entries.length + ' fields' : '';
    byId('validation-hints').textContent = !readonly && Object.keys(contract).length ? 'Required: ' + Object.entries(contract).map(([name,type]) => name + ' (' + type + ')').join(', ') : '';
}
function select(item, fresh = false) {
    stashDraft(); selected = item ? {...item} : undefined; activeDraftKey = draftKey(item?.id);
    if (fresh) drafts.delete(activeDraftKey);
    const saved = drafts.get(activeDraftKey);
    let unchanged = false;
    if (saved?.root && item) try {unchanged = WorkItemForms.stringify(WorkItemForms.toValue(saved.root)) === WorkItemForms.stringify(item.payload);} catch {}
    if (saved && !unchanged) {
        payloadEditor.setState(saved); payloadDirty = true; activeRevision = saved.revision; replaySource = saved.replaySource;
        if (saved.name) byId('name').value = saved.name;
        if (selected) selected.revision = saved.revision;
    } else {
        drafts.delete(activeDraftKey); payloadEditor.setValue(item ? item.payload : {}); payloadDirty = false; activeRevision = item?.revision; replaySource = undefined;
        if (!item) for (const [name,type] of Object.entries(contract)) payloadEditor.root.entries.push({key:name,node:WorkItemForms.node(['integer','number'].includes(type) ? 'number' : type)});
    }
    byId('selection').textContent = item ? title(item) : replaySource ? 'Replay input' : 'New input';
    payloadEditor.setReadOnly(!!isOutput(item) || (!!item && mode !== 'file'));
    showPayloadValue(payloadEditor, 'payload', 'validation'); byId('details').textContent = item ? JSON.stringify(item, null, 2) : '';
    byId('files').replaceChildren();
    for (const name of item?.files || replaySource?.files || []) {
        const button = actionButton(name, () => send('download', {name, id:item?.id || replaySource.id}), 'quiet attachment');
        button.title = item ? 'Save attachment copy' : 'Attachment will be copied from the original'; byId('files').append(button);
    }
    byId('attachment-hint').textContent = (item?.files || replaySource?.files || []).length ? '' : item ? 'No attachments.' : 'Create this input to add attachments.';
    if (item) listKind = isOutput(item) ? 'output' : 'input';
    updateControls(); renderItems(); renderResult(); persistEditorState();
}
function startReplay() {
    const source = selected; if (!source || !['file','sqlite'].includes(mode)) return;
    if (drafts.has(draftKey())) {byId('validation').textContent = 'A new input draft is already open. Save or discard it before replaying another item.'; return;}
    select(undefined, true);
    replaySource = {id:source.id, revision:source.revision, payload:copyNode(source.payload), files:[...(source.files || [])]};
    payloadEditor.setValue(source.payload); payloadDirty = true;
    byId('name').value = (source.name || 'input').replace(/-[a-f0-9]{12}$/, '').slice(0, 70) + '-copy';
    stashDraft(); listKind='input'; select(undefined); byId('name').focus?.();
}
byId('replay').onclick = startReplay;
byId('payload-apply-json').onclick = () => {try {payloadEditor.setJSON(byId('payload').value);} catch(error) {byId('validation').textContent=error.message;}};
byId('parameters-apply-json').onclick = () => {try {parametersEditor.setJSON(byId('parameters').value);} catch(error) {byId('parameters-validation').textContent=error.message;}};
byId('reload-payload').onclick = () => select(items.find(item => item.id === selected?.id), true);
byId('discard-draft').onclick = () => send('discardDraft');
byId('propose-fields').onclick = () => send('proposePayload', {instructions:byId('proposal-instructions').value});
byId('apply-proposal').onclick = () => {
    try {
        if (!proposalTarget || proposalTarget.mode !== mode || proposalTarget.input_id !== selected?.id) throw Error('Return to the original draft before applying this proposal.');
        const target = mode === 'managed' ? managedPayloadEditor : payloadEditor;
        if (target.readOnly) throw Error('Create a new input draft before applying a proposal.');
        target.setValue(proposalEditor.getValue());
        if (mode === 'managed') showPayloadValue(target,'managed-payload','managed-payload-validation');
        else {payloadDirty=true; showPayloadValue(target,'payload','validation'); updateControls();}
        byId('proposal-review').hidden=true; byId('status').textContent='Applied to draft. Review and save when ready.'; persistEditorState();
    } catch(error) {byId('proposal-status').textContent=error.message;}
};
for (const id of ['create','save','attach','run','debug']) byId(id).onclick = () => {
    try {
        const extra = {name:byId('name').value};
        if (['create','save'].includes(id) || (['run','debug'].includes(id) && mode === 'file')) extra.payload = object('payload');
        if (['run','debug'].includes(id)) extra.parameters = object('parameters');
        byId('validation').textContent = '';
        if (id === 'create' && replaySource) send('replay', {...extra, id:replaySource.id, revision:replaySource.revision, source_payload:replaySource.payload});
        else send(id, extra);
    } catch(error) {byId('validation').textContent=error.message;}
};
byId('new').onclick = () => {select(undefined); listKind='input'; renderItems(); byId('name').focus?.();};
byId('show-inputs').onclick = () => {listKind='input';renderItems();};
byId('show-outputs').onclick = () => {listKind='output';renderItems();};
byId('connect').onclick = () => send(mode === 'managed' ? 'managed.connect' : 'connect');
byId('recover').onclick = () => send('recover');
function showMode() {
    byId('local-root').hidden = mode === 'managed'; byId('managed-root').hidden = mode !== 'managed';
    byId('local-queue-label').hidden = !['sqlite','published'].includes(mode); byId('apply-queue').hidden = byId('local-queue-label').hidden;
    byId('recover').hidden = mode !== 'sqlite'; byId('connect').hidden = !['published','managed'].includes(mode);
    byId(mode === 'managed' ? 'managed-proposal-slot' : 'local-proposal-slot').append(byId('proposal-tools'));
    if(mode === 'managed')byId('proposal-tools').hidden=false;
}
byId('refresh').onclick = () => send(mode === 'managed' ? 'managed.refresh' : 'mode', {mode,queue:activeQueue});
byId('apply-queue').onclick = () => {
    const next = byId('queue').value || 'input';
    if(next !== activeQueue){stashDraft();activeQueue=next;selected=undefined;activeDraftKey=undefined;payloadDirty=false;replaySource=undefined;items=[];receipts=[];select(undefined);}
    send('mode',{mode,queue:activeQueue});
};
byId('mode').onchange = () => {
    stashDraft(); mode=byId('mode').value; selected=undefined; activeDraftKey=undefined; payloadDirty=false; replaySource=undefined;
    items=[]; receipts=[]; showMode(); select(undefined); send('mode', {mode,queue:byId('queue').value});
};
window.addEventListener('message', ({data}) => {
    if (data.type === 'editorDraftRestore') {restoreEditorState(data.state); return;}
    if (data.type === 'draftDiscarded') {payloadDirty=false;drafts.delete(draftKey());select(undefined,true);byId('name').value='input';persistEditorState();return;}
    if (data.type === 'loading') {loading=true;updateControls();byId('status').className='';byId('status').textContent='Working…';return;}
    if (!['error','unsupported','state','payload-proposal','proposal-cancelled','managed-state'].includes(data.type)) return;
    loading=false; updateControls(); byId('status').className=data.type==='error'?'error':'';
    if (data.type === 'error' || data.type === 'unsupported') {byId('status').textContent=data.message;return;}
    if (data.type === 'proposal-cancelled') {byId('status').textContent='Proposal cancelled. Draft unchanged.';return;}
    if (data.type === 'payload-proposal') {
        byId('status').textContent='Proposal ready for review.';
        try {proposalEditor.setJSON(data.json);proposalTarget={mode:data.mode,input_id:data.input_id};byId('proposal-review').hidden=false;byId('proposal-status').textContent='Review the fields, then apply to your draft.';}
        catch(error) {proposalTarget=undefined;byId('proposal-review').hidden=true;byId('proposal-status').textContent='Proposal rejected: '+error.message;}
        return;
    }
    if (data.type !== 'state') return;
    mode=data.mode; items=data.items || []; receipts=data.receipts || []; packagePath=data.package || packagePath; contract=data.contract || {};
    byId('mode').value=mode; activeQueue=data.queue || 'input'; byId('queue').value=activeQueue; showMode();
    byId('package').textContent=packagePath.replaceAll('\\','/').split('/').at(-2) || 'Selected package'; byId('package').title=packagePath;
    byId('package-path').textContent=packagePath; byId('authority').textContent=data.authority || '';
    byId('status').textContent='';
    for (const item of items) {const replay=(data.replays || []).find(entry => entry.copy === item.id && entry.mode === mode);if(replay)item.local_replay_source=replay.source;}
    const target=data.selectId || selected?.id || restoredSelection; restoredSelection=undefined;
    if (data.selectId && activeDraftKey === draftKey()) {payloadDirty=false;drafts.delete(activeDraftKey);replaySource=undefined;}
    select(items.find(item => item.id === target));
});
byId('name').oninput=() => {payloadDirty=true;updateControls();persistEditorState();};
byId('queue').oninput=persistEditorState;
showPayloadValue(parametersEditor,'parameters','parameters-validation'); select(undefined);
