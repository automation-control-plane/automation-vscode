// Actual published Linux wrapper + compiled extension lifecycle; VS Code terminal events are simulated.
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const {spawn, execFileSync} = require("node:child_process");
const Module = require("node:module");
const assert = require("node:assert/strict");

async function main() {
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
    const environment = {...process.env,
        HOME: path.join(preparedRoot, "os-home"),
        ACTIONS_HOME: path.join(preparedRoot, "actions-home"),
        ROBOTS_HOME: path.join(preparedRoot, "robots-home"),
        ROBOCORP_HOME: path.join(preparedRoot, "actions-home"),
        RCC_HOLOTREE_MODE: "private",
    };
    const vscode = {
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
                const terminal = {name: options.name, processId: Promise.resolve(child.pid), child, show() {}, dispose() {
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
    const load = Module._load;
    Module._load = function(name, parent, main) {
        if (parent?.filename === path.join(extension, "vscode-client/out/actionServer.js")) {
            if (name === "vscode") return vscode;
            if (["./runtimePaths", "./runtimeServerConfig"].includes(name)) return load.call(this, name, parent, main);
            if (name === "./legacyIntegrations") return {legacyVendorIntegrationsEnabled: () => false};
            if (name === "./rcc") return {getRobocorpHome: async () => environment.ACTIONS_HOME, createEnvWithRobocorpHome: () => ({...environment})};
            if (name === "./channel") return {OUTPUT_CHANNEL: {appendLine: text => events.push({event: "output", text, at: Date.now()})}};
            if (name.startsWith("./")) return {};
        }
        return load.call(this, name, parent, main);
    };
    let runtime;
    try {runtime = require(path.join(extension, "vscode-client/out/actionServer"));} finally {Module._load = load;}
    const {waitForOwnedRuntimeStop} = require(path.join(extension, "vscode-client/out/runtimeServerConfig"));
    const report = {root, extension, version: JSON.parse(fs.readFileSync(path.join(extension, "package.json"))).version,
        source_sha: execFileSync("git", ["rev-parse", "HEAD"], {cwd: path.resolve(__dirname, ".."), encoding: "utf8"}).trim(),
        scope: "Actual published wrapper and compiled extension; simulated Code terminal events, not GUI acceptance", port, events, errors};
    async function ready(terminal) {
        const deadline = Date.now() + 300000;
        while (Date.now() < deadline) {
            assert.equal(terminal.child.exitCode, null, "Runtime exited before readiness");
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
        await runtime.startActionServer(directory);
        assert.equal(created.length, 1);
        await ready(created[0]);
        const oldPid = created[0].child.pid;
        events.push({event: "first-ready", pid: oldPid, at: Date.now()});
        await runtime.startActionServer(directory);
        assert.equal(created.length, 2, errors.join("\n"));
        assert.notEqual(created[1].child.pid, oldPid);
        assert.ok(created[0].child.exitCode !== null || created[0].child.signalCode !== null);
        const route = await ready(created[1]);
        const response = await fetch(base + route, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({name: "Restart QA"}), signal: AbortSignal.timeout(60000)});
        assert.equal(response.status, 200);
        assert.equal(await response.json(), "Hello Restart QA");
        report.result = "PASS"; report.old_pid = oldPid; report.new_pid = created[1].child.pid;
        report.action_result = "Hello Restart QA";
        assert.deepEqual(errors, []);
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
