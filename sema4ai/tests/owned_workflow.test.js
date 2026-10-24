const {test} = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const manifest = require("../package.json");
const legacyCommands = require("../legacy-integrations.json");
const gate = "config.sema4ai.legacyVendorIntegrations.enabled";
let legacy = false, importOptions;
let startup = {status: "ready", title: "Ready", message: ""};
const vscode = {
    workspace: {getConfiguration: () => ({get: (_, fallback) => legacy || fallback})},
    EventEmitter: class {event() {} fire() {}},
};
const load = Module._load;
Module._load = function(name, parent, main) {
    if (name === "vscode" && parent?.filename.match(/\/(viewsRobots|viewsCommon|viewsRobocorp|importActions|legacyIntegrations)\.js$/)) return vscode;
    if (parent?.filename.match(/\/(viewsRobots|viewsRobocorp)\.js$/)) {
        if (name === "./languageServerStartup") return {getLanguageServerStartup: () => startup};
        if (name === "./files") return {uriExists: async () => true};
        if (["./legacyIntegrations", "./viewsCommon", "./robocorpCommands", "./robocorpViews"].includes(name)) return load.call(this, name, parent, main);
        if (name === "./extension") return {langServer: {sendRequest: assert.fail}};
        if (name.startsWith("./")) return {};
    }
    if (parent?.filename.endsWith("/importActions.js")) {
        if (name === "../ask") return {askForWs: async () => ({}), showSelectOneQuickPick: async options => {importOptions = options; return undefined;}};
        if (name === "../legacyIntegrations") return load.call(this, name, parent, main);
        if (name.startsWith("../") || name.startsWith("./")) return {};
    }
    return load.call(this, name, parent, main);
};
let Robots, Cloud, importActionPackage;
try {
    Robots = require("../vscode-client/out/viewsRobots").RobotsTreeDataProvider;
    Cloud = require("../vscode-client/out/viewsRobocorp").CloudTreeDataProvider;
    importActionPackage = require("../vscode-client/out/robo/importActions").importActionPackage;
} finally {Module._load = load;}

test("Packages tree does not discover or reuse cached packages before language services are ready", async () => {
    const provider = new Robots();
    let discoveries = 0;
    provider.computeChildren = async () => {discoveries++; return [];};
    try {
        for (const status of ["starting", "failed"]) {
            startup = {status, title: "Language services unavailable", message: "A repository connection failed. Open diagnostics."};
            const entries = await provider.getChildren();
            assert.equal(discoveries, 0);
            assert.equal(entries.length, 1);
            assert.equal(entries[0].label, startup.title);
            assert.equal(entries[0].tooltip, startup.message);
            provider.lastRoot = [{type: "ActionPackage", uri: {fsPath: "/cached/package.yaml"}}];
            assert.deepEqual(await provider.getValidCachedOrComputeChildren(), []);
        }
    } finally {startup = {status: "ready", title: "Ready", message: ""};}
});

test("Default contributions hide vendor publishing/navigation while keeping stable compatibility IDs", () => {
    assert.equal(manifest.contributes.configuration.properties["sema4ai.legacyVendorIntegrations.enabled"].default, false);
    for (const command of manifest.contributes.commands) {
        if (!legacyCommands.includes(command.command)) continue;
        assert.ok(command.enablement.includes(gate), command.command);
        const palette = manifest.contributes.menus.commandPalette.find(item => item.command === command.command);
        assert.ok(palette?.when.includes(gate), command.command);
    }
    for (const entries of Object.values(manifest.contributes.menus)) {
        for (const item of entries) if (legacyCommands.includes(item.command)) assert.ok(item.when.includes(gate), item.command);
    }
    const cloud = manifest.contributes.views["sem4ai-packages"].find(view => view.id === "sema4ai-cloud-tree");
    assert.equal(cloud.when, gate);
    for (const id of ["sema4ai.startActionServer", "sema4ai.actionServerPackageBuild", "sema4ai.submitIssue"]) {
        const command = manifest.contributes.commands.find(item => item.command === id);
        assert.ok(command, id);
        assert.ok(!legacyCommands.includes(id));
    }
});

test("Actual package tree retains local build/server and removes vendor destinations by default", async () => {
    const provider = new Robots();
    for (const type of ["ActionsInActionPackage", "ActionsInRobot", "ActionsInAgentPackage"]) {
        const entries = await provider.getChildren({type, parent: {parent: {label: "Owned"}}});
        assert.ok(entries.length > 0);
        assert.ok(entries.every(entry => !/Control Room|Sema4.ai Studio/.test(entry.label)), type);
        if (type === "ActionsInActionPackage") {
            assert.ok(entries.some(entry => entry.label === "Build Action Package (zip)"));
            assert.ok(entries.some(entry => entry.label === "Start Action Server"));
        }
    }
    assert.deepEqual(await new Cloud().getChildren(), []);
    await importActionPackage();
    assert.deepEqual(importOptions.map(option => option.action), ["from_local_path"]);
});

test("Explicit compatibility opt-in retains accurately named legacy destinations", async () => {
    legacy = true;
    try {
        const entries = await new Robots().getChildren({type: "ActionsInActionPackage", parent: {parent: {label: "Owned"}}});
        assert.ok(entries.some(entry => entry.label === "Publish to Sema4.ai Studio"));
        await importActionPackage();
        assert.ok(importOptions.some(option => option.action === "from_gallery"));
    } finally {legacy = false;}
});
