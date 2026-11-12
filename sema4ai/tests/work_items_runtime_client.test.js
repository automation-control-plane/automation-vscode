const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {WorkItemsRuntimeClient, canonicalRuntimeOrigin} = require('../vscode-client/out/workItemsRuntimeClient');

test('Managed client requires secure origin, explicit auth and a verified published contract', async () => {
    for (const endpoint of ['http://example.test', 'https://user:pass@example.test', 'https://example.test/path', 'https://example.test/?token=x']) {
        assert.throws(() => new WorkItemsRuntimeClient(endpoint, 'synthetic-token'));
    }
    assert.throws(() => new WorkItemsRuntimeClient('http://127.0.0.1:8082', ''));
    let version = '1.0.4', auth = true, denied = false, unavailable = false, requests = [];
    const server = http.createServer((req, res) => {
        requests.push({method: req.method, route: req.url});
        assert.equal(req.headers.authorization, 'Bearer synthetic-token');
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/config') return res.end(JSON.stringify({version, auth_enabled: auth}));
        if (denied) {res.statusCode = 403; return res.end('{"detail":"synthetic denial"}');}
        if (unavailable) {res.statusCode = 503; return res.end('{}');}
        if (req.url.endsWith('/files/payload.json')) return res.end('{"value":7}');
        if (req.method === 'POST') {
            let body = ''; req.on('data', chunk => body += chunk);
            return req.on('end', () => {assert.deepEqual(JSON.parse(body), {queue_name: 'package-a', payload: {value: 7}}); res.end('{"id":"server-owned-id","state":"PENDING"}');});
        }
        res.end('{"items":[],"total":0}');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const client = new WorkItemsRuntimeClient(`http://127.0.0.1:${server.address().port}`, 'synthetic-token');
    try {
        await assert.rejects(client.seed('package-a', {}), /Connect/);
        await client.connect();
        assert.deepEqual(await client.list('package-a'), {items: [], total: 0});
        assert.equal((await client.seed('package-a', {value: 7})).id, 'server-owned-id');
        const attachment = await client.download('server-owned-id','payload.json');
        assert.ok(Buffer.isBuffer(attachment)); assert.equal(attachment.toString(), '{"value":7}');
        denied = true;
        await assert.rejects(client.list('package-a'), /denied \(403\).*No local fallback/);
        denied = false; unavailable = true;
        await assert.rejects(client.list('package-a'), /unavailable \(503\)/);
        unavailable = false; auth = false;
        await assert.rejects(client.connect(), /authenticated/);
        await assert.rejects(client.list('package-a'), /Connect/);
        auth = true; version = '1.1.0-candidate';
        await assert.rejects(client.connect(), /separately verified capability contract/);
        assert.equal(requests.filter(item => item.method === 'POST').length, 1);
        assert.ok(requests.every(item => !/retry|lease|approve|cancel/.test(item.route)));
    } finally {await new Promise(resolve => server.close(resolve));}
});

test('Managed Runtime origin canonicalization shares transport origin rules', () => {
    assert.equal(canonicalRuntimeOrigin('https://runtime.example/'), 'https://runtime.example');
    assert.equal(canonicalRuntimeOrigin('https://runtime.example'), 'https://runtime.example');
    assert.equal(canonicalRuntimeOrigin('http://127.0.0.1:8082/'), 'http://127.0.0.1:8082');
    for (const endpoint of ['https://runtime.example/path', 'https://user@runtime.example/', 'https://runtime.example/?q=1', 'http://runtime.example/']) {
        assert.throws(() => canonicalRuntimeOrigin(endpoint));
    }
});
