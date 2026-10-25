/* Canonical Runtime projections; the host retains targets, bindings and keys. */
let managedState = {}, managedLogCursor;
function managedModeLabel(mode) {
    const labels={'reviewed':'Reviewed input','producer':'Producer','consumer':'Consumer','optional':'Optional input','required-input':'Input required','none':'No Work Item input'};
    return Object.hasOwn(labels,mode) ? labels[mode] : 'Unknown policy';
}
function managedAuthorityLabel(snapshot) {
    if (!snapshot) return 'No snapshot loaded';
    // Display the backend default without inserting it into the snapshot or journal.
    const authority=snapshot.capability_authority;
    return authority===undefined || authority==='legacy-action' ? 'Legacy action' : authority==='package-revision' ? 'Package revision' : 'Unknown authority — not admitted';
}
const managedPayloadEditor=new WorkItemForms.Editor(byId('managed-payload-fields'),{onChange:editor=>{showPayloadValue(editor,'managed-payload','managed-payload-validation');persistEditorState();}});
byId('managed-payload-apply-json').onclick=()=>{try{managedPayloadEditor.setJSON(byId('managed-payload').value);}catch(error){byId('managed-payload-validation').textContent=error.message;}};
function managedSend(op, extra = {}) {api.postMessage({op: 'managed.' + op, ...extra});}
function managedButton(parent, label, callback, metadata) {const button = document.createElement('button'); button.className='list-item'; if(metadata) button.append(textElement('span',label,'item-title'),textElement('span',metadata,'item-meta')); else button.textContent=label; button.onclick = callback; parent.append(button); return button;}
function managedAllowed(operation) {
    const permission = {
        'queues.list':'work_items.read','items.list':'work_items.read','items.get':'work_items.read','items.enqueue':'work_items.enqueue',
        'items.claim':'work_items.claim','items.renew':'work_items.claim','items.complete':'work_items.complete','items.retry':'work_items.retry','items.cancel':'work_items.cancel',
        'reviews.list':'work_items.review','reviews.decide':'work_items.review','runs.get':'work_items.read','runs.logs':'work_items.read','artifacts.read':'work_items.artifact.read',
    }[operation];
    return !!managedState.capabilities?.operations.includes(operation) && (!managedState.queue || managedState.queue.permissions.includes(permission));
}
byId('managed-refresh').onclick = () => managedSend('refresh');
byId('managed-more-queues').onclick = () => managedSend('moreQueues');
byId('managed-more-items').onclick = () => managedSend('moreItems');
byId('managed-more-reviews').onclick = () => managedSend('moreReviews');
byId('managed-more-logs').onclick = () => managedSend('logs', {id:managedState.logs?.run_id,cursor:managedLogCursor});
byId('managed-snapshot').onclick = () => managedSend('snapshot');
byId('managed-enqueue').onclick = () => {
    try {managedSend('enqueue', {payload:managedPayloadEditor.getValue()});}
    catch (error) {byId('managed-status').textContent = error.message;}
};
for (const operation of ['retry','cancel']) byId('managed-' + operation).onclick = () => managedSend(operation,
    {reason:byId('managed-reason').value,reconciliation_receipt:byId('managed-reconciliation').value});
byId('managed-approve').onclick = () => managedSend('decide', {decision:'approve'});
byId('managed-reject').onclick = () => managedSend('decide', {decision:'reject'});
for (const operation of ['claim','renew']) byId('managed-' + operation).onclick = () => managedSend(operation, {lease_seconds:Number(byId('managed-lease').value)});
byId('managed-complete').onclick = () => managedSend('complete', {outcome:byId('managed-outcome').value});
window.addEventListener('message', ({data}) => {
    if (data.type !== 'managed-state') return;
    managedState = data; mode = 'managed'; byId('mode').value = mode; showMode();
    byId('status').textContent = '';
    byId('managed-title').textContent = data.item ? 'Item ' + data.item.id : data.review ? 'Review ' + data.review.proposal.review_id : data.queue?.label || 'Managed Work Items';
    byId('managed-snapshot').disabled = !data.queue || !data.capabilities;
    byId('managed-snapshot').title = byId('managed-snapshot').disabled ? 'Connect and select an authorized queue first.' : 'Load an admitted snapshot; this does not execute it.'; byId('managed-status').textContent = data.message || (data.capabilities ? 'Connected. Runtime authority and live permissions govern every operation.' : 'Not connected.');
    byId('managed-identity').textContent = data.capabilities ? `${data.endpoint} · Workspace ${data.workspace} · Runtime ${data.capabilities.runtime_version} · SDK ${data.capabilities.sdk_version} · ${data.capabilities.backend} · database time\nModes: ${data.capabilities.modes.join(', ')}\nGrants: ${data.capabilities.permissions.join(', ')}` : '';
    byId('managed-queue-policy').textContent = data.queue ? data.queue.mode==='required-input'
        ? 'Input required. This policy needs an existing input for execution. Enqueue and claim are separate, explicitly granted operations; selecting this queue does not run it.'
        : managedModeLabel(data.queue.mode) + '. Only live Runtime operations and queue grants enable controls.' : '';
    byId('managed-queues').replaceChildren();
    for (const queue of data.queues || []) {
        const button=managedButton(byId('managed-queues'), queue.label, () => {navigateRunbook('inspect','result');managedSend('queue', {queue:JSON.stringify(queue.queue)});}, managedModeLabel(queue.mode) + ' · ' + Object.entries(queue.counts).map(([name,count])=>name + ' ' + count).join(' · '));
        button.ariaCurrent=String(JSON.stringify(queue.queue)===JSON.stringify(data.queue?.queue));
    }
    byId('managed-queues-empty').hidden=!!data.queues?.length;
    byId('managed-items').replaceChildren();
    for (const item of data.items || []) {
        const button=managedButton(byId('managed-items'), item.id, () => {navigateRunbook('inspect','result');managedSend('item', {id:item.id});}, item.queue_state + ' · ' + item.business_state + ' · delivery ' + item.delivery_count);
        button.ariaCurrent=String(item.id===data.item?.id);button.title=item.id;
    }
    byId('managed-items-empty').hidden=!!data.items?.length;
    byId('managed-reviews').replaceChildren();
    for (const review of data.reviews || []) {
        const button=managedButton(byId('managed-reviews'), review.proposal.review_id, () => {navigateRunbook('inspect','result');managedSend('review', {id:review.proposal.review_id});}, review.state + ' · Run ' + review.proposal.binding.run_id);
        button.ariaCurrent=String(review.proposal.review_id===data.review?.proposal.review_id);
    }
    byId('managed-reviews-empty').hidden=!!data.reviews?.length;
    byId('managed-details').textContent = JSON.stringify(data.item || data.review || data.queue || {}, null, 2);
    byId('managed-summary').replaceChildren();
    const summary = data.item ? {Item:data.item.id,'Business state':data.item.business_state,'Queue state':data.item.queue_state,
        Deliveries:data.item.delivery_count,'Parent input':data.item.parent_id,'Protected input':data.item.protected_input_digest,
        'Deployment revision':data.item.snapshot?.deployment?.revision_id,'Capability authority':managedAuthorityLabel(data.item.snapshot),'Claim owner':data.item.claim?.owner_id,'Claim epoch':data.item.claim?.epoch,'Lease deadline (database ms)':data.item.lease_deadline_ms} :
        data.review ? {Review:data.review.proposal.review_id,State:data.review.state,'Existing Run':data.review.proposal.binding.run_id,
            'Exact result digest':data.review.proposal.binding.result_digest,'Source version':data.review.proposal.binding.source_version,'Approved Work Item':data.review.work_item_id} : {};
    for (const [label,value] of Object.entries(summary)) if (value !== undefined && value !== null) {const row=document.createElement('p');row.textContent=label+': '+value;byId('managed-summary').append(row);}
    byId('managed-selection-empty').hidden=!!data.item || !!data.review;
    byId('managed-selected-payload').replaceChildren();
    if(data.item?.payload) renderDataTable(data.item.payload,byId('managed-selected-payload'));
    byId('managed-snapshot-view').textContent = JSON.stringify(data.snapshot || {}, null, 2);
    byId('managed-snapshot-authority').textContent = 'Capability authority: ' + managedAuthorityLabel(data.snapshot);
    byId('managed-enqueue').disabled = !data.queue || !managedAllowed('items.enqueue') || !data.snapshot || data.queue.mode === 'reviewed';
    byId('managed-enqueue').title=byId('managed-enqueue').disabled ? data.queue?.mode==='reviewed' ? 'Reviewed queues require an exact review decision.' : !data.snapshot ? 'Load an admitted execution snapshot first.' : 'The selected queue has not granted enqueue.' : 'Enqueue this input with the admitted snapshot.';
    byId('managed-claim').disabled = !data.queue || !managedAllowed('items.claim');
    byId('managed-renew').disabled = !data.item?.claim || !managedAllowed('items.renew');
    byId('managed-complete').disabled = !data.item?.claim || !managedAllowed('items.complete');
    for (const operation of ['retry','cancel']) {
        const button = byId('managed-' + operation);
        button.disabled = !data.item?.claim || !managedAllowed('items.' + operation);
        button.title = data.item && !data.item.claim ? 'This contract lacks the terminal item epoch. No epoch is guessed.' : 'Requires an actual item epoch and live Runtime grant.';
    }
    for (const operation of ['approve','reject']) {byId('managed-' + operation).disabled = !data.review || data.review.state !== 'pending' || !managedAllowed('reviews.decide');byId('managed-' + operation).title=byId('managed-' + operation).disabled ? 'Select a pending review with a live review grant.' : 'Decide only the exact selected review binding.';}
    byId('managed-runs').replaceChildren();
    const runs = [...(data.item?.run_ids || []), ...(data.review ? [data.review.proposal.binding.run_id] : [])];
    for (const id of [...new Set(runs)]) {
        if (managedAllowed('runs.get')) managedButton(byId('managed-runs'), 'Run / Attempts: ' + id, () => managedSend('run', {id}));
        if (managedAllowed('runs.logs')) managedButton(byId('managed-runs'), 'Logs: ' + id, () => managedSend('logs', {id}));
    }
    byId('managed-run-details').textContent = JSON.stringify(data.run || {}, null, 2);
    byId('managed-attempts').replaceChildren();
    if (data.run) {const heading=document.createElement('h3');heading.textContent='Run '+data.run.id+' · '+data.run.state;byId('managed-attempts').append(heading);}
    for (const attempt of data.run?.attempts || []) {const row=document.createElement('p');row.textContent=`Attempt ${attempt.id} · ${attempt.state} · owner ${attempt.owner_id} · epoch ${attempt.epoch} · database lease ${attempt.lease_deadline_ms}`;byId('managed-attempts').append(row);}
    byId('managed-artifacts').replaceChildren();
    if (managedAllowed('artifacts.read')) for (const artifact of data.run?.artifacts || []) managedButton(byId('managed-artifacts'),
        `Save artifact · ${artifact.size} bytes · ${artifact.digest}`, () => managedSend('artifact', {handle:artifact.handle}));
    byId('managed-logs').textContent = !data.logs ? 'Select Logs for a linked Run to load its log lines.'
        : data.logs.lines.length ? data.logs.lines.map(line => `${line.offset}: ${line.text}`).join('\n')
        : 'No log lines were returned for this page.';
    managedLogCursor = data.logs?.next_cursor;
    byId('managed-more-logs').disabled = !managedLogCursor;
    byId('managed-more-queues').disabled = !data.queueCursor;
    byId('managed-more-items').disabled = !data.itemCursor;
    byId('managed-more-reviews').disabled = !data.reviewCursor;
    byId('managed-pending').replaceChildren();
    for (const retained of data.pending || []) managedButton(byId('managed-pending'), `Reconcile exact ${retained.operation} · ${retained.key}`,
        () => managedSend('reconcile', {key:retained.key}));
});
for (const name of ['enqueue','claim','renew','complete','retry','cancel','approve','reject']) byId('managed-' + name).disabled = true;
initializeWorkItemEditor();
