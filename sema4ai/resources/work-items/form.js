/* Recursive value editor. No schema is required and no field name is a JS lookup. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.WorkItemForms = api;
})(globalThis, function () {
    let sequence = 0;
    const kinds = ['string', 'number', 'boolean', 'null', 'object', 'array'];
    const own = (object, key, value) => Object.defineProperty(object, key, {value, enumerable:true, writable:true, configurable:true});
    function numeric(text) {
        if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) throw Error('Enter a valid number.');
        const value = Number(text);
        if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw Error('Number is outside the exact supported range; use a string for a large identifier.');
        return value;
    }
    function parse(text) {
        if (typeof text !== 'string' || text.length > 2 * 1024 * 1024) throw Error('Payload exceeds the editor limit.');
        let index = 0, count = 0;
        const space = () => {while (/[\x20\t\r\n]/.test(text[index] || '\0')) index++;};
        function string() {
            const start = index++;
            while (index < text.length) {
                const char = text[index++];
                if (char === '\\') {index++; continue;}
                if (char === '"') return JSON.parse(text.slice(start, index));
                if (char.charCodeAt(0) < 32) throw Error('Unescaped control character.');
            }
            throw Error('Unterminated string.');
        }
        function read(depth) {
            if (++count > 2000 || depth > 64) throw Error('Payload has too many fields or nesting levels.');
            space(); const char = text[index];
            if (char === '"') return string();
            if (char === '{') {
                index++; space(); const result = Object.create(null), names = new Set();
                if (text[index] === '}') {index++; return result;}
                while (true) {
                    space(); if (text[index] !== '"') throw Error('Object field names must be quoted in advanced JSON.');
                    const name = string();
                    if (names.has(name)) throw Error('Duplicate field name: ' + name);
                    names.add(name); space(); if (text[index++] !== ':') throw Error('Missing colon after field name.');
                    own(result, name, read(depth + 1)); space();
                    if (text[index] === '}') {index++; return result;}
                    if (text[index++] !== ',') throw Error('Missing comma between fields.');
                }
            }
            if (char === '[') {
                index++; space(); const result = [];
                if (text[index] === ']') {index++; return result;}
                while (true) {
                    result.push(read(depth + 1)); space();
                    if (text[index] === ']') {index++; return result;}
                    if (text[index++] !== ',') throw Error('Missing comma between array values.');
                }
            }
            for (const [literal, value] of [['true',true],['false',false],['null',null]]) if (text.startsWith(literal,index)) {index += literal.length; return value;}
            const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index));
            if (!match) throw Error('Malformed JSON value.');
            index += match[0].length; return numeric(match[0]);
        }
        const value = read(0); space(); if (index !== text.length) throw Error('Unexpected text after JSON value.');
        return value;
    }
    function node(kind = 'string') {
        if (!kinds.includes(kind)) throw Error('Unsupported field type.');
        return {id:++sequence, kind, value:kind === 'number' ? '' : kind === 'boolean' ? false : '', entries:[], children:[]};
    }
    function fromValue(value, depth = 0, budget = {count:0}) {
        if (depth > 64 || ++budget.count > 2000) throw Error('Payload has too many fields or nesting levels.');
        const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
        const result = node(kind);
        if (kind === 'object') result.entries = Object.entries(value).map(([key,value]) => ({key,node:fromValue(value,depth+1,budget)}));
        else if (kind === 'array') result.children = value.map(value => fromValue(value,depth+1,budget));
        else if (kind === 'number') {result.value = Object.is(value,-0) ? '-0' : String(value); numeric(result.value);}
        else result.value = value;
        return result;
    }
    function toValue(root) {
        let count = 0;
        function read(current, depth) {
            if (++count > 2000 || depth > 64) throw Error('Payload has too many fields or nesting levels.');
            if (current.kind === 'object') {
                const result = Object.create(null), names = new Set();
                for (const entry of current.entries) {
                    if (typeof entry.key !== 'string') throw Error('Field names must be text.');
                    if (names.has(entry.key)) throw Error('Duplicate field name: ' + entry.key);
                    names.add(entry.key); own(result,entry.key,read(entry.node,depth+1));
                }
                return result;
            }
            if (current.kind === 'array') return current.children.map(child => read(child,depth+1));
            if (current.kind === 'number') return numeric(current.value);
            if (current.kind === 'null') return null;
            if (current.kind === 'boolean' && typeof current.value === 'boolean') return current.value;
            if (current.kind === 'string' && typeof current.value === 'string') return current.value;
            throw Error('Invalid field value/type.');
        }
        return read(root,0);
    }
    function stringify(value, indent = 0) {
        if (typeof value === 'number') {numeric(Object.is(value,-0) ? '-0' : String(value)); return Object.is(value,-0) ? '-0' : String(value);}
        if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
        const array = Array.isArray(value), pairs = array ? value.map(item=>stringify(item,indent+2)) : Object.entries(value).map(([key,item])=>JSON.stringify(key)+': '+stringify(item,indent+2));
        if (!pairs.length) return array ? '[]' : '{}';
        return (array?'[':'{')+'\n'+' '.repeat(indent+2)+pairs.join(',\n'+' '.repeat(indent+2))+'\n'+' '.repeat(indent)+(array?']':'}');
    }
    class Editor {
        constructor(container, options = {}) {this.container=container;this.document=options.document || document;this.onChange=options.onChange || (()=>{});this.readOnly=false;this.setValue({});}
        setValue(value) {
            this.error=undefined;
            try {this.root=fromValue(value);} catch(error) {this.root=undefined;this.error=error.message;}
            this.render();
        }
        getValue() {if(this.error || !this.root)throw Error(this.error || 'Payload is unavailable.');return toValue(this.root);}
        getJSON() {return stringify(this.getValue());}
        setJSON(text) {const value=parse(text);this.setValue(value);this.changed();}
        changed() {this.onChange(this);}
        setReadOnly(value) {this.readOnly=!!value;this.render();}
        button(label, fn) {const button=this.document.createElement('button');button.textContent=label;button.disabled=this.readOnly;button.onclick=fn;return button;}
        render() {
            this.container.replaceChildren();
            if(this.error){const message=this.document.createElement('p');message.textContent=this.error;this.container.append(message);return;}
            const draw=(current,parent,depth)=>{
                const group=this.document.createElement('div');group.className='work-item-form-node';parent.append(group);
                if(current.kind==='object') {
                    for(const entry of current.entries) {
                        const row=this.document.createElement('div');row.className='work-item-form-field';group.append(row);
                        const key=this.document.createElement('input');key.value=entry.key;key.placeholder='Field name';key.ariaLabel='Field name';key.disabled=this.readOnly;
                        key.oninput=()=>{entry.key=key.value;this.changed();};row.append(key);
                        drawValue(entry.node,row,depth+1);
                        row.append(this.button('Remove field',()=>{current.entries.splice(current.entries.indexOf(entry),1);this.render();this.changed();}));
                    }
                    group.append(this.button('Add field',()=>{let number=1,name='field';const names=new Set(current.entries.map(entry=>entry.key));while(names.has(name))name='field'+(++number);current.entries.push({key:name,node:node()});this.render();this.changed();}));
                } else if(current.kind==='array') {
                    current.children.forEach((child,index)=>{const row=this.document.createElement('div');row.className='work-item-form-field';group.append(row);const label=this.document.createElement('span');label.textContent='Item '+(index+1);row.append(label);drawValue(child,row,depth+1);row.append(this.button('Remove item',()=>{current.children.splice(index,1);this.render();this.changed();}));});
                    group.append(this.button('Add item',()=>{current.children.push(node());this.render();this.changed();}));
                }
            };
            const drawValue=(current,parent,depth)=>{
                const type=this.document.createElement('select');type.ariaLabel='Value type';type.disabled=this.readOnly;
                for(const kind of kinds){const option=this.document.createElement('option');option.value=kind;option.textContent=kind;type.append(option);}type.value=current.kind;
                type.onchange=()=>{Object.assign(current,node(type.value));this.render();this.changed();};parent.append(type);
                if(current.kind==='object'||current.kind==='array'){draw(current,parent,depth);return;}
                if(current.kind==='null'){const label=this.document.createElement('span');label.textContent='null';parent.append(label);return;}
                const input=this.document.createElement(current.kind==='boolean'?'select':'input');input.ariaLabel='Field value';input.disabled=this.readOnly;
                if(current.kind==='boolean'){for(const value of ['true','false']){const option=this.document.createElement('option');option.value=value;option.textContent=value;input.append(option);}input.value=String(current.value);input.onchange=()=>{current.value=input.value==='true';this.changed();};}
                else {input.type='text';input.placeholder=current.kind==='number'?'Number':'Value';input.value=current.value;input.oninput=()=>{current.value=input.value;this.changed();};}
                parent.append(input);
            };
            if(this.root.kind==='object'||this.root.kind==='array')draw(this.root,this.container,0);else drawValue(this.root,this.container,0);
        }
    }
    return {parse,stringify,fromValue,toValue,node,Editor};
});
