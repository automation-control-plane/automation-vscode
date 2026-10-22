const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runtimeHomes } = require("../vscode-client/out/runtimePaths");
const { publishedTool } = require("../vscode-client/out/publishedTools");

test("Unix defaults and explicit homes remain separate", () => {
    assert.deepEqual(runtimeHomes("", { HOME: "/operator" }, "linux"), {
        actions: "/operator/.actions", robots: "/operator/.robots"
    });
    assert.deepEqual(runtimeHomes("/legacy", { HOME: "/operator", ACTIONS_HOME: "/a", ROBOTS_HOME: "/r" }, "linux"), {
        actions: "/a", robots: "/r"
    });
});

test("Windows paths retain their drive and separators", () => {
    assert.deepEqual(runtimeHomes("", { LOCALAPPDATA: "C:\\Users\\Operator\\AppData\\Local" }, "win32"), {
        actions: "C:\\Users\\Operator\\AppData\\Local\\actions", robots: "C:\\Users\\Operator\\AppData\\Local\\robots"
    });
    assert.throws(() => runtimeHomes("", { LOCALAPPDATA: "C:\\Local", ACTIONS_HOME: "C:\\Same", ROBOTS_HOME: "c:\\same" }, "win32"), /different directories/);
});

test("Published artifacts have exact identity and no architecture fallback", () => {
    assert.equal(publishedTool("rcc", "linux", "x64").sha256, "f8e0394be7f47ee84d6f4cd734822b87b492a4d6102f977f6a18f29453703d48");
    assert.equal(publishedTool("action-server", "win32", "x64").name, "actions-runtime-1.0.4-windows64.exe");
    assert.throws(() => publishedTool("rcc", "linux", "arm64"), /No published/);
});
