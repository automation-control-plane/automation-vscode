const {test} = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
let extension, resolvedInterpreter, resourceConfig;
const output = [];
const resource = {fsPath: "/work/action-package/package.yaml", toString: () => "file:///work/action-package/package.yaml"};
const vscode = {
    extensions: {getExtension: () => extension},
    workspace: {
        getConfiguration: (_, uri) => {resourceConfig = uri; return {get: () => "/legacy/python", update: async () => {}};},
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
