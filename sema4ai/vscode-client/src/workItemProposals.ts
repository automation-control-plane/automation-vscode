import * as vscode from "vscode";

/** Explicit draft proposal only. Uses an already available VS Code model. */
export async function proposeWorkItemPayload(instructions: unknown): Promise<string> {
    if (typeof instructions !== "string" || !instructions.trim() || instructions.length > 4000) throw Error("Describe the proposed fields and values in 1–4000 characters.");
    if (!vscode.workspace.isTrusted) throw Error("Workspace trust is required for model proposals.");
    const models = await vscode.lm.selectChatModels();
    if (!models.length) throw Error("No existing VS Code language model is available. Add fields manually; this extension does not configure a model service or credentials.");
    const selected = await vscode.window.showQuickPick(models.map(model => ({label: model.name, description: model.vendor, model})), {placeHolder: "Choose an existing VS Code model for this proposal"});
    if (!selected) return undefined;
    const confirmed = await vscode.window.showInformationMessage(`Generate a draft with ${selected.model.name}? Only the description you entered is sent. Review and apply the proposal before saving.`, {modal: true}, "Generate proposal");
    if (confirmed !== "Generate proposal") return undefined;
    return vscode.window.withProgress({location: vscode.ProgressLocation.Notification, title: "Proposing Work Item fields", cancellable: true}, async (_, token) => {
        const cancellation = new vscode.CancellationTokenSource();
        let rejectCancellation: (error: Error) => void;
        const cancelled = new Promise<never>((_, reject) => {rejectCancellation = reject;});
        const listener = token.onCancellationRequested(() => {cancellation.cancel(); rejectCancellation(Error("Proposal cancelled; no draft was applied."));});
        let timer: ReturnType<typeof setTimeout>;
        try {
            if (token.isCancellationRequested) throw Error("Proposal cancelled; no draft was applied.");
            const generate = async () => {
                const response = await selected.model.sendRequest([vscode.LanguageModelChatMessage.User(
                    "Propose a Work Item payload as one finite JSON object. Return only that object, without Markdown, schema or an envelope. " +
                    "Use nested objects/arrays and basic types when appropriate. Field names must be unique. This is a draft only; no tools, execution, queue claims or approvals are available.\n" + instructions
                )], {justification: "Propose Work Item fields for explicit review and apply", tools: []}, cancellation.token);
                let text = "";
                for await (const chunk of response.text) {
                    text += chunk;
                    if (text.length > 32768) throw Error("Proposal exceeds the review limit.");
                }
                const trimmed = text.trim();
                return trimmed.startsWith("```json\n") && trimmed.endsWith("```") ? trimmed.slice(8, -3).trim() : trimmed;
            };
            return await Promise.race([generate(), cancelled, new Promise<never>((_, reject) => {timer = setTimeout(() => {cancellation.cancel(); reject(Error("Model proposal timed out; no draft was applied."));}, 60000);})]);
        } finally {clearTimeout(timer); listener.dispose(); cancellation.cancel(); cancellation.dispose();}
    });
}
