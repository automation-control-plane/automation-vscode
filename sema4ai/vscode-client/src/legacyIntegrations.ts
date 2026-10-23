import { workspace } from "vscode";

const manifest: unknown = require("../../legacy-integrations.json");
const legacyCommands = new Set<string>();
if (!Array.isArray(manifest)) {
    throw new Error("Invalid legacy integration command manifest.");
}
for (const command of manifest) {
    if (typeof command !== "string") {
        throw new Error("Invalid legacy integration command ID.");
    }
    legacyCommands.add(command);
}

export function legacyVendorIntegrationsEnabled(): boolean {
    return workspace.getConfiguration("sema4ai").get<boolean>("legacyVendorIntegrations.enabled", false);
}

export function isLegacyVendorCommand(command: string): boolean {
    return legacyCommands.has(command);
}
