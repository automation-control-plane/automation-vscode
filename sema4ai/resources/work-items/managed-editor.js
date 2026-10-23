/* Canonical Runtime projections; the host retains targets, bindings and keys. */
let managedState = {}, managedLogCursor;
function managedSend(op, extra = {}) {api.postMessage({op: 'managed.' + op, ...extra});}
function managedButton(parent, label, callback) {const button = document.createElement('button'); button.textContent = label; button.onclick = callback; parent.append(button);}
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
    try {managedSend('enqueue', {payload:JSON.parse(byId('managed-payload').value)});}
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
    byId('status').textContent = ''; byId('managed-status').textContent = data.message || (data.capabilities ? 'Connected. Runtime authority and live permissions govern every operation.' : 'Not connected.');
    byId('managed-identity').textContent = data.capabilities ? `${data.endpoint} · Workspace ${data.workspace} · Runtime ${data.capabilities.runtime_version} · SDK ${data.capabilities.sdk_version} · ${data.capabilities.backend} · database time\nModes: ${data.capabilities.modes.join(', ')}\nGrants: ${data.capabilities.permissions.join(', ')}` : '';
    byId('managed-queues').replaceChildren();
    for (const queue of data.queues || []) managedButton(byId('managed-queues'), `${queue.label} · ${queue.mode} · ${JSON.stringify(queue.counts)}`,
        () => managedSend('queue', {queue:JSON.stringify(queue.queue)}));
    byId('managed-items').replaceChildren();
    for (const item of data.items || []) managedButton(byId('managed-items'), `${item.id} · queue ${item.queue_state} · business ${item.business_state} · delivery ${item.delivery_count}`,
        () => managedSend('item', {id:item.id}));
    byId('managed-reviews').replaceChildren();
    for (const review of data.reviews || []) managedButton(byId('managed-reviews'), `${review.proposal.review_id} · ${review.state} · Run ${review.proposal.binding.run_id}`,
        () => managedSend('review', {id:review.proposal.review_id}));
    byId('managed-details').textContent = JSON.stringify(data.item || data.review || data.queue || {}, null, 2);
    byId('managed-summary').replaceChildren();
    const summary = data.item ? {Item:data.item.id,'Business state':data.item.business_state,'Queue state':data.item.queue_state,
        Deliveries:data.item.delivery_count,'Parent input':data.item.parent_id,'Protected input':data.item.protected_input_digest,
        'Deployment revision':data.item.snapshot?.deployment?.revision_id,'Claim owner':data.item.claim?.owner_id,'Claim epoch':data.item.claim?.epoch,'Lease deadline (database ms)':data.item.lease_deadline_ms} :
        data.review ? {Review:data.review.proposal.review_id,State:data.review.state,'Existing Run':data.review.proposal.binding.run_id,
            'Exact result digest':data.review.proposal.binding.result_digest,'Source version':data.review.proposal.binding.source_version,'Approved Work Item':data.review.work_item_id} : {};
    for (const [label,value] of Object.entries(summary)) if (value !== undefined && value !== null) {const row=document.createElement('p');row.textContent=label+': '+value;byId('managed-summary').append(row);}
    byId('managed-snapshot-view').textContent = JSON.stringify(data.snapshot || {}, null, 2);
    byId('managed-enqueue').disabled = !managedAllowed('items.enqueue') || !data.snapshot || data.queue?.mode === 'reviewed';
    byId('managed-claim').disabled = !data.queue || !managedAllowed('items.claim');
    byId('managed-renew').disabled = !data.item?.claim || !managedAllowed('items.renew');
    byId('managed-complete').disabled = !data.item?.claim || !managedAllowed('items.complete');
    for (const operation of ['retry','cancel']) {
        const button = byId('managed-' + operation);
        button.disabled = !data.item?.claim || !managedAllowed('items.' + operation);
        button.title = data.item && !data.item.claim ? 'This contract lacks the terminal item epoch. No epoch is guessed.' : 'Requires an actual item epoch and live Runtime grant.';
    }
    for (const operation of ['approve','reject']) byId('managed-' + operation).disabled = !data.review || data.review.state !== 'pending' || !managedAllowed('reviews.decide');
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
    byId('managed-logs').textContent = (data.logs?.lines || []).map(line => `${line.offset}: ${line.text}`).join('\n');
    managedLogCursor = data.logs?.next_cursor;
    byId('managed-more-logs').disabled = !managedLogCursor;
    byId('managed-more-queues').disabled = !data.queueCursor;
    byId('managed-more-items').disabled = !data.itemCursor;
    byId('managed-more-reviews').disabled = !data.reviewCursor;
    byId('managed-pending').replaceChildren();
    for (const retained of data.pending || []) managedButton(byId('managed-pending'), `Reconcile exact ${retained.operation} · ${retained.key}`,
        () => managedSend('reconcile', {key:retained.key}));
});
