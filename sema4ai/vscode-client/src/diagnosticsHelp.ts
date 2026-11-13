// RCC emits documentation-relative paths. This maintained destination was verified
// against the legacy robocorp.com/docs redirect; it does not affect RCC settings.
const documentationBase = "https://sema4.ai/docs/automation/";

export function resolveDiagnosticsHelp(value: unknown): string | undefined {
    if (typeof value !== "string" || !value.trim() || /[\s\\\x00-\x1f\x7f]/.test(value)) return undefined;
    try {
        // Reject malformed escapes, protocol-relative targets and path traversal.
        const decoded = decodeURIComponent(value);
        if (/[\\\x00-\x1f\x7f]/.test(decoded) || decoded.split(/[/?#]/).includes("..")) return undefined;
        let target: URL;
        if (value.startsWith("/troubleshooting/")) {
            target = new URL(value.slice(1), documentationBase);
        } else {
            if (!/^https?:\/\//i.test(value)) return undefined;
            target = new URL(value);
        }
        if (!["http:", "https:"].includes(target.protocol) || !target.hostname || target.username || target.password) {
            return undefined;
        }
        return target.href;
    } catch {
        return undefined;
    }
}

export async function openDiagnosticsHelp(
    value: unknown,
    open: (url: string) => PromiseLike<boolean>,
    explain: (message: string) => unknown
): Promise<void> {
    const target = resolveDiagnosticsHelp(value);
    if (!target) {
        await explain("No supported troubleshooting URL was supplied. See the Automation output for RCC diagnostics.");
        return;
    }
    try {
        if (await open(target)) return;
    } catch {
        // The OS may reject a valid URL; retain the copyable destination.
    }
    await explain(`Unable to open troubleshooting help. Open this URL in a browser: ${target}`);
}
