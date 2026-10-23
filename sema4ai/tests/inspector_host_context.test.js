const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const extensionRoot = path.resolve(__dirname, '..');
const originalLoad = Module._load;
let selected;
const panels = [];
const notices = [];
const requests = [];
const disposable = () => ({ dispose() {} });
const vscode = {
    ViewColumn: { Active: 1 },
    Uri: { file: value => ({ fsPath: value, toString: () => 'https://safe.example/' + encodeURIComponent(value) }) },
    commands: { executeCommand: async () => ({ success: true, result: [] }) },
    window: {
        showInformationMessage: async message => notices.push(message),
        createWebviewPanel() {
            let onDispose;
            const panel = {
                disposed: false, revealed: 0, messages: [],
                reveal() { this.revealed++; },
                onDidDispose(fn) { onDispose = fn; return disposable(); },
                dispose() { this.disposed = true; onDispose?.(); },
                webview: { html: '', cspSource: 'https://safe.example', asWebviewUri: uri => uri, onDidReceiveMessage: () => disposable(), postMessage: async message => panel.messages.push(message) },
            };
            panels.push(panel);
            return panel;
        },
    },
};
Module._load = function (name, parent, main) {
    if (parent?.filename.endsWith('/inspector/inspectorView.js')) {
        if (name === 'vscode') return vscode;
        if (name === '../viewsSelection') return { getSelectedRobot: () => selected };
        if (name === '../files') return { verifyFileExists: () => false, getExtensionRelativeFile: relative => path.resolve(extensionRoot, 'vscode-client/out', relative) };
        if (name === '../channel') return { OUTPUT_CHANNEL: { appendLine() {} }, buildErrorStr: String, logError() {} };
        if (name === '../extension') return { langServer: { onNotification: disposable, sendRequest: async (name, args) => { requests.push({ name, args }); return { success: true }; } } };
    }
    return originalLoad.call(this, name, parent, main);
};
let show;
try { show = require('../vscode-client/out/inspector/inspectorView').showInspectorUI; }
finally { Module._load = originalLoad; }
const context = { subscriptions: [] };
const readContext = panel => JSON.parse(panel.webview.html.match(/<script id="automation-surface-context" type="application\/json">([\s\S]*?)<\/script>/)[1]);

test('Inspector refuses ambiguous empty context, reuses the same package and replaces a different package without auto-picking', async () => {
    selected = undefined;
    await show(context);
    assert.equal(panels.length, 0);
    assert.equal(notices.length, 1);

    selected = { robot: { name: 'Import <records>', directory: '/synthetic/action', filePath: '/synthetic/action/package.yaml' } };
    await show(context, '/web-inspector/');
    const actionPanel = panels.at(-1);
    assert.equal(readContext(actionPanel).packageType, 'action');
    assert.equal(readContext(actionPanel).packageName, 'Import <records>');
    assert.equal(requests.length, 0, 'Opening an Inspector must not start a backend operation.');

    await show(context);
    assert.equal(panels.length, 1);
    assert.equal(actionPanel.messages.at(-1).event.data, '/locators-manager/');

    selected = { robot: { name: 'Robot fixture', directory: '/synthetic/robot', filePath: '/synthetic/robot/robot.yaml' } };
    await show(context, '/image-inspector/');
    assert.equal(actionPanel.disposed, true);
    assert.equal(panels.length, 2);
    assert.equal(readContext(panels.at(-1)).packageType, 'robot');
    assert.equal(readContext(panels.at(-1)).directory, '/synthetic/robot');
    assert.deepEqual(requests, [{ name: 'killInspectors', args: { inspector: null } }], 'Only explicit old-panel disposal cleans up its inspectors.');
});
