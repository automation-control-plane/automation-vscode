const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

async function exercise({trustEnabled = true, grant = true, registered = true} = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-import-unit-'));
    const events = [];
    try {
        fs.mkdirSync(path.join(root, 'workspace'));
        fs.mkdirSync(path.join(root, 'public'));
        fs.writeFileSync(path.join(root, 'public/installed-identity.json'), JSON.stringify({id: 'fixture.product'}));
        let trusted = false;
        let tick = 0;
        const api = {
            workspace: {
                workspaceFolders: [{uri: {fsPath: path.join(root, 'workspace')}}],
                getConfiguration: () => ({get: () => trustEnabled}),
                get isTrusted() { return trusted; },
            },
            commands: {executeCommand: async command => {
                assert.equal(command, 'workbench.trust.manage');
                events.push('native-trust-command');
                if (grant) trusted = true;
            }},
            extensions: {getExtension: id => {
                assert.equal(id, 'fixture.product');
                if (trusted && registered) {events.push('registered'); return {};}
            }},
        };
        const exported = {};
        vm.runInNewContext("const originalHarness = 'fixture-harness';\n" + fs.readFileSync(path.join(__dirname, 'windows_trusted_entry.cjs'), 'utf8'), {
            exports: exported, process: {env: {AUTOMATION_WINDOWS_QA: root}},
            Date: {now: () => tick++ * 120001}, setTimeout,
            require: name => {
                if (name === 'vscode') return api;
                if (name === 'fixture-harness') {
                    assert.equal(trusted, true);
                    assert.ok(events.includes('registered'));
                    events.push('harness-import');
                    return {run: async () => events.push('original-assertions-run')};
                }
                return require(name);
            },
        });
        let error;
        try { await exported.run(); } catch (caught) {error = caught;}
        return {events, error};
    } finally {fs.rmSync(root, {recursive: true});}
}

test('controller entry imports original harness only after native trust and product registration', async () => {
    const {events, error} = await exercise();
    assert.equal(error, undefined);
    assert.equal(events[0], 'native-trust-command');
    assert.ok(events.indexOf('registered') < events.indexOf('harness-import'));
    assert.equal(events.at(-1), 'original-assertions-run');
});

test('controller entry refuses disabled trust enforcement', async () => {
    const {events, error} = await exercise({trustEnabled: false});
    assert.ok(error);
    assert.deepEqual(events, []);
});

test('controller entry does not import acceptance if native UI trust is denied', async () => {
    const {events, error} = await exercise({grant: false});
    assert.match(error.message, /trust must be granted/);
    assert.deepEqual(events, ['native-trust-command']);
});

test('controller entry refuses missing product registration after trust', async () => {
    const {events, error} = await exercise({registered: false});
    assert.match(error.message, /must be registered/);
    assert.deepEqual(events, ['native-trust-command']);
});
