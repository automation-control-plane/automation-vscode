const {test} = require('node:test');
const assert = require('node:assert/strict');
const {resolveDiagnosticsHelp, openDiagnosticsHelp} = require('../vscode-client/out/diagnosticsHelp');

test('RCC relative help uses the maintained documentation location', () => {
    assert.equal(resolveDiagnosticsHelp('/troubleshooting/firewall-and-proxies'),
        'https://sema4.ai/docs/automation/troubleshooting/firewall-and-proxies');
    assert.equal(resolveDiagnosticsHelp('https://robocorp.com/docs/troubleshooting/firewall-and-proxies'),
        'https://robocorp.com/docs/troubleshooting/firewall-and-proxies');
    assert.equal(resolveDiagnosticsHelp('https://sema4.ai/docs/automation/troubleshooting/firewall-and-proxies'),
        'https://sema4.ai/docs/automation/troubleshooting/firewall-and-proxies');
});

test('missing, malformed and non-web help never reaches the OS', async () => {
    for (const value of [undefined, null, '', '  ', {}, '/unknown', 'troubleshooting/example',
        '//example.com/troubleshooting/example', '/troubleshooting/../../other',
        '/troubleshooting/\\example', 'file:///tmp/help', 'command:workbench.action.closeWindow',
        'javascript:alert(1)', 'https:', 'https://', 'https://user:password@example.com/help',
        'https://example.com/\nhelp', 'https://example.com/%zz']) {
        assert.equal(resolveDiagnosticsHelp(value), undefined, String(value));
        const explanations = [];
        await openDiagnosticsHelp(value, assert.fail, message => explanations.push(message));
        assert.equal(explanations.length, 1);
        assert.match(explanations[0], /Automation output/);
    }
});

test('external open success, refusal and rejection are awaited and explained', async () => {
    for (const outcome of ['success', 'false', 'throw']) {
        let finished = false;
        const explanations = [];
        await openDiagnosticsHelp('/troubleshooting/firewall-and-proxies', async url => {
            assert.ok(url.startsWith('https://sema4.ai/docs/automation/troubleshooting/'));
            await Promise.resolve();
            finished = true;
            if (outcome === 'throw') throw Error('OS rejected open');
            return outcome === 'success';
        }, message => explanations.push(message));
        assert.equal(finished, true);
        assert.equal(explanations.length, outcome === 'success' ? 0 : 1);
        if (explanations.length) assert.match(explanations[0], /https:\/\/sema4.ai/);
    }
});
