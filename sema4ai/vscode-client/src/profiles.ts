import {commands, window, workspace} from "vscode";
import {getRccLocation} from "./rcc";
import {getHome, getRccConfigLocation, getProceedwithlongpathsdisabled} from "./robocorpSettings";
import {runtimeHomes, RuntimeKind} from "./runtimePaths";
import {LocalRccProfiles, parseLongPathStatus, runPrivateRcc} from "./rccProfiles";

const latestDiagnostics = new Map<string, Awaited<ReturnType<LocalRccProfiles["diagnostics"]>>>();

async function selectTarget(): Promise<RuntimeKind | undefined> {
    const selected = await window.showQuickPick([
        {label: "Actions", description: "Local extension RCC and Actions home", target: "actions"},
        {label: "Robots", description: "Local extension RCC and Robots home", target: "robots"},
        {label: "Connected Runtime", description: "Remote RCC profile capabilities unavailable", target: "connected"},
    ], {title: "RCC Profiles / Setup Diagnostics", placeHolder: "Choose the execution target to inspect or change"});
    if (!selected) return;
    if (selected.target === "connected") {
        await window.showInformationMessage("Connected Runtime RCC profile inspection/import/switch is unavailable in the supported Runtime contract. Local extension profiles do not describe that Runtime. Use its operator-approved target-specific tooling (actions#359).");
        return;
    }
    if (selected.target === "actions" || selected.target === "robots") return selected.target;
}

async function localClient() {
    if (!workspace.isTrusted) throw Error("Trust this workspace before executing RCC setup operations. No executable or profile was changed.");
    const executable = await getRccLocation();
    if (!executable) throw Error("Verified RCC is unavailable. Check the configured executable or published-tool download in Automation output.");
    return new LocalRccProfiles({executable, homes: runtimeHomes(getHome()), env: process.env,
        configLocation: getRccConfigLocation() || undefined});
}

async function reportFailure(error: unknown) {
    await window.showErrorMessage(error instanceof Error ? error.message : "RCC setup failed. Inspect the selected local target and try again.");
}

async function importFor(client: LocalRccProfiles, target: RuntimeKind) {
    const status = await client.status(target);
    const files = await window.showOpenDialog({canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
        title: `Import profile for local ${target}: ${status.home}`, openLabel: `Import into ${target}`});
    if (!files?.length) return;
    await client.importProfile(target, files[0].fsPath);
    const refreshed = await client.status(target);
    await window.showInformationMessage(`Profile imported into local ${target} (${status.home}). Active profile: ${refreshed.profile}. Import does not switch profiles; use Automation: Switch Profile separately.`);
}

async function switchFor(client: LocalRccProfiles, target: RuntimeKind) {
    const status = await client.status(target);
    const selected = await window.showQuickPick([
        ...status.profiles.map(name => ({label: name, name})),
        {label: "Unset current profile (RCC defaults)", name: "<remove-current-back-to-defaults>"},
    ], {title: `Switch local ${target} profile`, placeHolder: `${status.home} · current: ${status.profile}`});
    if (!selected) return;
    const confirmed = await window.showWarningMessage(`Switch RCC profile for local ${target} only?\nHome: ${status.home}\nSelected profile: ${selected.label}`, {modal: true}, "Switch profile");
    if (confirmed !== "Switch profile") return;
    await client.switchProfile(target, selected.name);
    const refreshed = await client.status(target);
    latestDiagnostics.clear();
    const restart = await window.showInformationMessage(`Local ${target} active profile: ${refreshed.profile}. Home: ${refreshed.home}. Reload this window to refresh language-server network settings and cached environment discovery. Running tasks were not stopped.`, "Reload Window");
    if (restart === "Reload Window") await commands.executeCommand("workbench.action.reloadWindow");
}

export async function profileImport() {
    try {const target = await selectTarget(); if (target) await importFor(await localClient(), target);}
    catch (error) {await reportFailure(error);}
}
export async function profileSwitch() {
    try {const target = await selectTarget(); if (target) await switchFor(await localClient(), target);}
    catch (error) {await reportFailure(error);}
}

async function longPaths() {
    if (process.platform !== "win32") return {support: "not-applicable", check: "not-applicable"};
    const skipped = !!process.env.ROBOCORP_OVERRIDE_SYSTEM_REQUIREMENTS || getProceedwithlongpathsdisabled();
    let registry = "";
    try {registry = await runPrivateRcc("reg.exe", ["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem", "/v", "LongPathsEnabled"], {shell: false});}
    catch { /* Unavailable is different from disabled. Never elevate to inspect. */ }
    return {...parseLongPathStatus(registry, skipped), savedSkip: getProceedwithlongpathsdisabled(),
        environmentOverride: !!process.env.ROBOCORP_OVERRIDE_SYSTEM_REQUIREMENTS};
}

export async function showRccSetup() {
    try {
        const target = await selectTarget();
        if (!target) return;
        const client = await localClient();
        while (true) {
            const status = await client.status(target);
            const key = JSON.stringify([status.executable, status.home, getRccConfigLocation(), status.profile, status.certificates]);
            const selected = await window.showQuickPick([
                {label: "View sanitized setup report", action: "report"},
                {label: "Run full target diagnostics", action: "diagnostics"},
                {label: "Import profile (does not switch)", action: "import"},
                {label: "Switch profile explicitly", action: "switch"},
                {label: "Refresh status", action: "refresh"},
                {label: "Windows long-path preference", action: "longpaths"},
            ], {title: `Local ${target} · RCC ${status.version} · profile ${status.profile}`,
                placeHolder: `${status.home} · verify TLS: ${status.certificates.verifySsl} · no-revoke: ${status.certificates.sslNoRevoke}`});
            if (!selected) return;
            if (selected.action === "diagnostics") {
                latestDiagnostics.set(key, await client.diagnostics(target));
                await window.showInformationMessage(`Full RCC diagnostics completed for local ${target}. View the sanitized setup report for category results.`);
            } else if (selected.action === "import") await importFor(client, target);
            else if (selected.action === "switch") await switchFor(client, target);
            else if (selected.action === "longpaths") await commands.executeCommand("workbench.action.openSettings", "@id:sema4ai.proceedWithLongPathsDisabled");
            else if (selected.action === "report") {
                const report = {...status, configLocation: getRccConfigLocation() || "RCC default in selected home",
                    longPaths: await longPaths(), diagnostics: latestDiagnostics.get(key) || {status: "not-run"},
                    connectedRuntime: "Not represented: remote RCC setup capability unavailable (actions#359)."};
                const document = await workspace.openTextDocument({language: "json", content: JSON.stringify(report, null, 2)});
                await window.showTextDocument(document, {preview: true});
            }
        }
    } catch (error) {await reportFailure(error);}
}
