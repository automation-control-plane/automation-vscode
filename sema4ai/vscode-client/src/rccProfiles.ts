import {execFile, ExecFileOptions} from "child_process";
import * as path from "path";
import * as fs from "fs";
import {RuntimeKind} from "./runtimePaths";

type Runner = (executable: string, args: string[], options: ExecFileOptions) => Promise<string>;
interface Options {
    executable: string;
    homes: Record<RuntimeKind, string>;
    env: NodeJS.ProcessEnv;
    configLocation?: string;
    run?: Runner;
}

// Do not use the general logging wrapper: RCC settings/errors may contain proxy
// credentials or certificate material. Only parsed allowlisted fields leave here.
export const runPrivateRcc: Runner = (executable, args, options) => new Promise((resolve, reject) => {
    execFile(executable, args, {...options, encoding: "utf8", timeout: 90000, maxBuffer: 4 * 1024 * 1024,
        windowsHide: true}, (error, stdout) => error ? reject(error) : resolve(stdout));
});

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseObject(text: string): Record<string, unknown> {
    try {
        const value: unknown = JSON.parse(text);
        if (record(value)) return value;
    } catch { /* RCC may include private text in malformed output. */ }
    throw Error("Invalid RCC JSON response. Check the selected target's configuration.");
}
function explicitTarget(value: unknown): asserts value is RuntimeKind {
    if (value !== "actions" && value !== "robots") throw Error("Select an explicit Actions or Robots target.");
}
function bool(value: unknown): boolean | "unavailable" {
    return typeof value === "boolean" ? value : "unavailable";
}
function safeType(value: unknown): string {
    return typeof value === "string" && /^[a-zA-Z0-9 _-]{1,40}$/.test(value) ? value : "unknown";
}

export function parseLongPathStatus(registry: string, skipped: boolean) {
    const match = registry.match(/LongPathsEnabled\s+REG_DWORD\s+(0x[01])\b/i);
    return {support: match ? (match[1].toLowerCase() === "0x1" ? "enabled" : "disabled") : "unavailable",
        check: skipped ? "explicitly-skipped" : "checked"};
}

/** Bounded wrappers around the existing RCC configuration operations, independent of LS readiness. */
export class LocalRccProfiles {
    private readonly runner: Runner;
    constructor(private readonly options: Options) {this.runner = options.run || runPrivateRcc;}

    private async invoke(target: RuntimeKind, args: string[]): Promise<string> {
        explicitTarget(target);
        try {
            return await this.runner(this.options.executable,
                [...args, ...(this.options.configLocation ? ["--config", this.options.configLocation] : []),
                    "--controller", "AutomationCode", "--bundled", "--robocorp"],
                {env: {...this.options.env, ACTIONS_HOME: this.options.homes.actions, ROBOTS_HOME: this.options.homes.robots,
                    ROBOCORP_HOME: this.options.homes[target], RCC_HOLOTREE_MODE: "private"}, shell: false});
        } catch {
            throw Error(`RCC ${args.slice(0, 2).join(" ")} failed for ${target}. Check executable access, the selected home and approved profile; no other home was changed.`);
        }
    }

    private checkMutation(target: RuntimeKind) {
        explicitTarget(target);
        if (this.options.configLocation) {
            const canonical = (value: string) => fs.existsSync(value) ? fs.realpathSync(value) : path.resolve(value);
            const relative = path.relative(canonical(this.options.homes[target]), canonical(this.options.configLocation));
            if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
                throw Error("The configured RCC settings file is outside the selected home. Import/switch is unavailable to avoid cross-home changes; inspect the configured file explicitly.");
            }
        }
    }

    async profiles(target: RuntimeKind) {
        const value = parseObject(await this.invoke(target, ["config", "switch", "-j"]));
        if (typeof value.current !== "string" || !record(value.profiles)) throw Error("RCC profile status is unavailable.");
        return {current: value.current, names: Object.keys(value.profiles)};
    }

    async status(target: RuntimeKind) {
        const profiles = await this.profiles(target);
        const settings = parseObject(await this.invoke(target, ["config", "settings", "--json"]));
        const certificates = record(settings.certificates) ? settings.certificates : {};
        const version = (await this.invoke(target, ["version"])).match(/\bv?\d+\.\d+\.\d+(?:[-\w.]*)?/);
        return {scope: "local-extension", target, home: this.options.homes[target], executable: this.options.executable,
            version: version ? version[0] : "unavailable", profile: profiles.current, profiles: profiles.names,
            certificates: {verifySsl: bool(certificates["verify-ssl"]), sslNoRevoke: bool(certificates["ssl-no-revoke"]),
                legacyRenegotiationAllowed: bool(certificates["legacy-renegotiation-allowed"])}};
    }

    async diagnostics(target: RuntimeKind) {
        const value = parseObject(await this.invoke(target, ["configure", "diagnostics", "-j"]));
        if (!Array.isArray(value.checks)) throw Error("RCC diagnostic checks are unavailable.");
        return {checkedAt: new Date().toISOString(), checks: value.checks.filter(record).map(check => ({
            category: typeof check.category === "number" ? check.category : 0,
            status: safeType(check.status), type: safeType(check.type)}))};
    }

    async importProfile(target: RuntimeKind, filename: string): Promise<void> {
        this.checkMutation(target);
        if (!filename || typeof filename !== "string") throw Error("Select a profile file to import.");
        await this.invoke(target, ["config", "import", "-f", filename]);
    }

    async switchProfile(target: RuntimeKind, name: string): Promise<void> {
        this.checkMutation(target);
        const profiles = await this.profiles(target);
        if (name !== "<remove-current-back-to-defaults>" && !profiles.names.includes(name)) {
            throw Error("The selected profile is not available in this target home. Refresh status or import it first.");
        }
        await this.invoke(target, ["config", "switch", ...(name === "<remove-current-back-to-defaults>" ? ["-n"] : ["-p", name])]);
    }
}
