const {test} = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const manifest = require("../package.json");
let selection, errorMessage;
const requests = [];
const vscode = {
    commands: {executeCommand: async (id, args) => {
        requests.push([id, args]);
        if (id === "sema4ai.listWorkItems.internal") return errorMessage ? {success: false, message: errorMessage} : {success: true, result: {
            input_folder_path: "/package/devdata/work-items-in", output_folder_path: "/package/devdata/work-items-out", input_work_items: [], output_work_items: [],
        }};
        if (id === "sema4ai.verifyLibraryVersion.internal") return {success: true, result: {library: "actions-work-items", version: "0.4.4"}};
        assert.fail(id);
    }},
    TreeItem: class {constructor(label) {this.label = label;}},
    ThemeIcon: class {}, TreeItemCollapsibleState: {Expanded: 2},
};
const load = Module._load;
Module._load = function(name, parent, main) {
    if (parent?.filename.match(/\/(viewsResources|viewsWorkItems)\.js$/)) {
        if (name === "vscode") return vscode;
        if (name === "./viewsCommon") return {NO_PACKAGE_FOUND_MSG: "No package found in current folder", RobotEntryType: {
            Action: "Action", ActionPackage: "ActionPackage", ActionsInActionPackage: "ActionsInActionPackage", ActionsInRobot: "ActionsInRobot",
        }};
        if (name === "./viewsSelection") return {getSelectedRobot: () => selection};
        if (name === "./viewsRobotSelectionTreeBase") return {RobotSelectionTreeDataProviderBase: class {}};
        if (name === "./viewsLocators") return {LocatorsTreeDataProvider: class {async getChildren() {return [];}}};
        if (name === "./activities") return {resolveInterpreter: async () => ({success: true, result: {environ: {CONDA_PREFIX: "/env"}}})};
        if (name === "./rcc") return {feedback() {}};
        if (name === "./channel") return {logError: assert.fail};
    }
    return load.call(this, name, parent, main);
};
let Provider;
try {Provider = require("../vscode-client/out/viewsResources").ResourcesTreeDataProvider;} finally {Module._load = load;}

test("Contributed Package Resources exposes and routes Work Items for Action and Robot selections", async () => {
    assert.ok(manifest.contributes.views["sem4ai-packages"].some(view => view.id === "sema4ai-package-resources-tree"));
    for (const type of ["ActionPackage", "Action", "ActionsInActionPackage", "ActionsInRobot", "Robot", "Task"]) {
        const yaml = type === "Robot" || type === "Task" || type === "ActionsInRobot" ? "/package/robot.yaml" : "/package/package.yaml";
        selection = {type, uri: {fsPath: yaml}};
        const provider = new Provider();
        const roots = await provider.getChildren();
        const workItems = roots.find(item => item.subTree === "work-items");
        assert.ok(workItems, type);
        assert.ok(roots.some(item => item.subTree === "locators"));
        assert.equal(provider.getTreeItem(workItems).contextValue, "workItemsRoot");
        const children = await provider.getChildren(workItems);
        assert.deepEqual(children.map(child => child.name), ["work-items-in", "work-items-out"]);
        assert.ok(children.every(child => child.subTree === "work-items"));
        assert.equal(requests.filter(([id]) => id === "sema4ai.listWorkItems.internal").at(-1)[1].robot, yaml);
    }
});

test("Package Resources keeps missing/unsupported package messages", async () => {
    selection = undefined;
    const provider = new Provider();
    assert.equal((await provider.getChildren())[0].name, "No package found in current folder");
    selection = {type: "AgentPackage", uri: {fsPath: "/package/agent-spec.yaml"}};
    errorMessage = "Unable to find package.yaml or robot.yaml from /package/agent-spec.yaml.";
    try {
        const root = (await provider.getChildren()).find(item => item.subTree === "work-items");
        const children = await provider.getChildren(root);
        assert.equal(children[0].name, errorMessage);
    } finally {errorMessage = undefined;}
});
