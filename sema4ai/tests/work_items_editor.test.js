const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('Native editor payload validation, mode changes, attachments and linked outputs use structured host messages', () => {
    const nodes = new Map(), messages = [];
    function element() {
        return {value: '', textContent: '', children: [], disabled: false,
            append(...children) {this.children.push(...children);}, replaceChildren(...children) {this.children = children;},
            set innerHTML(_) {assert.fail('Untrusted Work Item content must not become HTML');}};
    }
    const document = {getElementById(id) {if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id);}, createElement: element};
    let receive;
    const sandbox = {document, acquireVsCodeApi: () => ({postMessage: message => messages.push(JSON.parse(JSON.stringify(message)))}), window: {addEventListener: (_, callback) => receive = callback}};
    vm.runInNewContext(fs.readFileSync('resources/work-items/editor.js', 'utf8'), sandbox);
    assert.equal(messages[0].op, 'refresh');
    nodes.get('payload').value = '[]'; nodes.get('create').onclick();
    assert.equal(messages.length, 1);
    assert.match(nodes.get('validation').textContent, /JSON object/);
    nodes.get('payload').value = '{"value":7}'; nodes.get('create').onclick();
    assert.deepEqual(messages.at(-1).payload, {value: 7});
    receive({data: {type: 'state', mode: 'file', package: '/workspace/action/package.yaml', authority: 'Local fixtures',
        contract:{value:'integer'}, selectId: 'input#0', items: [{id:'input#0',role:'input',payload:{value:7},files:['invoice.txt'],revision:'abc',state:'LOCAL_FIXTURE'},
        {id:'devdata/work-items-out/native-run1/work-items.json#0',role:'output',payload:{observed:7},files:[],state:'LOCAL_FIXTURE'}],
        receipts:[{id:'run1',mode:'file',input:'input#0',state:'EXITED',exit_code:0}]}});
    assert.equal(nodes.get('payload').value, '{\n  "value": 7\n}');
    const field = nodes.get('payload-fields').children[0].children[0];
    assert.equal(field.type, 'number'); field.value = '8'; field.oninput();
    assert.deepEqual(JSON.parse(nodes.get('payload').value), {value:8});
    nodes.get('files').children[0].onclick(); assert.equal(messages.at(-1).op, 'download');
    document.getElementById('parameters').value = '{}'; nodes.get('debug').onclick();
    assert.equal(messages.at(-1).op, 'debug'); assert.equal(messages.at(-1).id, 'input#0');
    assert.deepEqual(messages.at(-1).payload, {value:8});
    assert.deepEqual(messages.at(-1).parameters, {});
    const card = nodes.get('receipts').children[0];
    assert.equal(card.children[0].textContent, 'file · EXITED · exit 0');
    card.children[2].onclick(); assert.match(nodes.get('selection').textContent, /native-run1/);
    assert.equal(nodes.get('save').disabled, true);
    nodes.get('mode').value = 'managed'; nodes.get('mode').onchange();
    assert.equal(nodes.get('items').children.length, 0);
    assert.equal(nodes.get('debug').disabled, true);
    assert.deepEqual(messages.at(-1), {op:'mode', mode:'managed', queue:'input'});
    receive({data:{type:'error',message:'Runtime access denied (403). No local fallback.'}});
    assert.match(nodes.get('status').textContent, /denied/);
});
