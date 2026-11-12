import {
    commands,
    ConfigurationTarget,
    ExtensionContext,
    extensions,
    TextEditor,
    Uri,
    window,
    workspace,
    Terminal,
    TerminalOptions,
    StatusBarAlignment,
    StatusBarItem,
} from "vscode";
import { resolveInterpreter } from "./activities";
import { logError, OUTPUT_CHANNEL } from "./channel";
import { handleProgressMessage } from "./progress";
import { ActionResult, InterpreterInfo } from "./protocols";
import { getAutosetpythonextensioninterpreter } from "./robocorpSettings";
import { TREE_VIEW_SEMA4AI_TASK_PACKAGES_TREE } from "./robocorpViews";
import { refreshTreeView } from "./viewsCommon";
import { getActionServerTerminal, isActionServerAlive, restartActionServer } from "./actionServer";

const dirtyWorkspaceFiles = new Set<string>();
let packagePythonStatus: StatusBarItem | undefined;

// Subset of Microsoft's public API, with the legacy exports retained for older installations.
interface MicrosoftPythonApi {
    ready?: Promise<void>;
    environments?: {
        updateActiveEnvironmentPath?(python: string, resource?: Uri): Promise<void>;
        getActiveEnvironmentPath?(resource?: Uri): { path: string } | undefined;
        resolveEnvironment?(environment: { path: string }): Promise<{ executable: { uri?: Uri } } | undefined>;
    };
    environment?: {
        setActiveEnvironment?(python: string, resource: Uri): Promise<void>;
        setActiveInterpreter?(python: string, resource: Uri): Promise<void>;
    };
    settings?: { getExecutionDetails(resource?: Uri): { execCommand?: string[] | string } };
}

// Opaque environment item returned by Microsoft's public Environments API; never synthesize one.
interface PythonEnvironmentSelection {
    readonly envId: { id: string; managerId: string };
    readonly execInfo: { run: { executable: string } };
}

interface PythonEnvironmentsApi {
    resolveEnvironment?(python: Uri): Promise<PythonEnvironmentSelection | undefined>;
    setEnvironment?(resource: Uri, environment: PythonEnvironmentSelection): Promise<void>;
    getEnvironment?(resource: Uri): Promise<PythonEnvironmentSelection | undefined>;
}

async function getPythonEnvironmentsApi(resource: Uri): Promise<PythonEnvironmentsApi | undefined> {
    const extension = extensions.getExtension<PythonEnvironmentsApi | undefined>("ms-python.vscode-python-envs");
    if (!extension) {
        return undefined;
    }
    // The companion ignores the legacy default=false; only explicit operator settings disable it.
    const scopes = [resource, ...(workspace.workspaceFolders || []).map(folder => folder.uri)];
    for (const scope of scopes) {
        const setting = workspace.getConfiguration("python", scope).inspect<boolean>("useEnvironmentsExtension");
        if (setting?.globalValue === false || setting?.workspaceValue === false || setting?.workspaceFolderValue === false) {
            return undefined;
        }
    }
    if (!extension.isActive) {
        await extension.activate();
    }
    return extension.exports;
}

export function isEnvironmentFile(fsPath: string): boolean {
    return (
        fsPath.endsWith("conda.yaml") ||
        fsPath.endsWith("action-server.yaml") ||
        fsPath.endsWith("package.yaml") ||
        fsPath.endsWith("robot.yaml")
    );
}

export function isPythonFile(fsPath: string): boolean {
    return fsPath.endsWith(".py");
}

export async function autoUpdateInterpreter(docUri: Uri): Promise<boolean> {
    if (!getAutosetpythonextensioninterpreter()) {
        return false;
    }
    let result: ActionResult<InterpreterInfo | undefined> = await resolveInterpreter(docUri.fsPath);
    if (!result.success) {
        return false;
    }
    let interpreter: InterpreterInfo = result.result;
    if (!interpreter || !interpreter.pythonExe) {
        return false;
    }

    // This labels the resolved package interpreter, independent of Microsoft's discovery classification.
    if (packagePythonStatus && window.activeTextEditor?.document.uri.toString() === docUri.toString()) {
        packagePythonStatus.text = "$(package) Automation: RCC Python";
        packagePythonStatus.tooltip = `Resolved package interpreter\n${interpreter.pythonExe}\nPackage resource: ${docUri.fsPath}`;
        packagePythonStatus.show();
    }

    // Now, set the interpreter.
    let pythonExecutable = await getPythonExecutable(docUri, true, false);
    if (pythonExecutable != interpreter.pythonExe) {
        await setPythonInterpreterForPythonExtension(interpreter.pythonExe, docUri);
    }

    const additional = interpreter.additionalPythonpathEntries;
    if (additional && additional.length > 0) {
        await workspace.getConfiguration("python", docUri).update(
            "analysis.extraPaths",
            additional.map((el) => {
                return el.replaceAll("\\", "/");
            }),
            ConfigurationTarget.WorkspaceFolder
        );
    }
    return true;
}

export async function installWorkspaceWatcher(context: ExtensionContext) {
    packagePythonStatus = window.createStatusBarItem("automation.packagePython", StatusBarAlignment.Right, 99);
    packagePythonStatus.name = "Automation package Python";
    context.subscriptions.push(packagePythonStatus);
    // listen to editor change/switch (this should cause environment switching as well)
    const checkEditorSwitch = window.onDidChangeActiveTextEditor(async (event: TextEditor) => {
        try {
            // Whenever the active editor changes we update the Python interpreter used (if needed).
            let docURI = event?.document?.uri;
            packagePythonStatus?.hide();
            if (docURI) {
                await autoUpdateInterpreter(docURI);
            }
        } catch (error) {
            logError("Error auto-updating Python interpreter.", error, "PYTHON_SET_INTERPRETER");
        }
    });

    // listen for document changes and mark targeted files as dirty
    const checkIfFilesHaveChanged = workspace.onDidChangeTextDocument(async (event) => {
        let docURI = event.document.uri;
        if (event.document.isDirty && (isEnvironmentFile(docURI.fsPath) || isPythonFile(docURI.fsPath))) {
            dirtyWorkspaceFiles.add(docURI.fsPath);
        }
    });

    // listen for when documents are saved and check if the files of interest have changed
    const checkIfFilesWillBeSaved = workspace.onDidSaveTextDocument(async (document) => {
        try {
            let docURI = document.uri;
            if (
                docURI &&
                dirtyWorkspaceFiles.has(docURI.fsPath) &&
                (isEnvironmentFile(docURI.fsPath) || isPythonFile(docURI.fsPath))
            ) {
                const actionServerTerminal: Terminal = getActionServerTerminal();
                const terminalOptions = actionServerTerminal?.creationOptions as TerminalOptions;
                const terminalCwd = terminalOptions?.cwd as Uri;

                // let's refresh the view each time we get a hit on the files that might impact the workspace
                refreshTreeView(TREE_VIEW_SEMA4AI_TASK_PACKAGES_TREE);
                dirtyWorkspaceFiles.delete(docURI.fsPath);
                // if environment file has changed, let's ask the user if he wants to update the env
                if (isEnvironmentFile(docURI.fsPath)) {
                    window
                        .showInformationMessage(
                            "Changes were detected in the package configuration. Would you like to rebuild the environment?",
                            "Yes",
                            "No"
                        )
                        .then(async (selection) => {
                            if (selection === "Yes") {
                                const result = await autoUpdateInterpreter(docURI);
                                if (result) {
                                    window.showInformationMessage(
                                        `Environment built & cached. Python interpreter loaded.`
                                    );
                                } else {
                                    window.showErrorMessage(`Failed to Auto Update the Python Interpreter`);
                                }
                            }
                        });
                }

                /* If Action Server is running in the package the file was modified in, ask the user if they want to restart it. */
                if (
                    terminalCwd?.fsPath &&
                    docURI.fsPath.includes(terminalCwd.fsPath) &&
                    (await isActionServerAlive())
                ) {
                    window
                        .showInformationMessage(
                            "Changes were detected in the Action files. Would you like to restart the Action Server?",
                            "Yes",
                            "No"
                        )
                        .then(async (selection) => {
                            if (selection === "Yes") {
                                await restartActionServer(terminalCwd);
                            }
                        });
                }
            }
        } catch (error) {
            logError("Error auto-updating Python interpreter.", error, "PYTHON_SET_INTERPRETER");
        }
    });

    // create the appropriate subscriptions
    context.subscriptions.push(checkEditorSwitch, checkIfFilesHaveChanged, checkIfFilesWillBeSaved);

    // update the interpreter at start time
    try {
        let docURI = window.activeTextEditor?.document?.uri;
        if (docURI) {
            await autoUpdateInterpreter(docURI);
        }
    } catch (error) {
        logError("Error on initial Python interpreter auto-update.", error, "PYTHON_INITIAL_SET_INTERPRETER");
    }
}

export async function isMicrosoftPythonExtensionInstalled() {
    const extension = extensions.getExtension("ms-python.python");
    if (extension) {
        return true;
    }
    return false;
}

export async function isPyDevDebuggerPythonExtensionInstalled() {
    const extension = extensions.getExtension("fabioz.vscode-pydev-python-debugger");
    if (extension) {
        return true;
    }
    return false;
}

export async function disablePythonTerminalActivateEnvironment() {
    try {
        const extension = extensions.getExtension("ms-python.python");
        if (!extension) {
            return;
        }

        let configurationTarget: ConfigurationTarget = ConfigurationTarget.Workspace;
        let config = workspace.getConfiguration("python");
        await config.update("terminal.activateEnvironment", false, configurationTarget);
    } catch (error) {
        logError(
            "Error disabling python terminal activate environment.",
            error,
            "PYTHON_DISABLE_TERMINAL_ACTIVATE_ENVIRONMENT"
        );
    }
}

export async function setPythonInterpreterForPythonExtension(pythonExe: string, uri: Uri) {
    const extension = extensions.getExtension<MicrosoftPythonApi>("ms-python.python");
    if (!extension) {
        return;
    }

    // Note: always set it in the workspace!
    let configurationTarget: ConfigurationTarget = ConfigurationTarget.Workspace;

    OUTPUT_CHANNEL.appendLine("Setting the python executable path for vscode-python to be:\n" + pythonExe);
    if (!extension.isActive) {
        await extension.activate();
    }
    await extension.exports.ready;
    if (extension.exports.environments?.updateActiveEnvironmentPath) {
        await extension.exports.environments.updateActiveEnvironmentPath(pythonExe, uri);
    } else if (extension?.exports?.environment?.setActiveEnvironment !== undefined) {
        await extension.exports.environment.setActiveEnvironment(pythonExe, uri);
        // OUTPUT_CHANNEL.appendLine("Is: " + (await extension.exports.environment.getActiveInterpreterPath(uri)));
    } else {
        if (extension?.exports?.environment?.setActiveInterpreter !== undefined) {
            await extension.exports.environment.setActiveInterpreter(pythonExe, uri);
            // OUTPUT_CHANNEL.appendLine("Is: " + (await extension.exports.environment.getActiveInterpreterPath(uri)));
        } else {
            let config = workspace.getConfiguration("python", uri);
            const target = workspace.getWorkspaceFolder(uri) ? ConfigurationTarget.WorkspaceFolder : configurationTarget;
            await config.update("defaultInterpreterPath", pythonExe, target);

            try {
                await commands.executeCommand("python.clearWorkspaceInterpreter");
            } catch (err) {
                logError(
                    "Error calling python.clearWorkspaceInterpreter",
                    err,
                    "ACT_CLEAR_PYTHON_WORKSPACE_INTERPRETER"
                );
            }
        }
    }
    // Python 2026.10's public path API updates legacy storage. Environments owns a separate selection.
    const environments = await getPythonEnvironmentsApi(uri);
    if (environments?.resolveEnvironment && environments.setEnvironment) {
        const selected = await environments.resolveEnvironment(Uri.file(pythonExe));
        if (!selected) {
            OUTPUT_CHANNEL.appendLine(`Python Environments could not resolve ${pythonExe}; its selection was not changed.`);
            return;
        }
        await environments.setEnvironment(uri, selected);
    }
}

export async function getPythonExecutable(
    resource: Uri = null,
    forceLoadFromConfig: boolean = false,
    showInOutput: boolean = true
): Promise<string | undefined | "config"> {
    try {
        const extension = extensions.getExtension<MicrosoftPythonApi>("ms-python.python");
        if (!extension) {
            OUTPUT_CHANNEL.appendLine(
                "Unable to get python executable from vscode-python. ms-python.python extension not found."
            );
            return undefined;
        }

        // Detect the available API; current Python no longer needs the old experiment flag.
        {
            if (!extension.isActive) {
                const id = "activate-vscode-python-" + Date.now();
                handleProgressMessage({
                    kind: "begin",
                    id: id,
                    title: "Waiting for vscode-python activation...",
                });
                try {
                    await extension.activate();
                } finally {
                    handleProgressMessage({
                        kind: "end",
                        id: id,
                    });
                }
            }
            await extension.exports.ready;
            const environmentsApi = await getPythonEnvironmentsApi(resource);
            if (environmentsApi?.getEnvironment) {
                const selected = await environmentsApi.getEnvironment(resource);
                const executable = selected?.execInfo.run.executable;
                if (showInOutput) {
                    OUTPUT_CHANNEL.appendLine(`Python Environments selected executable: ${executable || "unresolved"}`);
                }
                return executable;
            }
            const environments = extension.exports.environments;
            if (environments?.getActiveEnvironmentPath && environments.resolveEnvironment) {
                const selected = environments.getActiveEnvironmentPath(resource);
                if (!selected) {
                    return undefined;
                }
                const resolved = await environments.resolveEnvironment(selected);
                const executable = resolved?.executable.uri?.fsPath;
                if (showInOutput) {
                    OUTPUT_CHANNEL.appendLine(`vscode-python selected environment: ${selected.path}; resolved executable: ${executable || "unresolved"}`);
                }
                return executable;
            }
            if (!extension.exports.settings?.getExecutionDetails) {
                if (!forceLoadFromConfig) {
                    return "config";
                }
                return workspace.getConfiguration("python", resource).get<string>("defaultInterpreterPath");
            }
            let execCommand = extension.exports.settings.getExecutionDetails(resource).execCommand;
            if (showInOutput) {
                OUTPUT_CHANNEL.appendLine("vscode-python execution details: " + execCommand);
            }
            if (!execCommand) {
                OUTPUT_CHANNEL.appendLine("vscode-python did not return proper execution details.");
                return undefined;
            }
            if (execCommand instanceof Array) {
                // It could be some composite command such as conda activate, but that's ok, we don't want to consider those
                // a match for our use-case.
                return execCommand.join(" ");
            }
            return execCommand;
        }
    } catch (error) {
        logError(
            "Error when querying about python executable path from vscode-python.",
            error,
            "PYTHON_EXT_NO_PYTHON_EXECUTABLE"
        );
        return undefined;
    }
}
