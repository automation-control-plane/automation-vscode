const {test} = require('node:test');
const assert = require('node:assert/strict');
const startup = require('../vscode-client/out/languageServerStartup');

test('RCC process rejection preserves a safe network explanation through LanguageClient rejection', () => {
    startup.beginLanguageServerStartup();
    const error = {error: new Error('Command failed: rcc holotree variables'), stdout: '',
        stderr: 'critical libmamba Download error (7) Could not connect to server https://private-token@example.invalid/channel'};
    startup.failLanguageServerStartup(error, 'environment');
    const state = startup.getLanguageServerStartup();
    assert.equal(state.status, 'failed');
    assert.equal(state.reason, 'network');
    assert.match(state.message, /connection failed/);
    assert.match(state.message, /VS Code process/);
    assert.doesNotMatch(JSON.stringify(state), /private-token|example.invalid|holotree variables/);
    startup.failLanguageServerStartup(new Error('Starting server failed'));
    assert.equal(startup.getLanguageServerStartup(), state);
    assert.equal(error.stderr.includes('private-token'), true, 'original diagnostic is not mutated');
});

test('Readiness changes are observable and explicit restart clears the failure without caching it', () => {
    const states = [];
    const listener = startup.onLanguageServerStartupChanged(() => states.push(startup.getLanguageServerStartup().status));
    startup.beginLanguageServerStartup();
    startup.failLanguageServerStartup({stderr:'Download error (28) Timeout was reached'}, 'environment');
    assert.equal(startup.getLanguageServerStartup().reason, 'network');
    startup.beginLanguageServerStartup();
    startup.completeLanguageServerStartup();
    assert.deepEqual(states, ['starting', 'failed', 'starting', 'ready']);
    assert.equal(startup.getLanguageServerStartup().message, '');
    listener.dispose(); startup.beginLanguageServerStartup();
    assert.equal(states.length, 4);
});

test('Non-network environment and server errors retain honest distinct guidance without exposing raw errors', () => {
    startup.beginLanguageServerStartup();
    startup.failLanguageServerStartup(new Error('Configured language-server Python does not exist: /private/path'), 'environment');
    assert.equal(startup.getLanguageServerStartup().reason, 'environment');
    assert.match(startup.getLanguageServerStartup().message, /configured RCC and language-server Python paths/);
    assert.doesNotMatch(startup.getLanguageServerStartup().message, /network|private\/path/);
    startup.beginLanguageServerStartup();
    startup.failLanguageServerStartup(new Error("command 'sema4ai.localListRobots.internal' not found"));
    assert.equal(startup.getLanguageServerStartup().reason, 'server');
    assert.doesNotMatch(startup.getLanguageServerStartup().message, /sema4ai|not found/);
    assert.equal(Object.isFrozen(startup.getLanguageServerStartup()), true);
});
