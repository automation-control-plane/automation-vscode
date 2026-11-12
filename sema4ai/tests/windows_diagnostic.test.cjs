const {test} = require('node:test');
const assert = require('node:assert/strict');
const {scrubDiagnostic, exceptionSummary} = require('./windows_diagnostic.cjs');

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
