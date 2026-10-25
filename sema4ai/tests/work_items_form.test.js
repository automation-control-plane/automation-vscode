const {test}=require('node:test');
const assert=require('node:assert/strict');
const F=require('../resources/work-items/form');

test('Payload form codec roundtrips nested values, own properties and negative zero',()=>{
    const text='{"invoice":{"number":"A-7","lines":[{"amount":12.5},true,null]},"__proto__":{"polluted":true},"constructor":"data","zero":-0}';
    const value=F.parse(text),root=F.fromValue(value),again=F.parse(F.stringify(F.toValue(root)));
    assert.equal(again.invoice.lines[0].amount,12.5);assert.equal(again.invoice.lines[1],true);assert.equal(again.invoice.lines[2],null);
    assert.equal(Object.getPrototypeOf(again),null);assert.ok(Object.hasOwn(again,'__proto__'));assert.equal(again.__proto__.polluted,true);
    assert.equal({}.polluted,undefined);assert.ok(Object.is(again.zero,-0));assert.equal(again.constructor,'data');
});
test('Malformed/duplicate keys, non-finite or imprecise numbers and excessive nesting are rejected',()=>{
    for(const text of ['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"x":{"same":1,"same":2}}','{"a":}','{a:7}','[1,]','01','NaN','1e999','9007199254740993'])assert.throws(()=>F.parse(text));
    assert.throws(()=>F.parse('['.repeat(66)+'0'+']'.repeat(66)),/nesting/);
    const root=F.fromValue({a:1,b:2});root.entries[1].key='a';assert.throws(()=>F.toValue(root),/Duplicate/);
    root.entries[1].key='b';root.entries[0].node.value='7wrong';assert.throws(()=>F.toValue(root),/valid number/);
});

test('Nested and scalar string controls preserve newlines and Unicode through render, edit and state restore',()=>{
    function element(tag){let value='';return {tag,children:[],textContent:'',get value(){return value;},set value(next){value=tag==='input'?String(next).replace(/[\r\n]/g,''):String(next);},
        append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;}};}
    const container=element('div'),document={createElement:element};
    const all=node=>[node,...node.children.flatMap(all)];
    const text='first "quoted" line\n第二行 🙂\\path\n';
    const editor=new F.Editor(container,{document});
    for(const value of [text,{nested:{text},array:[text]}]){
        editor.setValue(value);
        const fields=all(container).filter(node=>node.ariaLabel==='Field value');
        assert.equal(fields.length,typeof value==='string'?1:2);
        for(const field of fields){assert.equal(field.tag,'textarea');assert.equal(field.value,text);field.value=text+'edited';field.oninput();}
        const expected=typeof value==='string'?text+'edited':{nested:{text:text+'edited'},array:[text+'edited']};
        assert.deepEqual(JSON.parse(editor.getJSON()),expected);
        editor.setState(JSON.parse(JSON.stringify(editor.getState())));
        assert.deepEqual(JSON.parse(editor.getJSON()),expected);
        for(const field of all(container).filter(node=>node.ariaLabel==='Field value'))assert.equal(field.value,text+'edited');
    }
    editor.setReadOnly(true);
    assert.ok(all(container).every(node=>!['textarea','input','select','button'].includes(node.tag)));
    assert.ok(all(container).some(node=>node.textContent===text+'edited'));
});
