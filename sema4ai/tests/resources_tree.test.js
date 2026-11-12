const {test, beforeEach} = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const manifest = require("../package.json");
let selection, errorMessage;
let installedLibraries, inputPrompts;
const requests = [];
const errors = [];
const treeViewIdToTreeDataProvider = new Map();
const vscode = {
    commands: {executeCommand: async (id, args) => {
        requests.push([id, args]);
        if (id === "sema4ai.listWorkItems.internal") return errorMessage ? {success: false, message: errorMessage} : {success: true, result: {
            input_folder_path: "/package/devdata/work-items-in", output_folder_path: "/package/devdata/work-items-out", input_work_items: [], output_work_items: [],
        }};
        if (id === "sema4ai.verifyLibraryVersion.internal") {
            // Match the LSP's minimum-version contract and installed-library order.
            for (const [library, version] of Object.entries(installedLibraries)) {
                const minimum = args.libs_and_version.find(([name]) => name === library)?.[1];
                if (minimum && version.localeCompare(minimum, undefined, {numeric: true}) >= 0) {
                    return {success: true, result: {library, version}};
                }
            }
            return {success: false, message: "Requested libraries not found at the required minimum version."};
        }
        if (id === "automation.workItems.open") return;
        assert.fail(id);
    }},
    window: {
        showErrorMessage: async message => {errors.push(message);},
        showInputBox: async () => {inputPrompts++; return undefined;},
    },
    TreeItem: class {constructor(label) {this.label = label;}},
    ThemeIcon: class {}, TreeItemCollapsibleState: {Expanded: 2},
};
const load = Module._load;
Module._load = function(name, parent, main) {
    if (parent?.filename.match(/\/(viewsResources|viewsWorkItems)\.js$/)) {
        if (name === "vscode") return vscode;
        if (name === "./viewsCommon") return {treeViewIdToTreeDataProvider, NO_PACKAGE_FOUND_MSG: "No package found in current folder", RobotEntryType: {
            Action: "Action", ActionPackage: "ActionPackage", ActionsInActionPackage: "ActionsInActionPackage", ActionsInRobot: "ActionsInRobot",
        }};
        if (name === "./viewsSelection") return {getSelectedRobot: () => selection};
        if (name === "./viewsRobotSelectionTreeBase") return {RobotSelectionTreeDataProviderBase: class {
            getTreeItem(element) {return {label: element.name, command: {command: "vscode.open"}};}
        }};
        if (name === "./viewsLocators") return {LocatorsTreeDataProvider: class {async getChildren() {return [];}}};
        if (name === "./activities") return {resolveInterpreter: async () => ({success: true, result: {environ: {CONDA_PREFIX: "/env"}}})};
        if (name === "./rcc") return {feedback() {}};
        if (name === "./channel") return {logError: assert.fail};
    }
    return load.call(this, name, parent, main);
};
let Provider, newWorkItemInWorkItemsTree;
try {
    Provider = require("../vscode-client/out/viewsResources").ResourcesTreeDataProvider;
    ({newWorkItemInWorkItemsTree} = require("../vscode-client/out/viewsWorkItems"));
} finally {Module._load = load;}

beforeEach(() => {
    installedLibraries = {"actions-work-items": "0.4.4"};
    requests.length = 0;
    errors.length = 0;
    inputPrompts = 0;
    treeViewIdToTreeDataProvider.clear();
});

async function loadWorkItems(type = "ActionPackage") {
    const yaml = type === "Robot" ? "/package/robot.yaml" : "/package/package.yaml";
    selection = {type, uri: {fsPath: yaml}};
    const provider = new Provider();
    treeViewIdToTreeDataProvider.set("sema4ai-package-resources-tree", {
        workItemsTreeDataProvider: {getWorkItemsInfo: () => ({robot_yaml: yaml})},
    });
    const root = (await provider.getChildren()).find(item => item.subTree === "work-items");
    return {provider, children: await provider.getChildren(root)};
}

function itemCommand(provider) {
    return provider.getTreeItem({
        name: "input", subTree: "work-items", kind: "inputWorkItem", isDirectory: false,
        filePath: "/package/devdata/work-items-in/input/work-items.json",
    }).command.command;
}

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
        assert.equal(provider.getTreeItem(workItems).command.command, "automation.workItems.open");
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

for (const version of ["0.4.3", "0.5.0"]) {
    test(`Action Work Items rejects owned SDK ${version} without falling back to legacy SDKs`, async () => {
        installedLibraries = {"robocorp-workitems": "1.4.0", "rpaframework": "28.0.0", "actions-work-items": version};
        const {provider, children} = await loadWorkItems();
        assert.match(children[0].name, /actions-work-items==0\.4\.4/);
        assert.ok(children[0].name.includes(`actions-work-items==${version}`));
        assert.notEqual(itemCommand(provider), "automation.workItems.open");
        await newWorkItemInWorkItemsTree();
        assert.equal(errors.length, 1);
        assert.match(errors[0], /actions-work-items==0\.4\.4/);
        assert.ok(errors[0].includes(`actions-work-items==${version}`));
        assert.equal(inputPrompts, 0);
        assert.ok(!requests.some(([id]) => id === "automation.workItems.open"));
        assert.ok(requests.filter(([id]) => id === "sema4ai.verifyLibraryVersion.internal")
            .every(([, args]) => args.libs_and_version.every(([library]) => library === "actions-work-items")));
    });
}

test("Action Work Items rejects legacy-only environments with the owned SDK requirement", async () => {
    installedLibraries = {"robocorp-workitems": "1.4.0", "rpaframework": "28.0.0"};
    const {provider, children} = await loadWorkItems();
    assert.match(children[0].name, /actions-work-items==0\.4\.4/);
    assert.notEqual(itemCommand(provider), "automation.workItems.open");
    await newWorkItemInWorkItemsTree();
    assert.match(errors[0], /actions-work-items==0\.4\.4/);
    assert.equal(inputPrompts, 0);
    assert.ok(!requests.some(([id]) => id === "automation.workItems.open"));
    assert.ok(requests.filter(([id]) => id === "sema4ai.verifyLibraryVersion.internal")
        .every(([, args]) => args.libs_and_version.every(([library]) => library === "actions-work-items")));
});

for (const type of ["ActionPackage", "Robot"]) {
    test(`${type} Work Items opens and creates in the native editor only with owned SDK 0.4.4`, async () => {
        installedLibraries = {"robocorp-workitems": "1.4.0", "actions-work-items": "0.4.4"};
        const {provider, children} = await loadWorkItems(type);
        assert.deepEqual(children.map(child => child.name), ["work-items-in", "work-items-out"]);
        assert.equal(itemCommand(provider), "automation.workItems.open");
        await newWorkItemInWorkItemsTree();
        assert.equal(requests.filter(([id]) => id === "automation.workItems.open").length, 1);
        assert.equal(inputPrompts, 0);
        assert.deepEqual(errors, []);
    });
}

for (const legacy of ["robocorp-workitems", "rpaframework"]) {
    for (const ownedVersion of [undefined, "0.4.3", "0.5.0"]) {
        test(`Robot Work Items preserves ${legacy} with owned SDK ${ownedVersion || "absent"} without native routing`, async () => {
            installedLibraries = {[legacy]: legacy === "rpaframework" ? "28.0.0" : "1.4.0"};
            if (ownedVersion) installedLibraries["actions-work-items"] = ownedVersion;
            const {provider, children} = await loadWorkItems("Robot");
            assert.deepEqual(children.map(child => child.name), ["work-items-in", "work-items-out"]);
            assert.equal(itemCommand(provider), "vscode.open");
            await newWorkItemInWorkItemsTree();
            assert.equal(inputPrompts, 1);
            assert.ok(!requests.some(([id]) => id === "automation.workItems.open"));
            assert.deepEqual(errors, []);
        });
    }
}
