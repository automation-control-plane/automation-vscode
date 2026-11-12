import * as os from "os";
import * as path from "path";
import * as fs from "fs";

export type RuntimeKind = "actions" | "robots";

export function vendorStudioHome(legacyHome = "", env: NodeJS.ProcessEnv = process.env, platform = process.platform) {
    if (legacyHome || env.SEMA4AI_HOME) {
        return legacyHome || env.SEMA4AI_HOME;
    }
    if (platform === "win32") {
        if (!env.LOCALAPPDATA) {
            throw new Error("LOCALAPPDATA must be set to discover the separately installed Studio.");
        }
        return path.win32.join(env.LOCALAPPDATA, "sema4ai");
    }
    return path.posix.join(env.HOME || os.homedir(), ".sema4ai");
}

export function runtimeHomes(legacyHome = "", env: NodeJS.ProcessEnv = process.env, platform = process.platform) {
    const paths = platform === "win32" ? path.win32 : path.posix;
    const legacy = legacyHome || env.SEMA4AI_HOME || env.ROBOCORP_HOME;
    const base = platform === "win32" ? env.LOCALAPPDATA : env.HOME || os.homedir();
    if (!base) {
        throw new Error("LOCALAPPDATA must be set to resolve the local tooling homes.");
    }
    const homes = {
        actions:
            env.ACTIONS_HOME || paths.join(legacy || base, legacy || platform === "win32" ? "actions" : ".actions"),
        robots: env.ROBOTS_HOME || paths.join(legacy || base, legacy || platform === "win32" ? "robots" : ".robots"),
    };
    const canonical = (value: string) => {
        const resolved = fs.existsSync(value) ? fs.realpathSync(value) : paths.resolve(value);
        return platform === "win32" ? resolved.toLowerCase() : resolved;
    };
    if (canonical(homes.actions) === canonical(homes.robots)) {
        throw new Error("ACTIONS_HOME and ROBOTS_HOME must select different directories.");
    }
    return homes;
}

export function runtimeEnvironment(kind: RuntimeKind, legacyHome = "") {
    const homes = runtimeHomes(legacyHome);
    return {
        ACTIONS_HOME: homes.actions,
        ROBOTS_HOME: homes.robots,
        ROBOCORP_HOME: homes[kind],
        RCC_HOLOTREE_MODE: "private",
    };
}

export function publishedWorkItemEnvironment(env: { [key: string]: string }): { [key: string]: string } {
    const result = { ...env };
    if (env.RPA_OUTPUT_WORKITEM_PATH || env.RPA_INPUT_WORKITEM_PATH) {
        result.RC_WORKITEM_ADAPTER = env.RC_WORKITEM_ADAPTER || "FileAdapter";
        if (env.RPA_INPUT_WORKITEM_PATH) {
            result.RC_WORKITEM_INPUT_PATH = env.RC_WORKITEM_INPUT_PATH || env.RPA_INPUT_WORKITEM_PATH;
        }
        if (env.RPA_OUTPUT_WORKITEM_PATH) {
            result.RC_WORKITEM_OUTPUT_PATH = env.RC_WORKITEM_OUTPUT_PATH || env.RPA_OUTPUT_WORKITEM_PATH;
        }
    }
    return result;
}

/** Attach discovered optional backends while retaining operator-provided values. */
export function withStudioEnvironment(
    environment: { [key: string]: string },
    credentialApi?: string,
    dataServerInfo?: string
): { [key: string]: string } {
    return {
        ...environment,
        ...(credentialApi && !environment.SEMA4AI_CREDENTIAL_API ? { SEMA4AI_CREDENTIAL_API: credentialApi } : {}),
        ...(dataServerInfo && !environment.SEMA4AI_DATA_SERVER_INFO
            ? { SEMA4AI_DATA_SERVER_INFO: dataServerInfo }
            : {}),
    };
}
