import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { randomBytes } from "crypto";
import { resolveInterpreter } from "./activities";
import { getSelectedRobot } from "./viewsSelection";
import { SEMA4AI_LIST_ACTIONS_INTERNAL } from "./robocorpCommands";

export const OPEN_NATIVE_WORK_ITEMS = "automation.workItems.open";
type Mode = "file" | "sqlite" | "managed";
interface Item { id: string; payload?: Record<string, unknown>; files?: string[]; revision?: string; state?: string; }
interface Request { op: string; mode: Mode; id?: string; queue?: string; name?: string; payload?: unknown; revision?: string; parameters?: unknown; }
interface LocalResult { items?: Item[]; id?: string; env?: Record<string, string>; parameters?: string; content?: string; }

/** One editor per package, scoped to the package selected by the trusted host. */
export function registerNativeWorkItems(context: vscode.ExtensionContext): void {
    const panels = new Map<string, vscode.WebviewPanel>();
    context.subscriptions.push(vscode.commands.registerCommand(OPEN_NATIVE_WORK_ITEMS, async () => {
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
        if (panels.has(key)) { panels.get(key).reveal(); return; }
        const panel = vscode.window.createWebviewPanel("automation.workItems", "Work Items: " + path.basename(path.dirname(key)),
            vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [] });
        panels.set(key, panel);
        const nonce = randomBytes(24).toString("hex");
        panel.webview.html = editorHtml(nonce);
        let mode: Mode = "file", queue = "input", busy = Promise.resolve();
        const sessions = new Map<string, vscode.DebugSession>();
        const runs = new Set<string>();
        let disposed = false;
        async function local(request: Request & Record<string, unknown>): Promise<LocalResult> {
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
                child.stdin.end(JSON.stringify({ ...request, manifest: key }));
            });
        }
        async function refresh(): Promise<void> {
            if (mode === "managed") {
                await panel.webview.postMessage({ type: "unsupported", message: "Managed lifecycle is awaiting the canonical authenticated Work Item/Run/Attempt contract from Actions #132/#327. Published Runtime 1.0.4 has list/seed/files APIs, but no lease/retry/cancel/review graph. No local queue is substituted." });
                return;
            }
            const state = await local({ op: "list", mode, queue });
            if (!disposed) await panel.webview.postMessage({ type: "state", ...state, package: key, mode, queue });
        }
        const listeners = [
            vscode.debug.onDidStartDebugSession(session => {
                for (const id of runs) if (session.name === "Work Item " + id) {
                    sessions.set(id, session);
                    void local({ op: "receipt", mode: "file", id, state: "STARTED", session: session.id }).then(refresh);
                }
            }),
            vscode.debug.onDidTerminateDebugSession(session => {
                for (const [id, owned] of sessions) if (owned.id === session.id) {
                    sessions.delete(id);
                    void local({ op: "receipt", mode: "file", id, state: "STOPPED", session: session.id }).then(refresh);
                }
            }),
            panel.webview.onDidReceiveMessage(message => {
                busy = busy.then(async () => {
                    if (!message || typeof message.op !== "string") throw Error("Invalid editor request.");
                    await panel.webview.postMessage({ type: "loading" });
                    if (message.op === "mode") {
                        if (!["file", "sqlite", "managed"].includes(message.mode)) throw Error("Unknown Work Items mode.");
                        mode = message.mode; queue = message.queue || "input";
                    } else if (message.op === "refresh") { /* refresh below */ }
                    else if (message.op === "cancel") {
                        const session = sessions.get(message.id);
                        if (!session) throw Error("No active extension-owned debug session for this receipt.");
                        const confirmed = await vscode.window.showWarningMessage("Stop this local Work Item execution? SQLite claim recovery follows the SDK's orphan timeout; this is not a managed cancellation.", { modal: true }, "Stop execution");
                        if (confirmed === "Stop execution") await vscode.debug.stopDebugging(session);
                    } else {
                        if (mode === "managed") throw Error("Managed mutation is unavailable until the canonical server contract is verified.");
                        const request: Request & Record<string, unknown> = { op: message.op, mode, queue };
                        for (const field of ["id", "name", "payload", "revision", "parameters"]) if (message[field] !== undefined) request[field] = message[field];
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
                        } else if (!["create", "save", "replay"].includes(message.op)) throw Error("Unsupported editor operation.");
                        await local(request);
                    }
                    await refresh();
                }).catch(async error => { if (!disposed) await panel.webview.postMessage({ type: "error", message: error.message }); });
            }),
        ];
        panel.onDidDispose(() => { disposed = true; panels.delete(key); listeners.forEach(listener => listener.dispose()); });
    }));
}

function editorHtml(nonce: string): string {
    const script = fs.readFileSync(path.join(__dirname, "../../resources/work-items/editor.js"), "utf8");
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}';"><style nonce="${nonce}">
    body{font:var(--vscode-font-size) var(--vscode-font-family);color:var(--vscode-foreground);padding:20px;max-width:1100px}select,input,textarea,button{font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);padding:7px;margin:4px}button{cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}textarea{display:block;box-sizing:border-box;width:100%;min-height:160px;font-family:var(--vscode-editor-font-family)}#status{white-space:pre-wrap;padding:10px}#items button{display:block;text-align:left;width:100%}.layout{display:grid;grid-template-columns:1fr 2fr;gap:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere}#files button{display:inline-block}.error{color:var(--vscode-errorForeground)}@media(max-width:700px){.layout{display:block}}
    </style></head><body><h1>Work Items</h1><p id="package"></p><label>Mode <select id="mode"><option value="file">Local test files</option><option value="sqlite">SDK SQLite queue</option><option value="managed">Managed Runtime</option></select></label><label>Queue <input id="queue" value="input" maxlength="80"></label><button id="refresh">Refresh / reconnect</button><p id="authority"></p><div id="status" role="status" aria-live="polite">Loading package…</div><div class="layout"><section><h2>Inputs and outputs</h2><button id="new">New input</button><div id="items"></div><h2>Local execution receipts</h2><div id="receipts"></div></section><section><h2 id="selection">New input</h2><label>Name <input id="name" value="input"></label><label>Payload (JSON object)<textarea id="payload">{\n  "value": 7\n}</textarea></label><p id="validation"></p><button id="create">Create input</button><button id="save">Save payload</button><button id="replay">Replay as new input</button><h3>Attachments</h3><div id="files"></div><button id="attach">Add attachment…</button><h3>Action parameters (separate from Work Item payload)</h3><textarea id="parameters">{}</textarea><button id="run">Run selected input</button><button id="debug">Debug selected input</button><h3>State, error and lineage</h3><pre id="details"></pre></section></div><script nonce="${nonce}">${script}</script></body></html>`;
}
