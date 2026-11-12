/** Startup readiness shared by activation and views. No retries or environment mutations. */
export interface LanguageServerStartup {
    status: "starting" | "ready" | "failed";
    title: string;
    message: string;
    reason?: "network" | "environment" | "server" | "activation";
}

const listeners = new Set<() => void>();
let current: Readonly<LanguageServerStartup> = Object.freeze({status: "starting",
    title: "Preparing language services", message: "Automation is preparing its Python environment and starting language services. Package discovery will begin when startup finishes."});

export function getLanguageServerStartup(): Readonly<LanguageServerStartup> {return current;}
export function onLanguageServerStartupChanged(listener: () => void): {dispose(): void} {
    listeners.add(listener);
    return {dispose: () => {listeners.delete(listener);}};
}
function update(value: LanguageServerStartup): void {
    current = Object.freeze(value);
    for (const listener of listeners) listener();
}
export function beginLanguageServerStartup(): void {
    update({status: "starting", title: "Preparing language services",
        message: "Automation is preparing its Python environment and starting language services. Package discovery will begin when startup finishes."});
}
export function completeLanguageServerStartup(): void {
    update({status: "ready", title: "Language services ready", message: ""});
}

/** Inspect known process-error fields for classification, never expose raw output/URLs to the UI. */
function diagnosticText(cause: unknown, depth = 0): string {
    if (depth > 3 || !cause) return "";
    if (typeof cause === "string") return cause.slice(0, 65536);
    if (typeof cause !== "object") return "";
    const error = cause as {message?: unknown; stdout?: unknown; stderr?: unknown; error?: unknown; cause?: unknown};
    return [error.message, error.stderr, error.stdout, error.error, error.cause]
        .map(value => diagnosticText(value, depth + 1)).join("\n");
}

export function failLanguageServerStartup(cause: unknown, phase: "environment" | "server" | "activation" = "server"): void {
    // LanguageClient can replace a bootstrap rejection with a generic startup error.
    // Preserve the earlier, more specific explanation until an explicit new startup.
    if (current.status === "failed") return;
    const text = diagnosticText(cause);
    const network = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|connection (?:refused|timed out|failed)|(?:could not|couldn't|cannot|failed to) (?:resolve|connect)|\b(?:network|download|connection|operation)\b[^\n]{0,100}\b(?:timeout|timed out)|SSL certificate|certificate verify failed|proxy (?:error|authentication)|HTTP (?:403|407)/i.test(text);
    const message = network
        ? "The language-service environment could not start because a dependency download or connection failed. Check repository access and network/proxy settings for this VS Code process. Open diagnostic logs for the exact error, then retry startup."
        : phase === "environment"
            ? "Automation could not prepare its language-service Python environment. Check the configured RCC and language-server Python paths, and review the original error in diagnostic logs. Correct the reported problem, then retry startup."
            : "Automation language services could not start. Review the original error in diagnostic logs and check the language-server settings, then retry startup.";
    update({status: "failed", title: network ? "Language-service connection failed" : "Language services unavailable",
        reason: network ? "network" : phase, message});
}
