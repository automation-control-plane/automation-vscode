const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function renderEnvironmentState(state) {
    const receivers = [], nodes = [];
    function element(tag) {
        const node = {tag, children: [], textContent: '', attributes: {}, className: '', disabled: false,
            append(...children) {for (const child of children) {child.parent = this; this.children.push(child);}},
            prepend(...children) {for (const child of children) child.parent = this; this.children.unshift(...children);},
            replaceChildren(...children) {this.children = []; this.append(...children);},
            setAttribute(name, value) {this.attributes[name] = value;},
            get lastChild() {return this.children.at(-1);},
            classList: {add(name) {node.className += ' ' + name;}},
            set innerHTML(_) {assert.fail('Workspace content must use text nodes, not injected markup');}};
        nodes.push(node);
        return node;
    }
    const app = element('div');
    const scope = {
        document: {createElement: element, getElementById: id => {assert.equal(id, 'app'); return app;}},
        acquireVsCodeApi: () => ({postMessage() {}, getState: () => undefined, setState() {}}),
        window: {addEventListener: (_, callback) => receivers.push(callback)},
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../resources/runbook/workspace.js'), 'utf8'), scope);
    receivers.forEach(callback => callback({data: state}));
    return nodes.map(node => node.textContent).join(' ');
}

function loadPublishedToolVersion(contents) {
    const helperPath = path.join(__dirname, '../vscode-client/out/publishedTools.js');
    const exports = {};
    const module = {exports};
    const source = fs.readFileSync(helperPath, 'utf8');
    const scope = {
        exports, module, __dirname: path.dirname(helperPath), __filename: helperPath,
        require: name => name === 'fs' ? {readFileSync: () => {
            if (contents instanceof Error) throw contents;
            return contents;
        }} : require(name),
    };
    vm.runInNewContext(source, scope, {filename: helperPath});
    return module.exports.publishedToolVersion;
}

test('Published tool versions follow changed manifest values', () => {
    const publishedToolVersion = loadPublishedToolVersion(JSON.stringify({
        rcc: {version: '18.20.1'}, 'action-server': {version: '9.8.7'},
    }));

    assert.equal(publishedToolVersion('rcc'), '18.20.1');
    assert.equal(publishedToolVersion('action-server'), '9.8.7');
});

test('Published tool version lookup returns unknown for missing, malformed, or unreadable manifests', () => {
    assert.equal(loadPublishedToolVersion('{}')('rcc'), undefined);
    assert.equal(loadPublishedToolVersion('{')('rcc'), undefined);
    assert.equal(loadPublishedToolVersion('not readable')('rcc'), undefined);

    assert.equal(loadPublishedToolVersion(Object.assign(new Error('ENOENT'), {code: 'ENOENT'}))('rcc'), undefined);
});

test('Environments view renders changed manifest pins without claiming Runtime RCC or qualification', () => {
    const text = renderEnvironmentState({type: 'state', route: 'environments', title: 'Environments',
        selected: {name: 'Demo', directory: '/workspace/demo', manifest: '/workspace/demo/package.yaml', kind: 'Action', dependencies: []},
        packages: [{name: 'Demo', directory: '/workspace/demo', manifest: '/workspace/demo/package.yaml', kind: 'Action'}], trusted: true,
        environment: {status: 'Not checked'}, homes: {actions: '/actions', robots: '/robots'},
        runtime: {kind: 'unknown-listener', message: 'Status unavailable.'}, runnable: [], runs: [],
        publishedTools: {runtimeVersion: '9.8.7', extensionRccVersion: '18.20.1'},
    });

    assert.match(text, /Runtime pin 9\.8\.7/);
    assert.match(text, /Extension RCC pin 18\.20\.1/);
    assert.match(text, /Runtime-bundled RCC: Unknown \(not declared in the published manifest\)/);
    assert.match(text, /These pins do not identify configured overrides or installed versions/);
    assert.match(text, /Runtime qualification is not established by manifest versions/);
    assert.match(text, /canonical managed lifecycle qualification is separate/);
    assert.doesNotMatch(text, /Runtime 1\.0\.4|18\.19\.3|18\.19\.7/);
});

test('Environments view handles missing manifest versions as unknown', () => {
    const text = renderEnvironmentState({type: 'state', route: 'environments', title: 'Environments',
        selected: {name: 'Demo', directory: '/workspace/demo', manifest: '/workspace/demo/package.yaml', kind: 'Action', dependencies: []},
        packages: [{name: 'Demo', directory: '/workspace/demo', manifest: '/workspace/demo/package.yaml', kind: 'Action'}], trusted: true,
        environment: {status: 'Not checked'}, homes: {actions: '/actions', robots: '/robots'},
        runtime: {kind: 'unknown-listener', message: 'Status unavailable.'}, runnable: [], runs: [], publishedTools: {},
    });

    assert.match(text, /Runtime pin Unknown/);
    assert.match(text, /Extension RCC pin Unknown/);
    assert.match(text, /Runtime qualification is not established by manifest versions/);
});
