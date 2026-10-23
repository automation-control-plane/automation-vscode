/* Native Work Items view. Host messages remain the only execution boundary. */
const api = acquireVsCodeApi();
const byId = id => document.getElementById(id);
let selected, items = [], receipts = [], mode = 'file', contract = {};
let activeDraftKey, activeRevision, payloadDirty = false, proposalTarget, editorReady = false, restoredSelection;
let replaySource, listKind = 'input', packagePath = '', loading = false, activeQueue = 'input';
const drafts = new Map();
let runbookView = {stage:'prepare', tab:'inputs'}, viewSelectionId, lastReceiptKey, restoredRunbookView = false;
const compactContext = window.matchMedia?.('(max-width:650px)');
if (compactContext) {byId('context-extra').open = !compactContext.matches; compactContext.addEventListener('change', event => {byId('context-extra').open = !event.matches;});}
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
            replaySource:copyNode(replaySource), runbookView:{...runbookView}, drafts:[...drafts].filter(([key]) => key !== activeDraftKey)};
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
        if (state.runbookView && ['prepare','run','inspect'].includes(state.runbookView.stage) && ['inputs','files','result'].includes(state.runbookView.tab)) {
            runbookView = {...state.runbookView}; viewSelectionId = state.selectedId; restoredRunbookView = true;
        }
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
function showRunbookView() {
    byId('local-root').className = 'layout stage-' + runbookView.stage;
    for (const stage of ['prepare','run','inspect']) byId('stage-' + stage).ariaCurrent = stage === runbookView.stage ? 'step' : 'false';
    for (const tab of ['inputs','files','result']) {
        byId('tab-' + tab).ariaPressed = String(tab === runbookView.tab);
        byId(tab + '-view').hidden = tab !== runbookView.tab;
    }
    for (const stage of ['prepare','run','inspect']) byId('managed-' + stage + '-view').hidden = stage !== runbookView.stage;
}
function navigateRunbook(stage, tab) {
    runbookView = {stage, tab}; showRunbookView(); persistEditorState();
}
for (const stage of ['prepare','run','inspect']) byId('stage-' + stage).onclick = () => navigateRunbook(stage, stage === 'prepare' ? 'inputs' : 'result');
byId('tab-inputs').onclick = () => navigateRunbook('prepare','inputs');
byId('tab-result').onclick = () => navigateRunbook('inspect','result');
byId('tab-files').onclick = () => navigateRunbook(runbookView.stage,'files');
byId('open-logs').onclick = () => send('openLogs');
function textElement(tag, value, className) {
    const element = document.createElement(tag); element.textContent = String(value); if (className) element.className = className; return element;
}
function readableValue(value) {
    if (value === null) return 'null';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
}
function renderRecordTable(records, container) {
    const columns = [...new Set(records.flatMap(record => Object.keys(record)))].slice(0,20);
    const wrap=document.createElement('div'), table=document.createElement('table'), head=document.createElement('thead'), heading=document.createElement('tr'), body=document.createElement('tbody');
    wrap.className='result-table-wrap';table.className='result-table';
    for(const name of columns) heading.append(textElement('th',name));head.append(heading);table.append(head);
    for(const record of records.slice(0,200)) {const row=document.createElement('tr');for(const name of columns)row.append(textElement('td',Object.hasOwn(record,name) ? readableValue(record[name]) : '—'));body.append(row);}
    table.append(body);wrap.append(table);container.append(wrap);
    if(records.length>200 || records.some(record=>Object.keys(record).some(name=>!columns.includes(name)))) container.append(textElement('p','Showing up to 200 records and 20 columns. The complete read-only payload is available under Prepare inputs → Advanced payload JSON.','hint'));
}
function renderDataTable(payload, container) {
    const allEntries = payload && typeof payload === 'object' ? Object.entries(payload) : [['Value',payload]];
    const entries=[];
    for(const [name,value] of allEntries) {
        if(Array.isArray(value) && value.length && value.every(record=>record && typeof record==='object' && !Array.isArray(record))) {
            container.append(textElement('h3',name,'output-label'));renderRecordTable(value,container);
        } else entries.push([name,value]);
    }
    if(!entries.length && allEntries.length) return;
    if (!entries.length) {container.append(textElement('p','This output contains no fields.','hint')); return;}
    const wrap = document.createElement('div'), table = document.createElement('table'); wrap.className = 'result-table-wrap'; table.className = 'result-table';
    const head = document.createElement('thead'), headings = document.createElement('tr');
    headings.append(textElement('th','Field'),textElement('th','Value')); head.append(headings); table.append(head);
    const body = document.createElement('tbody');
    for (const [name,value] of entries) {
        const row = document.createElement('tr'), cell = document.createElement('td');
        if (value && typeof value === 'object') {
            const detail = document.createElement('details'); detail.append(textElement('summary', Array.isArray(value) ? value.length + ' items' : Object.keys(value).length + ' fields'), textElement('pre',readableValue(value))); cell.append(detail);
        } else cell.textContent = readableValue(value);
        row.append(textElement('td',name),cell); body.append(row);
    }
    table.append(body); wrap.append(table); container.append(wrap);
}
function renderContext(latest) {
    byId('context-item-label').textContent = isOutput(selected) ? 'Output' : replaySource ? 'Replay source' : 'Input';
    byId('context-item').textContent = selected ? title(selected) : replaySource?.id || 'New input';
    byId('context-storage').textContent = ({file:'Local FileAdapter',sqlite:'Local SDK queue · ' + activeQueue,published:'Runtime storage',managed:'Managed Runtime'})[mode];
    byId('context-receipt').textContent = latest?.id || 'No execution receipt';
    byId('context-started').textContent = latest?.created_at ? new Date(latest.created_at).toLocaleString() : 'Not run';
    const elapsed = latest?.updated_at && latest?.created_at ? (new Date(latest.updated_at) - new Date(latest.created_at)) / 1000 : undefined;
    byId('context-duration').textContent = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed.toFixed(1) + 's · receipt interval' : 'Not available';
    byId('context-exit').textContent = latest?.exit_code !== undefined ? String(latest.exit_code) : 'Not available';
    const names = selected?.files || replaySource?.files || [];
    byId('context-files').replaceChildren();
    if (!names.length) byId('context-files').textContent = 'No attachments';
    else for (const name of names) byId('context-files').append(actionButton(name, () => navigateRunbook(runbookView.stage,'files')));
    byId('context-lineage').replaceChildren();
    const sourceId = selected?.parent_id || selected?.local_replay_source || replaySource?.id || (isOutput(selected) ? latest?.input : undefined);
    if (sourceId) {
        const source = items.find(item => item.id === sourceId);
        const link = actionButton('Source · ' + (source ? title(source) : sourceId), () => {if (source) select(source);}); link.disabled = !source; link.title = sourceId; byId('context-lineage').append(link);
    }
    if (latest) for (const output of outputsFor(latest)) byId('context-lineage').append(actionButton('Output · ' + title(output), () => select(output)));
    if (!byId('context-lineage').children.length) byId('context-lineage').append(textElement('p','No linked input or output yet.'));
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
    const receiptKey = selected?.id + ':' + latest?.id + ':' + latest?.state;
    if (receiptKey !== lastReceiptKey && latest && !restoredRunbookView) runbookView = {stage:['STARTED','PREPARED'].includes(latest.state) ? 'run' : 'inspect',tab:'result'};
    lastReceiptKey = receiptKey; restoredRunbookView = false;
    const outputItems = isOutput(selected) ? [selected] : latest ? outputsFor(latest) : [];
    const outcome = latest ? (latest.state === 'EXITED' ? latest.exit_code === 0 ? 'Completed successfully' : 'Execution failed' :
        {STARTED:'Execution in progress',PREPARED:'Ready to launch',CANCELLED:'Execution cancelled',LAUNCH_REJECTED:'Unable to launch',TERMINATED:'Session ended',STOPPED:'Session ended'}[latest.state] || latest.state) : isOutput(selected) ? 'Saved output' : 'Ready to run';
    byId('result-outcome').textContent = outcome;
    byId('result-icon').className = 'codicon codicon-' + (latest?.state === 'EXITED' ? latest.exit_code === 0 ? 'pass-filled' : 'error' : latest?.state === 'STARTED' ? 'sync' : isOutput(selected) ? 'file-text' : 'play-circle');
    byId('result-banner').className = 'result-banner ' + (latest?.state === 'EXITED' ? latest.exit_code === 0 ? 'success' : 'failure' : latest && ['STARTED','PREPARED'].includes(latest.state) ? 'running' : '');
    byId('result-explanation').textContent = outputItems.length ? 'Output values from the selected item’s linked records. Outputs stay read-only.' : isOutput(selected) ? 'This output has no readable payload.' : latest ? 'No linked outputs were produced. Open run logs for execution details.' : 'Prepare an input, then explicitly Run or Debug it. No workload starts when you open this view.';
    byId('result-count').textContent = outputItems.length ? outputItems.length + (outputItems.length === 1 ? ' output' : ' outputs') : '';
    byId('result-data').replaceChildren();
    for (const output of outputItems) {
        if (outputItems.length > 1) byId('result-data').append(textElement('h3',title(output),'output-label'));
        renderDataTable(output.payload,byId('result-data'));
    }
    renderContext(latest); showRunbookView();
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
    for (const id of ['run','debug']) {byId(id).hidden = !runnable; byId(id).disabled = loading || !runnable || (mode === 'sqlite' && selected.state !== 'PENDING');}
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
    byId('selection-note').textContent = mode === 'sqlite' && selected?.state === 'RESERVED' ? 'Item ' + selected.id + ' is reserved by the SDK. Do not run it again. Refresh to check its claim; interrupted claims can be recovered only after the SDK orphan timeout (default 30 minutes).' : output ? 'Replay to create an editable input. This output stays unchanged.' :
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
    if (viewSelectionId !== item?.id) {
        runbookView = {stage:isOutput(item) ? 'inspect' : 'prepare',tab:isOutput(item) ? 'result' : 'inputs'};
        lastReceiptKey = undefined;
    }
    viewSelectionId = item?.id;
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
    byId('local-root').hidden = mode === 'managed'; byId('managed-root').hidden = mode !== 'managed'; showRunbookView();
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
    items=[]; receipts=[]; runbookView={stage:mode === 'managed' ? 'inspect' : 'prepare',tab:mode === 'managed' ? 'result' : 'inputs'}; showMode(); select(undefined); send('mode', {mode,queue:byId('queue').value});
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
    byId('runbook-title').textContent=packagePath.replaceAll('\\','/').split('/').at(-2) || 'Work Items';
    byId('package').textContent=(/robot\.yaml$/.test(packagePath) ? 'Robot Task' : 'Python Action') + ' · Work Items';
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
