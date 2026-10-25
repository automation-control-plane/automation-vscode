import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { isDeepStrictEqual } from "util";
import { RuntimeTransport } from "./workItemsRuntimeClient";
import { validateManagedValue } from "./managedWorkItemsClient";
import { CanvasApplicationSummary, ManagedClaimInvocation, ManagedInvocationDescriptor, parseCanvasApplications, parseManagedInvocationDescriptors } from "./managedExecutionSelection";

const protocol = "2026-07-28"; // Python MCP 2.3.0, verified installed consumer recipe.
const schemas = JSON.parse(fs.readFileSync(path.join(__dirname, "../../resources/work-items/managed-mcp-schemas.json"), "utf8"));
// a38 and the reviewed candidate differ in top-level explanatory prose only.
// Do not recursively strip keys: a payload property named "description", defaults,
// nested schemas, enums, required fields and authority constraints remain exact.
function contractWithoutTopLevelProse(schema: any): unknown {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
    if (schema.description !== undefined && typeof schema.description !== "string") return schema;
    const {description, ...contract} = schema;
    return contract;
}
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export interface ManagedExecutionResult {
    state: "completed" | "failed" | "reconciliation_required";
    runId: string; attemptId: string; attemptEpoch: number;
    workItemId: string; workItemEpoch: number; runStatus: number;
    attemptState: string; workItemState: string | null;
}

/** Narrow stateless MCP consumer: three fixed tools, no shell, callbacks,
 * notifications, session fallback, automatic retry or client-selected audience.
 * A successful JSON-RPC exchange alone is never proof of execution success.
 */
export class ManagedExecutionClient extends RuntimeTransport {
    private verified = false;
    negotiated(): boolean {return this.verified;}
    constructor(endpoint: string, token: string, readonly workspace: string) {super(endpoint, token);}
    private async rpc(method: "server/discover" | "tools/list" | "tools/call", params: Record<string, unknown>, id: string = randomUUID(), execute = false): Promise<any> {
        const envelope = {jsonrpc: "2.0", id, method, params: {...params, _meta: {
            "io.modelcontextprotocol/protocolVersion": protocol,
            "io.modelcontextprotocol/clientInfo": {name: "automation-vscode", version: "1"},
            "io.modelcontextprotocol/clientCapabilities": {},
        }}};
        const body = Buffer.from(JSON.stringify(envelope));
        if (body.length > 512 * 1024) throw Error("MCP request exceeds the protocol limit.");
        let result: any;
        try {result = await this.request("POST", "/mcp", body, "application/json", false, {
            headers: {Accept: "application/json, text/event-stream", "Mcp-Protocol-Version": protocol, "Mcp-Method": method,
                ...(method === "tools/call" ? {"Mcp-Name": String(params.name)} : {})},
            timeoutMs: execute ? 360000 : 10000,
        });} catch (error) {this.verified = false; throw error;}
        if (!result || result.jsonrpc !== "2.0" || result.id !== id || result.error || !result.result || result.result.resultType && result.result.resultType !== "complete") {
            this.verified = false;
            throw Error("Runtime MCP protocol response was rejected. Execution outcome may be uncertain; inspect the retained request before another Run.");
        }
        return result.result;
    }
    async negotiate(): Promise<void> {
        this.verified = false;
        const discovered = await this.rpc("server/discover", {});
        if (!Array.isArray(discovered.supportedVersions) || !discovered.supportedVersions.includes(protocol) || !discovered.capabilities?.tools ||
            discovered._meta?.["io.modelcontextprotocol/serverInfo"]?.name !== "Action Server") throw Error("Unsupported Runtime MCP protocol or server identity. Native Run is unavailable.");
        const listed = await this.rpc("tools/list", {});
        if (!Array.isArray(listed.tools) || listed.tools.length > 512 || listed.nextCursor) throw Error("Incomplete Runtime tool catalog; native Run is unavailable.");
        for (const [name, expected] of Object.entries(schemas)) {
            const matching = listed.tools.filter(tool => tool.name === name);
            if (matching.length !== 1 || !isDeepStrictEqual(contractWithoutTopLevelProse(matching[0].inputSchema), contractWithoutTopLevelProse(expected)) || !matching[0]._meta?.ui?.visibility?.includes("model")) {
                throw Error("Unreviewed or unavailable Runtime MCP contract for " + name + ". Native Run is unavailable.");
            }
        }
        this.verified = true;
    }
    private async call(name: "canvas_open" | "canvas_inspect" | "capability_invoke", args: unknown, id?: string): Promise<any> {
        if (!this.verified) throw Error("Negotiate canonical MCP before discovering or executing capabilities.");
        validateManagedValue(args, schemas[name]);
        const response = await this.rpc("tools/call", {name, arguments: args}, id, name === "capability_invoke");
        if (response.isError || !response.structuredContent || typeof response.structuredContent !== "object") {
            this.verified = false;
            throw Error("Runtime did not confirm the canonical tool result. Inspect retained execution state; no automatic retry.");
        }
        return response.structuredContent;
    }
    async applications(): Promise<readonly CanvasApplicationSummary[]> {return parseCanvasApplications(await this.call("canvas_open", {}));}
    async descriptors(applicationId: string): Promise<readonly ManagedInvocationDescriptor[]> {
        return parseManagedInvocationDescriptors(await this.call("canvas_inspect", {appId: applicationId}), {workspace: this.workspace, applicationId});
    }
    async invokeClaim(request: ManagedClaimInvocation, requestId: string): Promise<ManagedExecutionResult> {
        if (!uuid(requestId) || Object.keys(request).sort().join(",") !== "claim,mode,snapshot") throw Error("Invalid native execution request identity or variant.");
        validateManagedValue(request, {$ref: "#/$defs/GenericClaimInvocation"}, schemas.capability_invoke);
        const response = await this.call("capability_invoke", request, requestId);
        const value = response.execution;
        if (!value || !["completed", "failed", "reconciliation_required"].includes(value.state) || !uuid(value.runId) || !uuid(value.attemptId) ||
            !Number.isSafeInteger(value.attemptEpoch) || value.attemptEpoch < 1 || value.workItemId !== request.claim.item_id || value.workItemEpoch !== request.claim.epoch ||
            !Number.isInteger(value.runStatus) || !["running", "succeeded", "failed"].includes(value.attemptState) || !(value.workItemState === null || typeof value.workItemState === "string")) {
            throw Error("Runtime execution result identity/contract mismatch. Inspect the retained request; do not retry.");
        }
        // Only validated public identities enter the UI. Output handles are
        // independently rediscovered using authorized linked managed Run reads.
        return {state: value.state, runId: value.runId, attemptId: value.attemptId, attemptEpoch: value.attemptEpoch,
            workItemId: value.workItemId, workItemEpoch: value.workItemEpoch, runStatus: value.runStatus,
            attemptState: value.attemptState, workItemState: value.workItemState};
    }
}
