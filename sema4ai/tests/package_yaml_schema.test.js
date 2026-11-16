const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifest = require('../package.json');

test('Action Package YAML schema is local, scoped to package.yaml, and preserves supported dependency types', () => {
    const associations = manifest.contributes?.yamlValidation || [];
    const association = associations.find(item => item.fileMatch === '**/package.yaml');
    assert.ok(association, 'the extension must associate a schema specifically with package.yaml');
    assert.ok(association.url.startsWith('./'), 'the Action Package schema must ship with this extension');

    const schemaPath = path.resolve(__dirname, '..', association.url);
    assert.equal(fs.existsSync(schemaPath), true, 'the contributed schema file must be packaged');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');

    const groupRef = schema.properties.dependencies.$ref;
    assert.equal(schema.properties['dev-dependencies'].$ref, groupRef);
    const groups = schema.definitions[groupRef.split('/').at(-1)];
    for (const name of ['conda-forge', 'pypi', 'local-wheels']) {
        assert.deepEqual(groups.properties[name], {type: 'array', items: {type: 'string'}});
    }
});
