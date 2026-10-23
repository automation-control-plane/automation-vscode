const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Inspector navigation emits only an existing route event, never starts a picker', () => {
    const { inspectorRouteEvent } = require('../resources/runbook/legacy-shell.js');
    for (const route of ['/locators-manager/', '/web-inspector/', '/windows-inspector/', '/image-inspector/', '/java-inspector/']) {
        assert.deepEqual(inspectorRouteEvent(route), { type: 'event', id: '', event: { type: 'gotoInspectorApp', status: 'success', data: route } });
    }
    assert.equal(inspectorRouteEvent('/api-inspector/'), undefined);
    assert.equal(inspectorRouteEvent('javascript:alert(1)'), undefined);
});

test('the Inspector context distinguishes Actions and Robot Tasks without inferred success or credentials', () => {
    const { packageContext } = require('../resources/runbook/legacy-shell.js');
    assert.deepEqual(packageContext({ packageName: 'Import records', packageType: 'action', directory: '/synthetic/actions' }), { name: 'Import records', kind: 'Action Package', directory: '/synthetic/actions' });
    assert.equal(packageContext({ packageName: 'Import records', packageType: 'robot', directory: '/synthetic/robots' }).kind, 'Robot Task');
    assert.equal(packageContext({}).name, 'No package selected');
});

test('Inspector keyboard navigation reaches every real route and wraps without invoking inspection', () => {
    const { nextInspectorRoute } = require('../resources/runbook/legacy-shell.js');
    assert.equal(nextInspectorRoute('/web-inspector/', 'ArrowRight'), '/windows-inspector/');
    assert.equal(nextInspectorRoute('/locators-manager/', 'ArrowLeft'), '/java-inspector/');
    assert.equal(nextInspectorRoute('/image-inspector/', 'Home'), '/locators-manager/');
    assert.equal(nextInspectorRoute('/image-inspector/', 'End'), '/java-inspector/');
    assert.equal(nextInspectorRoute('/image-inspector/', 'Enter'), undefined);
});

test('high-contrast color bridging reads rendered RGB channels without accepting arbitrary CSS', () => {
    const { rgbChannels } = require('../resources/runbook/legacy-shell.js');
    assert.equal(rgbChannels('rgb(255, 191, 36)'), '255, 191, 36');
    assert.equal(rgbChannels('rgb(0 0 0)'), '0, 0, 0');
    assert.equal(rgbChannels('rgba(255, 255, 255, 1)'), '255, 255, 255');
    assert.equal(rgbChannels('url(http://example.com)'), undefined);
    assert.equal(rgbChannels('rgb(999, 1, 2)'), undefined);
});

test('Output shell follows the selected log identity and never equates stream closure with success', () => {
    const { outputMessage } = require('../resources/runbook/legacy-shell.js');
    const initial = { runId: undefined, label: '' };
    const selected = outputMessage(initial, { type: 'request', command: 'setContents', runId: 'run-b', allRunIdsToLabel: { 'run-a': 'First', 'run-b': 'Second' }, initialContents: '' });
    assert.deepEqual(selected, { runId: 'run-b', label: 'Second' });
    assert.equal(outputMessage(selected, { type: 'request', command: 'updateLabel', runId: 'run-a', label: 'First (finished)' }), selected);
    assert.deepEqual(outputMessage(selected, { type: 'request', command: 'updateLabel', runId: 'run-b', label: 'Second (finished)' }), { runId: 'run-b', label: 'Second (finished)' });
    assert.equal(outputMessage(selected, { type: 'request', command: 'appendContents', runId: 'run-b', appendContents: 'log' }), selected);
});
