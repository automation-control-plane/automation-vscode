const {test} = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const Module = require("node:module");

test("Start -> Restart waits beyond terminal close for the owned listener to release its port", async () => {
    const reserve = http.createServer();
    const port = await new Promise(resolve => reserve.listen(0, "127.0.0.1", () => resolve(reserve.address().port)));
    await new Promise(resolve => reserve.close(resolve));
    const created = [], handlers = [], errors = [], prompts = [];
    const directory = {fsPath: "/synthetic/restart-package"};
    const vscode = {
        workspace: {getConfiguration: () => ({get: (key, fallback) => key === "actionServer.port" ? port : key === "actionServer.location" ? process.execPath : fallback})},
        window: {
            terminals: [], showErrorMessage: text => errors.push(text),
            showWarningMessage: async (...args) => {prompts.push(args); return "Restart action server";},
            createTerminal: options => {
                const server = http.createServer((req, res) => res.end("{}"));
                const ready = new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
                let disposed = false;
                const terminal = {name: options.name, processId: Promise.resolve(undefined), server, ready,
                    show() {}, dispose() {
                        if (disposed) return;
                        disposed = true;
                        vscode.window.terminals = vscode.window.terminals.filter(item => item !== terminal);
                        // Real Code can report terminal disposal before the Runtime child releases its port.
                        setImmediate(() => handlers.slice().forEach(fn => fn(terminal)));
                        setTimeout(() => server.close(), 100);
                    },
                };
                created.push(terminal); vscode.window.terminals.push(terminal); return terminal;
            },
            onDidCloseTerminal: fn => {handlers.push(fn); return {dispose() {const i = handlers.indexOf(fn); if (i >= 0) handlers.splice(i, 1);}};},
        },
    };
    const load = Module._load;
    Module._load = function(name, parent, main) {
        if (parent?.filename.endsWith("/actionServer.js")) {
            if (name === "vscode") return vscode;
            if (["./runtimePaths", "./runtimeServerConfig", "./runtimeOwnership"].includes(name)) return load.call(this, name, parent, main);
            if (name === "./legacyIntegrations") return {legacyVendorIntegrationsEnabled: () => false};
            if (name === "./rcc") return {getRobocorpHome: async () => "/task", createEnvWithRobocorpHome: () => ({ACTIONS_HOME: "/task/actions", ROBOTS_HOME: "/task/robots"})};
            if (name === "./channel") return {OUTPUT_CHANNEL: {appendLine() {}}};
            if (name.startsWith("./")) return {};
        }
        return load.call(this, name, parent, main);
    };
    let runtime;
    try {runtime = require("../vscode-client/out/actionServer");} finally {Module._load = load;}
    try {
        await runtime.startActionServer(directory);
        await created[0].ready;
        await runtime.startActionServer(directory);
        assert.equal(prompts.length, 1);
        assert.ok(prompts[0].includes("Restart action server"));
        assert.equal(created.length, 2, "replacement must launch after the previous owned listener closes");
        await created[1].ready;
        assert.equal(created[0].server.listening, false);
        assert.equal(created[1].server.listening, true);
        assert.deepEqual(errors, []);
    } finally {
        for (const terminal of created) if (terminal.server.listening) await new Promise(resolve => terminal.server.close(resolve));
    }
});
