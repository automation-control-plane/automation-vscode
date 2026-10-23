/**
 * Interesting docs related to webviews:
 * https://code.visualstudio.com/api/extension-guides/webview
 */
import { readFileSync } from "fs";
import * as vscode from "vscode";
import { logError } from "./channel";
import { getExtensionRelativeFile } from "./files";
import { CollectedLogs, collectIssueLogs } from "./rcc";

export const ISSUE_URL = "https://github.com/automation-control-plane/automation-vscode/issues/new";

export async function showSubmitIssueUI(context: vscode.ExtensionContext) {
    const info = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Collecting information to submit issue...",
            cancellable: false,
        },
        async () => {
            const collectedLogs: CollectedLogs = await collectIssueLogs(context.logUri.fsPath);
            return { collectedLogs, email: "" };
        }
    );

    const collectedLogs = info.collectedLogs;
    const email = info.email;

    const panel = vscode.window.createWebviewPanel(
        "robocorpCodeSubmitIssue",
        "Submit Issue to Automation",
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        }
    );

    panel.webview.html = getWebviewContent({ "files": collectedLogs.logFiles, "email": email });
    panel.webview.onDidReceiveMessage(
        async (message) => {
            switch (message.command) {
                case "onClickViewFile":
                    const file = message.filename;
                    vscode.commands.executeCommand("vscode.open", vscode.Uri.file(file));
                    return;
                case "onClickSubmit":
                    const contents: IReportContents = message.contents;
                    try {
                        // Open a reviewable draft. Logs and account details never leave the machine here.
                        const body = contents.details + "\n\nDiagnostic logs remain local; review them before attaching.";
                        const query = `title=${encodeURIComponent(contents.summary)}&body=${encodeURIComponent(body)}`;
                        const opened = await vscode.env.openExternal(vscode.Uri.parse(`${ISSUE_URL}?${query}`));
                        if (!opened) {
                            vscode.window.showErrorMessage(`Unable to open the issue draft. Visit ${ISSUE_URL}`);
                        }
                    } catch (err) {
                        logError("Error opening private issue draft.", err, "OPEN_ISSUE_ERROR");
                    } finally {
                        panel.webview.postMessage({ command: "issueSent" });
                    }
                    return;
            }
        },
        undefined,
        context.subscriptions
    );
}

interface IReportContents {
    email: string;
    summary: string;
    details: string;
    files: string[];
}

interface ISubmitIssueInput {
    files: string[];
    email: string;
}

function getWebviewContent(jsonData: ISubmitIssueInput): string {
    const jsonDataStr = JSON.stringify(jsonData, null, 4);
    const templateFile = getExtensionRelativeFile("../../vscode-client/templates/submit_issue.html", true);
    const data = readFileSync(templateFile, "utf8");

    const start = '<script id="data" type="application/json">';
    const startI = data.indexOf(start) + start.length;
    const end = "</script>";
    const endI = data.indexOf(end, startI);

    const ret: string = data.substring(0, startI) + jsonDataStr + data.substring(endI);
    return ret;
}
