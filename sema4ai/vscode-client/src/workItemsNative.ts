import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { randomBytes } from "crypto";
import { resolveInterpreter } from "./activities";
import { getSelectedRobot } from "./viewsSelection";
import { SEMA4AI_LIST_ACTIONS_INTERNAL } from "./robocorpCommands";
import { WorkItemsRuntimeClient } from "./workItemsRuntimeClient";
import { ManagedWorkItemsView } from "./managedWorkItemsView";
import { proposeWorkItemPayload } from "./workItemProposals";

export const OPEN_NATIVE_WORK_ITEMS = "automation.workItems.open";
type Mode = "file" | "sqlite" | "published" | "managed";
interface Item { id: string; payload?: Record<string, unknown>; files?: string[]; revision?: string; state?: string; }
interface Request { op: string; mode: Mode; id?: string; queue?: string; name?: string; payload?: unknown; revision?: string; parameters?: unknown; }
interface LocalResult { receipts?: ({id: string; [key: string]: unknown})[]; items?: Item[]; id?: string; env?: Record<string, string>; parameters?: string; content?: string; }

/** One editor per package, scoped to the package selected by the trusted host. */
export function registerNativeWorkItems(context: vscode.ExtensionContext): void {
    const panels = new Map<string, {panel: vscode.WebviewPanel; select: (id: string) => void; refresh: () => Promise<void>}>();
    const packageStates = new Map<string, {sessions: Map<string, vscode.DebugSession>; runs: Set<string>; listening: boolean; pending: Promise<unknown>; call?: (request: Request & Record<string, unknown>) => Promise<LocalResult>}>();
    const editorDrafts = new Map<string, unknown>();
    context.subscriptions.push(vscode.commands.registerCommand(OPEN_NATIVE_WORK_ITEMS, async (item?: {filePath?: string}) => {
        if (!vscode.workspace.isTrusted) {
            await vscode.window.showErrorMessage("Trust this workspace before loading its Work Items interpreter.");
            return;
        }
        const selected = getSelectedRobot();
        const manifest = selected?.robot?.filePath || selected?.uri?.fsPath;
        if (!manifest || !["package.yaml", "robot.yaml"].includes(path.basename(manifest))) {
            await vscode.window.showInformationMessage("Select an Action Package or Robot Task in Automation first.");
            return;
        }
        const key = path.resolve(manifest);
        const editorStateKey = "workItems.editor.v1." + require("crypto").createHash("sha256").update(key).digest("hex");
        if (panels.has(key)) {
            const existing = panels.get(key);
            existing.panel.reveal();
            if (item?.filePath) existing.select(path.relative(path.dirname(key), item.filePath) + "#0");
            return;
        }
        const panel = vscode.window.createWebviewPanel("automation.workItems", "Runbook: " + path.basename(path.dirname(key)),
            vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [] });
        panels.set(key, {panel, refresh, select: id => {mode = "file"; selectId = id; void refresh().catch(() => undefined);}});
        const managed = new ManagedWorkItemsView(context, key, message => panel.webview.postMessage(message));
        const nonce = randomBytes(24).toString("hex");
        panel.webview.html = editorHtml(nonce);
        let mode: Mode = "file", queue = "input", busy = Promise.resolve();
        if (!packageStates.has(key)) packageStates.set(key, {sessions: new Map(), runs: new Set(), listening: false, pending: Promise.resolve()});
        const packageState = packageStates.get(key);
        const sessions = packageState.sessions, runs = packageState.runs;
        let disposed = false;
        let runtime: WorkItemsRuntimeClient | undefined;
        let selectId: string | undefined = item?.filePath ? path.relative(path.dirname(key), item.filePath) + "#0" : undefined;
        function local(request: Request & Record<string, unknown>): Promise<LocalResult> {
            if (!packageState.call) packageState.call = request => {
                const result = packageState.pending.then(() => invoke(request));
                packageState.pending = result.catch(() => undefined);
                return result;
            };
            return packageState.call(request);
        }
        async function invoke(request: Request & Record<string, unknown>): Promise<LocalResult> {
            if (!vscode.workspace.isTrusted) throw Error("Workspace trust is required for Work Items execution.");
            const resolved = await resolveInterpreter(key);
            if (!resolved.success || !resolved.result?.pythonExe) throw Error(resolved.message || "Package interpreter is unavailable.");
            const interpreter = resolved.result;
            return new Promise((resolve, reject) => {
                const child = execFile(interpreter.pythonExe, [path.join(context.extensionPath, "src/sema4ai_code/work_items_native.py")],
                    { cwd: path.dirname(key), env: { ...process.env, ...interpreter.environ }, timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
                    (error, stdout) => {
                        try {
                            const value = JSON.parse(stdout);
                            if (!value.success) reject(Error(value.message)); else resolve(value.result);
                        } catch { reject(Error(error ? "Work Items bridge failed. Check the selected package's owned SDK installation." : "Invalid Work Items bridge response.")); }
                    });
                child.stdin.on("error", () => undefined); // execFile callback reports a closed/failed helper.
                child.stdin.end(JSON.stringify({ ...request, manifest: key }));
            });
        }
        async function refresh(): Promise<void> {
            if (mode === "managed") {await managed.refresh(); return;}
            if (mode === "published") {
                if (!runtime) {
                    await panel.webview.postMessage({ type: "unsupported", message: "Connect an authenticated published Runtime. Runtime 1.0.4 supports item and attachment management. Managed execution, retry, cancellation and review require a compatible Runtime capability; local modes remain separate." });
                    return;
                }
                const state = await runtime.list(queue);
                await panel.webview.postMessage({ type: "state", ...state, package: key, mode, queue,
                    authority: "Authenticated Runtime 1.0.4: " + runtime.endpoint + ". Published item/attachment APIs; durable Run/Attempt/review lifecycle is unavailable." });
                return;
            }
            const state = await local({ op: "list", mode, queue });
            if (!disposed) await panel.webview.postMessage({ type: "state", ...state, receipts: state.receipts?.map(receipt => ({...receipt, session_active: sessions.has(receipt.id)})), package: key, mode, queue, selectId });
            selectId = undefined;
        }
        const lifecycle = packageState.listening ? [] : [
            vscode.debug.registerDebugAdapterTrackerFactory("*", {
                createDebugAdapterTracker: session => ({ onDidSendMessage: message => {
                    if (message.type !== "event" || message.event !== "exited") return;
                    for (const id of runs) if (session.name === "Work Item " + id) {
                        void local({op: "receipt", mode: "file", id, state: "EXITED", exit_code: message.body?.exitCode, session: session.id})
                            .then(() => panels.get(key)?.refresh()).catch(() => undefined);
                    }
                } }),
            }),
            vscode.debug.onDidStartDebugSession(session => {
                for (const id of runs) if (session.name === "Work Item " + id) {
                    sessions.set(id, session);
                    void local({ op: "receipt", mode: "file", id, state: "STARTED", session: session.id }).then(() => panels.get(key)?.refresh()).catch(() => undefined);
                }
            }),
            vscode.debug.onDidTerminateDebugSession(session => {
                for (const [id, owned] of sessions) if (owned.id === session.id) {
                    sessions.delete(id);
                    void local({ op: "receipt", mode: "file", id, state: "TERMINATED", session: session.id }).then(() => panels.get(key)?.refresh()).catch(() => undefined);
                }
            }),
        ];
        packageState.listening = true;
        context.subscriptions.push(...lifecycle);
        const listener = panel.webview.onDidReceiveMessage(message => {
                // UI drafts use VS Code's existing memento, independently of
                // task/model/network operations. Closing a panel must not drop
                // edits queued behind an interpreter or model request.
                if (message?.op === "openLogs") {
                    void vscode.commands.executeCommand("sema4ai.python.view.output.focus");
                    return;
                }
                if (message?.op === "restoreEditorDraft") {
                    const state = editorDrafts.get(key) || context.workspaceState.get(editorStateKey);
                    void panel.webview.postMessage({type: "editorDraftRestore", state});
                    return;
                }
                if (message?.op === "editorDraftState") {
                    try {
                        const state = message.state;
                        if (!state || state.version !== 1 || !["file", "sqlite", "published", "managed"].includes(state.mode) ||
                            typeof state.name !== "string" || typeof state.queue !== "string" || state.name.length > 80 || state.queue.length > 80 ||
                            !Array.isArray(state.drafts) || state.drafts.length > 100 || Buffer.byteLength(JSON.stringify(state)) > 4 * 1024 * 1024) throw Error("Editor draft state exceeds the supported bounds. Keep this tab open and save the input.");
                        const allowed = ["version", "mode", "queue", "name", "activeKey", "selectedId", "revision", "dirty", "root", "error", "parameters", "managedRoot", "replaySource", "runbookView", "receiptKey", "drafts"];
                        if (state.receiptKey !== undefined && (typeof state.receiptKey !== "string" || state.receiptKey.length > 16384)) throw Error("Invalid execution presentation state.");
                        if (state.runbookView && (!["prepare", "run", "inspect"].includes(state.runbookView.stage) || !["inputs", "files", "result"].includes(state.runbookView.tab) || Object.keys(state.runbookView).some(name => !["stage", "tab"].includes(name)))) throw Error("Invalid Runbook presentation state.");
                        if (Object.keys(state).some(name => !allowed.includes(name))) throw Error("Invalid editor draft state.");
                        editorDrafts.set(key, state);
                        void Promise.resolve(context.workspaceState.update(editorStateKey, state)).catch(() => panel.webview.postMessage({type: "error", message: "Unable to preserve this draft in editor state. Keep the tab open and save the input."}));
                    } catch (error) {void panel.webview.postMessage({type: "error", message: error.message});}
                    return;
                }
                busy = busy.then(async () => {
                    if (!vscode.workspace.isTrusted) throw Error("Workspace trust is required for Work Items.");
                    if (!message || typeof message.op !== "string") throw Error("Invalid editor request.");
                    await panel.webview.postMessage({ type: "loading" });
                    if (message.op === "discardDraft") {
                        const answer = await vscode.window.showWarningMessage("Discard this unsaved input draft? Saved items and outputs stay unchanged.", {modal: true}, "Discard draft");
                        if (answer === "Discard draft") await panel.webview.postMessage({type: "draftDiscarded"});
                        await refresh(); return;
                    }
                    if (message.op === "proposePayload") {
                        const json = await proposeWorkItemPayload(message.instructions);
                        if (json !== undefined) await panel.webview.postMessage({type: "payload-proposal", json, mode, input_id: message.id});
                        else await panel.webview.postMessage({type: "proposal-cancelled"});
                        return;
                    }
                    if (message.op.startsWith("managed.")) {
                        if (mode !== "managed") throw Error("Select canonical Managed Runtime mode first.");
                        await managed.handle(message); return;
                    }
                    if (message.op === "mode") {
                        if (!["file", "sqlite", "published", "managed"].includes(message.mode)) throw Error("Unknown Work Items mode.");
                        mode = message.mode; queue = message.queue || "input";
                    } else if (message.op === "refresh") { /* refresh below */ }
                    else if (message.op === "connect") {
                        const endpoint = await vscode.window.showInputBox({ prompt: "Authenticated Runtime origin (HTTPS, or HTTP loopback)", value: context.workspaceState.get("workItems.endpoint." + key, "http://127.0.0.1:8082"), ignoreFocusOut: true });
                        if (!endpoint) { await refresh(); return; }
                        // SecretStorage is scoped by package AND origin. The token never enters the webview or workspace files.
                        const secretKey = "workItems.token." + require("crypto").createHash("sha256").update(key + "\n" + endpoint).digest("hex");
                        const existing = await context.secrets.get(secretKey);
                        const entered = await vscode.window.showInputBox({ prompt: existing ? "Runtime API token; leave empty to reuse this package's stored token, Escape to cancel" : "Runtime API token (stored in VS Code SecretStorage after successful verification)", password: true, ignoreFocusOut: true });
                        if (entered === undefined) { await refresh(); return; }
                        const token = entered || existing;
                        if (!token) throw Error("An explicit Runtime API token is required.");
                        runtime = undefined;
                        const client = new WorkItemsRuntimeClient(endpoint, token);
                        await client.connect();
                        await context.secrets.store(secretKey, token);
                        await context.workspaceState.update("workItems.endpoint." + key, endpoint);
                        runtime = client;
                    }
                    else if (message.op === "cancel") {
                        const session = sessions.get(message.id);
                        if (!session) throw Error("No active extension-owned debug session for this receipt.");
                        const confirmed = await vscode.window.showWarningMessage("Stop this local Work Item execution? SQLite claim recovery follows the SDK's orphan timeout; this is not a managed cancellation.", { modal: true }, "Stop execution");
                        if (confirmed === "Stop execution") {
                            await vscode.debug.stopDebugging(session);
                            await local({op: "receipt", mode: "file", id: message.id, state: "CANCELLED", session: session.id});
                        }
                    } else {
                        if (mode === "published") {
                            if (!runtime) throw Error("Connect an authenticated Runtime first.");
                            if (message.op === "create") {
                                const payload = message.payload;
                                if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw Error("Payload must be a JSON object.");
                                const confirmed = await vscode.window.showWarningMessage(`Enqueue a new item in Runtime queue ${queue} at ${runtime.endpoint}?`, {modal: true}, "Enqueue item");
                                if (confirmed === "Enqueue item") await runtime.seed(queue, payload);
                            } else if (message.op === "attach") {
                                const chosen = await vscode.window.showOpenDialog({canSelectMany: false, openLabel: "Upload to Runtime Work Item"});
                                if (chosen?.length) {
                                    const stat = await vscode.workspace.fs.stat(chosen[0]);
                                    if (stat.size > 2 * 1024 * 1024) throw Error("Attachment exceeds the 2 MiB editor limit.");
                                    const confirmed = await vscode.window.showWarningMessage(`Upload this attachment to ${runtime.endpoint}?`, {modal: true}, "Upload attachment");
                                    if (confirmed === "Upload attachment") await runtime.attach(message.id, path.basename(chosen[0].fsPath), Buffer.from(await vscode.workspace.fs.readFile(chosen[0])));
                                }
                            } else if (message.op === "download") {
                                const content = await runtime.download(message.id, message.name);
                                const target = await vscode.window.showSaveDialog({saveLabel: "Save Runtime attachment copy"});
                                if (target) {
                                    try {await vscode.workspace.fs.stat(target); throw Error("Destination exists. Choose a new filename.");}
                                    catch (error) {if (!(error instanceof vscode.FileSystemError && error.code === "FileNotFound")) throw error;}
                                    await vscode.workspace.fs.writeFile(target, content);
                                }
                            } else throw Error("Runtime 1.0.4 does not support this managed lifecycle operation. Connect a Runtime with a verified compatible capability.");
                            await refresh(); return;
                        }
                        const request: Request & Record<string, unknown> = { op: message.op, mode, queue };
                        for (const field of ["id", "name", "payload", "revision", "parameters", "source_payload"]) if (message[field] !== undefined) request[field] = message[field];
                        if (message.op === "attach") {
                            const chosen = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: "Attach to Work Item" });
                            if (!chosen?.length) { await refresh(); return; }
                            const stat = await vscode.workspace.fs.stat(chosen[0]);
                            if (stat.size > 2 * 1024 * 1024) throw Error("Attachment exceeds the 2 MiB local editor limit.");
                            request.name = path.basename(chosen[0].fsPath);
                            request.files = { [request.name]: Buffer.from(await vscode.workspace.fs.readFile(chosen[0])).toString("base64") };
                        } else if (message.op === "download") {
                            const result = await local(request);
                            const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(path.dirname(key), String(request.name))) });
                            if (target) {
                                try { await vscode.workspace.fs.stat(target); throw Error("Destination exists. Choose a new filename; existing data was preserved."); }
                                catch (error) { if (!(error instanceof vscode.FileSystemError && error.code === "FileNotFound")) throw error; }
                                await vscode.workspace.fs.writeFile(target, Buffer.from(result.content, "base64"));
                            }
                            await refresh(); return;
                        } else if (message.op === "run" || message.op === "debug") {
                            if (mode === "file" && request.payload !== undefined) await local({...request, op: "save"});
                            const prepared = await local({ ...request, op: "prepare" });
                            const config: vscode.DebugConfiguration = { type: "sema4ai", request: "launch", name: "Work Item " + prepared.id,
                                noDebug: message.op === "run", automationWorkItems: prepared.env };
                            if (path.basename(key) === "package.yaml") {
                                const result = await vscode.commands.executeCommand<{success: boolean; result: {name: string; uri: string}[]; message?: string}>(
                                    SEMA4AI_LIST_ACTIONS_INTERNAL, { action_package: vscode.Uri.file(key).toString() });
                                if (!result?.success) throw Error(result?.message || "Unable to discover package Actions.");
                                const chosen = await vscode.window.showQuickPick(result.result.map(action => ({ label: action.name, action })), { placeHolder: "Run selected Work Item with Action" });
                                if (!chosen) { await refresh(); return; }
                                Object.assign(config, { package: key, actionName: chosen.action.name, uri: chosen.action.uri, jsonInput: prepared.parameters });
                            } else {
                                const task = await vscode.window.showQuickPick(Object.keys(selected.robot?.yamlContents?.["tasks"] || {}), { placeHolder: "Run selected Work Item with Robot task" });
                                if (!task) { await refresh(); return; }
                                Object.assign(config, { robot: key, task });
                            }
                            runs.add(prepared.id);
                            const started = await vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(vscode.Uri.file(key)), config);
                            if (!started) await local({ op: "receipt", mode, id: prepared.id, state: "LAUNCH_REJECTED" });
                            await refresh(); return;
                        } else if (message.op === "contract") {
                            const confirmed = await vscode.window.showWarningMessage("Save this package's required payload field types? This affects subsequent local creates, saves and launches.", {modal: true}, "Save field types");
                            if (confirmed !== "Save field types") {await refresh(); return;}
                        } else if (message.op === "recover") {
                            const confirmed = await vscode.window.showWarningMessage("Recover expired SQLite claims in this package? The SDK uses its configured orphan timeout (default 30 minutes) across this package database. This is local development recovery, not a fenced managed retry.", {modal: true}, "Recover expired claims");
                            if (confirmed !== "Recover expired claims") {await refresh(); return;}
                        } else if (!["create", "save", "replay"].includes(message.op)) throw Error("Unsupported editor operation.");
                        const result = await local(request);
                        if (message.op === "create" || message.op === "replay") selectId = result.id;
                    }
                    await refresh();
                }).catch(async error => { if (!disposed) await panel.webview.postMessage({ type: "error", message: error.message }); });
            });
        panel.onDidDispose(() => { disposed = true; panels.delete(key); listener.dispose(); });
    }));
}

function editorHtml(nonce: string): string {
    const resource = (name: string) => fs.readFileSync(path.join(__dirname, "../../resources/work-items", name), "utf8");
    const values = {
        nonce,
        style: ["theme.css", "codicon.css"].map(name => fs.readFileSync(path.join(__dirname, "../../resources/runbook", name), "utf8")).join("\n") + "\n" + resource("panel.css"),
        script: ["form.js", "editor.js", "managed-editor.js"].map(resource).join("\n"),
    };
    return resource("panel.html").replace(/\{\{(nonce|style|script)\}\}/g, (_, key: string) => values[key]);
}
