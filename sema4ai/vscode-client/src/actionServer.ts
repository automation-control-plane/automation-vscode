import { CancellationToken, Progress, ProgressLocation, Terminal, Uri, window, commands, workspace } from "vscode";
import * as roboCommands from "./robocorpCommands";
import { createEnvWithRobocorpHome, getRobocorpHome } from "./rcc";
import path = require("path");
import { OUTPUT_CHANNEL } from "./channel";
import * as http from "http";
import * as fs from "fs";
import { listAndAskRobotSelection } from "./activities";
import { ActionResult, ActionServerVerifyLoginOutput, ActionServerListOrganizationsOutput } from "./protocols";
import { Tool, getToolVersion, downloadTool } from "./tools";
import { langServer } from "./extension";
import { DATA_SERVER_STATUS_COMMAND_ID, fetchDataServerStatus } from "./dataExtension";
import { convertDataServerInfoToEnvVar } from "./robo/actionPackage";
import { createHash } from "crypto";
import { withStudioEnvironment } from "./runtimePaths";

const ACTION_SERVER_DEFAULT_PORT = 8082;
const ACTION_SERVER_TERMINAL_NAME = "Sema4.ai: Action Server";

function downloadActionServer(): Thenable<string> {
    return downloadTool(Tool.ActionServer);
}

export const getActionServerVersion = async (): Promise<string> => {
    return getToolVersion(Tool.ActionServer);
};

export const downloadOrGetActionServerLocation = async (): Promise<string | undefined> => {
    const configured =
        workspace.getConfiguration("sema4ai").get<string>("actionServer.location") ||
        process.env.ACTIONS_RUNTIME_LOCATION;
    if (configured) {
        if (!fs.existsSync(configured)) {
            throw new Error("Configured Actions Runtime executable does not exist: " + configured);
        }
        return configured;
    }
    return await downloadActionServer();
};

export const isActionServerAlive = async (port: number = ACTION_SERVER_DEFAULT_PORT) => {
    try {
        await fetchData(port, "/openapi.json", "GET");
        return true;
    } catch (err) {
        return false;
    }
};

function makeRequest(postData: string, options: http.RequestOptions): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let responseData = "";

            res.setEncoding("utf8");
            res.on("data", (chunk) => {
                responseData += chunk;
            });

            res.on("end", () => {
                if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(`Action Server HTTP ${res.statusCode} for ${options.method} ${options.path}`));
                    return;
                }
                resolve(responseData);
            });
        });

        req.on("error", (error) => {
            reject(error);
        });

        req.write(postData);
        req.end();
    });
}

/**
 * @param path this is the path in the host (i.e.: /api-endpoint)
 */
async function fetchData(port: number, path: string, method: "POST" | "GET") {
    const postData = JSON.stringify({});

    const options: http.RequestOptions = {
        hostname: "localhost",
        port: port,
        path: path,
        method: method,
        headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
        },
    };

    return await makeRequest(postData, options);
}

const shutdownExistingActionServer = async (port) => {
    await fetchData(port, "/api/shutdown/", "POST");
};

export const getActionServerTerminal = (): undefined | Terminal => {
    for (const terminal of window.terminals) {
        if (terminal.name === ACTION_SERVER_TERMINAL_NAME) {
            return terminal;
        }
    }
    return undefined;
};

const disposeActionServerTerminal = (terminal: Terminal) => {
    terminal.dispose();
    /**
     * @TODO:
     * Verify whether unsetting the reference is necessary.
     * If not, this function can be removed in favour of calling terminal.dispose() in the caller.
     */
    terminal = undefined;
};

const stopActionServer = async () => {
    let actionServerTerminal: Terminal = getActionServerTerminal();

    await shutdownExistingActionServer(ACTION_SERVER_DEFAULT_PORT);
    disposeActionServerTerminal(actionServerTerminal);
};

const startActionServerInternal = async (directory: Uri) => {
    let actionServerTerminal: Terminal = getActionServerTerminal();

    const location = await downloadOrGetActionServerLocation();
    if (!location) {
        return;
    }

    let env = createEnvWithRobocorpHome(await getRobocorpHome());
    // Retain separately installed Studio/Data integrations. Local startup must
    // also work when those optional backends are absent.
    let credentialApi: string | undefined;
    let dataServerInfo: string | undefined;
    try {
        if (!env.SEMA4AI_CREDENTIAL_API) {
            credentialApi = await langServer.sendRequest("getExternalApiUrl");
        }
        if (
            !env.SEMA4AI_DATA_SERVER_INFO &&
            (await commands.getCommands(true)).includes(DATA_SERVER_STATUS_COMMAND_ID)
        ) {
            const status = await fetchDataServerStatus();
            if (status?.data) {
                dataServerInfo = convertDataServerInfoToEnvVar(status.data);
            }
        }
    } catch (error) {
        OUTPUT_CHANNEL.appendLine("Optional Studio/Data backend discovery failed: " + error);
        window.showWarningMessage("The Studio/Data backend could not be loaded. See the SDK output for details.");
    }
    env = withStudioEnvironment(env, credentialApi, dataServerInfo);
    env["RC_ADD_SHUTDOWN_API"] = "1";
    env["ACTIONS_SKIP_UPDATE_CHECK"] = "1";

    actionServerTerminal = window.createTerminal({
        name: "Sema4.ai: Action Server",
        env: env,
        cwd: directory,
        shellPath: location,
        shellArgs: [
            "start",
            `--port=${ACTION_SERVER_DEFAULT_PORT}`,
            "--datadir=" +
                path.join(
                    env.ACTIONS_HOME,
                    "action-server",
                    "vscode-" + createHash("sha256").update(directory.fsPath).digest("hex").slice(0, 12)
                ),
        ],
    });

    actionServerTerminal.show();
    OUTPUT_CHANNEL.appendLine("Starting action-server (in terminal): " + location);
};

export const findActionPackagePath = async ({ includeSemaOrg = true } = {}): Promise<Uri | undefined> => {
    // Need to list the action packages available to decide
    // which one to use for the action server.
    const selected = await listAndAskRobotSelection(
        "Please select the Action Package from which the Action Server should load actions.",
        "Unable to start Action Server because no Action Package was found in the workspace.",
        { showActionPackages: true, showTaskPackages: false, showAgentPackages: false, includeSemaOrg: includeSemaOrg }
    );
    if (!selected) {
        return;
    }
    return Uri.file(selected.directory);
};

export const startActionServer = async (directory: Uri) => {
    if (!directory) {
        directory = await findActionPackagePath();
    }

    let actionServerTerminal: Terminal = getActionServerTerminal();
    if (actionServerTerminal !== undefined) {
        if (await isActionServerAlive(ACTION_SERVER_DEFAULT_PORT)) {
            const RESTART = "Restart action server";
            const option = await window.showWarningMessage(
                "The action server seems to be running already. How do you want to proceed?",
                RESTART,
                "Cancel"
            );
            if (option !== RESTART) {
                return;
            }

            await stopActionServer();
        } else {
            OUTPUT_CHANNEL.appendLine("Action server not alive.");

            /* Called just in case to ensure ActionServer terminal is not active. */
            disposeActionServerTerminal(actionServerTerminal);
        }
    }

    await startActionServerInternal(directory);
};

export const restartActionServer = async (directory: Uri) => {
    await stopActionServer();
    await startActionServerInternal(directory);
};

const askForAccessCredentials = async (): Promise<string | undefined> => {
    const access_credentials: string = await window.showInputBox({
        "placeHolder": "Control Room Access Credentials",
        "prompt": "Please provide the Control Room access credentials.",
        "ignoreFocusOut": true,
        "password": true,
        "validateInput": (access_credentials: string): string | Thenable<string> => {
            const regex = /^\d{1,}:.{11,}$/;
            if (!access_credentials || !regex.test(access_credentials)) {
                return "Invalid access credentials: use form 1234:xxx...x";
            }
        },
    });

    return access_credentials;
};

export const verifyLogin = async (): Promise<ActionServerVerifyLoginOutput | undefined> => {
    const result: ActionResult<ActionServerVerifyLoginOutput> = await commands.executeCommand(
        roboCommands.SEMA4AI_ACTION_SERVER_CLOUD_VERIFY_LOGIN_INTERNAL
    );

    if (!result.success) {
        window.showErrorMessage(`Failed to verify login: ${result.message}`);
        return;
    }

    return result.result;
};

const askUserForHostname = async (
    progress: Progress<{ message?: string; increment?: number }>
): Promise<string | undefined> => {
    let defaultHostname = "https://us1.robocorp.com";

    progress.report({ message: "Getting default hostname" });
    const loginOutput = await verifyLogin();
    if (loginOutput && loginOutput.logged_in) {
        defaultHostname = loginOutput.hostname;
    }

    progress.report({ message: "Input hostname" });
    const hostname: string = await window.showInputBox({
        "value": defaultHostname,
        "prompt": "Please provide the Control Room hostname.",
        "ignoreFocusOut": true,
        "validateInput": (hostname: string): string | Thenable<string> => {
            if (!hostname) {
                return "Provide valid hostname";
            }
        },
    });

    return hostname;
};

export const actionServerCloudLogin = async () => {
    await window.withProgress(
        {
            location: ProgressLocation.Notification,
            title: "Action Server Login",
            cancellable: false,
        },
        async (
            progress: Progress<{ message?: string; increment?: number }>,
            token: CancellationToken
        ): Promise<void> => {
            progress.report({ message: "Validating action server" });
            const actionServerLocation = await downloadOrGetActionServerLocation();
            if (!actionServerLocation) {
                return;
            }

            progress.report({ message: "Input access credentials" });
            const accessCredentials = await askForAccessCredentials();
            if (!accessCredentials) {
                return;
            }

            const hostname = await askUserForHostname(progress);
            if (!hostname) {
                return;
            }

            progress.report({ message: "Logging in" });
            const result: ActionResult<undefined> = await commands.executeCommand(
                roboCommands.SEMA4AI_ACTION_SERVER_CLOUD_LOGIN_INTERNAL,
                {
                    access_credentials: accessCredentials,
                    hostname,
                }
            );

            if (result.success) {
                window.showInformationMessage("Action Server Control Room login successful.");
            } else {
                window.showErrorMessage(`Action Server Control Room login failed: ${result.message}`);
            }
        }
    );
};

export const listOrganizations = async (): Promise<ActionServerListOrganizationsOutput> => {
    const result: ActionResult<ActionServerListOrganizationsOutput> = await commands.executeCommand(
        roboCommands.SEMA4AI_ACTION_SERVER_CLOUD_LIST_ORGANIZATIONS_INTERNAL,
        {}
    );
    if (!result.success) {
        window.showErrorMessage("No organizations found");
        return [];
    }

    return result.result;
};
