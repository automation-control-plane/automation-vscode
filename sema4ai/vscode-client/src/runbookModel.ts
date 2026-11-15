import type { LocalPackageMetadataInfo } from "./protocols";
import * as path from "path";

export const RUNBOOK_ROUTES = [
    { id: "packages", label: "Packages", icon: "package" },
    { id: "environments", label: "Environments", icon: "server-environment" },
    { id: "work-items", label: "Work Items", icon: "briefcase" },
    { id: "runs", label: "Runs", icon: "play-circle" },
    { id: "inspectors", label: "Inspectors", icon: "search" },
    { id: "settings", label: "Settings", icon: "settings-gear" },
] as const;
export type RunbookRoute = typeof RUNBOOK_ROUTES[number]["id"];
export const RUNBOOK_ACTIONS = ["create-action", "create-robot", "create-agent", "configure", "dependencies", "terminal", "check-environment", "rebuild", "runtime-start", "runtime-reconnect", "runtime-open", "work-items", "run", "debug", "action-inputs", "source", "logs", "diagnostics", "native-settings", "report-issue", "rcc-setup", "profile-import", "profile-switch", "export", "metadata", "locators", "web-inspector", "windows-inspector", "image-inspector", "java-inspector", "recorder", "reveal", "oauth-settings", "open-run", "edit-setting", "retry-startup"] as const;
export type RunbookAction = typeof RUNBOOK_ACTIONS[number];
export type RunbookRequest =
    | {op: "refresh"}
    | {op: "navigate"; route: RunbookRoute}
    | {op: "selectPackage"; target: string}
    | {op: "action"; action: RunbookAction; target?: string};
export function isRunbookRoute(value: unknown): value is RunbookRoute {
    return RUNBOOK_ROUTES.some(route => route.id === value);
}
function isRunbookAction(value: unknown): value is RunbookAction {
    return RUNBOOK_ACTIONS.some(action => action === value);
}
/** This boundary never accepts a command ID, executable, URI or arbitrary arguments. */
export function parseRunbookRequest(value: unknown): RunbookRequest | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value) || !("op" in value)) return;
    if (value.op === "refresh") return {op: "refresh"};
    if (value.op === "navigate" && "route" in value && isRunbookRoute(value.route)) return {op: "navigate", route: value.route};
    if (value.op === "selectPackage" && "target" in value && typeof value.target === "string" && value.target.length < 16384) return {op: "selectPackage", target: value.target};
    if (value.op === "action" && "action" in value && isRunbookAction(value.action)) {
        if (!("target" in value)) return {op: "action", action: value.action};
        if (typeof value.target === "string" && value.target.length < 16384) return {op: "action", action: value.action, target: value.target};
    }
}
export function describePackage(metadata: LocalPackageMetadataInfo) {
    const kind = metadata.packageType === "action" ? "Action" : metadata.packageType === "agent" ? "Agent" : "Robot";
    const yaml = metadata.yamlContents;
    const dependencies: {source: string; value: string}[] = [];
    if (yaml && "dependencies" in yaml && yaml.dependencies && typeof yaml.dependencies === "object") {
        for (const [source, values] of Object.entries(yaml.dependencies)) {
            if (Array.isArray(values)) for (const value of values) if (typeof value === "string") dependencies.push({source, value});
        }
    }
    return {id: metadata.filePath, name: metadata.name || path.basename(metadata.directory), kind,
        directory: metadata.directory, manifest: path.basename(metadata.filePath), dependencies,
        runtimeStatus: "Not checked", version: yaml && "version" in yaml && typeof yaml.version === "string" ? yaml.version : undefined,
        description: yaml && "description" in yaml && typeof yaml.description === "string" ? yaml.description : ""};
}
