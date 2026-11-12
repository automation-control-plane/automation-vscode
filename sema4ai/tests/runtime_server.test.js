const {test} = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const http = require("node:http");
const Module = require("node:module");
const {runtimeServerPort, assertRuntimePortAvailable, waitForOwnedRuntimeStop} = require("../vscode-client/out/runtimeServerConfig");
const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const close = server => new Promise(resolve => server.close(resolve));

test("Runtime port validates overrides and refuses an occupied loopback listener without touching it", async () => {
    assert.equal(runtimeServerPort(), 8082);
    assert.equal(runtimeServerPort(18447), 18447);
    for (const value of [0, -1, 65536, 1.5, "8082", null]) assert.throws(() => runtimeServerPort(value), /integer/);
    const listener = net.createServer(socket => socket.end());
    const port = await listen(listener);
    try {
        await assert.rejects(assertRuntimePortAvailable(port), /Existing listeners are left running/);
        assert.equal(listener.listening, true);
    } finally {await close(listener);}
    await assertRuntimePortAvailable(port);
});

test("Runtime launch propagates configured port/address and never adopts or shuts down an unknown service", async () => {
    const errors = [], created = [], handlers = [];
    let configuredPort;
    const directory = {fsPath: "/synthetic/package"};
    const unrelated = {name: "Automation: Action Server"};
    const vscode = {
        workspace: {getConfiguration: (_, resource) => ({get: (name, fallback) => {
            if (name === "actionServer.location") return process.execPath;
            if (name === "actionServer.port") {assert.equal(resource, directory); return configuredPort ?? fallback;}
        }})},
        commands: {getCommands: async () => []},
        window: {
            terminals: [unrelated], showErrorMessage: value => errors.push(value),
            createTerminal: options => {
                const terminal = {name: options.name, creationOptions: options, show() {}, dispose() {
                    vscode.window.terminals = vscode.window.terminals.filter(t => t !== terminal);
                    setImmediate(() => handlers.slice().forEach(fn => fn(terminal)));
                }};
                created.push(terminal); vscode.window.terminals.push(terminal); return terminal;
            },
            onDidCloseTerminal: fn => {handlers.push(fn); return {dispose() {const i = handlers.indexOf(fn); if (i >= 0) handlers.splice(i, 1);}};},
        },
    };
    const load = Module._load;
    Module._load = function(name, parent, main) {
        if (name === "vscode" && parent?.filename.endsWith("/legacyIntegrations.js")) return vscode;
        if (parent?.filename.endsWith("/actionServer.js")) {
            if (name === "vscode") return vscode;
            if (name === "./runtimeServerConfig") {
                const actual = load.call(this, name, parent, main);
                return {...actual, waitForOwnedRuntimeStop: options => actual.waitForOwnedRuntimeStop({...options, timeoutMs: 100, pollMs: 10})};
            }
            if (name === "./runtimePaths" || name === "./legacyIntegrations" || name === "./runtimeOwnership") return load.call(this, name, parent, main);
            if (name === "./rcc") return {getRobocorpHome: async () => "/isolated", createEnvWithRobocorpHome: () => ({ACTIONS_HOME: "/isolated/actions", ROBOTS_HOME: "/isolated/robots"})};
            if (name === "./channel") return {OUTPUT_CHANNEL: {appendLine() {}}};
            if (name === "./extension") return {langServer: {sendRequest: assert.fail}};
            if (name.startsWith("./")) return {};
        }
        return load.call(this, name, parent, main);
    };
    let runtime;
    try {runtime = require("../vscode-client/out/actionServer");} finally {Module._load = load;}
    assert.equal(runtime.getActionServerTerminal(), undefined);
    let requests = 0;
    const service = http.createServer((req, res) => {requests++; res.end("{}");});
    configuredPort = await listen(service);
    try {
        await runtime.startActionServer(directory);
        assert.equal(created.length, 0);
        assert.ok(errors[0].includes(`127.0.0.1:${configuredPort}`));
        assert.equal(requests, 0);
    } finally {await close(service);}
    await runtime.startActionServer(directory);
    assert.equal(created.length, 1);
    assert.ok(created[0].creationOptions.shellArgs.includes(`--port=${configuredPort}`));
    assert.ok(created[0].creationOptions.shellArgs.includes("--address=127.0.0.1"));
    assert.ok(created[0].creationOptions.shellArgs.some(arg => arg.startsWith("--datadir=/isolated/actions/action-server/")));
    // A different service could later own the same port: stopping our terminal must not POST to it.
    await new Promise(resolve => service.listen(configuredPort, "127.0.0.1", resolve));
    try {
        assert.equal(await runtime.isActionServerAlive(), true);
        assert.equal(requests, 1);
        await runtime.restartActionServer(directory);
        assert.equal(requests, 1);
        assert.equal(created.length, 1);
        assert.equal(service.listening, true);
        assert.ok(vscode.window.terminals.includes(unrelated));
    } finally {await close(service);}
});

test("Owned shutdown wait is bounded and leaves an unrelated listener untouched", async () => {
    const listener = net.createServer(socket => socket.end());
    const port = await listen(listener);
    try {
        await assert.rejects(waitForOwnedRuntimeStop({port, processId: undefined, timeoutMs: 40, pollMs: 5}), /No replacement was started.*Existing listeners were left running/);
        assert.equal(listener.listening, true);
    } finally {await close(listener);}
    // A free port alone is insufficient while the recorded process is still alive.
    await assert.rejects(waitForOwnedRuntimeStop({port, processId: process.pid, timeoutMs: 30, pollMs: 5}), /Timed out waiting for owned Actions Runtime PID/);
});
