/* Native editor: all data uses textContent; the host owns package paths and SDK calls. */
const api = acquireVsCodeApi();
const byId = id => document.getElementById(id);
let selected, items = [], mode = 'file';
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
    byId('details').textContent = item ? JSON.stringify(item, null, 2) : '';
    byId('files').replaceChildren();
    for (const name of item?.files || []) {
        const button = document.createElement('button'); button.textContent = name + ' — save copy';
        button.onclick = () => send('download', {name}); byId('files').append(button);
    }
    byId('save').disabled = !item || mode !== 'file' || item.role !== 'input';
    for (const id of ['attach','replay','run','debug']) byId(id).disabled = !item || mode === 'managed';
}
for (const id of ['create','save','replay','attach','run','debug']) byId(id).onclick = () => {
    try {
        const extra = {name: byId('name').value};
        if (['create','save'].includes(id)) extra.payload = object('payload');
        if (['run','debug'].includes(id)) extra.parameters = object('parameters');
        byId('validation').textContent = ''; send(id, extra);
    } catch (error) { byId('validation').textContent = error.message; }
};
byId('new').onclick = () => select(undefined);
byId('refresh').onclick = () => send('mode', {mode: byId('mode').value, queue: byId('queue').value});
byId('mode').onchange = () => {mode = byId('mode').value; select(undefined); send('mode', {mode, queue: byId('queue').value});};
window.addEventListener('message', ({data}) => {
    byId('status').className = data.type === 'error' ? 'error' : '';
    if (data.type === 'loading') {byId('status').textContent = 'Loading…'; return;}
    if (data.type === 'error' || data.type === 'unsupported') {byId('status').textContent = data.message; return;}
    if (data.type !== 'state') return;
    mode = data.mode; items = data.items || [];
    byId('package').textContent = data.package; byId('authority').textContent = data.authority;
    byId('status').textContent = items.length ? items.length + ' items. SQLite consumption is FIFO; refresh shows SDK-owned state.' : 'No items yet. Create an input with its payload, then add attachments and Run or Debug.';
    byId('items').replaceChildren();
    for (const item of items) {
        const button = document.createElement('button'); button.textContent = (item.name || item.id) + ' · ' + (item.role || item.queue_name || '') + ' · ' + item.state;
        button.onclick = () => select(item); byId('items').append(button);
    }
    byId('receipts').replaceChildren();
    for (const receipt of data.receipts || []) {
        const detail = document.createElement('pre'); detail.textContent = JSON.stringify(receipt, null, 2); byId('receipts').append(detail);
        if (receipt.state === 'STARTED') {const button = document.createElement('button'); button.textContent = 'Stop ' + receipt.id; button.onclick = () => send('cancel', {id: receipt.id}); byId('receipts').append(button);}
    }
    select(items.find(item => item.id === selected?.id));
});
select(undefined); send('refresh');
