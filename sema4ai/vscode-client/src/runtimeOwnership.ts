import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";

/** Nonsecret launch metadata. PID alone, a terminal name, and an HTTP response are not ownership. */
export interface RuntimeOwnership {
    version: 1;
    launchId: string;
    processId: number;
    processStart: string;
    bootId: string;
    directory: string;
    executable: string;
    dataDirectory: string;
    port: number;
    launchedAt: number;
}

export type RuntimeOwnershipInspection =
    | {kind: "verified"}
    | {kind: "not-listening"}
    | {kind: "unverified-listener"}
    | {kind: "stale"}
    | {kind: "unavailable"};

export function parseRuntimeOwnership(value: unknown): RuntimeOwnership | undefined {
    if (typeof value !== "object" || value === null) return;
    if (!("version" in value && value.version === 1 &&
        "launchId" in value && typeof value.launchId === "string" && /^[a-f0-9-]{36}$/i.test(value.launchId) &&
        "processId" in value && typeof value.processId === "number" && Number.isSafeInteger(value.processId) && value.processId > 0 &&
        "processStart" in value && typeof value.processStart === "string" && /^\d+$/.test(value.processStart) &&
        "bootId" in value && typeof value.bootId === "string" && /^[a-f0-9-]{36}$/i.test(value.bootId) &&
        "directory" in value && typeof value.directory === "string" && path.isAbsolute(value.directory) &&
        "executable" in value && typeof value.executable === "string" && path.isAbsolute(value.executable) &&
        "dataDirectory" in value && typeof value.dataDirectory === "string" && path.isAbsolute(value.dataDirectory) &&
        "port" in value && typeof value.port === "number" && Number.isInteger(value.port) && value.port > 0 && value.port <= 65535 &&
        "launchedAt" in value && typeof value.launchedAt === "number" && Number.isFinite(value.launchedAt) && value.launchedAt > 0)) return;
    // Construct only the known fields; persisted environment variables and credentials are never retained.
    return {version: 1, launchId: value.launchId, processId: value.processId, processStart: value.processStart,
        bootId: value.bootId, directory: value.directory, executable: value.executable,
        dataDirectory: value.dataDirectory, port: value.port, launchedAt: value.launchedAt};
}

async function processIdentity(processId: number): Promise<{start: string; parent: number}> {
    const stat = await fs.readFile(`/proc/${processId}/stat`, "utf8");
    // The comm field may itself contain spaces and parentheses. Fields after its final ')' are stable.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
    if (!/^\d+$/.test(fields[19] || "") || !/^\d+$/.test(fields[1] || "")) throw Error("Invalid process identity.");
    return {start: fields[19], parent: Number(fields[1])};
}

function isGone(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error &&
        (error.code === "ENOENT" || error.code === "ESRCH");
}

async function matchesLaunch(record: RuntimeOwnership): Promise<boolean> {
    const [identity, bootId, executable, directory, expectedDirectory, commandLine] = await Promise.all([
        processIdentity(record.processId), fs.readFile("/proc/sys/kernel/random/boot_id", "utf8"),
        fs.readlink(`/proc/${record.processId}/exe`), fs.readlink(`/proc/${record.processId}/cwd`),
        fs.realpath(record.directory), fs.readFile(`/proc/${record.processId}/cmdline`, "utf8"),
    ]);
    const args = commandLine.split("\0");
    return identity.start === record.processStart && bootId.trim() === record.bootId &&
        executable === record.executable && directory === expectedDirectory &&
        ["start", "--address=127.0.0.1", `--port=${record.port}`, `--datadir=${record.dataDirectory}`].every(arg => args.includes(arg));
}

/** Capture only the terminal process we just created, before allowing recovery after a host reload. */
export async function captureRuntimeOwnership(launch: {
    processId: number | undefined;
    directory: string;
    executable: string;
    dataDirectory: string;
    port: number;
}): Promise<RuntimeOwnership | undefined> {
    if (process.platform !== "linux" || !Number.isSafeInteger(launch.processId) || launch.processId <= 0) return;
    try {
        const identity = await processIdentity(launch.processId);
        const record: RuntimeOwnership = {
            version: 1, launchId: randomUUID(), processId: launch.processId, processStart: identity.start,
            bootId: (await fs.readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(),
            directory: path.resolve(launch.directory), executable: await fs.realpath(launch.executable),
            dataDirectory: path.resolve(launch.dataDirectory), port: launch.port, launchedAt: Date.now(),
        };
        return await matchesLaunch(record) ? record : undefined;
    } catch {
        // An unreadable/unsupported process identity cannot establish recovery authority.
        return;
    }
}

async function processTreeSockets(root: number): Promise<Set<string>> {
    // Only public process IDs/parent IDs are read outside the owned tree, never argv or environments.
    // Some Linux proc mounts omit task/*/children, so derive descendants from the process table.
    const processIds = (await fs.readdir("/proc")).filter(value => /^\d+$/.test(value)).map(Number);
    if (processIds.length > 8192) throw Error("Process table exceeds verification bound.");
    const childrenByParent = new Map<number, number[]>();
    for (let offset = 0; offset < processIds.length; offset += 64) {
        await Promise.all(processIds.slice(offset, offset + 64).map(async pid => {
            try {
                const identity = await processIdentity(pid);
                const children = childrenByParent.get(identity.parent) || [];
                children.push(pid);
                childrenByParent.set(identity.parent, children);
            } catch (error) {if (!isGone(error)) throw error;}
        }));
    }
    const pending = [root];
    const seen = new Set<number>();
    const sockets = new Set<string>();
    while (pending.length) {
        const pid = pending.shift();
        if (seen.has(pid)) continue;
        seen.add(pid);
        if (seen.size > 512) throw Error("Runtime process tree exceeds verification bound.");
        try {
            const files = await fs.readdir(`/proc/${pid}/fd`);
            for (const file of files) {
                try {
                    const target = await fs.readlink(`/proc/${pid}/fd/${file}`);
                    const match = /^socket:\[(\d+)\]$/.exec(target);
                    if (match) sockets.add(match[1]);
                } catch (error) {if (!isGone(error)) throw error;}
            }
            for (const child of childrenByParent.get(pid) || []) {
                try {if ((await processIdentity(child)).parent === pid) pending.push(child);}
                catch (error) {if (!isGone(error)) throw error;}
            }
        } catch (error) {if (!isGone(error)) throw error;}
    }
    return sockets;
}

/** Read-only local proof. No HTTP probes, environment reads, listener adoption, or process signals. */
export async function inspectRuntimeOwnership(record: RuntimeOwnership): Promise<RuntimeOwnershipInspection> {
    if (process.platform !== "linux") return {kind: "unavailable"};
    try {
        if (!(await matchesLaunch(record))) return {kind: "stale"};
        const table = await fs.readFile(`/proc/${record.processId}/net/tcp`, "utf8");
        const port = record.port.toString(16).toUpperCase().padStart(4, "0");
        const listeners = table.split("\n").slice(1).map(line => line.trim().split(/\s+/)).filter(columns =>
            columns[3] === "0A" && (columns[1] === `0100007F:${port}` || columns[1] === `00000000:${port}`));
        if (!listeners.length) return {kind: "not-listening"};
        const sockets = await processTreeSockets(record.processId);
        if (!(await matchesLaunch(record))) return {kind: "stale"};
        return listeners.every(columns => sockets.has(columns[9])) ? {kind: "verified"} : {kind: "unverified-listener"};
    } catch (error) {
        return {kind: isGone(error) ? "stale" : "unavailable"};
    }
}
