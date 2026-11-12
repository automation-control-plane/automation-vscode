const {test} = require('node:test');
const assert = require('node:assert/strict');
const {scrubDiagnostic, exceptionSummary, collectAdapterFailures} = require('./windows_diagnostic.cjs');

test('adapter error preserves the error code and approved diagnostic context', () => {
    const error = Object.assign(new Error('spawn D:\\qa\\python.exe ENOENT'), {code: 'ENOENT'});
    assert.deepEqual(exceptionSummary(error, 'D:\\qa'), {name: 'Error', code: 'ENOENT', message: 'spawn <qa-root>\\python.exe ENOENT'});
});
test('diagnostics omit credential/environment lines and long opaque values', () => {
    const text = 'spawn failed\nAWS_BEARER_TOKEN_BEDROCK=synthetic\nAuthorization: Bearer synthetic\nenv: synthetic\n{"PATH":"synthetic"}\n' + 'A'.repeat(48);
    const result = scrubDiagnostic(text, 'D:\\qa');
    assert.equal(result, 'spawn failed\n<redacted>');
});
test('diagnostic output is bounded without serializing exception properties', () => {
    const error = {name: 'Error', message: 'x '.repeat(2000), environment: {private: 'synthetic'}};
    const result = exceptionSummary(error, 'D:\\qa');
    assert.ok(result.message.length <= 2000);
    assert.equal(JSON.stringify(result).includes('synthetic'), false);
});
test('private adapter log collection retains fatal lines without environment or opaque values', () => {
    const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-diagnostic-'));
    try {
        fs.mkdirSync(path.join(root, 'debugpy-private'));
        fs.writeFileSync(path.join(root, 'debugpy-private/debugpy.adapter-7.log'),
            'Traceback (most recent call last):\nModuleNotFoundError: No module named debugpy\nError env: synthetic\nError Authorization: Bearer synthetic\nError ' + 'A'.repeat(48));
        const result = collectAdapterFailures(root);
        assert.equal(result.privateLogFilesFound, 1);
        assert.ok(result.files[0].fatalLines.some(line => line.includes('ModuleNotFoundError')));
        assert.equal(JSON.stringify(result).includes('synthetic'), false);
        assert.equal(JSON.stringify(result).includes('A'.repeat(48)), false);
    } finally {fs.rmSync(root, {recursive: true});}
});
test('collector decodes only diagnostic protocol fields and inspects owned ptyhost failures', () => {
    const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'protocol-diagnostic-'));
    try {
        fs.mkdirSync(path.join(root, 'debugpy-private'));
        fs.writeFileSync(path.join(root, 'debugpy-private/debugpy.launcher-7.log'),
            '    "output": "ModuleNotFoundError: No module named example\\n",\n    "exitCode": 1,\n    "env": {"private":"synthetic"}');
        fs.mkdirSync(path.join(root, 'profile/logs/20261112T000000'), {recursive: true});
        fs.writeFileSync(path.join(root, 'profile/logs/20261112T000000/ptyhost.log'),
            'Error: CreateProcess failed\nError Authorization: Bearer synthetic');
        const result = collectAdapterFailures(root);
        assert.ok(result.files.some(item => item.fatalLines.some(line => line.includes('ModuleNotFoundError'))));
        assert.ok(result.files.some(item => item.protocol?.some(field => field.field === 'exitCode' && field.value === 1)));
        assert.ok(result.files.some(item => item.file === 'ptyhost.log' && item.fatalLines.some(line => line.includes('CreateProcess failed'))));
        assert.equal(JSON.stringify(result).includes('synthetic'), false);
    } finally {fs.rmSync(root, {recursive: true});}
});
