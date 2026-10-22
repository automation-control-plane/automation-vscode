import * as assert from "assert";
import * as fs from "fs";
import * as vscode from "vscode";
import { extensionIdentity } from "../publishedTools";
import { ActionResult, InterpreterInfo, LocalPackageMetadataInfo } from "../protocols";
import { SEMA4AI_GET_LANGUAGE_SERVER_PYTHON_INFO, SEMA4AI_LOCAL_LIST_ROBOTS_INTERNAL } from "../robocorpCommands";

export async function run(): Promise<void> {
    const identity = extensionIdentity();
    const extension = vscode.extensions.getExtension(identity.id);
    assert.ok(extension, "Private extension must be discovered");
    if (process.env.AUTOMATION_SMOKE_VSIX) {
        assert.ok(
            extension.extensionPath.startsWith(process.env.AUTOMATION_INSTALLED_EXTENSIONS + require("path").sep),
            "Test the installed VSIX"
        );
    }
    await extension.activate();
    const python = await vscode.commands.executeCommand<InterpreterInfo>(SEMA4AI_GET_LANGUAGE_SERVER_PYTHON_INFO);
    assert.ok(python?.pythonExe, "Language server Python must resolve");
    const packages = await vscode.commands.executeCommand<ActionResult<LocalPackageMetadataInfo[]>>(
        SEMA4AI_LOCAL_LIST_ROBOTS_INTERNAL
    );
    assert.ok(packages?.success, packages?.message);
    assert.ok(packages.result.length >= 2, "Provide an Action Package and a Robot Task in the smoke workspace");
    const destination = process.env.AUTOMATION_HOST_RESULT;
    assert.ok(destination, "Host evidence destination must be provided");
    fs.writeFileSync(
        destination,
        JSON.stringify(
            {
                extension: identity,
                activated: extension.isActive,
                extensionPath: extension.extensionPath,
                vsix: process.env.AUTOMATION_SMOKE_VSIX,
                python: python.pythonExe,
                packages: packages.result.map((entry) => entry.name),
                pythonDebuggerInstalled: !!vscode.extensions.getExtension("ms-python.debugpy"),
                scope: "Activation, language-server startup and package discovery. Workload debug and inspectors require their own acceptance.",
            },
            null,
            2
        )
    );
}
