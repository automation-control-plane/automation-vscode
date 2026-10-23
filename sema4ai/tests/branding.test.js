const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const root = path.resolve(__dirname, "..");
const manifest = require("../package.json");

test("Owned display branding retains stable extension and integration IDs", () => {
    assert.equal(`${manifest.publisher}.${manifest.name}`, "automation-control-plane.automation-vscode");
    assert.equal(manifest.displayName, "Automation Control Plane");
    assert.equal(manifest.author.name, "Automation Control Plane");
    assert.equal(manifest.contributes.debuggers[0].type, "sema4ai");
    assert.equal(manifest.taskDefinitions[0].type, "Sema4.ai: dev-task");
    assert.equal(manifest.contributes.viewsContainers.activitybar[0].title, "Automation");
    for (const command of manifest.contributes.commands) assert.equal(command.category, "Automation");
    assert.ok(manifest.contributes.commands.some(c => c.command === "sema4ai.actionPackagePublishToSema4AIStudioApp"));
    assert.ok(manifest.contributes.views["sem4ai-packages"].some(v => v.name === "Control Room (legacy integration)"));
    assert.equal(manifest.icon, "images/automation-icon.png");
    const icon = fs.readFileSync(path.join(root, manifest.icon));
    assert.equal(icon.subarray(1, 4).toString(), "PNG");
    assert.equal(icon.readUInt32BE(16), 256);
    assert.equal(icon.readUInt32BE(20), 256);
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
    assert.ok(readme.startsWith("# Automation Control Plane\n"));
    assert.ok(!readme.includes("marketplace.visualstudio.com/items?itemName=sema4ai"));
    assert.ok(!readme.includes("images/gif_run.gif"));
});

test("Issue UI opens the private repository draft without vendor upload or account lookup", async () => {
    let receiver, opened;
    const panel = {webview: {onDidReceiveMessage: fn => receiver = fn, postMessage() {}}};
    const vscode = {
        ProgressLocation: {Notification: 1}, ViewColumn: {One: 1},
        window: {withProgress: async (_, fn) => fn(), createWebviewPanel: () => panel, showErrorMessage: assert.fail},
        Uri: {parse: value => value}, env: {openExternal: async uri => {opened = uri; return true;}},
    };
    const load = Module._load;
    Module._load = function(name, parent, main) {
        if (parent?.filename.endsWith("/submitIssue.js")) {
            if (name === "vscode") return vscode;
            if (name === "./channel") return {logError: assert.fail};
            if (name === "./rcc") return {collectIssueLogs: async () => ({logFiles: ["/local/log.txt"]})};
            if (name === "./files") return {getExtensionRelativeFile: () => path.join(root, "vscode-client/templates/submit_issue.html")};
        }
        return load.call(this, name, parent, main);
    };
    let issue;
    try { issue = require("../vscode-client/out/submitIssue"); } finally { Module._load = load; }
    await issue.showSubmitIssueUI({logUri: {fsPath: "/local/logs"}, subscriptions: []});
    assert.ok(panel.webview.html.includes("Logs stay local"));
    await receiver({command: "onClickSubmit", contents: {summary: "Runtime & test", details: "Steps\n1", email: "private@example.invalid", files: ["/local/log.txt"]}});
    const url = new URL(opened);
    assert.equal(url.origin + url.pathname, "https://github.com/automation-control-plane/automation-vscode/issues/new");
    assert.equal(url.searchParams.get("title"), "Runtime & test");
    assert.ok(url.searchParams.get("body").startsWith("Steps\n1"));
    assert.ok(!opened.includes("private%40"));
    assert.ok(!opened.includes("log.txt"));
});
