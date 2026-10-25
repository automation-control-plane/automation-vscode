import { isDeepStrictEqual } from "util";
import { managedCommandSchema, ManagedSnapshot, QueueRef, validateManagedValue } from "./managedWorkItemsClient";

// Pure DTO boundary for the reviewed public a38 Canvas MCP projection.
// These functions do not discover, grant, claim or invoke. The host must retain
// selections and negotiate authenticated MCP before offering an execution action.
export interface CanvasApplicationSummary {
    readonly applicationId: string;
    readonly title: string;
    readonly activeRevisionId: string | null;
}
export interface ManagedInvocationDescriptor {
    readonly bindingId: string;
    readonly mode: "generic";
    readonly snapshot: ManagedSnapshot;
    readonly inputMode: "none" | "optional" | "required" | "claim";
    readonly inputQueue: QueueRef | null;
    readonly standaloneAllowed: boolean;
    readonly inputSchema: Readonly<Record<string, unknown>>;
}
export interface ManagedClaimRef {
    readonly queue: QueueRef;
    readonly item_id: string;
    readonly owner_id: string;
    readonly epoch: number;
}
export interface ManagedClaimInvocation {
    readonly mode: "generic";
    readonly snapshot: ManagedSnapshot;
    readonly claim: ManagedClaimRef;
}

const schema = managedCommandSchema("items.enqueue");
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const revision = (value: unknown): value is string => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
function requireValue(condition: unknown): asserts condition {
    if (!condition) throw Error("Canonical execution selection is invalid or outside the selected scope.");
}
function object(value: unknown): Record<string, any> {
    requireValue(value && typeof value === "object" && !Array.isArray(value));
    return value as Record<string, any>;
}
function exact(value: Record<string, unknown>, keys: string[]): void {
    requireValue(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
}
function jsonCopy<T>(value: T, limit: number): T {
    const json = JSON.stringify(value, (_key, child) => {
        requireValue(child === null || ["string", "boolean", "object"].includes(typeof child) || (typeof child === "number" && Number.isFinite(child)));
        return child;
    });
    requireValue(typeof json === "string" && Buffer.byteLength(json) <= limit);
    return JSON.parse(json);
}
function freeze<T>(value: T): T {
    if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}
function validateReference(value: unknown, name: "ExecutionSnapshot" | "QueueRef" | "ClaimRef"): void {
    validateManagedValue(value, {$ref: "#/$defs/" + name}, schema);
}

/** Accept structuredContent only, never private View/app-session metadata. */
export function parseCanvasApplications(value: unknown): readonly CanvasApplicationSummary[] {
    const applications = object(value).applications;
    requireValue(Array.isArray(applications) && applications.length <= 200);
    const ids = new Set<string>();
    return freeze(applications.map(raw => {
        const app = object(raw);
        exact(app, ["applicationId", "title", "activeRevisionId"]);
        requireValue(uuid(app.applicationId) && !ids.has(app.applicationId));
        requireValue(typeof app.title === "string" && app.title.length > 0 && [...app.title].length <= 128);
        requireValue(app.activeRevisionId === null || revision(app.activeRevisionId));
        ids.add(app.applicationId);
        return jsonCopy(app, 4096) as CanvasApplicationSummary;
    }));
}

/** Preserve the exact admitted snapshot, including omission of legacy defaults. */
export function parseManagedInvocationDescriptors(value: unknown, context: {workspace: string; applicationId: string}): readonly ManagedInvocationDescriptor[] {
    const inspected = object(value);
    requireValue(uuid(context.workspace) && uuid(context.applicationId) && inspected.applicationId === context.applicationId);
    requireValue(inspected.activeRevisionId === null || revision(inspected.activeRevisionId));
    requireValue(inspected.invocationReadiness === "not-checked");
    const descriptors = jsonCopy(inspected.invocationDescriptors, 128 * 1024);
    requireValue(Array.isArray(descriptors) && descriptors.length <= 64);
    requireValue(inspected.invocationAvailability === (descriptors.length ? "authorized" : "unavailable"));
    const bindings = new Set<string>();
    return freeze(descriptors.map(raw => {
        const descriptor = object(raw);
        exact(descriptor, ["bindingId", "mode", "snapshot", "inputMode", "inputQueue", "standaloneAllowed", "inputSchema"]);
        requireValue(typeof descriptor.bindingId === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(descriptor.bindingId) && !bindings.has(descriptor.bindingId));
        bindings.add(descriptor.bindingId);
        requireValue(descriptor.mode === "generic" && ["none", "optional", "required", "claim"].includes(descriptor.inputMode));
        requireValue(typeof descriptor.standaloneAllowed === "boolean");
        validateReference(descriptor.snapshot, "ExecutionSnapshot");
        const snapshot = object(descriptor.snapshot), deployment = object(snapshot.deployment);
        requireValue(deployment.workspace_id === context.workspace && deployment.deployment_id === context.applicationId && deployment.revision_id === inspected.activeRevisionId);
        requireValue(snapshot.runtime_kind === "rcc");
        if (descriptor.inputQueue !== null) {
            validateReference(descriptor.inputQueue, "QueueRef");
            requireValue(descriptor.inputQueue.workspace_id === context.workspace && isDeepStrictEqual(descriptor.inputQueue.deployment, deployment));
        }
        // These are independent server projections, not client-derived grants.
        // In particular standaloneAllowed describes the capability declaration;
        // it must not be inferred from the deployment's inputMode.
        object(descriptor.inputSchema);
        jsonCopy(descriptor.inputSchema, 32 * 1024);
        return descriptor as ManagedInvocationDescriptor;
    }));
}

/** Construct the existing typed MCP claim variant, never claim the item here. */
export function buildManagedClaimInvocation(descriptor: ManagedInvocationDescriptor, selectedItem: unknown): ManagedClaimInvocation {
    const item = object(selectedItem);
    requireValue(descriptor.mode === "generic" && descriptor.inputMode !== "none" && descriptor.inputQueue !== null);
    validateReference(descriptor.snapshot, "ExecutionSnapshot");
    validateReference(item.claim, "ClaimRef");
    requireValue(uuid(item.id) && uuid(item.claim.owner_id) && item.queue_state === "IN_PROGRESS");
    requireValue(item.claim.item_id === item.id && isDeepStrictEqual(item.claim.queue, descriptor.inputQueue));
    requireValue(isDeepStrictEqual(item.queue, descriptor.inputQueue) && isDeepStrictEqual(item.snapshot, descriptor.snapshot));
    return freeze(jsonCopy({mode: "generic", snapshot: descriptor.snapshot, claim: item.claim} as ManagedClaimInvocation, 512 * 1024));
}
