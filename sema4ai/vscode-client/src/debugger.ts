import { getRccLocation as getConfiguredRcc } from "./rcc";
import { runtimeEnvironment } from "./runtimePaths";
import { getExtensionStorage } from "./extensionStorage";
import * as path from "path";
import * as fs from "fs";
import {
    window,
    commands,
    WorkspaceFolder,
    DebugAdapterExecutable,
    debug,
    DebugConfiguration,
    DebugConfigurationProvider,
    CancellationToken,
    extensions,
} from "vscode";
import * as roboConfig from "./robocorpSettings";
import { OUTPUT_CHANNEL } from "./channel";
import { resolveInterpreter, updateLaunchEnvironmentCommonTasksAndActions, updateWorkItemEnvironment } from "./activities";
import {
    SEMA4AI_COMPUTE_ROBOT_LAUNCH_FROM_ROBOCORP_CODE_LAUNCH,
    SEMA4AI_UPDATE_LAUNCH_ENV,
    SEMA4AI_GET_CONNECTED_VAULT_WORKSPACE_INTERNAL,
} from "./robocorpCommands";
import { globalCachedPythonInfo } from "./extension";
import { disablePythonTerminalActivateEnvironment } from "./pythonExtIntegration";
import { InterpreterInfo } from "./protocols";

interface ActionResult {
    success: boolean;
    message: string;
    result: any;
}

function ownedPythonRun(configuration: DebugConfiguration): DebugConfiguration {
    return {
        ...configuration,
        type: "sema4ai",
        noDebug: true,
        automationResolvedPython: true,
        terminal: configuration.terminal || (configuration.console === "internalConsole" ? "none" :
            configuration.console === "externalTerminal" ? "external" : "integrated"),
    };
}

export async function updateDebugConfigurationAndAutoActivatePythonExtension(
    debugConfiguration: DebugConfiguration
): Promise<DebugConfiguration | undefined> {
    const isPythonRun = debugConfiguration && debugConfiguration.type && debugConfiguration.type == "python";
    if (isPythonRun) {
        if (debugConfiguration.noDebug === true) return ownedPythonRun(debugConfiguration);
        for (const [id, type] of [["ms-python.debugpy", "debugpy"], ["ms-python.python", "python"],
            ["fabioz.vscode-pydev-python-debugger", "pydevd"]]) {
            const extension = extensions.getExtension(id);
            const contributions: unknown = extension?.packageJSON?.contributes?.debuggers;
            if (!extension || !Array.isArray(contributions) || !contributions.some(value =>
                value !== null && typeof value === "object" && "type" in value && value.type === type)) continue;
            try {
                if (!extension.isActive) await extension.activate();
            } catch {
                await window.showErrorMessage(`Unable to activate Python debugging provider ${id}. Check its extension output and try again.`);
                return;
            }
            debugConfiguration.type = type;
            if (type === "pydevd") debugConfiguration.pythonExecutable = debugConfiguration.python;
            return debugConfiguration;
        }
        const msg = "Python Debug requires a supported debugger contribution: ms-python.debugpy (Python Debugger), " +
            "legacy ms-python.python with a python adapter, or fabioz.vscode-pydev-python-debugger. " +
            "Ordinary Run does not require these extensions.";
        OUTPUT_CHANNEL.appendLine(msg);
        if (await window.showErrorMessage(msg, "Open Python Debugger") === "Open Python Debugger") {
            await commands.executeCommand("extension.open", "ms-python.debugpy");
        }
        return;
    }

    return debugConfiguration;
}

export class RobocorpCodeDebugConfigurationProvider implements DebugConfigurationProvider {
    provideDebugConfigurations?(folder: WorkspaceFolder | undefined, token?: CancellationToken): DebugConfiguration[] {
        let configurations: DebugConfiguration[] = [];
        configurations.push({
            "type": "sema4ai",
            "name": "Automation: Launch task from robot.yaml",
            "request": "launch",
            "robot": '^"\\${file}"',
            "task": "",
        });
        return configurations;
    }

    async resolveDebugConfigurationWithSubstitutedVariables(
        folder: WorkspaceFolder | undefined,
        debugConfiguration: DebugConfiguration,
        token?: CancellationToken
    ): Promise<DebugConfiguration> {
        if (token?.isCancellationRequested) return;
        if (debugConfiguration.automationResolvedPython === true) {
            if (debugConfiguration.noDebug === true) return debugConfiguration;
            await window.showErrorMessage("The owned Python execution adapter supports Run only. Select Debug to resolve a supported Python debugger.");
            return;
        }
        let isActionPackageLaunch = false;
        let targetYaml;
        if (debugConfiguration.robot) {
            if (!fs.existsSync(debugConfiguration.robot)) {
                window.showWarningMessage(
                    'Error. Expected: specified "robot.yaml": ' + debugConfiguration.robot + " to exist."
                );
                return;
            }
            targetYaml = debugConfiguration.robot;
        } else if (debugConfiguration.package) {
            isActionPackageLaunch = true;
            if (!fs.existsSync(debugConfiguration.package)) {
                window.showWarningMessage(
                    'Error. Expected: specified "package": ' + debugConfiguration.package + " to exist."
                );
                return;
            }
            targetYaml = debugConfiguration.package;
        } else {
            window.showWarningMessage('Error. Neither "package" nor "robot" were specified in the launch.');
            return;
        }

        let interpreter: InterpreterInfo | undefined = undefined;
        let interpreterResult = await resolveInterpreter(targetYaml);
        if (!interpreterResult.success) {
            window.showWarningMessage("Error resolving interpreter info: " + interpreterResult.message);
            return;
        }
        interpreter = interpreterResult.result;
        if (!interpreter) {
            window.showWarningMessage("Unable to resolve interpreter for: " + targetYaml);
            return;
        }

        if (!interpreter.environ) {
            window.showErrorMessage("Unable to resolve interpreter environment based on: " + targetYaml);
            return;
        }

        let env: { [key: string]: string } = { ...interpreter.environ };
        const baseEnv = debugConfiguration.baseEnv;
        if (baseEnv) {
            env = { ...env, ...baseEnv };
        }

        if (debugConfiguration.automationWorkItems) {
            // Native Work Items prepares a private input snapshot or SDK queue
            // through the package interpreter. Preserve explicit operator values.
            const allowed = new Set(["RC_WORKITEM_ADAPTER", "RC_WORKITEM_INPUT_PATH", "RC_WORKITEM_OUTPUT_PATH",
                "RC_WORKITEM_DB_PATH", "RC_WORKITEM_FILES_DIR", "RC_WORKITEM_QUEUE_NAME", "RC_WORKITEM_OUTPUT_QUEUE_NAME"]);
            if (["RPA_WORKITEMS_ADAPTER", "RPA_INPUT_WORKITEM_PATH", "RPA_OUTPUT_WORKITEM_PATH"].some(key => env[key])) {
                throw Error("Explicit legacy Work Items overrides conflict with native selection. Existing configuration was preserved.");
            }
            for (const [key, value] of Object.entries(debugConfiguration.automationWorkItems)) {
                if (!allowed.has(key) || typeof value !== "string") throw Error("Invalid native Work Items launch environment.");
                if (env[key] && env[key] !== value) throw Error(`Operator override ${key} conflicts with native Work Items selection. Existing configuration was preserved.`);
                env[key] = value;
            }
            env = await updateLaunchEnvironmentCommonTasksAndActions(env, targetYaml);
        } else if (isActionPackageLaunch) {
            env = await updateLaunchEnvironmentCommonTasksAndActions(env, debugConfiguration.package);
            const workItemEnv = await updateWorkItemEnvironment(env, debugConfiguration.package);
            if (workItemEnv === "cancelled") {
                OUTPUT_CHANNEL.appendLine("Launch cancelled");
                return;
            }
            env = workItemEnv;
        } else {
            // Resolve environment (updates the environment to add vault
            // environment variables as well as work-items environment variables).
            try {
                let newEnv: { [key: string]: string } | "cancelled" = await commands.executeCommand(
                    SEMA4AI_UPDATE_LAUNCH_ENV,
                    {
                        "targetRobot": debugConfiguration.robot,
                        "env": env,
                    }
                );
                if (newEnv === "cancelled") {
                    OUTPUT_CHANNEL.appendLine("Launch cancelled");
                    return;
                } else {
                    env = newEnv;
                }
            } catch (error) {
                // The command may not be available.
            }
        }

        // If vscode-python is installed, we need to disable the terminal activation as it
        // conflicts with the robot environment.
        if (roboConfig.getAutosetpythonextensiondisableactivateterminal()) {
            await disablePythonTerminalActivateEnvironment();
        }

        let actionResult: ActionResult;
        if (isActionPackageLaunch) {
            actionResult = await commands.executeCommand(SEMA4AI_COMPUTE_ROBOT_LAUNCH_FROM_ROBOCORP_CODE_LAUNCH, {
                "name": debugConfiguration.name,
                "request": debugConfiguration.request,
                "package": debugConfiguration.package,
                "actionName": debugConfiguration.actionName,
                "uri": debugConfiguration.uri,
                "jsonInput": debugConfiguration.jsonInput,
                "additionalPythonpathEntries": interpreter.additionalPythonpathEntries,
                "env": env,
                "pythonExe": interpreter.pythonExe,
                "noDebug": debugConfiguration.noDebug,
            });
        } else {
            actionResult = await commands.executeCommand(SEMA4AI_COMPUTE_ROBOT_LAUNCH_FROM_ROBOCORP_CODE_LAUNCH, {
                "name": debugConfiguration.name,
                "request": debugConfiguration.request,
                "robot": debugConfiguration.robot,
                "task": debugConfiguration.task,
                "additionalPythonpathEntries": interpreter.additionalPythonpathEntries,
                "env": env,
                "pythonExe": interpreter.pythonExe,
                "noDebug": debugConfiguration.noDebug,
            });
        }

        // In a custom run we get the input contents -- something as:
        // "type": "sema4ai",
        // "name": "Automation: Launch task from current robot.yaml",
        // "request": "launch",
        // "robot": "c:/robot.yaml",
        // "task": "entrypoint",
        //
        // and convert it to the contents expected by robotframework-lsp:
        //
        // "type": "robotframework-lsp",
        // "name": "Robot: Current File",
        // "request": "launch",
        // "cwd": "${workspaceFolder}",
        // "target": "c:/task.robot",
        //
        // (making sure that we can actually do this and it's a robot launch for the task)

        let result = actionResult.result;
        const isPythonRun = result && result.type && result.type == "python";

        if (!isActionPackageLaunch && debugConfiguration.noDebug && (!actionResult.success || isPythonRun)) {
            // In no debug mode if it didn't work that's ok, we'll just go back to running
            // rcc directly (note that we try to go to the regular RF launch whenever
            // possible because we can edit the command line to be able to track the run with the
            // `Robot Output View` and put log messages in the `Console Output`).
            //
            // Also, in a Python run in noDebug mode we still run with RCC instead of falling
            // back to the run with the Python extension.
            let vaultInfoActionResult: ActionResult = await commands.executeCommand(
                SEMA4AI_GET_CONNECTED_VAULT_WORKSPACE_INTERNAL
            );
            if (vaultInfoActionResult?.success && vaultInfoActionResult.result) {
                debugConfiguration.workspaceId = vaultInfoActionResult.result.workspaceId;
            }
            // Not running with debug: just use rcc to launch.
            debugConfiguration.env = env;
            return debugConfiguration;
        }

        if (!actionResult.success) {
            window.showErrorMessage(actionResult.message);
            return;
        }
        if (token?.isCancellationRequested) return;
        result.noDebug = debugConfiguration.noDebug;
        if (debugConfiguration.terminal) result.terminal = debugConfiguration.terminal;
        if (isActionPackageLaunch) result.automationRuntimeKind = "actions";
        result = await updateDebugConfigurationAndAutoActivatePythonExtension(result);
        if (!result) return;

        // OUTPUT_CHANNEL.appendLine("Launching with: " + JSON.stringify(result));
        result["noDebug"] = debugConfiguration.noDebug;

        return result;
    }
}

export function registerDebugger() {
    async function createDebugAdapterExecutable(config: DebugConfiguration): Promise<DebugAdapterExecutable> {
        let env = config.env;
        if (!env) {
            env = {};
        }
        const homes = runtimeEnvironment(config.automationRuntimeKind === "actions" ? "actions" : "robots", roboConfig.getHome());
        env = { ...homes, ...env, AUTOMATION_RCC_LOCATION: await getConfiguredRcc(),
            AUTOMATION_EXTENSION_STORAGE: env.AUTOMATION_EXTENSION_STORAGE || getExtensionStorage() };
        let targetMain: string = path.resolve(__dirname, "../../src/sema4ai_code_debug_adapter/__main__.py");
        if (!fs.existsSync(targetMain)) {
            window.showWarningMessage("Error. Expected: " + targetMain + " to exist.");
            return;
        }

        if (!globalCachedPythonInfo) {
            window.showWarningMessage("Error. Expected globalCachedPythonInfo to be set when launching debugger.");
            return;
        }
        const pythonExecutable = globalCachedPythonInfo.pythonExe;
        if (!fs.existsSync(pythonExecutable)) {
            window.showWarningMessage("Error. Expected: " + pythonExecutable + " to exist.");
            return;
        }

        if (env) {
            return new DebugAdapterExecutable(pythonExecutable, ["-u", targetMain], { "env": env });
        } else {
            return new DebugAdapterExecutable(pythonExecutable, ["-u", targetMain]);
        }
    }

    debug.registerDebugAdapterDescriptorFactory("sema4ai", {
        createDebugAdapterDescriptor: (session) => {
            const config: DebugConfiguration = session.configuration;
            return createDebugAdapterExecutable(config);
        },
    });

    debug.registerDebugConfigurationProvider("sema4ai", new RobocorpCodeDebugConfigurationProvider());
}
