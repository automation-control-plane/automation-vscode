import * as net from "net";
import { performance } from "perf_hooks";

export function runtimeServerPort(value: unknown = 8082): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
        throw new Error("sema4ai.actionServer.port must be an integer between 1 and 65535.");
    }
    return value;
}

/** Check before launch. Never contact, attach to or shut down the current listener. */
export function assertRuntimePortAvailable(port: number): Promise<void> {
    runtimeServerPort(port);
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once("error", error => reject(new Error(
            `Cannot start Actions Runtime on 127.0.0.1:${port}: ${error.message}. ` +
            "Choose an unused sema4ai.actionServer.port. Existing listeners are left running."
        )));
        probe.listen({host: "127.0.0.1", port, exclusive: true}, () => probe.close(error => error ? reject(error) : resolve()));
    });
}

/** Terminal disposal can precede child shutdown. Probe only; never signal or adopt a listener. */
export async function waitForOwnedRuntimeStop({
    port,
    processId,
    timeoutMs = 15000,
    pollMs = 100,
}: {
    port: number;
    processId: number | undefined;
    timeoutMs?: number;
    pollMs?: number;
}): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    while (true) {
        let exited = processId === undefined;
        if (processId !== undefined) {
            try {
                process.kill(processId, 0); // Existence check only, no termination signal.
            } catch (error) {
                exited = typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
            }
        }
        let released = false;
        try {
            await assertRuntimePortAvailable(port);
            released = true;
        } catch {
            // The previous child or an unrelated service may still hold this port.
        }
        if (exited && released) {
            return;
        }
        const remaining = deadline - performance.now();
        if (remaining <= 0) {
            throw new Error(
                `Timed out waiting for owned Actions Runtime${processId === undefined ? "" : ` PID ${processId}`} ` +
                `to exit and release 127.0.0.1:${port} after ${timeoutMs}ms. ` +
                "No replacement was started. Existing listeners were left running."
            );
        }
        await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, remaining)));
    }
}
