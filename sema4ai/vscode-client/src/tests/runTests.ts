import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn, spawnSync } from "child_process";

async function main() {
    const executable = process.env.AUTOMATION_VSCODE_EXECUTABLE;
    const python = process.env.AUTOMATION_LS_PYTHON;
    const workspace = process.env.AUTOMATION_SMOKE_WORKSPACE;
    if (!executable || !python || !workspace) {
        throw new Error(
            "Set AUTOMATION_VSCODE_EXECUTABLE, AUTOMATION_LS_PYTHON and AUTOMATION_SMOKE_WORKSPACE. See docs/compatibility-port.md."
        );
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "automation-vscode-host-"));
    const userData = path.join(root, "user-data");
    fs.mkdirSync(path.join(userData, "User"), { recursive: true });
    fs.writeFileSync(
        path.join(userData, "User/settings.json"),
        JSON.stringify(
            {
                "sema4ai.language-server.python": python,
                "sema4ai.rcc.location": process.env.AUTOMATION_RCC_LOCATION || "",
                "sema4ai.actionServer.location": process.env.ACTIONS_RUNTIME_LOCATION || "",
            },
            null,
            2
        )
    );
    const extensionsDirectory = path.join(root, "extensions");
    let developmentPath = path.resolve(__dirname, "../../..");
    const vsix = process.env.AUTOMATION_SMOKE_VSIX;
    if (vsix) {
        const installed = spawnSync(
            executable,
            [
                "--user-data-dir=" + userData,
                "--extensions-dir=" + extensionsDirectory,
                "--install-extension",
                path.resolve(vsix),
            ],
            { stdio: "inherit", env: process.env }
        );
        if (installed.error || installed.status !== 0) {
            throw installed.error || new Error("VSIX installation failed: " + installed.status);
        }
        // Only the test controller is developed. The port is loaded from the
        // installed VSIX in the otherwise empty extensions directory.
        developmentPath = path.join(root, "acceptance-controller");
        fs.mkdirSync(developmentPath);
        fs.writeFileSync(
            path.join(developmentPath, "package.json"),
            JSON.stringify({
                name: "acceptance-controller",
                publisher: "task-local",
                version: "0.0.1",
                engines: { vscode: "^1.101.0" },
            })
        );
    }
    const args = [
        "--user-data-dir=" + userData,
        "--extensions-dir=" + extensionsDirectory,
        "--extensionDevelopmentPath=" + developmentPath,
        "--extensionTestsPath=" + path.resolve(__dirname, "publishedSmoke"),
        "--skip-welcome",
        "--skip-release-notes",
        workspace,
    ];
    if (process.env.AUTOMATION_HEADLESS === "1") {
        args.unshift("--ozone-platform=headless", "--disable-gpu");
    }
    const child = spawn(executable, args, {
        stdio: "inherit",
        env: {
            ...process.env,
            AUTOMATION_INSTALLED_EXTENSIONS: extensionsDirectory,
            AUTOMATION_HOST_RESULT: path.join(root, "result.json"),
        },
    });
    const result = await new Promise<number>((resolve, reject) => {
        child.on("error", reject);
        child.on("exit", (code) => resolve(code ?? 1));
    });
    console.log("Extension Host evidence: " + root);
    if (result !== 0 || !fs.existsSync(path.join(root, "result.json"))) {
        throw new Error("Extension Host smoke did not complete successfully; process exit " + result);
    }
    console.log(fs.readFileSync(path.join(root, "result.json"), "utf8"));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
