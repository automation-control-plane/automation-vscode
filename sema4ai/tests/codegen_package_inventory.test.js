const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('generated default test inventory matches the committed package manifest', () => {
    const committed = JSON.parse(fs.readFileSync(require.resolve('../package.json'), 'utf8')).scripts.test;
    const generator = fs.readFileSync(require.resolve('../codegen/codegen_package.py'), 'utf8');
    const generated = generator.match(/"test": "(node --test [^"]+)"/);
    assert.ok(generated, 'codegen_package.py must define a default test command');
    assert.deepEqual(generated[1].split(' ').slice(2), committed.split(' ').slice(2));
});
