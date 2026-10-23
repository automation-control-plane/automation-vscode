import * as fs from "fs";
import * as path from "path";
import { RuntimeHTTPError, RuntimeTransport } from "./workItemsRuntimeClient";

const contract = JSON.parse(fs.readFileSync(path.join(__dirname, "../../resources/work-items/managed-v1.json"), "utf8"));
export const MANAGED_VERSION = "actions.managed-work-items/v1";
export const MANAGED_PERMISSIONS: Record<string, string> = {
    "queues.list": "work_items.read", "items.list": "work_items.read", "items.get": "work_items.read",
    "items.enqueue": "work_items.enqueue", "items.claim": "work_items.claim", "items.renew": "work_items.claim",
    "items.complete": "work_items.complete", "items.retry": "work_items.retry", "items.cancel": "work_items.cancel",
    "reviews.list": "work_items.review", "reviews.decide": "work_items.review", "runs.get": "work_items.read",
    "runs.logs": "work_items.read", "artifacts.read": "work_items.artifact.read",
};
export interface ManagedCapabilities {
    schema_version: string; runtime_version: string; sdk_version: string; workspace_id: string;
    operations: string[]; permissions: string[]; backend: "sqlite" | "postgresql"; time_authority: "database"; modes: string[];
}
export interface QueueRef { workspace_id: string; deployment: {workspace_id: string; deployment_id: string; revision_id: string}; queue_id: string; }
export interface ManagedCommand { schema_version: string; operation: string; queue?: QueueRef; workspace_id?: string; [key: string]: unknown; }
export interface ManagedEnvelope { schema_version: string; operation: string; runtime_version: string; result: Record<string, unknown>; }
export function managedCommandSchema(operation: string): any {
    const reference = contract.commands.discriminator.mapping[operation];
    if (!reference) throw Error("Unknown managed operation.");
    return {...contract.commands.$defs[reference.slice(8)], $defs: contract.commands.$defs};
}

function stable(value: unknown): string {
    if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
    if (value !== null && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
    return JSON.stringify(value);
}
function uuid(value: unknown): boolean {return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);}
function version(value: string): number[] {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:(a|b|rc)(\d+))?$/.exec(value);
    if (!match) throw Error("Unsupported managed candidate version format.");
    return [+match[1], +match[2], +match[3], match[4] ? {a: 0, b: 1, rc: 2}[match[4]] : 3, +(match[5] || 0)];
}
function atLeast(value: string, floor: string): boolean {
    const a = version(value), b = version(floor);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return true;
}
function finiteJSON(value: unknown, parents = new Set<object>(), depth = 0): void {
    if (depth > 100) throw Error("Managed JSON nesting exceeds the limit.");
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (!value || typeof value !== "object" || parents.has(value)) throw Error("Managed commands require finite JSON values.");
    parents.add(value);
    for (const child of Object.values(value)) finiteJSON(child, parents, depth + 1);
    parents.delete(value);
}

/** Validates the exact admitted generated schema vocabulary, with local refs only.
 * This is not an arbitrary external JSON Schema interpreter. Semantic authority,
 * canonical digests, admission and live fences remain server checks.
 */
export function validateManagedValue(value: unknown, schema: any, root = schema, location = "$", depth = 0): void {
    if (depth > 100) throw Error("Managed value nesting exceeds the protocol limit.");
    const fail = () => {throw Error("Managed contract validation failed at " + location);};
    if (schema.$ref) {
        if (!schema.$ref.startsWith("#/$defs/")) fail();
        const referred = root.$defs?.[schema.$ref.slice(8)];
        if (!referred) fail();
        return validateManagedValue(value, referred, root, location, depth + 1);
    }
    for (const union of [schema.anyOf, schema.oneOf]) if (union) {
        let count = 0;
        for (const branch of union) try {validateManagedValue(value, branch, root, location, depth + 1); count++;} catch {}
        if (!count || (union === schema.oneOf && count !== 1)) fail();
    }
    if ("const" in schema && value !== schema.const) fail();
    if (schema.enum && !schema.enum.includes(value)) fail();
    const type = schema.type;
    if (type === "null" && value !== null) fail();
    if (type === "boolean" && typeof value !== "boolean") fail();
    if (type === "string") {
        if (typeof value !== "string") fail();
        const text = value as string, size = [...text].length;
        if ((schema.minLength !== undefined && size < schema.minLength) || (schema.maxLength !== undefined && size > schema.maxLength)) fail();
        if (schema.pattern && !new RegExp(schema.pattern).test(text)) fail();
        if (schema.format && (schema.format !== "uuid" || !uuid(text))) fail();
    }
    if (type === "number" || type === "integer") {
        if (typeof value !== "number" || !Number.isFinite(value) || (type === "integer" && !Number.isSafeInteger(value))) fail();
        if ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)) fail();
    }
    if (type === "array") {
        if (!Array.isArray(value)) fail();
        const values = value as unknown[];
        if (schema.maxItems !== undefined && values.length > schema.maxItems) fail();
        for (let i = 0; i < values.length; i++) validateManagedValue(values[i], schema.items || {}, root, location + "[" + i + "]", depth + 1);
    }
    if (type === "object") {
        if (!value || typeof value !== "object" || Array.isArray(value)) fail();
        const object = value as Record<string, unknown>;
        for (const name of schema.required || []) if (!Object.prototype.hasOwnProperty.call(object, name)) fail();
        for (const name of Object.keys(object)) {
            if (Object.prototype.hasOwnProperty.call(schema.properties || {}, name)) validateManagedValue(object[name], schema.properties[name], root, location + "." + name, depth + 1);
            else if (schema.additionalProperties === false) fail();
            else if (typeof schema.additionalProperties === "object") validateManagedValue(object[name], schema.additionalProperties, root, location + "." + name, depth + 1);
        }
    }
}

/** Canonical managed client: no legacy routes, actor construction or worker loop. */
export class ManagedWorkItemsClient extends RuntimeTransport {
    private admitted?: ManagedCapabilities;
    constructor(endpoint: string, token: string, readonly workspace: string) {super(endpoint, token, 512 * 1024); if (!uuid(workspace)) throw Error("Enter the canonical Workspace UUID.");}
    async negotiate(): Promise<ManagedCapabilities> {
        this.admitted = undefined;
        let live: unknown;
        try {live = await this.request("GET", "/api/managed-work-items/v1/schema");} catch (error) {
            if (error instanceof RuntimeHTTPError && [404, 503].includes(error.status)) throw Error(`Canonical managed API unavailable (${error.status}${error.code ? ": " + error.code : ""}). A configured SQL/auth-backed compatible Runtime is required; no local fallback.`);
            throw error;
        }
        if (stable(live) !== stable(contract)) throw Error("Runtime managed schema differs from the pinned contract. A reviewed client update is required.");
        const value = await this.request("GET", "/api/managed-work-items/v1/capabilities?workspace_id=" + encodeURIComponent(this.workspace)) as ManagedCapabilities;
        const allowed = ["schema_version", "runtime_version", "sdk_version", "workspace_id", "operations", "permissions", "backend", "time_authority", "modes"];
        if (!value || Object.keys(value).some(key => !allowed.includes(key)) || value.schema_version !== MANAGED_VERSION || value.workspace_id !== this.workspace || value.time_authority !== "database" || !["sqlite", "postgresql"].includes(value.backend)) throw Error("Invalid managed capability scope or authority.");
        if (!Array.isArray(value.operations) || !Array.isArray(value.permissions) || !Array.isArray(value.modes) || !value.modes.every(mode => ["reviewed", "producer", "consumer", "optional", "none"].includes(mode))) throw Error("Invalid managed capability set.");
        if (new Set(value.operations).size !== value.operations.length || new Set(value.permissions).size !== value.permissions.length || value.operations.some(operation => !MANAGED_PERMISSIONS[operation] || !value.permissions.includes(MANAGED_PERMISSIONS[operation])) || value.permissions.some(permission => !Object.values(MANAGED_PERMISSIONS).includes(permission))) throw Error("Managed operation lacks an explicit known grant.");
        if (!atLeast(value.runtime_version, contract.minimum_runtime) || !atLeast(value.sdk_version, contract.minimum_sdk)) throw Error("Runtime or fenced SDK is below the managed protocol floor.");
        this.admitted = value;
        return value;
    }
    capabilities(): ManagedCapabilities | undefined {return this.admitted;}
    validateCommand(command: ManagedCommand): Buffer {
        const available = this.admitted;
        if (!available || !available.operations.includes(command.operation)) throw Error("Managed operation is unavailable or not granted. Reconnect to refresh live capabilities.");
        finiteJSON(command);
        validateManagedValue(command, contract.commands);
        const workspace = command.operation === "queues.list" ? command.workspace_id : command.queue?.workspace_id;
        if (workspace !== this.workspace || (command.queue && command.queue.deployment.workspace_id !== workspace)) throw Error("Managed command crosses Workspace scope.");
        if (command.operation === "items.enqueue" && stable((command.snapshot as any)?.deployment) !== stable(command.queue?.deployment)) throw Error("Enqueue snapshot crosses the exact queue Deployment revision.");
        if ((command.operation === "items.renew" || command.operation === "items.complete") && stable((command.claim as any)?.queue) !== stable(command.queue)) throw Error("Claim belongs to another queue.");
        if (command.operation === "reviews.decide" && stable((command.proposal as any)?.binding?.scope?.deployment) !== stable(command.queue?.deployment)) throw Error("Review decision crosses the exact Deployment revision.");
        const raw = Buffer.from(JSON.stringify(command));
        if (raw.length > 512 * 1024) throw Error("Managed command exceeds 512 KiB.");
        return raw;
    }
    async execute(command: ManagedCommand): Promise<ManagedEnvelope> {
        const raw = this.validateCommand(command);
        const available = this.admitted;
        try {
            const value = await this.request("POST", "/api/managed-work-items/v1/operations", raw) as ManagedEnvelope;
            if (!value || Object.keys(value).some(key => !["schema_version", "operation", "runtime_version", "result"].includes(key)) || value.schema_version !== MANAGED_VERSION || value.operation !== command.operation || value.runtime_version !== available.runtime_version) throw Error("Managed response identity changed; reconnect and reconcile the original request.");
            validateManagedValue(value.result, contract.results[command.operation]);
            const sameQueue = (queue: QueueRef) => {
                if (queue.workspace_id !== this.workspace || queue.deployment.workspace_id !== this.workspace || (command.queue && stable(queue) !== stable(command.queue))) throw Error("Managed response crosses the requested queue scope.");
            };
            const item = (entry: any) => {
                sameQueue(entry.queue);
                if (!uuid(entry.id) || stable(entry.snapshot.deployment) !== stable(entry.queue.deployment) || (entry.claim && (stable(entry.claim.queue) !== stable(entry.queue) || entry.claim.item_id !== entry.id)) || ((entry.claim === null) !== (entry.lease_deadline_ms === null))) throw Error("Managed item identity/admission/claim mismatch.");
            };
            const result: any = value.result;
            for (const queue of result.queues || []) sameQueue(queue.queue);
            for (const entry of result.items || []) item(entry);
            if (result.item) item(result.item);
            if (command.item_id && result.item?.id && result.item.id !== command.item_id) throw Error("Managed response changed the requested item.");
            if (command.operation === "items.claim" || command.operation === "items.renew") {
                if (stable(result.item?.claim || null) !== stable(result.claim) || (result.item?.lease_deadline_ms || null) !== result.lease_deadline_ms) throw Error("Managed claim result mismatch.");
            }
            for (const review of [...(result.reviews || []), ...(result.review ? [result.review] : [])]) {
                if (stable(review.proposal.binding.scope.deployment) !== stable(command.queue?.deployment) || (["pending", "rejected"].includes(review.state) && review.work_item_id !== null)) throw Error("Managed review binding mismatch.");
            }
            if (command.operation === "reviews.decide" && (stable(result.review.proposal) !== stable(command.proposal) || result.review.state !== (command.decision === "approve" ? "approved" : "rejected"))) throw Error("Managed review decision changed its exact binding.");
            if (result.run) {
                if (!uuid(result.run.id) || result.run.id !== command.run_id || stable(result.run.snapshot.deployment) !== stable(command.queue?.deployment) || result.run.artifacts.some(artifact => artifact.run_id !== result.run.id)) throw Error("Managed Run/artifact identity mismatch.");
            }
            if (command.operation === "runs.logs" && result.run_id !== command.run_id) throw Error("Managed log Run identity mismatch.");
            if (command.operation === "artifacts.read" && result.artifact.handle !== command.artifact_handle) throw Error("Managed artifact handle mismatch.");
            return value;
        } catch (error) {
            if (error instanceof RuntimeHTTPError && [401, 403].includes(error.status)) this.admitted = undefined;
            // The caller retains the exact mutation/key on timeout or uncertainty.
            // There is deliberately no automatic replay, new key or fallback.
            throw error;
        }
    }
}
