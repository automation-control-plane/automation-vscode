// Keep private VSIX builds local and preserve the fork's source attribution.
const fs = require("node:fs");
const path = require("node:path");
const extensionRoot = path.resolve(__dirname, "..");
const repositoryRoot = path.dirname(extensionRoot);
for (const [source, target] of [
    ["LICENSE", "LICENSE.txt"],
    ["COPYRIGHT", "COPYRIGHT"],
    ["ThirdPartyNotices.txt", "ThirdPartyNotices.txt"],
]) {
    fs.copyFileSync(path.join(repositoryRoot, source), path.join(extensionRoot, target));
}
fs.cpSync(
    path.join(repositoryRoot, "sema4ai-python-ls-core/src/sema4ai_ls_core"),
    path.join(extensionRoot, "src/sema4ai_code/vendored/sema4ai_ls_core"),
    { recursive: true, filter: (source) => !source.includes("__pycache__") && !source.endsWith(".pyc") }
);
