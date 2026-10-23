import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { createHash, randomBytes } from "crypto";

interface FormsCodec { parse(text: string): unknown; stringify(value: unknown): string; }
const codec: FormsCodec = require(path.join(__dirname, "../../resources/work-items/form.js"));
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
interface InputEntry extends Record<string, unknown> { inputName: string; inputValue: unknown; }
export interface ActionInputDocument { source: Record<string, unknown>; inputs: InputEntry[]; metadata: Record<string, unknown>; }
const revision = (text: string) => createHash("sha256").update(text).digest("hex");

/** Validate without upgrading metadata or importing the package's Action code. */
export function readActionInputs(text: string, actionName: string): ActionInputDocument {
    if (Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024) throw Error("Action inputs exceed the 2 MiB form limit. Use advanced JSON.");
    const source = JSON.parse(codec.stringify(codec.parse(text)));
    if (!record(source) || !record(source.metadata) || !["v2", "v3"].includes(String(source.metadata.inputFileVersion))) throw Error("The form supports V2 or V3 Action inputs. Open advanced JSON to review this unchanged file.");
    if (source.metadata.actionName !== actionName) throw Error("This input file belongs to a different Action. Open advanced JSON to review its metadata.");
    if (typeof source.metadata.actionRelativePath !== "string" || !source.metadata.actionRelativePath) throw Error("Action source metadata is missing. Open advanced JSON; the file has not changed.");
    if (!Array.isArray(source.inputs) || !source.inputs.length || source.inputs.length > 100) throw Error("Keep between one and 100 named input cases.");
    const inputs: InputEntry[] = [], names = new Set<string>();
    for (const entry of source.inputs) {
        if (!record(entry) || typeof entry.inputName !== "string" || !entry.inputName.trim() || !Object.hasOwn(entry, "inputValue")) throw Error("Every case needs an input name and value.");
        if (names.has(entry.inputName)) throw Error("Input case names must be unique.");
        names.add(entry.inputName); inputs.push({...entry, inputName: entry.inputName, inputValue: entry.inputValue});
    }
    return {source, inputs, metadata: source.metadata};
}

/** Only case names/values are editable; all metadata and unknown fields survive. */
export function applyActionInputEdits(document: ActionInputDocument, edits: unknown): Record<string, unknown> {
    if (!Array.isArray(edits) || !edits.length || edits.length > 100) throw Error("Keep at least one input and no more than 100 cases.");
    const names = new Set<string>(), indices = new Set<number>();
    const inputs = edits.map(edit => {
        if (!record(edit) || typeof edit.inputName !== "string" || !edit.inputName.trim() || edit.inputName.length > 200 || !Object.hasOwn(edit, "inputValue")) throw Error("Each case needs a name of 1–200 characters and an input value.");
        if (names.has(edit.inputName)) throw Error("Input case names must be unique.");
        names.add(edit.inputName);
        const value = codec.parse(codec.stringify(edit.inputValue));
        let existing: InputEntry | undefined;
        if (edit.index !== null) {
            if (typeof edit.index !== "number" || !Number.isInteger(edit.index) || edit.index < 0 || edit.index >= document.inputs.length || indices.has(edit.index)) throw Error("Input case index changed. Reload the saved file before editing.");
            indices.add(edit.index); existing = document.inputs[edit.index];
        }
        return {...existing, inputName: edit.inputName, inputValue: JSON.parse(codec.stringify(value))};
    });
    return {...document.source, inputs};
}

let extensionContext: vscode.ExtensionContext | undefined;
const panels = new Map<string, vscode.WebviewPanel>();
export function initializeActionInputEditors(context: vscode.ExtensionContext): void { extensionContext = context; }

/** The existing run loader remains the only execution/OAuth/signature authority. */
export async function openActionInputsEditor(targetInput: string, actionName: string): Promise<void> {
    const context = extensionContext;
    if (!context) throw Error("Action input editor is not initialized.");
    const key = path.resolve(targetInput), uri = vscode.Uri.file(key);
    const existing = panels.get(key);
    if (existing) { existing.reveal(); return; }
    const panel = vscode.window.createWebviewPanel("automation.actionInputs", "Inputs: " + actionName, vscode.ViewColumn.Active, {enableScripts: true, localResourceRoots: []});
    panels.set(key, panel);
    const stateKey = "actionInputs.editor.v1." + revision(key);
    let source: ActionInputDocument | undefined, sourceRevision = "", busy = Promise.resolve(), draftWrites = Promise.resolve();
    function storeDraft(state: unknown): Promise<void> {
        draftWrites = draftWrites.catch(() => undefined).then(() => context.workspaceState.update(stateKey, state));
        return draftWrites;
    }
    async function publish(restore = true): Promise<void> {
        try {
            if ((await vscode.workspace.fs.stat(uri)).size > 2 * 1024 * 1024) throw Error("Action inputs exceed the 2 MiB form limit. Use advanced JSON.");
            const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
            source = readActionInputs(text, actionName); sourceRevision = revision(text);
            const nativeDirty = vscode.workspace.textDocuments.some(document => document.uri.toString() === uri.toString() && document.isDirty);
            await panel.webview.postMessage({type:"state", actionName, path:key, inputs:source.inputs, metadata:source.metadata, revision:sourceRevision,
                draft:restore ? context.workspaceState.get(stateKey) : undefined, nativeDirty});
        } catch (error) { source = undefined; await panel.webview.postMessage({type:"unsupported", message: error instanceof Error ? error.message : "Unable to read this input file. Open advanced JSON to review it."}); }
    }
    const listener = panel.webview.onDidReceiveMessage(message => {
        if (!record(message) || typeof message.op !== "string") return;
        if (message.op === "draft") {
            const state = message.state;
            if (record(state) && state.version === 1 && Array.isArray(state.cases) && state.cases.length <= 100 && Buffer.byteLength(JSON.stringify(state)) <= 4 * 1024 * 1024) {
                void storeDraft(state).catch(() => panel.webview.postMessage({type:"error",message:"Unable to preserve this draft. Keep this editor open and save the input."}));
            }
            return;
        }
        busy = busy.then(async () => {
            if (message.op === "ready") { await publish(); return; }
            if (message.op === "advanced") { await vscode.window.showTextDocument(uri); return; }
            if (message.op === "remove") {
                const answer = await vscode.window.showWarningMessage("Remove this input case from the draft? The saved file changes only when you Save.", {modal:true}, "Remove case");
                if (answer === "Remove case") await panel.webview.postMessage({type:"removed", key:message.key});
                return;
            }
            if (message.op === "reload") {
                const answer = await vscode.window.showWarningMessage("Reload saved Action inputs and discard this form's unsaved edits?", {modal:true}, "Reload saved inputs");
                if (answer === "Reload saved inputs") { await storeDraft(undefined); await publish(false); }
                return;
            }
            if (message.op !== "save" || !source) throw Error("Load a supported Action input file before saving.");
            if (message.revision !== sourceRevision) throw Error("This draft belongs to an earlier file revision. Reload or open advanced JSON; nothing was overwritten.");
            const document = await vscode.workspace.openTextDocument(uri);
            const nativeVersion = document.version;
            if (document.isDirty) throw Error("The native JSON editor has unsaved changes. Save or revert those changes, then reload this form. Nothing was overwritten.");
            if (revision(document.getText()) !== sourceRevision) throw Error("The saved input file changed outside this form. Reload before saving; nothing was overwritten.");
            const edited = applyActionInputEdits(source, message.inputs), text = codec.stringify(edited) + "\n";
            if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw Error("Action inputs exceed the 2 MiB form limit. Use advanced JSON.");
            const onDisk = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
            if (document.isDirty || document.version !== nativeVersion || revision(document.getText()) !== sourceRevision || revision(onDisk) !== sourceRevision) throw Error("The input changed while preparing this save. Reload; nothing was overwritten.");
            const edit = new vscode.WorkspaceEdit();
            edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
            if (!await vscode.workspace.applyEdit(edit)) throw Error("The native editor rejected this change. Reload and try again.");
            if (!await document.save()) throw Error("The native editor could not save. Your edits remain in its unsaved buffer.");
            await storeDraft(undefined); await publish(false);
            await panel.webview.postMessage({type:"saved"});
        }).catch(error => panel.webview.postMessage({type:"error", message:error instanceof Error ? error.message : "Unable to update the Action input file."})).then(() => undefined);
    });
    panel.onDidDispose(() => { panels.delete(key); listener.dispose(); });
    const resource = (area: string, name: string) => fs.readFileSync(path.join(__dirname, "../../resources", area, name), "utf8");
    const nonce = randomBytes(24).toString("hex");
    const values = {nonce, style:[resource("runbook","theme.css"),resource("runbook","codicon.css"),resource("work-items","panel.css"),resource("action-inputs","panel.css")].join("\n"), script:resource("work-items","form.js") + "\n" + resource("action-inputs","editor.js")};
    panel.webview.html = resource("action-inputs","panel.html").replace(/\{\{(nonce|style|script)\}\}/g, (_,name: string) => values[name]);
}
