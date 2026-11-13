const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runtimeHomes } = require("../vscode-client/out/runtimePaths");
const { publishedTool } = require("../vscode-client/out/publishedTools");
const { publishedWorkItemEnvironment } = require("../vscode-client/out/runtimePaths");
const { vendorStudioHome } = require("../vscode-client/out/runtimePaths");

test("Unix defaults and explicit homes remain separate", () => {
    assert.deepEqual(runtimeHomes("", { HOME: "/operator" }, "linux"), {
        actions: "/operator/.actions",
        robots: "/operator/.robots",
    });
    assert.deepEqual(runtimeHomes("/legacy", { HOME: "/operator", ACTIONS_HOME: "/a", ROBOTS_HOME: "/r" }, "linux"), {
        actions: "/a",
        robots: "/r",
    });
});

test("Windows paths retain their drive and separators", () => {
    assert.deepEqual(runtimeHomes("", { LOCALAPPDATA: "C:\\Users\\Operator\\AppData\\Local" }, "win32"), {
        actions: "C:\\Users\\Operator\\AppData\\Local\\actions",
        robots: "C:\\Users\\Operator\\AppData\\Local\\robots",
    });
    assert.throws(
        () =>
            runtimeHomes("", { LOCALAPPDATA: "C:\\Local", ACTIONS_HOME: "C:\\Same", ROBOTS_HOME: "c:\\same" }, "win32"),
        /different directories/
    );
});

test("Published artifacts have exact identity and no architecture fallback", () => {
    assert.equal(
        publishedTool("rcc", "linux", "x64").sha256,
        "ea8dc96e66d7a81536b03a344b4eaf44bbd94122585954e70290bd466f5de4b6"
    );
    assert.equal(publishedTool("action-server", "win32", "x64").name, "actions-runtime-1.1.0-windows64.exe");
    assert.throws(() => publishedTool("rcc", "linux", "arm64"), /No published/);
});

test("Published Work Items receives FileAdapter paths and preserves explicit controls", () => {
    const legacy = {
        RPA_WORKITEMS_ADAPTER: "RPA.Robocorp.WorkItems.FileAdapter",
        RPA_INPUT_WORKITEM_PATH: "/input.json",
        RPA_OUTPUT_WORKITEM_PATH: "/output.json",
    };
    const result = publishedWorkItemEnvironment(legacy);
    assert.equal(result.RC_WORKITEM_ADAPTER, "FileAdapter");
    assert.equal(result.RC_WORKITEM_INPUT_PATH, "/input.json");
    assert.equal(result.RC_WORKITEM_OUTPUT_PATH, "/output.json");
    const overridden = publishedWorkItemEnvironment({
        ...legacy,
        RC_WORKITEM_ADAPTER: "custom.Adapter",
        RC_WORKITEM_INPUT_PATH: "/operator.json",
    });
    assert.equal(overridden.RC_WORKITEM_ADAPTER, "custom.Adapter");
    assert.equal(overridden.RC_WORKITEM_INPUT_PATH, "/operator.json");
});

test("Studio discovery keeps its original home while local environments stay separate", () => {
    const env = { HOME: "/operator", SEMA4AI_HOME: "/studio", ACTIONS_HOME: "/a", ROBOTS_HOME: "/r" };
    assert.equal(vendorStudioHome("", env, "linux"), "/studio");
    assert.equal(vendorStudioHome("/configured", env, "linux"), "/configured");
    assert.deepEqual(runtimeHomes("", env, "linux"), { actions: "/a", robots: "/r" });
});

test("Optional Studio/Data backends preserve explicit operator environment", () => {
    const { withStudioEnvironment } = require("../vscode-client/out/runtimePaths");
    assert.deepEqual(withStudioEnvironment({ ACTIONS_HOME: "/a" }), { ACTIONS_HOME: "/a" });
    assert.deepEqual(withStudioEnvironment({}, "http://localhost:1", "discovered"), {
        SEMA4AI_CREDENTIAL_API: "http://localhost:1",
        SEMA4AI_DATA_SERVER_INFO: "discovered",
    });
    assert.deepEqual(
        withStudioEnvironment(
            { SEMA4AI_CREDENTIAL_API: "operator", SEMA4AI_DATA_SERVER_INFO: "operator-data" },
            "discovered",
            "discovered-data"
        ),
        { SEMA4AI_CREDENTIAL_API: "operator", SEMA4AI_DATA_SERVER_INFO: "operator-data" }
    );
});
