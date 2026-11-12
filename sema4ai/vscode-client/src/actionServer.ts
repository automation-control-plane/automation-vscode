import { CancellationToken, Progress, ProgressLocation, Terminal, Uri, window, commands, workspace, Memento } from "vscode";
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
import { assertRuntimePortAvailable, runtimeServerPort, waitForOwnedRuntimeStop } from "./runtimeServerConfig";
import { legacyVendorIntegrationsEnabled } from "./legacyIntegrations";
import { RuntimeOwnership, captureRuntimeOwnership, inspectRuntimeOwnership, parseRuntimeOwnership } from "./runtimeOwnership";

const ACTION_SERVER_DEFAULT_PORT = 8082;
const ACTION_SERVER_TERMINAL_NAME = "Automation: Action Server";
let ownedServer: { terminal: Terminal; port: number; directory: Uri } | undefined;
const RUNTIME_OWNERSHIP_KEY = "automation.runtimeOwnership.v1";
let ownershipState: Pick<Memento, "get" | "update"> | undefined;
let launchOwnership: RuntimeOwnership | undefined;

type RuntimeStatusBase = {message: string; port?: number; packageDirectory?: string};
export type RuntimeStatus = RuntimeStatusBase & (
    | {kind: "owned-running"; endpoint: string; canReconnect: boolean; terminalAvailable: boolean}
    | {kind: "not-started" | "unknown-listener" | "stale-owner" | "unavailable"}
);

/** Storage initialization is passive: activation does not reconnect, contact, or start any service. */
export function initializeRuntimeOwnership(state: Pick<Memento, "get" | "update">): void {
    ownershipState = state;
}

function savedRuntimeOwnership(): RuntimeOwnership | undefined {
    return launchOwnership || parseRuntimeOwnership(ownershipState?.get<unknown>(RUNTIME_OWNERSHIP_KEY));
}

async function saveRuntimeOwnership(record: RuntimeOwnership | undefined): Promise<void> {
    launchOwnership = record;
    try {await ownershipState?.update(RUNTIME_OWNERSHIP_KEY, record);}
    catch {OUTPUT_CHANNEL.appendLine("Runtime launch ownership could not be saved. Recovery after window reload is unavailable.");}
}

async function terminalProcessId(terminal: Terminal): Promise<number | undefined> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([Promise.resolve(terminal.processId), new Promise<undefined>(resolve => {
            timer = setTimeout(() => resolve(undefined), 1000);
        })]);
    } catch {return undefined;}
    finally {if (timer) clearTimeout(timer);}
}

async function retainedRuntimeTerminal(record: RuntimeOwnership): Promise<Terminal | undefined> {
    const matches = await Promise.all(window.terminals.map(async terminal =>
        terminal.exitStatus === undefined && await terminalProcessId(terminal) === record.processId ? terminal : undefined));
    const found = matches.filter(terminal => terminal !== undefined);
    return found.length === 1 ? found[0] : undefined;
}

/** Read-only status; PID, process birth, package and actual socket ownership must all agree. */
export async function getRuntimeStatus(directory?: Uri): Promise<RuntimeStatus> {
    const candidate = savedRuntimeOwnership();
    const record = candidate && (!directory || path.resolve(directory.fsPath) === candidate.directory) ? candidate : undefined;
    const packageDirectory = directory?.fsPath || record?.directory;
    let port: number;
    try {port = record?.port ?? getActionServerPort(directory);}
    catch (error) {return {kind: "unavailable", packageDirectory, message: String(error)};}
    const base = {port, packageDirectory};
    if (record) {
        const inspection = await inspectRuntimeOwnership(record);
        if (inspection.kind === "verified") {
            const terminal = await retainedRuntimeTerminal(record);
            return {...base, kind: "owned-running", endpoint: `http://127.0.0.1:${port}`,
                canReconnect: !!terminal && terminal !== getActionServerTerminal(), terminalAvailable: !!terminal,
                message: terminal && terminal === ownedServer?.terminal ? "Owned Runtime is running for this package." :
                    terminal ? "Your Runtime survived the window reload. Reconnect to its existing terminal." :
                        "The recorded Runtime is verified, but its terminal was not restored. Open it without starting a replacement."};
        }
        if (inspection.kind === "unverified-listener") return {...base, kind: "unknown-listener",
            message: "This port is held by a listener outside the recorded Runtime process tree. It will not be adopted, contacted or stopped."};
        if (inspection.kind === "unavailable") return {...base, kind: "unavailable",
            message: "Runtime process ownership cannot be verified on this host. Existing listeners are left running; no automatic reconnect is allowed."};
        if (inspection.kind === "not-listening") return {...base, kind: "unavailable",
            message: "The owned launch process is present but no verified Runtime listener is ready. Check its terminal, then refresh."};
        return {...base, kind: "stale-owner",
            message: "The saved Runtime launch is no longer the same live process. It cannot be reconnected or stopped from this record."};
    }
    try {
        await assertRuntimePortAvailable(port);
        return {...base, kind: "not-started", message: "No owned Runtime is running for this package. Start it explicitly when needed."};
    } catch (error) {
        return {...base, kind: String(error).includes("EADDRINUSE") ? "unknown-listener" : "unavailable",
            message: "This port is unavailable and there is no verified launch record for this package. Existing listeners are left running."};
    }
}

/** Explicit recovery only; this never sends a signal, shutdown request, or replacement launch. */
export async function reconnectActionServer(directory: Uri): Promise<boolean> {
    const status = await getRuntimeStatus(directory);
    const record = savedRuntimeOwnership();
    if (status.kind !== "owned-running" || !record || record.directory !== path.resolve(directory.fsPath)) {
        window.showErrorMessage(status.message);
        return false;
    }
    const terminal = await retainedRuntimeTerminal(record);
    if (!terminal || (await inspectRuntimeOwnership(record)).kind !== "verified") {
        window.showErrorMessage("The Runtime terminal or process identity changed. Nothing was reconnected or stopped.");
        return false;
    }
    ownedServer = {terminal, port: record.port, directory: Uri.file(record.directory)};
    terminal.show();
    return true;
}

export const getActionServerPort = (resource?: Uri): number =>
    runtimeServerPort(workspace.getConfiguration("sema4ai", resource).get<number>("actionServer.port", ACTION_SERVER_DEFAULT_PORT));

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

export const isActionServerAlive = async (port: number = ownedServer?.port ?? getActionServerPort()) => {
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
        req.setTimeout(2000, () => req.destroy(new Error("Actions Runtime request timed out.")));

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
        hostname: "127.0.0.1",
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

export const getActionServerTerminal = (): undefined | Terminal => {
    if (ownedServer && window.terminals.includes(ownedServer.terminal) && ownedServer.terminal.exitStatus === undefined) {
        return ownedServer.terminal;
    }
    ownedServer = undefined;
    return undefined;
};

const disposeActionServerTerminal = (terminal: Terminal) => {
    if (ownedServer?.terminal === terminal) {
        ownedServer = undefined;
    }
    terminal.dispose();
    /**
     * @TODO:
     * Verify whether unsetting the reference is necessary.
     * If not, this function can be removed in favour of calling terminal.dispose() in the caller.
     */
    terminal = undefined;
};

const stopActionServer = async (): Promise<boolean> => {
    const server = ownedServer;
    let actionServerTerminal: Terminal = getActionServerTerminal();
    if (!server || !actionServerTerminal) {
        return true;
    }
    // Dispose only our launch process. An HTTP port may have been rebound by an unrelated service.
    try {
        const processId = await actionServerTerminal.processId;
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                closed.dispose();
                reject(new Error("Actions Runtime terminal did not close. Existing listeners were left untouched."));
            }, 5000);
            const closed = window.onDidCloseTerminal(terminal => {
                if (terminal === actionServerTerminal) {
                    clearTimeout(timer);
                    closed.dispose();
                    resolve();
                }
            });
            disposeActionServerTerminal(actionServerTerminal);
        });
        OUTPUT_CHANNEL.appendLine(`Waiting for owned Actions Runtime to exit and release 127.0.0.1:${server.port}.`);
        await waitForOwnedRuntimeStop({port: server.port, processId});
        await saveRuntimeOwnership(undefined);
        return true;
    } catch (error) {
        OUTPUT_CHANNEL.appendLine(String(error));
        window.showErrorMessage(String(error));
        return false;
    }
};

const startActionServerInternal = async (directory: Uri) => {
    if (!directory) {
        return;
    }
    let actionServerTerminal: Terminal = getActionServerTerminal();
    let port: number;
    try {
        port = getActionServerPort(directory);
        await assertRuntimePortAvailable(port);
    } catch (error) {
        window.showErrorMessage(String(error));
        return;
    }

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
        if (legacyVendorIntegrationsEnabled() && !env.SEMA4AI_CREDENTIAL_API) {
            credentialApi = await langServer.sendRequest("getExternalApiUrl");
        }
        if (
            legacyVendorIntegrationsEnabled() && !env.SEMA4AI_DATA_SERVER_INFO &&
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

    const dataDirectory = path.join(env.ACTIONS_HOME, "action-server",
        "vscode-" + createHash("sha256").update(directory.fsPath).digest("hex").slice(0, 12));
    actionServerTerminal = window.createTerminal({
        name: ACTION_SERVER_TERMINAL_NAME,
        env: env,
        cwd: directory,
        shellPath: location,
        shellArgs: [
            "start",
            "--address=127.0.0.1",
            `--port=${port}`,
            "--datadir=" + dataDirectory,
        ],
    });
    ownedServer = {terminal: actionServerTerminal, port, directory};

    actionServerTerminal.show();
    OUTPUT_CHANNEL.appendLine(`Starting Actions Runtime (in terminal): ${location}; URL: http://127.0.0.1:${port}`);
    await saveRuntimeOwnership(undefined);
    const processId = await terminalProcessId(actionServerTerminal);
    if (processId !== undefined) {
        const deadline = Date.now() + 2000;
        let record: RuntimeOwnership | undefined;
        do {
            record = await captureRuntimeOwnership({processId, directory: directory.fsPath,
                executable: location, dataDirectory, port});
            if (record || process.platform !== "linux" || Date.now() >= deadline) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        } while (window.terminals.includes(actionServerTerminal) && actionServerTerminal.exitStatus === undefined);
        if (record) await saveRuntimeOwnership(record);
        else OUTPUT_CHANNEL.appendLine("Runtime started, but a stable process identity is unavailable. Recovery after reload will remain blocked.");
    }
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
    if (!directory) return;

    let actionServerTerminal: Terminal = getActionServerTerminal();
    if (!actionServerTerminal && savedRuntimeOwnership()) {
        const status = await getRuntimeStatus(directory);
        if (status.kind === "owned-running") {
            if (status.canReconnect && await window.showWarningMessage(status.message, "Reconnect to Runtime", "Cancel") === "Reconnect to Runtime") {
                await reconnectActionServer(directory);
            } else if (!status.canReconnect) window.showWarningMessage(status.message);
            return;
        }
    }
    if (actionServerTerminal !== undefined) {
        if (await isActionServerAlive()) {
            const RESTART = "Restart action server";
            const option = await window.showWarningMessage(
                "The action server seems to be running already. How do you want to proceed?",
                RESTART,
                "Cancel"
            );
            if (option !== RESTART) {
                return;
            }

            if (!(await stopActionServer())) {
                return;
            }
        } else {
            OUTPUT_CHANNEL.appendLine("Action server not alive.");

            if (!(await stopActionServer())) {
                return;
            }
        }
    }

    await startActionServerInternal(directory);
};

export const restartActionServer = async (directory: Uri) => {
    if (!(await stopActionServer())) {
        return;
    }
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
