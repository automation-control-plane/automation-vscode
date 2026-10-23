const {test} = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const commands = require("../vscode-client/out/robocorpCommands");
let selected, calls;
const commandApi = {executeCommand: async (id, args) => {
    calls.push([id, args]);
    if (id === commands.SEMA4AI_LIST_WORK_ITEMS_INTERNAL) return {success: true, result: {
        input_work_items: [{name: "input-1", json_path: "/package/devdata/work-items-in/input-1/work-items.json"}],
        output_work_items: [], new_output_workitem_path: "/package/devdata/work-items-out/run-1/work-items.json",
    }};
    if (id === commands.SEMA4AI_VERIFY_LIBRARY_VERSION_INTERNAL) {
        assert.ok(args.libs_and_version.some(([name, version]) => name === "actions-work-items" && version === "0.4.4"));
        return {success: true, result: {library: "actions-work-items", version: "0.4.4"}};
    }
    assert.fail(`Unexpected command: ${id}`);
}};
const load = Module._load;
Module._load = function(name, parent, main) {
    if (parent?.filename.endsWith("/activities.js")) {
        if (name === "vscode") return {commands: commandApi};
        if (name === "./runtimePaths" || name === "./robocorpCommands") return load.call(this, name, parent, main);
        if (name === "./channel") return {logError: assert.fail, OUTPUT_CHANNEL: {appendLine() {}}};
        if (name === "./ask") return {showSelectOneQuickPick: async () => selected};
        if (name === "./rcc") return {feedback() {}};
        if (name.startsWith("./")) return {};
    }
    return load.call(this, name, parent, main);
};
let launch;
try {launch = require("../vscode-client/out/activities").updateWorkItemEnvironment;} finally {Module._load = load;}

test("Action and Robot launches select published FileAdapter input/output and respect overrides", async () => {
    for (const yaml of ["/package/package.yaml", "/package/robot.yaml"]) {
        calls = [];
        selected = {label: "input-1", action: "/package/devdata/work-items-in/input-1/work-items.json"};
        const env = {CONDA_PREFIX: "/env", ACTIONS_HOME: "/actions", ROBOTS_HOME: "/robots"};
        const result = await launch(env, yaml);
        assert.equal(calls[0][1].robot, yaml);
        assert.equal(result.RC_WORKITEM_ADAPTER, "FileAdapter");
        assert.equal(result.RC_WORKITEM_INPUT_PATH, selected.action);
        assert.equal(result.RC_WORKITEM_OUTPUT_PATH, "/package/devdata/work-items-out/run-1/work-items.json");
        assert.equal(env.RC_WORKITEM_INPUT_PATH, undefined);
        assert.equal(result.ACTIONS_HOME, "/actions");
        assert.equal(result.ROBOTS_HOME, "/robots");
        const overridden = await launch({...env, RC_WORKITEM_INPUT_PATH: "/operator/input.json", RC_WORKITEM_OUTPUT_PATH: "/operator/output.json"}, yaml);
        assert.equal(overridden.RC_WORKITEM_INPUT_PATH, "/operator/input.json");
        assert.equal(overridden.RC_WORKITEM_OUTPUT_PATH, "/operator/output.json");
    }
});

test("Cancelling Work Items selection cancels launch", async () => {
    calls = [];
    selected = undefined;
    assert.equal(await launch({CONDA_PREFIX: "/env"}, "/package/package.yaml"), "cancelled");
});
