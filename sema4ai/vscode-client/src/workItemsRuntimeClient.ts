import * as http from "http";
import * as https from "https";

export class RuntimeHTTPError extends Error {
    constructor(message: string, readonly status: number, readonly code?: string) {super(message);}
}

/** Authenticated origin transport. No redirects, retries, fallback or raw errors. */
export class RuntimeTransport {
    readonly endpoint: string;
    constructor(endpoint: string, private readonly token: string, private readonly maxBytes = 4 * 1024 * 1024) {
        const url = new URL(endpoint);
        if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw Error("Use a Runtime origin without credentials, path or query.");
        const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
        if (!(url.protocol === "https:" || (url.protocol === "http:" && loopback))) throw Error("Managed Runtime requires HTTPS, or HTTP on loopback.");
        if (!token || /[\r\n]/.test(token)) throw Error("An explicit Runtime API token is required.");
        this.endpoint = url.origin;
    }
    protected request(method: string, route: string, body?: Buffer, contentType = "application/json", binary = false,
        options: {headers?: Record<string, string>; timeoutMs?: number} = {}): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const request = (this.endpoint.startsWith("https:") ? https : http).request(this.endpoint + route,
                { method, headers: { ...options.headers, Authorization: "Bearer " + this.token, ...(body ? { "Content-Type": contentType, "Content-Length": body.length } : {}) } },
                response => {
                    let size = 0;
                    const chunks: Buffer[] = [];
                    response.on("data", chunk => {
                        size += chunk.length;
                        if (size > this.maxBytes) { request.destroy(); reject(Error("Runtime response exceeds the editor limit.")); }
                        else chunks.push(Buffer.from(chunk));
                    });
                    response.on("end", () => {
                        const status = response.statusCode || 0;
                        if (status < 200 || status >= 300) {
                            // No redirect following, raw response/error/token logging or guessed retries.
                            let code: string | undefined;
                            try {
                                const value = JSON.parse(Buffer.concat(chunks).toString("utf8"))?.error?.code;
                                if (["not_authenticated", "forbidden", "not_found", "stale_claim", "changed_input", "approval_required", "blocked_uncertain_effect", "unsupported_operation", "unconfigured", "storage_unavailable", "request_too_large", "invalid_request"].includes(value)) code = value;
                            } catch { /* Legacy auth errors can be plain text. */ }
                            reject(new RuntimeHTTPError(status === 401 || status === 403 ? `Runtime access denied (${status}). No local fallback.` :
                                status === 503 ? "Runtime Work Items unavailable (503). No local fallback." : `Runtime request failed (${status}${code ? ": " + code : ""}).`, status, code));
                            return;
                        }
                        const bytes = Buffer.concat(chunks);
                        if (binary || !String(response.headers["content-type"]).includes("application/json")) {resolve(bytes); return;}
                        try { resolve(JSON.parse(bytes.toString("utf8"))); } catch {reject(Error("Invalid Runtime JSON response."));}
                    });
                    response.on("error", () => reject(Error("Runtime response was interrupted.")));
                });
            // The synchronous canonical MCP execution has a separate bounded
            // deadline. Existing published/managed REST requests stay at 10s.
            const timeoutMs = Math.min(options.timeoutMs || 10000, 360000);
            const deadline = setTimeout(() => request.destroy(Error("Runtime request timed out.")), timeoutMs);
            request.on("close", () => clearTimeout(deadline));
            request.setTimeout(timeoutMs, () => request.destroy(Error("Runtime request timed out.")));
            request.on("error", () => reject(Error("Runtime connection failed. Reconnect to the configured endpoint.")));
            request.end(body);
        });
    }
}

/** Published 1.0.4 local REST storage; never a managed lifecycle fallback. */
export class WorkItemsRuntimeClient extends RuntimeTransport {
    private verified = false;
    async connect(): Promise<{version: string; auth_enabled: boolean}> {
        this.verified = false;
        const config = await this.request("GET", "/config") as { version: string; auth_enabled: boolean };
        if (config.version !== "1.0.4") throw Error("This client supports published Runtime 1.0.4. Candidate durable APIs require a separately verified capability contract.");
        if (config.auth_enabled !== true) throw Error("Managed mode requires an authenticated Runtime. Configure its API key before connecting.");
        await this.request("GET", "/api/work-items?limit=1");
        this.verified = true;
        return config;
    }
    private requireVerified(): void { if (!this.verified) throw Error("Connect and verify this Runtime before accessing Work Items."); }
    async list(queue: string): Promise<{items: unknown[]; total: number}> {
        this.requireVerified();
        return this.request("GET", "/api/work-items?limit=100&queue_name=" + encodeURIComponent(queue)) as Promise<{items: unknown[]; total: number}>;
    }
    async seed(queue: string, payload: Record<string, unknown>): Promise<unknown> {
        this.requireVerified();
        const body = Buffer.from(JSON.stringify({queue_name: queue, payload}));
        if (body.length > 2 * 1024 * 1024) throw Error("Payload exceeds the editor limit.");
        return this.request("POST", "/api/work-items", body);
    }
    async attach(id: string, name: string, content: Buffer): Promise<unknown> {
        this.requireVerified();
        if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(name) || content.length > 2 * 1024 * 1024) throw Error("Invalid attachment name or size.");
        const boundary = "automation-work-item-" + require("crypto").randomBytes(24).toString("hex");
        const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), content, Buffer.from(`\r\n--${boundary}--\r\n`)]);
        return this.request("POST", `/api/work-items/${encodeURIComponent(id)}/files`, body, "multipart/form-data; boundary=" + boundary);
    }
    async download(id: string, name: string): Promise<Buffer> {
        this.requireVerified();
        return this.request("GET", `/api/work-items/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`, undefined, "application/json", true) as Promise<Buffer>;
    }
}
