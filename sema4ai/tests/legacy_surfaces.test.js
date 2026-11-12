const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const engineHashes = {
    inspector: '213867dbae25e817f15a6bbe70da8dd2daf9770b9a76e960c21249f7f7024fdc',
    output: '41cdf8b154eb30d43382462c44493358cd6e515dc7711149cb3d6c39b2945a1a',
};
const digest = value => createHash('sha256').update(value).digest('hex');

test('the maintained surface decorator preserves both existing executable engines byte-for-byte', async () => {
    let render;
    await assert.doesNotReject(async () => {
        ({ renderLegacySurface: render } = require('../vscode-client/out/legacySurface'));
    });
    for (const [surface, expectedHash] of Object.entries(engineHashes)) {
        const template = fs.readFileSync(path.join(root, 'vscode-client/templates', surface + '.html'), 'utf8');
        assert.equal(digest(template), expectedHash, 'The compatibility engine changed; requalify before changing its adapter.');
        const html = render({ surface, template, theme: 'body{color:white}', styles: '', script: 'window.surfaceReady=true;', markup: '<header>Automation</header>', context: { packageName: 'Example' }, cspSource: 'https://file+.vscode-resource.vscode-cdn.net' });
        const engine = template.match(/<script type="module" crossorigin>([\s\S]*?)<\/script>/)[1];
        assert.ok(html.includes(engine), 'Existing Inspector/log decoding must remain byte-identical.');
        assert.ok(html.indexOf('<header>Automation</header>') < html.indexOf('<div id="root"'));
        const hash = createHash('sha256').update(engine).digest('base64');
        assert.ok(html.includes("'sha256-" + hash + "'"), 'Existing inline engine is authorized by exact content, not unsafe-inline.');
        assert.ok(html.includes("connect-src 'none'"));
    }
});

test('package names and locator payloads cannot escape JSON script elements', async () => {
    const { renderLegacySurface, replaceJSONSlot } = require('../vscode-client/out/legacySurface');
    const hostile = '</script><script>throw new Error("payload executed")</script>';
    let template = '<!doctype html><html><head><script id="controlJSON" type="application/json"></script></head><body><div id="root"></div></body></html>';
    template = replaceJSONSlot(template, 'controlJSON', { name: hostile });
    const html = renderLegacySurface({ surface: 'inspector', template, theme: '', styles: '', script: '', markup: '', context: { packageName: hostile }, cspSource: 'https://safe.example' });
    assert.equal(html.includes(hostile), false);
    const json = html.match(/<script id="automation-surface-context" type="application\/json">([\s\S]*?)<\/script>/)[1];
    assert.equal(JSON.parse(json).packageName, hostile);
    assert.throws(() => replaceJSONSlot(template, 'missing-slot', {}), /slot/i);
});

test('a malformed template fails closed rather than silently omitting the shared controls', async () => {
    const { renderLegacySurface } = require('../vscode-client/out/legacySurface');
    assert.throws(() => renderLegacySurface({ surface: 'output', template: '<div>broken</div>', theme: '', styles: '', script: '', markup: '', context: {}, cspSource: 'https://safe.example' }), /template/i);
});

test('the actual VS Code CSP resource source permits self and its wildcard resource origin without weakening scripts', () => {
    const { renderLegacySurface } = require('../vscode-client/out/legacySurface');
    const options = { surface: 'output', template: '<html><head></head><body></body></html>', theme: '', styles: '', script: '', markup: '', context: {}, cspSource: "'self' https://*.vscode-cdn.net" };
    const html = renderLegacySurface(options);
    assert.ok(html.includes("img-src 'self' https://*.vscode-cdn.net data: blob:"));
    assert.ok(html.includes("script-src 'none'"));
    assert.throws(() => renderLegacySurface({ ...options, cspSource: 'https://safe.example; script-src *' }), /resource origin/i);
});
