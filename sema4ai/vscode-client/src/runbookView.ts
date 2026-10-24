/** Package-centric UI over existing extension capabilities. No execution occurs on mount. */
import * as vscode from "vscode";
import * as path from "path";
import {readFileSync} from "fs";
import {randomBytes} from "crypto";
import {RUNBOOK_ROUTES, RunbookRoute, RunbookAction, isRunbookRoute, parseRunbookRequest, describePackage} from "./runbookModel";
import {RobotEntry, RobotEntryType, treeViewIdToTreeDataProvider, treeViewIdToTreeView} from "./viewsCommon";
import {RobotsTreeDataProvider} from "./viewsRobots";
import {getSelectedRobot, onSelectedRobotChanged, onChangedRobotSelection} from "./viewsSelection";
import {TREE_VIEW_SEMA4AI_TASK_PACKAGES_TREE} from "./robocorpViews";
import {resolveInterpreter} from "./activities";
import {runtimeHomes} from "./runtimePaths";
import {globalOutputViewState} from "./output/outViewRunIntegration";
import {getRuntimeStatus, reconnectActionServer} from "./actionServer";
import {getLanguageServerStartup, onLanguageServerStartupChanged} from "./languageServerStartup";
import {logError} from "./channel";

const OPEN = "automation.runbook.open";
const SETTINGS: [string, string, string][] = [
    ["sema4ai.rcc.location", "RCC executable", "Use a verified published tool, or preserve your explicit executable override."],
    ["sema4ai.actionServer.location", "Actions Runtime executable", "An explicit Runtime path is never downloaded over or replaced."],
    ["sema4ai.actionServer.port", "Runtime port", "Loopback port. An occupied port is not permission to adopt or stop its listener."],
    ["sema4ai.home", "Legacy tooling root", "Actions and Robots keep separate homes. Existing data is never moved."],
    ["sema4ai.agentCli.location", "Agent CLI executable", "Agent workflows need an explicitly configured compatible CLI; no published download mapping is available."],
    ["sema4ai.autoSetPythonExtensionInterpreter", "Package interpreter selection", "Synchronize the Microsoft Python extension with the selected package environment."],
    ["sema4ai.autoSetPythonExtensionDisableActivateTerminal", "Package terminal activation", "Avoid a second Python auto-activation overriding the package terminal environment."],
    ["sema4ai.codeLens.roboLaunch", "Robot Run and Debug code lenses", "Show launch controls above Robot tasks."],
    ["sema4ai.codeLens.actionsLaunch", "Action Run and Debug code lenses", "Show launch controls above Python Actions."],
    ["sema4ai.codeLens.devTask", "Development task code lenses", "Show launch controls in package development tasks."],
    ["sema4ai.rcc.config_location", "RCC configuration file", "Use your configured RCC profile and settings."],
    ["sema4ai.rcc.endpoint", "RCC endpoint override", "Optional operator-managed endpoint; not a managed Work Items service."],
    ["sema4ai.language-server.python", "Language server Python", "Explicit Python executable for extension language services. Requires reload."],
    ["sema4ai.language-server.args", "Language server arguments", "Additional language server arguments. Requires reload."],
    ["sema4ai.language-server.tcp-port", "Language server development port", "Connect to an existing language server. Requires reload."],
    ["sema4ai.verifyLSP", "Verify Robot Framework integration", "Check the separately installed Robot Framework Language Server."],
    ["sema4ai.proceedWithLongPathsDisabled", "Windows long-path compatibility", "Allow startup when Windows long paths are disabled."],
    ["sema4ai.legacyVendorIntegrations.enabled", "Legacy external integrations", "Off by default. Retained third-party publishing and Control Room are not Automation Control Plane services."],
    ["sema4ai.vaultTokenTimeoutInMinutes", "Legacy Vault token lifetime", "Only used by explicitly enabled legacy external Vault integration."],
];

export function registerRunbookWorkspace(context: vscode.ExtensionContext): void {
    const changed = new vscode.EventEmitter<void>();
    let route: RunbookRoute = "packages";
    let panel: vscode.WebviewPanel | undefined;
    let roots: RobotEntry[] = [];
    let targets = new Map<string, RobotEntry>();
    let busy = false;
    let renderEpoch = 0;
    let refreshEpoch = 0;
    let error = "";
    const environments = new Map<string, {status: string; python?: string; message?: string}>();
    const provider = treeViewIdToTreeDataProvider.get(TREE_VIEW_SEMA4AI_TASK_PACKAGES_TREE);
    const packageTree = treeViewIdToTreeView.get(TREE_VIEW_SEMA4AI_TASK_PACKAGES_TREE);
    const navigation: vscode.TreeDataProvider<typeof RUNBOOK_ROUTES[number]> = {
        onDidChangeTreeData: changed.event,
        getChildren: () => [...RUNBOOK_ROUTES],
        getTreeItem: item => {
            const treeItem = new vscode.TreeItem(item.label, vscode.TreeItemCollapsibleState.None);
            treeItem.id = item.id;
            treeItem.iconPath = new vscode.ThemeIcon(item.icon, item.id === route ? new vscode.ThemeColor("charts.yellow") : undefined);
            treeItem.command = {command: OPEN, title: item.label, arguments: [item.id]};
            treeItem.accessibilityInformation = {label: item.label + (item.id === route ? ", current section" : "")};
            return treeItem;
        },
    };
    const navTree = vscode.window.createTreeView("automation-navigation", {treeDataProvider: navigation, showCollapseAll: false});
    context.subscriptions.push(navTree, changed, vscode.commands.registerCommand(OPEN, async (requested: unknown = "packages") => {
        if (isRunbookRoute(requested)) route = requested;
        changed.fire();
        if (getLanguageServerStartup().status === "ready" && route === "work-items" && getSelectedRobot()?.robot?.packageType !== "agent") {
            await vscode.commands.executeCommand("automation.workItems.open");
            return;
        }
        if (!panel) {
            panel = vscode.window.createWebviewPanel("automation.runbook", "Automation · " + title(), vscode.ViewColumn.Active,
                {enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true});
            panel.webview.html = html();
            panel.onDidDispose(() => {panel = undefined;}, undefined, context.subscriptions);
            panel.webview.onDidReceiveMessage(async raw => {
                const request = parseRunbookRequest(raw);
                if (!request || busy) return;
                if (request.op === "navigate") {await vscode.commands.executeCommand(OPEN, request.route); return;}
                if (request.op === "refresh") {error = ""; await refresh(); return;}
                try {
                    if (request.op === "selectPackage") {
                        const selected = roots.find(root => root.robot?.filePath === request.target);
                        if (!selected) throw Error("This package is no longer in the workspace. Refresh Packages.");
                        await select(selected);
                        return;
                    }
                    const admittedPackage = getSelectedRobot()?.robot?.filePath;
                    busy = true; error = ""; await post();
                    await act(request.action, request.target, admittedPackage);
                } catch (cause) {
                    error = cause instanceof Error ? cause.message : "The operation could not be completed. Open diagnostic logs for details.";
                } finally {busy = false; await refresh();}
            }, undefined, context.subscriptions);
        } else {panel.title = "Automation · " + title(); panel.reveal();}
        await refresh();
    }));
    context.subscriptions.push(onSelectedRobotChanged(() => {void refresh();}));
    context.subscriptions.push(onLanguageServerStartupChanged(() => {void refresh();}));
    if (provider instanceof RobotsTreeDataProvider) context.subscriptions.push(provider.onDidChangeTreeData(() => {void refresh();}));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(() => {if (panel) void post();}));

    function title() {return RUNBOOK_ROUTES.find(item => item.id === route)?.label || "Packages";}
    async function select(entry: RobotEntry) {
        if (provider instanceof RobotsTreeDataProvider && packageTree) {
            await onChangedRobotSelection(packageTree, provider, [entry]);
            await packageTree.reveal(entry, {select: true, focus: false, expand: false});
        }
        await refresh();
    }
    async function refresh() {
        if (!panel) return;
        const epoch = ++refreshEpoch;
        if (getLanguageServerStartup().status !== "ready") {
            roots = []; targets.clear(); error = "";
            await post(); return;
        }
        try {
            const discovered = provider instanceof RobotsTreeDataProvider ? await provider.getValidCachedOrComputeChildren() : [];
            if (epoch !== refreshEpoch || !panel) return;
            roots = discovered;
            await post();
        } catch (cause) {
            if (epoch !== refreshEpoch || !panel) return;
            logError("Package discovery failed.", cause, "RUNBOOK_DISCOVERY_ERROR");
            if (getLanguageServerStartup().status !== "ready") {roots = []; targets.clear(); error = ""; await post(); return;}
            error = "Package discovery failed. Open diagnostic logs for the original error, then refresh Packages.";
            await panel?.webview.postMessage({type: "error", message: error});
        }
    }
    async function post() {
        if (!panel) return;
        const epoch = ++renderEpoch;
        const selectedRoute = route;
        const startup = getLanguageServerStartup();
        const selected = startup.status === "ready" ? getSelectedRobot() : undefined;
        const metadata = selected?.robot;
        const localTargets = new Map<string, RobotEntry>();
        let runnable: {id: string; name: string; kind: string; source: string}[] = [];
        if (metadata && provider instanceof RobotsTreeDataProvider) {
            const root = roots.find(item => item.robot?.filePath === metadata.filePath);
            if (root) for (const child of await provider.getValidCachedOrComputeChildren(root)) {
                if (child.type === RobotEntryType.Action || child.type === RobotEntryType.Task) {
                    const id = metadata.filePath + "::" + (child.uri?.toString() || "") + "::" + (child.actionName || child.taskName);
                    localTargets.set(id, child);
                    runnable.push({id, name: child.actionName || child.taskName || child.label, kind: child.type, source: child.uri?.fsPath || ""});
                }
            }
        }
        let homes: {actions: string; robots: string} | undefined;
        let homeError: string | undefined;
        try {homes = runtimeHomes(vscode.workspace.getConfiguration("sema4ai").get<string>("home", ""));} catch (cause) {homeError = String(cause);}
        const runtime = route === "environments" && metadata?.packageType === "action" ? await getRuntimeStatus(vscode.Uri.file(metadata.directory)) : undefined;
        if (epoch !== renderEpoch || route !== selectedRoute || getLanguageServerStartup() !== startup ||
            (startup.status === "ready" && getSelectedRobot()?.robot?.filePath !== metadata?.filePath) || !panel) return;
        targets = localTargets;
        const runs = globalOutputViewState?.uniqueRunIds.map(id => ({id, label: globalOutputViewState.runIdToContents.get(id)?.label || id})).reverse() || [];
        await panel.webview.postMessage({type: "state", route, routes: RUNBOOK_ROUTES, title: title(),
            packages: roots.filter(root => root.robot).map(root => describePackage(root.robot)),
            selected: metadata ? describePackage(metadata) : undefined, runnable, busy, error, startup,
            environment: metadata ? environments.get(metadata.filePath) || {status: "Not checked", message: "Check explicitly to resolve or build this package's Python environment."} : undefined,
            homes, homeError, runtime, runs, platform: process.platform, trusted: vscode.workspace.isTrusted,
            settings: SETTINGS.filter(([key]) => key !== "sema4ai.vaultTokenTimeoutInMinutes" || vscode.workspace.getConfiguration().get("sema4ai.legacyVendorIntegrations.enabled", false))
                .map(([id, label, description]) => ({id, label, description, value: vscode.workspace.getConfiguration().get(id)}))});
    }
    async function act(action: RunbookAction, target?: string, admittedPackage?: string) {
        const command = (id: string, ...args: unknown[]) => vscode.commands.executeCommand(id, ...args);
        switch (action) {
            case "retry-startup":
                if (getLanguageServerStartup().status === "failed") await command("workbench.action.reloadWindow");
                return;
            case "native-settings": await command("workbench.action.openSettings", "@ext:automation-control-plane.automation-vscode"); return;
            case "edit-setting": if (!SETTINGS.some(([key]) => key === target)) throw Error("Unknown setting."); await command("workbench.action.openSettings", "@id:" + target); return;
            case "diagnostics": await command("sema4ai.showOutput"); return;
            case "logs": await command("sema4ai.python.view.output.focus"); return;
            case "open-run": if (!target || !globalOutputViewState?.runIdToContents.has(target)) throw Error("This run log is no longer retained."); await globalOutputViewState.setCurrentRunId(target); await command("sema4ai.python.view.output.focus"); return;
            case "report-issue": await command("sema4ai.submitIssue"); return;
        }
        if (getLanguageServerStartup().status !== "ready") throw Error(getLanguageServerStartup().message);
        switch (action) {
            case "create-action": await command("sema4ai.createActionPackage"); return;
            case "create-robot": await command("sema4ai.createRobot"); return;
            case "create-agent": await command("sema4ai.createAgentPackage"); return;
            case "profile-import": await command("sema4ai.profileImport"); return;
            case "profile-switch": await command("sema4ai.profileSwitch"); return;
            case "oauth-settings": await command("sema4ai.oauth2.open_settings"); return;
        }
        const selected = getSelectedRobot();
        const metadata = selected?.robot;
        if (!metadata) throw Error("Select a package first.");
        if (metadata.filePath !== admittedPackage) throw Error("The selected package changed while this action was being prepared. Choose the action again.");
        if (!roots.some(root => root.robot?.filePath === metadata.filePath)) throw Error("This package is no longer in the workspace. Refresh Packages.");
        if (!vscode.workspace.isTrusted) throw Error("Trust this workspace before running package operations.");
        if (["runtime-start", "runtime-reconnect", "runtime-open", "export", "metadata"].includes(action) && metadata.packageType !== "action") {
            throw Error("This operation requires an Action Package.");
        }
        const directory = vscode.Uri.file(metadata.directory);
        const manifest = vscode.Uri.file(metadata.filePath);
        switch (action) {
            case "configure": await vscode.window.showTextDocument(manifest); return;
            case "dependencies": await command("sema4ai.openRobotCondaTreeSelection", selected); return;
            case "reveal": await command("revealInExplorer", directory); return;
            case "terminal": await command("sema4ai.rccTerminalCreateRobotTreeSelection", selected); return;
            case "check-environment": case "rebuild": {
                environments.set(metadata.filePath, {status: "Resolving", message: "Resolving package Python and dependencies…"}); await post();
                const result = await resolveInterpreter(metadata.filePath);
                environments.set(metadata.filePath, result.success && result.result?.pythonExe ? {status: "Ready", python: result.result.pythonExe} : {status: "Unavailable", message: result.message || "No package interpreter returned."});
                return;
            }
            case "runtime-start": if (metadata.packageType !== "action") throw Error("Actions Runtime requires an Action Package."); await command("sema4ai.startActionServer", directory); return;
            case "runtime-reconnect": if (!(await reconnectActionServer(directory))) throw Error("The existing Runtime could not be verified as owned. No listener was adopted or stopped."); return;
            case "runtime-open": {
                const status = await getRuntimeStatus(directory);
                if (status.kind !== "owned-running") throw Error("Verify the owned Runtime before opening it.");
                await vscode.env.openExternal(vscode.Uri.parse(status.endpoint)); return;
            }
            case "work-items": await command("automation.workItems.open"); return;
            case "locators": await command("sema4ai.inspector"); return;
            case "web-inspector": await command("sema4ai.newRobocorpInspectorBrowser"); return;
            case "windows-inspector": await command("sema4ai.newRobocorpInspectorWindows"); return;
            case "image-inspector": await command("sema4ai.newRobocorpInspectorImage"); return;
            case "java-inspector": await command("sema4ai.newRobocorpInspectorJava"); return;
            case "recorder": await command("sema4ai.openPlaywrightRecorder", true); return;
            case "export": await command("sema4ai.actionServerPackageBuild", directory); return;
            case "metadata": await command("sema4ai.actionServerPackageMetadata", directory); return;
            case "run": case "debug": case "source": case "action-inputs": {
                const entry = target ? targets.get(target) : undefined;
                if (!entry || entry.robot?.filePath !== metadata.filePath) throw Error("This runnable no longer belongs to the selected package. Refresh before launching.");
                if (action === "source") {if (entry.uri) await vscode.window.showTextDocument(entry.uri); return;}
                if (action === "action-inputs") {if (entry.type !== RobotEntryType.Action) throw Error("Action inputs require a Python Action, not a Robot task."); await command("sema4ai.robotsViewActionEditInput", entry); return;}
                const id = entry.type === RobotEntryType.Action ? (action === "debug" ? "sema4ai.robotsViewActionDebug" : "sema4ai.robotsViewActionRun") : (action === "debug" ? "sema4ai.robotsViewTaskDebug" : "sema4ai.robotsViewTaskRun");
                await command(id, entry); return;
            }
            default: {const unsupported: never = action; throw Error("Unsupported action: " + unsupported);}
        }
    }
    function html() {
        const nonce = randomBytes(24).toString("hex");
        const resource = (name: string) => readFileSync(path.join(context.extensionPath, "resources/runbook", name), "utf8");
        return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; font-src data:; img-src data:;"><style nonce="${nonce}">${resource("codicon.css")}\n${resource("theme.css")}\n${resource("workspace.css")}</style></head><body><div id="app" aria-live="polite"><div class="loading">Loading packages…</div></div><script nonce="${nonce}">${resource("workspace.js")}</script></body></html>`;
    }
}
