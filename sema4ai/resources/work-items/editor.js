/* Native editor: all data uses textContent; the host owns package paths and SDK calls. */
const api = acquireVsCodeApi();
const byId = id => document.getElementById(id);
let selected, items = [], mode = 'file', contractRevision, contract = {};
function send(op, extra = {}) {
    api.postMessage({op, id: selected?.id, revision: selected?.revision, ...extra});
}
function object(id) {
    const value = JSON.parse(byId(id).value);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Use a JSON object.');
    return value;
}
function select(item) {
    selected = item;
    byId('selection').textContent = item ? (item.name || item.id) : 'New input';
    byId('payload').value = JSON.stringify(item?.payload || {}, null, 2);
    const output = item?.role === 'output' || item?.queue_name?.endsWith('.outputs');
    byId('payload').readOnly = !!output || (!!item && mode !== 'file');
    byId('payload-fields').replaceChildren();
    if (!output && mode !== 'managed') for (const [name, kind] of Object.entries(contract)) {
        const label = document.createElement('label'); label.textContent = name + ' (' + kind + ', required) ';
        const input = document.createElement(['object','array'].includes(kind) ? 'textarea' : 'input');
        const value = item?.payload?.[name];
        input.disabled = !!item && mode !== 'file';
        if (kind === 'boolean') {input.type = 'checkbox'; input.checked = value === true;}
        else {input.type = ['number','integer'].includes(kind) ? 'number' : 'text'; input.value = value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value); if (kind === 'integer') input.step = '1';}
        input.oninput = () => {
            try {
                if (['number','integer'].includes(kind) && input.value.trim() === '') throw Error(name + ' is required.');
                const payload = object('payload');
                payload[name] = kind === 'boolean' ? input.checked : ['number','integer'].includes(kind) ? Number(input.value) : ['object','array','null'].includes(kind) ? JSON.parse(input.value) : input.value;
                byId('payload').value = JSON.stringify(payload, null, 2); byId('validation').textContent = '';
            } catch (error) {byId('validation').textContent = error.message;}
        };
        label.append(input); byId('payload-fields').append(label);
    }
    byId('details').textContent = item ? JSON.stringify(item, null, 2) : '';
    byId('files').replaceChildren();
    for (const name of item?.files || []) {
        const button = document.createElement('button'); button.textContent = name + ' — save copy';
        button.onclick = () => send('download', {name}); byId('files').append(button);
    }
    byId('save').disabled = !item || mode !== 'file' || item.role !== 'input';
    byId('attach').disabled = !item;
    byId('replay').disabled = !item || mode === 'managed';
    for (const id of ['run','debug']) byId(id).disabled = !item || !!output || mode === 'managed';
}
for (const id of ['create','save','replay','attach','run','debug']) byId(id).onclick = () => {
    try {
        const extra = {name: byId('name').value};
        if (['create','save'].includes(id)) extra.payload = object('payload');
        if (['run','debug'].includes(id) && mode === 'file') extra.payload = object('payload');
        if (['run','debug'].includes(id)) extra.parameters = object('parameters');
        byId('validation').textContent = ''; send(id, extra);
    } catch (error) { byId('validation').textContent = error.message; }
};
byId('new').onclick = () => select(undefined);
byId('connect').onclick = () => send('connect');
byId('recover').onclick = () => send('recover');
byId('contract-save').onclick = () => {
    try {send('contract', {payload: object('contract'), revision: contractRevision});}
    catch (error) {byId('validation').textContent = error.message;}
};
byId('refresh').onclick = () => send('mode', {mode: byId('mode').value, queue: byId('queue').value});
byId('mode').onchange = () => {mode = byId('mode').value; items = []; byId('items').replaceChildren(); byId('receipts').replaceChildren(); select(undefined); send('mode', {mode, queue: byId('queue').value});};
window.addEventListener('message', ({data}) => {
    byId('status').className = data.type === 'error' ? 'error' : '';
    if (data.type === 'loading') {byId('status').textContent = 'Loading…'; return;}
    if (data.type === 'error' || data.type === 'unsupported') {byId('status').textContent = data.message; return;}
    if (data.type !== 'state') return;
    mode = data.mode; items = data.items || [];
    byId('mode').value = mode;
    byId('queue').value = data.queue || 'input';
    byId('contract-save').disabled = mode === 'managed';
    byId('recover').disabled = mode !== 'sqlite';
    byId('run').textContent = mode === 'sqlite' ? 'Run next queue input (FIFO)' : 'Save & Run selected input';
    byId('debug').textContent = mode === 'sqlite' ? 'Debug next queue input (FIFO)' : 'Save & Debug selected input';
    contractRevision = data.contract_revision; contract = data.contract || {};
    byId('contract').value = JSON.stringify(contract, null, 2);
    byId('package').textContent = data.package; byId('authority').textContent = data.authority;
    byId('status').textContent = items.length ? items.length + ' items. SQLite consumption is FIFO; refresh shows SDK-owned state.' : 'No items yet. Create an input with its payload, then add attachments and Run or Debug.';
    byId('items').replaceChildren();
    for (const item of items) {
        const replay = (data.replays || []).find(entry => entry.copy === item.id && entry.mode === mode);
        if (replay) item.local_replay_source = replay.source;
        const button = document.createElement('button'); button.textContent = (item.name || item.id) + ' · ' + (item.role || item.queue_name || '') + ' · ' + item.state;
        button.onclick = () => select(item); byId('items').append(button);
    }
    byId('receipts').replaceChildren();
    for (const receipt of data.receipts || []) {
        const card = document.createElement('section');
        const title = document.createElement('h3'); title.textContent = receipt.mode + ' · ' + receipt.state + (receipt.exit_code !== undefined ? ' · exit ' + receipt.exit_code : ''); card.append(title);
        const input = document.createElement('button'); input.textContent = 'Input: ' + receipt.input;
        input.onclick = () => select(items.find(item => item.id === receipt.input)); card.append(input);
        const outputs = items.filter(item => item.parent_id === receipt.input || item.id.replaceAll('\\', '/').includes('/native-' + receipt.id + '/'));
        for (const output of outputs) {const button = document.createElement('button'); button.textContent = (receipt.mode === 'sqlite' ? 'SDK-related output: ' : 'Output: ') + output.id; button.onclick = () => select(output); card.append(button);}
        const detail = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Execution identity and provenance'; detail.append(summary);
        const raw = document.createElement('pre'); raw.textContent = JSON.stringify(receipt, null, 2); detail.append(raw); card.append(detail); byId('receipts').append(card);
        if (receipt.state === 'STARTED' && !receipt.session_active) {const note = document.createElement('p'); note.textContent = 'Previous session is not tracked by this Extension Host. Refresh SDK queue state; no process will be adopted or stopped.'; byId('receipts').append(note);}
        if (receipt.session_active) {const button = document.createElement('button'); button.textContent = 'Stop ' + receipt.id; button.onclick = () => send('cancel', {id: receipt.id}); byId('receipts').append(button);}
    }
    select(items.find(item => item.id === (data.selectId || selected?.id)));
});
select(undefined); send('refresh');
