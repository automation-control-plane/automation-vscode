const {test} = require("node:test");
const assert = require("node:assert/strict");
const {spawn} = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const {once} = require("node:events");
const Module = require("node:module");
const {captureRuntimeOwnership, inspectRuntimeOwnership, parseRuntimeOwnership} = require("../vscode-client/out/runtimeOwnership");

async function runtimeFixture(t, {descendant = false, listen = true} = {}) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "automation-runtime-owner-"));
    const reserve = net.createServer();
    await new Promise(resolve => reserve.listen(0, "127.0.0.1", resolve));
    const port = reserve.address().port;
    await new Promise(resolve => reserve.close(resolve));
    const dataDirectory = path.join(directory, "state");
    const code = `
        const net = require("net");
        const port = Number(process.argv.find(x => x.startsWith("--port=")).slice(7));
        const server = net.createServer(socket => {process.send({contacted: true}); socket.end();});
        process.on("message", message => {if (message === "close") {server.listening ? server.close(() => process.exit(0)) : process.exit(0);}});
        ${listen ? 'server.listen(port, "127.0.0.1", () => process.send({ready:true}));' : 'process.send({ready:true});'}
    `;
    const args = ["start", "--address=127.0.0.1", `--port=${port}`, `--datadir=${dataDirectory}`];
    const program = descendant ? `
        const child = require("child_process").spawn(process.execPath, ["-e", ${JSON.stringify(code)}, "--", ...process.argv.slice(1)], {stdio:["ignore","ignore","inherit","ipc"]});
        child.on("message", message => process.send(message));
        process.on("message", message => child.send(message));
        child.on("exit", code => process.exit(code || 0));
    ` : code;
    const child = spawn(process.execPath, ["-e", program, "--", ...args], {cwd: directory, stdio: ["ignore", "ignore", "inherit", "ipc"]});
    const contacts = [];
    child.on("message", message => {if (message.contacted) contacts.push(message);});
    await once(child, "message");
    t.after(async () => {
        if (child.exitCode === null) {const exited = once(child, "exit"); child.send("close"); await exited;}
        await fs.rm(directory, {recursive:true, force:true});
    });
    return {child, contacts, port, directory, dataDirectory, executable: process.execPath, processId: child.pid};
}

test("Runtime ownership survives a host reload and proves the exact live process and listener without contacting it", {skip: process.platform !== "linux"}, async t => {
    const fixture = await runtimeFixture(t);
    const record = await captureRuntimeOwnership(fixture);
    assert.ok(record, "new owned launch must produce a restart-safe identity");
    assert.equal(record.directory, fixture.directory);
    assert.equal(record.processId, fixture.child.pid);
    assert.equal(record.port, fixture.port);
    const reloaded = parseRuntimeOwnership(JSON.parse(JSON.stringify(record)));
    assert.ok(reloaded);
    assert.deepEqual(await inspectRuntimeOwnership(reloaded), {kind:"verified"});
    assert.equal(fixture.contacts.length, 0, "ownership inspection must not contact the listener");
    assert.equal(Object.keys(record).some(key => /token|credential|environment|password/i.test(key)), false);
});

test("Runtime wrapper ownership includes a listener in its live descendant process tree", {skip: process.platform !== "linux"}, async t => {
    const fixture = await runtimeFixture(t, {descendant:true});
    const record = await captureRuntimeOwnership(fixture);
    assert.ok(record);
    assert.deepEqual(await inspectRuntimeOwnership(record), {kind:"verified"});
    assert.equal(fixture.contacts.length, 0);
});

test("A live owned launch cannot adopt an unrelated listener on its recorded port", {skip: process.platform !== "linux"}, async t => {
    const fixture = await runtimeFixture(t, {listen:false});
    const record = await captureRuntimeOwnership(fixture);
    assert.ok(record);
    const unrelated = net.createServer(socket => {assert.fail("Unknown listener was contacted"); socket.end();});
    await new Promise(resolve => unrelated.listen(fixture.port, "127.0.0.1", resolve));
    try {
        assert.deepEqual(await inspectRuntimeOwnership(record), {kind:"unverified-listener"});
        assert.equal(unrelated.listening, true);
    } finally {await new Promise(resolve => unrelated.close(resolve));}
});

test("Changed process birth identity and package path cannot recover an owned Runtime", {skip: process.platform !== "linux"}, async t => {
    const fixture = await runtimeFixture(t);
    const record = await captureRuntimeOwnership(fixture);
    assert.ok(record);
    assert.deepEqual(await inspectRuntimeOwnership({...record, processStart: record.processStart + "0"}), {kind:"stale"});
    assert.deepEqual(await inspectRuntimeOwnership({...record, directory: fixture.directory + "-other"}), {kind:"stale"});
    assert.equal(await captureRuntimeOwnership({...fixture, directory: fixture.directory + "-other"}), undefined);
    assert.equal(fixture.contacts.length, 0);
});

test("An exited Runtime never regains ownership from a free port or a reused record", {skip: process.platform !== "linux"}, async t => {
    const fixture = await runtimeFixture(t);
    const record = await captureRuntimeOwnership(fixture);
    assert.ok(record);
    const exited = once(fixture.child, "exit"); fixture.child.send("close"); await exited;
    assert.deepEqual(await inspectRuntimeOwnership(record), {kind:"stale"});
});

test("Runtime ownership persistence rejects malformed or unsupported records", () => {
    for (const record of [null, {}, [], {version:2}, {version:1, processId:1, port:8082}, {version:1, processId:"1", directory:"/x"}]) {
        assert.equal(parseRuntimeOwnership(record), undefined);
    }
});

function runtimeHost(fixture, record, createTerminal) {
    const saved = new Map(record ? [["automation.runtimeOwnership.v1", record]] : []);
    let shown = 0;
    const terminal = {name:"Automation: Action Server", processId:Promise.resolve(fixture.processId),
        show() {shown++;}, dispose() {assert.fail("Recovery must not dispose a terminal");}};
    const errors = [];
    const vscode = {
        Uri: {file: fsPath => ({fsPath})},
        workspace: {getConfiguration: () => ({get: (key, fallback) => key === "actionServer.port" ? fixture.port : key === "actionServer.location" ? process.execPath : fallback})},
        window: {terminals:[terminal], showErrorMessage: message => errors.push(message),
            showWarningMessage: async () => "Reconnect to Runtime", createTerminal(options) {
                if (!createTerminal) assert.fail("Recovery must not start a replacement");
                const created = createTerminal(options); vscode.window.terminals.push(created); return created;
            }},
    };
    const state = {get: key => saved.get(key), update: async (key, value) => {value === undefined ? saved.delete(key) : saved.set(key, value);}};
    const file = require.resolve("../vscode-client/out/actionServer");
    delete require.cache[file];
    const load = Module._load;
    Module._load = function(name, parent, main) {
        if (parent?.filename === file) {
            if (name === "vscode") return vscode;
            if (["./runtimePaths", "./runtimeServerConfig", "./runtimeOwnership"].includes(name)) return load.call(this, name, parent, main);
            if (name === "./channel") return {OUTPUT_CHANNEL:{appendLine() {}}};
            if (name === "./legacyIntegrations") return {legacyVendorIntegrationsEnabled: () => false};
            if (name === "./rcc") return {getRobocorpHome: async () => fixture.directory,
                createEnvWithRobocorpHome: () => ({ACTIONS_HOME:path.join(fixture.directory,"actions"), ROBOTS_HOME:path.join(fixture.directory,"robots")})};
            if (name.startsWith("./")) return {};
        }
        return load.call(this, name, parent, main);
    };
    let runtime;
    try {runtime = require(file);} finally {Module._load = load;}
    assert.equal(typeof runtime.initializeRuntimeOwnership, "function", "Runtime must register restart-safe storage");
    runtime.initializeRuntimeOwnership(state);
    return {runtime, terminal, saved, errors, shown: () => shown};
}

test("A reloaded extension can explicitly reconnect only its verified package terminal", {skip: process.platform !== "linux"}, async t => {
    const fixture = await runtimeFixture(t);
    const record = await captureRuntimeOwnership(fixture);
    const host = runtimeHost(fixture, record);
    const directory = {fsPath:fixture.directory};
    const status = await host.runtime.getRuntimeStatus(directory);
    assert.equal(status.kind, "owned-running");
    assert.equal(status.endpoint, `http://127.0.0.1:${fixture.port}`);
    assert.equal(status.canReconnect, true);
    assert.equal(host.runtime.getActionServerTerminal(), undefined, "Reading status does not adopt the process");
    assert.equal(await host.runtime.reconnectActionServer(directory), true);
    assert.equal(host.runtime.getActionServerTerminal(), host.terminal);
    assert.equal((await host.runtime.getRuntimeStatus(directory)).canReconnect, false);
    assert.equal(host.shown(), 1);
    assert.equal(fixture.contacts.length, 0);
    assert.deepEqual(host.errors, []);
});

test("Start after host reload offers reconnect instead of creating a colliding Runtime", {skip: process.platform !== "linux"}, async t => {
    const fixture = await runtimeFixture(t);
    const host = runtimeHost(fixture, await captureRuntimeOwnership(fixture));
    await host.runtime.startActionServer({fsPath:fixture.directory});
    assert.equal(host.runtime.getActionServerTerminal(), host.terminal);
    assert.equal(host.shown(), 1);
    assert.deepEqual(host.errors, []);
    assert.equal(fixture.contacts.length, 0);
});

test("An identically named terminal and healthy unknown port are not recovery authority", {skip: process.platform !== "linux"}, async t => {
    const fixture = await runtimeFixture(t);
    const host = runtimeHost(fixture);
    const directory = {fsPath:fixture.directory};
    const status = await host.runtime.getRuntimeStatus(directory);
    assert.equal(status.kind, "unknown-listener");
    assert.equal("endpoint" in status, false);
    assert.equal(await host.runtime.reconnectActionServer(directory), false);
    assert.equal(host.runtime.getActionServerTerminal(), undefined);
    assert.equal(host.shown(), 0);
    assert.equal(fixture.contacts.length, 0);
});

test("A persisted launch for another package never enables Runtime reconnect", {skip: process.platform !== "linux"}, async t => {
    const fixture = await runtimeFixture(t);
    const host = runtimeHost(fixture, await captureRuntimeOwnership(fixture));
    const other = {fsPath:fixture.directory + "-other"};
    assert.equal((await host.runtime.getRuntimeStatus(other)).kind, "unknown-listener");
    assert.equal(await host.runtime.reconnectActionServer(other), false);
    assert.equal(host.runtime.getActionServerTerminal(), undefined);
    assert.equal(fixture.contacts.length, 0);
});

test("A new Runtime launch persists its own nonsecret identity before reload recovery", {skip: process.platform !== "linux"}, async t => {
    const fixture = await runtimeFixture(t, {listen:false});
    let child, ready;
    t.after(async () => {
        if (child && child.exitCode === null) {const exited = once(child, "exit"); child.send("close"); await exited;}
    });
    const host = runtimeHost(fixture, undefined, options => {
        const program = `
            const port = Number(process.argv.find(x => x.startsWith("--port=")).slice(7));
            const server = require("net").createServer(socket => {process.send({contacted:true});socket.end();});
            server.listen(port,"127.0.0.1",()=>process.send({ready:true}));
            process.on("message",()=>server.close(()=>process.exit(0)));
        `;
        child = spawn(options.shellPath, ["-e", program, "--", ...options.shellArgs], {cwd:options.cwd.fsPath, stdio:["ignore","ignore","inherit","ipc"]});
        ready = once(child,"message");
        return {name:options.name, processId:Promise.resolve(child.pid), show() {}, dispose() {assert.fail("Launch must not dispose a terminal");}};
    });
    await host.runtime.startActionServer({fsPath:fixture.directory});
    await ready;
    const record = parseRuntimeOwnership(host.saved.get("automation.runtimeOwnership.v1"));
    assert.ok(record, "successful owned launch must save its process birth identity");
    assert.equal(record.processId, child.pid);
    assert.equal(record.directory, fixture.directory);
    assert.equal((await host.runtime.getRuntimeStatus({fsPath:fixture.directory})).kind, "owned-running");
    const reloaded = runtimeHost({...fixture,processId:child.pid}, record);
    assert.equal(await reloaded.runtime.reconnectActionServer({fsPath:fixture.directory}), true);
    assert.deepEqual(host.errors, []);
});
