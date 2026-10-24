// Actual published Linux wrapper, /proc ownership and compiled extension lifecycle.
// VS Code terminals, workspace Memento and module reload are simulated; this is not Extension Host/GUI acceptance.
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const {spawn, execFileSync} = require("node:child_process");
const Module = require("node:module");
const assert = require("node:assert/strict");

async function main() {
    assert.equal(process.platform, "linux", "This smoke requires actual Linux /proc process/socket ownership.");
    const [extension, runtimePath, fixture, preparedRoot, outputParent] = process.argv.slice(2);
    assert.ok(extension && runtimePath && fixture && preparedRoot && outputParent,
        "Arguments: extension-root runtime-binary synthetic-fixture prepared-smoke-root output-parent");
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(runtimePath)).digest("hex"),
        "d3c450a2b10b226613588cc40cc6ec18873b23c7427958b0752711e4531a1de4");
    const root = fs.mkdtempSync(path.join(outputParent, "runtime-restart-"));
    const packageDir = path.join(root, "package");
    fs.mkdirSync(packageDir);
    for (const name of ["package.yaml", "smoke_actions.py"]) fs.copyFileSync(path.join(fixture, name), path.join(packageDir, name));
    const directory = {fsPath: packageDir};
    const probe = net.createServer();
    const port = await new Promise(resolve => probe.listen(0, "127.0.0.1", () => resolve(probe.address().port)));
    await new Promise(resolve => probe.close(resolve));
    const base = `http://127.0.0.1:${port}`;
    const created = [], handlers = [], errors = [], events = [];
    const persisted = new Map();
    const ownershipKey = "automation.runtimeOwnership.v1";
    const state = {
        get: (key, fallback) => persisted.has(key) ? JSON.parse(persisted.get(key)) : fallback,
        update: async (key, value) => {value === undefined ? persisted.delete(key) : persisted.set(key, JSON.stringify(value));},
    };
    const environment = {...process.env,
        HOME: path.join(preparedRoot, "os-home"),
        ACTIONS_HOME: path.join(preparedRoot, "actions-home"),
        ROBOTS_HOME: path.join(preparedRoot, "robots-home"),
        ROBOCORP_HOME: path.join(preparedRoot, "actions-home"),
        RCC_HOLOTREE_MODE: "private",
    };
    const vscode = {
        Uri: {file: fsPath => ({fsPath: path.resolve(fsPath)})},
        workspace: {getConfiguration: () => ({get: (key, fallback) => key === "actionServer.location" ? runtimePath : key === "actionServer.port" ? port : fallback})},
        window: {
            terminals: [], showErrorMessage: message => errors.push(message),
            showWarningMessage: async (_, option) => {assert.equal(option, "Restart action server"); events.push({event: "restart-confirmed", at: Date.now()}); return option;},
            createTerminal: options => {
                const index = created.length;
                const log = fs.openSync(path.join(root, `runtime-${index}.log`), "wx");
                const child = spawn(options.shellPath, options.shellArgs, {cwd: options.cwd.fsPath, env: options.env, stdio: ["ignore", log, log]});
                fs.closeSync(log);
                events.push({event: "spawn", pid: child.pid, at: Date.now(), argv: [options.shellPath, ...options.shellArgs]});
                let disposed = false;
                const terminal = {name: options.name, processId: Promise.resolve(child.pid), child,
                    show() {events.push({event: "terminal-shown", pid: child.pid, at: Date.now()});}, dispose() {
                    if (disposed) return;
                    disposed = true;
                    vscode.window.terminals = vscode.window.terminals.filter(item => item !== terminal);
                    events.push({event: "terminal-closed", pid: child.pid, at: Date.now()});
                    setImmediate(() => handlers.slice().forEach(fn => fn(terminal)));
                    // Reproduce early terminal-close notification; signal only the child this harness spawned.
                    setTimeout(() => {if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");}, 150);
                }};
                child.once("exit", (code, signal) => {
                    terminal.exitStatus = {code};
                    events.push({event: "process-exited", pid: child.pid, code, signal, at: Date.now()});
                });
                child.once("error", error => errors.push(error.message));
                created.push(terminal); vscode.window.terminals.push(terminal); return terminal;
            },
            onDidCloseTerminal: fn => {handlers.push(fn); return {dispose() {const index = handlers.indexOf(fn); if (index >= 0) handlers.splice(index, 1);}};},
        },
    };
    const runtimeModule = require.resolve(path.join(extension, "vscode-client/out/actionServer"));
    function loadRuntime() {
        // Discard module-local ownership, retaining only serialized workspace state and the live terminal.
        delete require.cache[runtimeModule];
        const load = Module._load;
        Module._load = function(name, parent, main) {
            if (parent?.filename === runtimeModule) {
                if (name === "vscode") return vscode;
                if (["./runtimePaths", "./runtimeServerConfig", "./runtimeOwnership"].includes(name)) return load.call(this, name, parent, main);
                if (name === "./legacyIntegrations") return {legacyVendorIntegrationsEnabled: () => false};
                if (name === "./rcc") return {getRobocorpHome: async () => environment.ACTIONS_HOME, createEnvWithRobocorpHome: () => ({...environment})};
                if (name === "./channel") return {OUTPUT_CHANNEL: {appendLine: text => events.push({event: "output", text, at: Date.now()})}};
                if (name.startsWith("./")) return {};
            }
            return load.call(this, name, parent, main);
        };
        let loaded;
        try {loaded = require(runtimeModule);} finally {Module._load = load;}
        loaded.initializeRuntimeOwnership(state);
        return loaded;
    }
    let runtime = loadRuntime();
    const {waitForOwnedRuntimeStop} = require(path.join(extension, "vscode-client/out/runtimeServerConfig"));
    const report = {root, extension, version: JSON.parse(fs.readFileSync(path.join(extension, "package.json"))).version,
        source_sha: execFileSync("git", ["rev-parse", "HEAD"], {cwd: path.resolve(__dirname, ".."), encoding: "utf8"}).trim(),
        scope: "Actual published wrapper, Linux process/socket ownership and compiled extension; simulated Code terminals, Memento and module reload, not Extension Host/GUI acceptance", port, events, errors};
    async function ready(terminal) {
        const deadline = Date.now() + 300000;
        while (Date.now() < deadline) {
            assert.equal(terminal.child.exitCode, null, "Runtime exited before readiness");
            assert.equal(terminal.child.signalCode, null, "Runtime was signalled before readiness");
            try {
                const response = await fetch(base + "/openapi.json", {signal: AbortSignal.timeout(1000)});
                if (response.ok) {
                    const spec = await response.json();
                    const route = Object.keys(spec.paths).find(value => value.includes("welcome") && value.endsWith("/run"));
                    if (route) return route;
                }
            } catch {}
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error("Runtime readiness timed out");
    }
    try {
        let unknownContacts = 0;
        const unrelated = net.createServer(socket => {unknownContacts++; socket.destroy();});
        await new Promise((resolve, reject) => {
            unrelated.once("error", reject);
            unrelated.listen(port, "127.0.0.1", resolve);
        });
        try {
            const unknown = await runtime.getRuntimeStatus(directory);
            assert.equal(unknown.kind, "unknown-listener");
            assert.equal(await runtime.reconnectActionServer(directory), false);
            assert.equal(runtime.getActionServerTerminal(), undefined);
            assert.equal(created.length, 0);
            assert.equal(persisted.size, 0);
            assert.equal(unrelated.listening, true);
            assert.equal(unknownContacts, 0, "Unknown listener must not be contacted");
            assert.equal(errors.length, 1, "Rejected reconnect must explain the ownership boundary");
            report.unknown_listener = {status: unknown, contacts: unknownContacts, expected_errors: errors.splice(0)};
        } finally {await new Promise(resolve => unrelated.close(resolve));}

        await runtime.startActionServer(directory);
        assert.equal(created.length, 1);
        await ready(created[0]);
        const oldPid = created[0].child.pid;
        report.old_pid = oldPid;
        events.push({event: "first-ready", pid: oldPid, at: Date.now()});
        const saved = state.get(ownershipKey);
        assert.ok(saved, "Published wrapper must persist a verified process identity");
        assert.equal(saved.processId, oldPid);
        assert.equal(saved.directory, packageDir);
        assert.equal(saved.port, port);
        report.original_ownership = saved;

        runtime = loadRuntime();
        events.push({event: "simulated-extension-reload", pid: oldPid, at: Date.now()});
        assert.equal(runtime.getActionServerTerminal(), undefined, "Reload must discard module-local ownership");
        const recovered = await runtime.getRuntimeStatus(directory);
        assert.equal(recovered.kind, "owned-running", recovered.message);
        assert.equal(recovered.canReconnect, true);
        assert.equal(recovered.terminalAvailable, true);
        assert.equal(recovered.endpoint, base);
        assert.equal(runtime.getActionServerTerminal(), undefined, "Read-only status must not adopt the terminal");
        assert.equal(created.length, 1, "Status must not launch a replacement");
        assert.deepEqual(state.get(ownershipKey), saved, "Status must preserve persisted ownership");
        assert.equal(await runtime.reconnectActionServer(directory), true);
        assert.equal(runtime.getActionServerTerminal(), created[0]);
        assert.equal(created.length, 1, "Reconnect must retain the actual wrapper process");
        assert.equal(created[0].child.exitCode, null);
        assert.equal(created[0].child.signalCode, null);
        assert.equal((await runtime.getRuntimeStatus(directory)).canReconnect, false);
        assert.deepEqual(state.get(ownershipKey), saved, "Reconnect must not rewrite launch identity");
        report.reloaded_status = recovered;
        events.push({event: "verified-reconnected", pid: oldPid, at: Date.now()});

        await runtime.startActionServer(directory);
        assert.equal(created.length, 2, errors.join("\n"));
        report.new_pid = created[1].child.pid;
        assert.notEqual(created[1].child.pid, oldPid);
        assert.ok(created[0].child.exitCode !== null || created[0].child.signalCode !== null);
        const oldExit = events.findIndex(event => event.event === "process-exited" && event.pid === oldPid);
        const newSpawn = events.findIndex(event => event.event === "spawn" && event.pid === created[1].child.pid);
        assert.ok(oldExit >= 0 && oldExit < newSpawn, "Owned process must exit before replacement starts");
        const route = await ready(created[1]);
        const replacement = state.get(ownershipKey);
        assert.equal(replacement.processId, created[1].child.pid);
        assert.notEqual(replacement.launchId, saved.launchId);
        assert.equal((await runtime.getRuntimeStatus(directory)).kind, "owned-running");
        report.replacement_ownership = replacement;
        const response = await fetch(base + route, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({name: "Restart QA"}), signal: AbortSignal.timeout(60000)});
        assert.equal(response.status, 200);
        assert.equal(await response.json(), "Hello Restart QA");
        report.action_result = "Hello Restart QA";
        assert.deepEqual(errors, []);
        report.result = "PASS";
    } catch (error) {
        report.result = "FAIL";
        report.failure = error.stack || String(error);
        throw error;
    } finally {
        for (const terminal of created) {
            if (terminal.child.exitCode === null && terminal.child.signalCode === null) {
                terminal.dispose();
                await waitForOwnedRuntimeStop({port, processId: terminal.child.pid});
            }
        }
        fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2) + "\n");
        process.stdout.write(JSON.stringify({root, result: report.result || "FAIL", old_pid: report.old_pid, new_pid: report.new_pid, errors}) + "\n");
    }
}
main().catch(error => {process.stderr.write(error.stack + "\n"); process.exitCode = 1;});
