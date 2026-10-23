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
