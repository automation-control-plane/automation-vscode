const {test} = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
let extension, environmentsExtension, resolvedInterpreter, resourceConfig, environmentsEnabled;
const output = [];
const resource = {fsPath: "/work/action-package/package.yaml", toString: () => "file:///work/action-package/package.yaml"};

test("Task code lens does not start a debug session when debugger resolution declines", async () => {
    const calls = [];
    const original = Module._load;
    Module._load = function(name, parent, ...args) {
        if (parent?.filename.endsWith("/robo/runRobocorpTasks.js")) {
            if (name === "vscode") return {
                commands: {executeCommand: async () => ({success: false, message: "No fixture interpreter"})},
                debug: {startDebugging: (...args) => calls.push(args)},
            };
            if (name === "../debugger") return {updateDebugConfigurationAndAutoActivatePythonExtension: async () => undefined};
            if (name === "../channel") return {logError() {}};
            if (name.startsWith("../")) return {};
        }
        return original.call(this, name, parent, ...args);
    };
    let run;
    try {run = require("../vscode-client/out/robo/runRobocorpTasks").runRobocorpTasks;}
    finally {Module._load = original;}
    await run(false, ["/work/robot/tasks.py"]);
    assert.equal(calls.length, 0);
});

test("Native Python launch refuses a missing debugger instead of selecting absent PyDev", async () => {
    const messages = [];
    let installed;
    const original = Module._load;
    Module._load = function(name, parent, ...args) {
        if (parent?.filename.endsWith("/debugger.js")) {
            if (name === "vscode") return {
                extensions: {getExtension: id => installed?.id === id ? installed : undefined},
                window: {showErrorMessage: message => messages.push(message)},
            };
            if (name === "./pythonExtIntegration") return {
                isPyDevDebuggerPythonExtensionInstalled: async () => installed?.id === "fabioz.vscode-pydev-python-debugger",
            };
            if (name === "./channel") return {OUTPUT_CHANNEL: {appendLine() {}}};
            if (name.startsWith("./")) return {};
        }
        return original.call(this, name, parent, ...args);
    };
    let resolve;
    try {resolve = require("../vscode-client/out/debugger").updateDebugConfigurationAndAutoActivatePythonExtension;}
    finally {Module._load = original;}
    const missing = {type: "python", python: "/rcc/bin/python"};
    assert.equal(await resolve(missing), undefined);
    assert.equal(missing.type, "python");
    assert.match(messages[0], /ms-python.python.*fabioz.vscode-pydev-python-debugger/);
    let activated = false;
    installed = {id: "fabioz.vscode-pydev-python-debugger", isActive: false, activate: async () => {activated = true;}};
    const pydev = await resolve({type: "python", python: "/rcc/bin/python"});
    assert.equal(activated, true);
    assert.equal(pydev.type, "pydevd");
    assert.equal(pydev.pythonExecutable, "/rcc/bin/python");
});
const vscode = {
    extensions: {getExtension: id => id === "ms-python.vscode-python-envs" ? environmentsExtension : extension},
    Uri: {file: fsPath => ({fsPath})},
    workspace: {
        getConfiguration: (_, uri) => {resourceConfig = uri; return {
            get: key => key === "useEnvironmentsExtension" ? false : "/legacy/python",
            inspect: () => ({globalValue: environmentsEnabled}), update: async () => {},
        };},
        getWorkspaceFolder: () => ({}),
    },
    window: {activeTextEditor: {document: {uri: resource}}},
    ConfigurationTarget: {Workspace: 2, WorkspaceFolder: 3},
};
const load = Module._load;
Module._load = function(name, parent, main) {
    if (parent?.filename.endsWith("/pythonExtIntegration.js")) {
        if (name === "vscode") return vscode;
        if (name === "./activities") return {resolveInterpreter: async () => resolvedInterpreter};
        if (name === "./channel") return {logError: assert.fail, OUTPUT_CHANNEL: {appendLine: value => output.push(value)}};
        if (name === "./progress") return {handleProgressMessage() {}};
        if (name === "./robocorpSettings") return {getAutosetpythonextensioninterpreter: () => true};
        return {};
    }
    return load.call(this, name, parent, main);
};
let integration;
try {integration = require("../vscode-client/out/pythonExtIntegration");} finally {Module._load = load;}

test("Current Python API activates and updates the resource without the legacy experiment flag", async () => {
    const calls = [];
    extension = {isActive: false, exports: {}, activate: async () => {
        calls.push("activate");
        extension.isActive = true;
        extension.exports = {ready: Promise.resolve(), environments: {
            updateActiveEnvironmentPath: async (...args) => calls.push(args),
        }};
    }};
    await integration.setPythonInterpreterForPythonExtension("/rcc/bin/python", resource);
    assert.deepEqual(calls, ["activate", ["/rcc/bin/python", resource]]);
});

test("Current Python lookup resolves the selected environment and never reports invalid discovery as system Python", async () => {
    const selected = {path: "/rcc/env"};
    extension = {isActive: true, exports: {environments: {
        getActiveEnvironmentPath: uri => {assert.equal(uri, resource); return selected;},
        resolveEnvironment: async env => {assert.equal(env, selected); return {executable: {uri: {fsPath: "/rcc/env/bin/python"}}};},
    }}};
    assert.equal(await integration.getPythonExecutable(resource), "/rcc/env/bin/python");
    extension.exports.environments.resolveEnvironment = async () => undefined;
    assert.equal(await integration.getPythonExecutable(resource), undefined);
    assert.ok(output.some(line => line.includes("resolved executable: unresolved")));
});

test("Automatic package selection waits for the asynchronous Python API update", async () => {
    let finish;
    let updateStarted;
    const started = new Promise(resolve => updateStarted = resolve);
    const pending = new Promise(resolve => finish = resolve);
    resolvedInterpreter = {success: true, result: {pythonExe: "/rcc/bin/python"}};
    extension = {isActive: true, exports: {environments: {
        getActiveEnvironmentPath: () => ({path: "/system/python"}),
        resolveEnvironment: async () => ({executable: {uri: {fsPath: "/system/python"}}}),
        updateActiveEnvironmentPath: async () => {updateStarted(); await pending;},
    }}};
    let completed = false;
    const update = integration.autoUpdateInterpreter(resource).then(value => {completed = true; return value;});
    await started;
    assert.equal(completed, false);
    finish();
    assert.equal(await update, true);
});

test("Legacy execution-details and scoped configuration lookup remain available", async () => {
    extension = {isActive: true, exports: {settings: {getExecutionDetails: uri => {
        assert.equal(uri, resource); return {execCommand: ["/legacy/bin/python"]};
    }}}};
    assert.equal(await integration.getPythonExecutable(resource), "/legacy/bin/python");
    extension.exports = {};
    assert.equal(await integration.getPythonExecutable(resource, true), "/legacy/python");
    assert.equal(resourceConfig, resource);
});

test("Python Environments selection synchronizes when the legacy Python API already has the RCC path", async () => {
    const calls = [];
    const rcc = {envId: {id: "rcc", managerId: "system"}, execInfo: {run: {executable: "/rcc/bin/python"}}};
    let active = {execInfo: {run: {executable: "/system/python3.13"}}};
    environmentsEnabled = undefined; // The legacy default is false; it is not an explicit opt-out.
    environmentsExtension = {isActive: false, activate: async () => {calls.push("activate-envs"); environmentsExtension.isActive = true;}, exports: {
        getEnvironment: async uri => {assert.equal(uri, resource); return active;},
        resolveEnvironment: async uri => {assert.equal(uri.fsPath, "/rcc/bin/python"); return rcc;},
        setEnvironment: async (uri, env) => {assert.equal(uri, resource); assert.equal(env, rcc); calls.push("select-envs"); active = env;},
    }};
    resolvedInterpreter = {success: true, result: {pythonExe: "/rcc/bin/python"}};
    extension = {isActive: true, exports: {environments: {
        getActiveEnvironmentPath: () => ({path: "/rcc/bin/python"}),
        resolveEnvironment: async () => ({executable: {uri: {fsPath: "/rcc/bin/python"}}}),
        updateActiveEnvironmentPath: async (_, uri) => {assert.equal(uri, resource); calls.push("select-python");},
    }}};
    try {
        assert.equal(await integration.autoUpdateInterpreter(resource), true);
        assert.deepEqual(calls, ["activate-envs", "select-python", "select-envs"]);
        assert.equal(await integration.getPythonExecutable(resource), "/rcc/bin/python");
    } finally {environmentsExtension = undefined; environmentsEnabled = undefined;}
});

test("Unresolved Python Environments metadata never clears a selection or changes global settings", async () => {
    environmentsEnabled = true;
    environmentsExtension = {isActive: true, exports: {
        resolveEnvironment: async () => undefined,
        setEnvironment: assert.fail,
    }};
    extension = {isActive: true, exports: {environments: {updateActiveEnvironmentPath: async (_, uri) => assert.equal(uri, resource)}}};
    try {
        await integration.setPythonInterpreterForPythonExtension("/rcc/bin/python", resource);
        assert.ok(output.some(line => line.includes("Python Environments could not resolve /rcc/bin/python")));
    } finally {environmentsExtension = undefined; environmentsEnabled = undefined;}
});

test("Explicitly disabled Python Environments keeps the scoped legacy API without activating the companion", async () => {
    environmentsEnabled = false;
    environmentsExtension = {isActive: false, activate: assert.fail};
    const calls = [];
    extension = {isActive: true, exports: {environments: {updateActiveEnvironmentPath: async (...args) => calls.push(args)}}};
    try {
        await integration.setPythonInterpreterForPythonExtension("/rcc/bin/python", resource);
        assert.deepEqual(calls, [["/rcc/bin/python", resource]]);
    } finally {environmentsExtension = undefined; environmentsEnabled = undefined;}
});
