import * as net from "net";

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
