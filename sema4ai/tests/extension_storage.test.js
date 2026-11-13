const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const storage = require("../vscode-client/out/extensionStorage");

test("owned storage preserves explicit roots, legacy base semantics and platform defaults", () => {
    assert.equal(storage.extensionStorage({AUTOMATION_EXTENSION_STORAGE: "/exact", ROBOCORP_CODE_USER_HOME: "/legacy"}, "linux"), "/exact");
    assert.equal(storage.extensionStorage({ROBOCORP_CODE_USER_HOME: "/legacy", HOME: "/home/operator"}, "linux"), "/legacy/.automation-vscode");
    assert.equal(storage.extensionStorage({HOME: "/home/operator"}, "linux"), "/home/operator/.local/state/automation-vscode");
    assert.equal(storage.extensionStorage({XDG_STATE_HOME: "/state", HOME: "/home/operator"}, "linux"), "/state/automation-vscode");
    assert.equal(storage.extensionStorage({LOCALAPPDATA: "C:\\Local"}, "win32"), "C:\\Local\\automation-vscode");
    assert.equal(storage.extensionStorage({ROBOCORP_CODE_USER_HOME: "D:\\Legacy"}, "win32"), "D:\\Legacy\\.automation-vscode");
    assert.throws(() => storage.extensionStorage({}, "win32"), /LOCALAPPDATA/);
    assert.equal(storage.runtimeMetadataDirectory("D:\\Robots", "win32"), "D:\\Robots\\.automation-vscode");
    assert.equal(storage.runtimeMetadataDirectory("/actions", "linux"), "/actions/.automation-vscode");
});

test("concurrent Action inputs have private distinct directories and retain previous input", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "automation-storage-inputs-"));
    const previous = process.env.AUTOMATION_EXTENSION_STORAGE;
    process.env.AUTOMATION_EXTENSION_STORAGE = root;
    try {
        const [first, second] = await Promise.all([storage.createActionInputDirectory(), storage.createActionInputDirectory()]);
        assert.notEqual(first, second);
        assert.equal(path.dirname(first), path.join(root, "inputs"));
        fs.writeFileSync(path.join(first, "input.json"), '{"name":"first"}');
        fs.writeFileSync(path.join(second, "input.json"), '{"name":"second"}');
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(first, "input.json"))), {name: "first"});
        if (process.platform !== "win32") assert.equal(fs.statSync(first).mode & 0o077, 0);
    } finally {
        if (previous === undefined) delete process.env.AUTOMATION_EXTENSION_STORAGE;
        else process.env.AUTOMATION_EXTENSION_STORAGE = previous;
        fs.rmSync(root, {recursive: true, force: true});
    }
});

function loadCleanup() {
    const original = Module._load;
    Module._load = function(name, parent, ...args) {
        if (parent?.filename.replaceAll("\\", "/").endsWith("/clear.js")) {
            if (name === "./channel") return {OUTPUT_CHANNEL: {appendLine() {}}, logError() {}};
            if (["./rcc", "./subprocess", "vscode"].includes(name)) return {};
        }
        return original.call(this, name, parent, ...args);
    };
    try {return require("../vscode-client/out/clear").clearRobocorpCodeCaches;}
    finally {Module._load = original;}
}
const cleanup = loadCleanup();

test("cleanup awaits removal only from selected owned metadata, preserving vendor/private records", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "automation-storage-cleanup-"));
    try {
        const owned = path.join(root, ".automation-vscode");
        const legacy = path.join(root, ".sema4ai_code");
        fs.mkdirSync(path.join(owned, "cache"), {recursive: true});
        fs.mkdirSync(legacy);
        fs.writeFileSync(path.join(owned, "cache", "cache.json"), "{}");
        fs.writeFileSync(path.join(legacy, "private-record"), "preserve");
        await cleanup(root);
        assert.deepEqual(fs.readdirSync(owned), []);
        assert.equal(fs.readFileSync(path.join(legacy, "private-record"), "utf8"), "preserve");
        await cleanup(path.join(root, "unused-home"));
        assert.equal(fs.existsSync(path.join(root, "unused-home")), false);
    } finally {fs.rmSync(root, {recursive: true, force: true});}
});

test("cleanup refuses a metadata link to an externally owned directory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "automation-storage-link-"));
    try {
        const vendor = path.join(root, "vendor");
        const home = path.join(root, "actions");
        fs.mkdirSync(vendor);
        fs.mkdirSync(home);
        fs.writeFileSync(path.join(vendor, "private-record"), "preserve");
        fs.symlinkSync(vendor, path.join(home, ".automation-vscode"), "junction");
        await assert.rejects(cleanup(home), /symbolic link/);
        assert.equal(fs.readFileSync(path.join(vendor, "private-record"), "utf8"), "preserve");
    } finally {fs.rmSync(root, {recursive: true, force: true});}
});

test("editor storage binding honors operator overrides without mutating the shared environment", () => {
    const keys = ["AUTOMATION_EXTENSION_STORAGE", "ROBOCORP_CODE_USER_HOME"];
    const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    try {
        for (const key of keys) delete process.env[key];
        assert.equal(storage.initializeExtensionStorage("editor-owned"), "editor-owned");
        assert.equal(storage.getExtensionStorage(), "editor-owned");
        assert.equal(process.env.AUTOMATION_EXTENSION_STORAGE, undefined);
        process.env.ROBOCORP_CODE_USER_HOME = "operator-base";
        assert.equal(storage.initializeExtensionStorage("editor-owned"), path.join("operator-base", ".automation-vscode"));
        process.env.AUTOMATION_EXTENSION_STORAGE = "operator-exact";
        assert.equal(storage.initializeExtensionStorage("editor-owned"), "operator-exact");
        assert.equal(process.env.ROBOCORP_CODE_USER_HOME, "operator-base");
    } finally {
        for (const key of keys) {
            if (original[key] === undefined) delete process.env[key];
            else process.env[key] = original[key];
        }
        storage.initializeExtensionStorage(storage.extensionStorage());
    }
});
