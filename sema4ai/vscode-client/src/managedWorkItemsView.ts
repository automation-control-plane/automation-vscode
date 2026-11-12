import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { createHash, randomUUID } from "crypto";
import { ManagedWorkItemsClient, ManagedCommand, MANAGED_VERSION, MANAGED_PERMISSIONS, QueueRef, ManagedQueueMode, ManagedSnapshot, validateManagedJournalCommand, validateManagedResponse } from "./managedWorkItemsClient";
import { RuntimeHTTPError, canonicalRuntimeOrigin } from "./workItemsRuntimeClient";
import { isDeepStrictEqual } from "util";
import { ManagedExecutionClient, ManagedExecutionResult, validateManagedExecutionConfirmation, validateManagedExecutionRequest, validateManagedExecutionResult } from "./managedExecutionClient";
import { buildManagedClaimInvocation, CanvasApplicationSummary, ManagedClaimInvocation, ManagedInvocationDescriptor } from "./managedExecutionSelection";

// DTOs are validated against the exact Actions-owned schema in the client.
interface Queue {queue: QueueRef; label: string; mode: ManagedQueueMode; permissions: string[]; counts: Record<string, number>;}
interface Item {id: string; queue: QueueRef; payload: unknown; snapshot: ManagedSnapshot; claim: {epoch: number; [key: string]: unknown} | null; run_ids: string[]; [key: string]: unknown;}
interface Review {proposal: {review_id: string; binding: {run_id: string; [key: string]: unknown}; [key: string]: unknown}; state: string; [key: string]: unknown;}
interface Run {id: string; artifacts: {handle: string; digest: string; size: number; run_id: string}[]; [key: string]: unknown;}
interface Journal {key: string; command: ManagedCommand; state: "uncertain" | "confirmed" | "denied";}
interface InvocationJournal {key: string; request: ManagedClaimInvocation; priorRuns: string[]; state: "uncertain" | "confirmed"; result?: ManagedExecutionResult;}

/** Native projection of canonical Runtime authority, with an exact request journal. */
export class ManagedWorkItemsView {
    private client?: ManagedWorkItemsClient;
    private queues: Queue[] = [];
    private queue?: Queue;
    private items: Item[] = [];
    private reviews: Review[] = [];
    private item?: Item;
    private review?: Review;
    private run?: Run;
    private snapshot?: ManagedSnapshot;
    private logs?: unknown;
    private pending = new Map<string, Journal>();
    private journalDir?: string;
    private cursor?: string;
    private queueCursor?: string;
    private reviewCursor?: string;
    private executionClient?: ManagedExecutionClient;
    private applications: readonly CanvasApplicationSummary[] = [];
    private application?: CanvasApplicationSummary;
    private descriptors: readonly ManagedInvocationDescriptor[] = [];
    private descriptor?: ManagedInvocationDescriptor;
    private executionMessage = "Discover authorized executions to select a capability without a snapshot file.";
    private invocations = new Map<string, InvocationJournal>();
    private handling = Promise.resolve();
    constructor(private readonly context: vscode.ExtensionContext, private readonly manifest: string,
        private readonly post: (message: unknown) => Thenable<boolean>) {}

    private permitted(operation: string): boolean {
        const caps = this.client?.capabilities();
        return !!caps?.operations.includes(operation) && (operation === "queues.list" || !this.queue || this.queue.permissions.includes(MANAGED_PERMISSIONS[operation]));
    }
    private async call(operation: string, fields: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
        if (!this.client || !this.permitted(operation)) throw Error("Runtime has not granted this operation for the selected queue.");
        const command: ManagedCommand = operation === "queues.list"
            ? {schema_version: MANAGED_VERSION, operation, workspace_id: this.client.workspace, ...fields}
            : {schema_version: MANAGED_VERSION, operation, queue: this.queue?.queue, ...fields};
        return (await this.client.execute(command)).result;
    }
    private async publish(message?: string): Promise<void> {
        let executable = false;
        try {if (this.descriptor && this.executionClient?.negotiated() && this.permitted("items.get") && this.permitted("runs.get")) {buildManagedClaimInvocation(this.descriptor, this.item); executable = true;}} catch { /* Selection is not an executable claim. */ }
        const unresolved = [...this.invocations.values()].filter(record => record.state === "uncertain");
        const execution = [...this.invocations.values()].reverse().find(record => record.request.claim.item_id === this.item?.id);
        await this.post({type: "managed-state", endpoint: this.client?.endpoint, workspace: this.client?.workspace,
            capabilities: this.client?.capabilities(), queues: this.queues, queue: this.queue, items: this.items,
            reviews: this.reviews, item: this.item, review: this.review, run: this.run, logs: this.logs,
            snapshot: this.snapshot, itemCursor: this.cursor, queueCursor: this.queueCursor, reviewCursor: this.reviewCursor,
            execution: {applications: this.applications, application: this.application, descriptors: this.descriptors.map(({bindingId, inputMode, standaloneAllowed}) => ({bindingId, inputMode, standaloneAllowed})),
                bindingId: this.descriptor?.bindingId, message: this.executionMessage, canRun: executable && !unresolved.length && ![...this.pending.values()].some(record => record.state === "uncertain"),
                result: execution?.result, pending: unresolved.map(record => ({key: record.key, itemId: record.request.claim.item_id}))},
            pending: [...this.pending.values()].filter(record => record.state === "uncertain").map(record => ({key: record.key, operation: record.command.operation})),
            message: message || (!this.client ? "Connect a Runtime with canonical managed Work Items support. Published 1.0.4 storage is a separate mode." : undefined)});
    }
    async refresh(): Promise<void> {
        if (!this.client) {await this.publish(); return;}
        if (!this.client.capabilities()) {this.clearProjection(); await this.publish("Authorization/capabilities changed. Reconnect before accessing managed data."); return;}
        const remembered = this.queue?.queue;
        const result = await this.call("queues.list");
        this.queues = result.queues as Queue[];
        this.queueCursor = result.next_cursor as string | undefined;
        this.queue = this.queues.find(entry => JSON.stringify(entry.queue) === JSON.stringify(remembered));
        if (this.queue) await this.loadQueue();
        else this.clearSelection();
        await this.publish();
    }
    private clearSelection(): void {this.items = []; this.reviews = []; this.item = undefined; this.review = undefined; this.run = undefined; this.snapshot = undefined; this.logs = undefined; this.cursor = undefined;}
    private clearProjection(): void {this.queues = []; this.queue = undefined; this.clearSelection(); this.applications = []; this.application = undefined; this.descriptors = []; this.descriptor = undefined; this.executionClient = undefined;}
    private async loadQueue(cursor?: string): Promise<void> {
        const previous = this.item?.id;
        const page = this.permitted("items.list") ? await this.call("items.list", cursor ? {cursor} : {}) : {};
        this.items = page.items as Item[] || []; this.cursor = page.next_cursor as string | undefined;
        // Review proposals are distinct entities; no pending Work Item is fabricated.
        const reviews = this.permitted("reviews.list") ? await this.call("reviews.list") : {};
        this.reviews = reviews.reviews as Review[] || []; this.reviewCursor = reviews.next_cursor as string | undefined;
        this.item = this.items.find(item => item.id === previous);
        this.review = this.reviews.find(review => review.proposal.review_id === this.review?.proposal.review_id);
    }
    private async connect(): Promise<void> {
        const endpoint = await vscode.window.showInputBox({prompt: "Canonical managed Runtime origin", value: this.context.workspaceState.get("managed.endpoint." + this.manifest, "http://127.0.0.1:8082"), ignoreFocusOut: true});
        if (!endpoint) {await this.publish("Connection cancelled. Existing connection unchanged."); return;}
        const workspace = await vscode.window.showInputBox({prompt: "Workspace UUID granted by this Runtime", value: this.context.workspaceState.get("managed.workspace." + this.manifest, ""), ignoreFocusOut: true});
        if (!workspace) {await this.publish("Connection cancelled. Existing connection unchanged."); return;}
        const origin = canonicalRuntimeOrigin(endpoint);
        const namespace = createHash("sha256").update(this.manifest + "\n" + origin + "\n" + workspace).digest("hex");
        const secretKey = "managed.token." + namespace;
        const savedEndpoint = this.context.workspaceState.get("managed.endpoint." + this.manifest, "");
        const legacyEndpoints = [...new Set([origin, origin + "/", endpoint, endpoint + "/", savedEndpoint, savedEndpoint ? savedEndpoint + "/" : ""].filter(value => {
            if (!value) return false;
            try {return canonicalRuntimeOrigin(value) === origin;} catch {return false;}
        }))];
        const legacyNamespaces = legacyEndpoints.map(value => createHash("sha256").update(this.manifest + "\n" + value + "\n" + workspace).digest("hex"));
        const stored = (await this.context.secrets.get(secretKey)) || (await Promise.all(legacyNamespaces.map(value => this.context.secrets.get("managed.token." + value)))).find(Boolean);
        const entered = await vscode.window.showInputBox({prompt: stored ? "Managed API token; empty reuses this scope's stored token, Escape cancels" : "Managed API token", password: true, ignoreFocusOut: true});
        if (entered === undefined) {await this.publish("Connection cancelled. Existing connection unchanged."); return;}
        const token = entered || stored;
        if (!token) throw Error("A managed API token is required.");
        this.client = undefined; this.executionClient = undefined; this.journalDir = undefined; this.clearProjection(); this.pending.clear(); this.invocations.clear();
        const client = new ManagedWorkItemsClient(endpoint, token, workspace);
        await client.negotiate();
        const journalDir = path.join(this.context.globalStorageUri.fsPath, "managed-work-items", namespace);
        await fs.promises.mkdir(journalDir, {recursive: true});
        for (const legacyNamespace of legacyNamespaces) {
            if (legacyNamespace === namespace) continue;
            const legacyDir = path.join(this.context.globalStorageUri.fsPath, "managed-work-items", legacyNamespace);
            let names: string[];
            try {names = await fs.promises.readdir(legacyDir);} catch (error) {if (error.code === "ENOENT") continue; throw error;}
            for (const name of names) {
                const source = path.join(legacyDir, name), target = path.join(journalDir, name);
                try {await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);}
                catch (error) {
                    if (error.code !== "EEXIST") throw error;
                    if (!(await fs.promises.readFile(source)).equals(await fs.promises.readFile(target))) throw Error("Conflicting legacy managed journal identity; preserve both scopes and inspect before reconnecting.");
                }
            }
        }
        const pending = new Map<string, Journal>(), invocations = new Map<string, InvocationJournal>();
        for (const name of await fs.promises.readdir(journalDir)) if (/^[0-9a-f-]{36}\.request\.json$/.test(name)) {
            const key = name.slice(0, -13);
            const command = validateManagedJournalCommand(JSON.parse(await fs.promises.readFile(path.join(journalDir, name), "utf8")), workspace);
            if (command.idempotency_key !== key) throw Error("Retained request scope/identity mismatch; preserve the journal and inspect it.");
            let receipt: unknown;
            try {receipt = JSON.parse(await fs.promises.readFile(path.join(journalDir, key + ".receipt.json"), "utf8"));}
            catch (error) {if (error.code !== "ENOENT") throw error; pending.set(key, {key, command, state: "uncertain"}); continue;}
            if (receipt && typeof receipt === "object" && !Array.isArray(receipt) && "denied" in receipt && receipt.denied === true) {
                const denial = receipt as Record<string, unknown>;
                if (typeof denial.status !== "number" || ![401, 403, 409, 413, 422].includes(denial.status) || (denial.code !== undefined && typeof denial.code !== "string")) throw Error("Legacy denial receipt is malformed; preserve the journal and inspect it.");
                pending.set(key, {key, command, state: "uncertain"}); continue;
            }
            validateManagedResponse(command, receipt, workspace);
        }
        for (const name of await fs.promises.readdir(journalDir)) if (/^[0-9a-f-]{36}\.invocation\.json$/.test(name)) {
            const stored: unknown = JSON.parse(await fs.promises.readFile(path.join(journalDir, name), "utf8"));
            if (!stored || typeof stored !== "object" || Array.isArray(stored)) throw Error("Retained execution journal is malformed. Preserve it for inspection.");
            const entry = stored as Record<string, unknown>;
            if (Object.keys(entry).some(key => !["key", "request", "priorRuns", "state"].includes(key)) ||
                name !== entry.key + ".invocation.json" || typeof entry.key !== "string" || !/^[0-9a-f-]{36}$/.test(entry.key) ||
                entry.state !== "uncertain" || !Array.isArray(entry.priorRuns) ||
                !entry.priorRuns.every(id => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))) throw Error("Retained execution scope/identity mismatch. Preserve the journal for inspection.");
            const request = validateManagedExecutionRequest(entry.request, workspace);
            const record: InvocationJournal = {key: entry.key, request, priorRuns: entry.priorRuns, state: "uncertain"};
            // Restored execution is uncertain until its original response receipt
            // exists. Reload never invokes a tool or clears an unresolved claim.
            const receipt = path.join(journalDir, record.key + ".invocation-result.json");
            let resultBytes: Buffer | undefined, confirmationBytes: Buffer | undefined;
            try {resultBytes = await fs.promises.readFile(receipt);} catch (error) {if (error.code !== "ENOENT") throw error;}
            try {confirmationBytes = await fs.promises.readFile(path.join(journalDir, record.key + ".invocation-confirmed.json"));} catch (error) {if (error.code !== "ENOENT") throw error;}
            if (resultBytes && confirmationBytes) {
                record.result = validateManagedExecutionResult(JSON.parse(resultBytes.toString("utf8")), request);
                validateManagedExecutionConfirmation(JSON.parse(confirmationBytes.toString("utf8")), record.result);
                record.state = "confirmed";
            } else if (resultBytes || confirmationBytes) throw Error("Retained execution result/confirmation is incomplete. Preserve the journal for inspection.");
            invocations.set(record.key, record);
        }
        this.pending = pending; this.invocations = invocations; this.journalDir = journalDir;
        this.client = client; this.executionClient = new ManagedExecutionClient(origin, token, workspace);
        await this.context.secrets.store(secretKey, token);
        await this.context.workspaceState.update("managed.endpoint." + this.manifest, origin);
        await this.context.workspaceState.update("managed.workspace." + this.manifest, workspace);
        await this.refresh();
    }
    private async mutate(operation: string, fields: Record<string, unknown>, retained?: Journal): Promise<void> {
        if (!this.client || !this.journalDir || !this.permitted(operation)) throw Error("This managed operation is not granted.");
        if (!retained && ([...this.pending.values(), ...this.invocations.values()].some(record => record.state === "uncertain"))) throw Error("Reconcile the retained uncertain request before issuing another mutation. Its identity must be preserved.");
        const key = retained?.key || randomUUID();
        const command = retained?.command || {schema_version: MANAGED_VERSION, operation, queue: this.queue?.queue, idempotency_key: key, ...fields};
        this.client.validateCommand(command);
        const confirmed = await vscode.window.showWarningMessage(
            `${retained ? "Reconcile the exact retained" : "Execute"} ${operation} request at ${this.client.endpoint}? Queue ${command.queue?.queue_id}; key ${key}. Review the exact target/binding in the editor.`,
            {modal: true}, retained ? "Reconcile exact request" : "Execute request");
        if (!confirmed) {
            await this.publish(retained ? "Reconciliation cancelled. The retained request is unchanged." : "Request cancelled. Nothing was submitted.");
            return;
        }
        if (!retained) await fs.promises.writeFile(path.join(this.journalDir, key + ".request.json"), JSON.stringify(command), {flag: "wx", mode: 0o600});
        const record: Journal = {key, command, state: "uncertain"}; this.pending.set(key, record);
        try {
            const result = await this.client.execute(command);
            await fs.promises.writeFile(path.join(this.journalDir, key + ".receipt.json"), JSON.stringify(result), {flag: "wx", mode: 0o600});
            record.state = "confirmed";
            await this.refresh();
            // Claim-next may choose a different item than the selected one.
            // Select only the actual returned item, never attach a claim to the
            // prior selection or infer ownership from a successful HTTP status.
            if (operation === "items.claim" && (result.result.item as Item | undefined)?.id) {
                this.item = result.result.item as Item; this.snapshot = this.item.snapshot;
                this.run = undefined; this.logs = undefined; this.review = undefined;
                await this.publish();
            }
        } catch (error) {
            if (!retained && error instanceof RuntimeHTTPError && error.status !== 404 &&
                ([401, 403, 413, 422].includes(error.status) || error.status === 409 && ["stale_claim", "changed_input", "approval_required", "unsupported_operation"].includes(error.code))) {
                record.state = "denied";
                await fs.promises.writeFile(path.join(this.journalDir, key + ".receipt.json"), JSON.stringify({denied: true, status: error.status, code: error.code}), {flag: "wx", mode: 0o600});
                if ([401, 403].includes(error.status)) this.clearProjection();
            }
            await this.publish(record.state === "uncertain" ? "Outcome is uncertain. The exact request/key is retained; do not create a replacement or assume failure." : error.message);
            throw error;
        }
    }
    handle(message: Record<string, any>): Promise<void> {
        // Serialize host operations so a double-click or selection change cannot
        // race the selected scope while a confirmation or Run is pending.
        const work = this.handling.then(async () => {try {await this.dispatch(message);} catch (error) {
            if (!this.client?.capabilities()) this.clearProjection();
            await this.publish(error.message + ([...this.pending.values()].some(record => record.state === "uncertain") ? " Exact uncertain request/key retained; reconcile before another mutation." : ""));
            throw error;
        }});
        this.handling = work.catch(() => undefined);
        return work;
    }
    private async discoverExecutions(): Promise<void> {
        this.applications = []; this.application = undefined; this.descriptors = []; this.descriptor = undefined;
        try {
            await this.executionClient.negotiate();
            this.applications = await this.executionClient.applications();
            this.executionMessage = this.applications.length ? "Select an authorized application, then its capability. Discovery does not run or claim an item." : "No authorized applications were returned.";
        } catch (error) {this.executionMessage = error.message; throw error;}
    }
    private async invokeSelected(): Promise<void> {
        if (!this.executionClient || !this.descriptor || !this.application || !this.item || !this.journalDir || !this.permitted("items.get") || !this.permitted("runs.get")) throw Error("Select a discovered capability and its actual claimed input, with item and Run read access.");
        if ([...this.pending.values(), ...this.invocations.values()].some(record => record.state === "uncertain")) throw Error("Inspect the retained uncertain request before another Run. No replacement invocation is sent.");
        const selected = this.descriptor, itemId = this.item.id;
        const request = buildManagedClaimInvocation(selected, this.item);
        const key = randomUUID();
        const confirmed = await vscode.window.showWarningMessage(`Run ${this.application.title} / ${selected.bindingId} at ${this.client.endpoint}? Input ${itemId}, claim epoch ${request.claim.epoch}. The Runtime will execute the exact selected revision. Request ${key}.`, {modal: true}, "Run claimed input");
        if (!confirmed) {await this.publish("Run cancelled. Nothing was submitted."); return;}
        // Recheck the same selection and grant immediately before dispatch. A
        // changed revision never silently substitutes a new immutable snapshot.
        await this.executionClient.negotiate();
        const fresh = (await this.executionClient.descriptors(this.application.applicationId)).find(value => value.bindingId === selected.bindingId);
        if (!isDeepStrictEqual(fresh, selected)) throw Error("The admitted capability changed. Discover and explicitly select it again before Run.");
        this.item = (await this.call("items.get", {item_id: itemId})).item as Item;
        if (!isDeepStrictEqual(buildManagedClaimInvocation(selected, this.item), request)) throw Error("The selected claim changed. Refresh and review its actual state before Run.");
        const record: InvocationJournal = {key, request, priorRuns: this.item.run_ids.slice(), state: "uncertain"};
        const retained = await fs.promises.open(path.join(this.journalDir, key + ".invocation.json"), "wx", 0o600);
        try {await retained.writeFile(JSON.stringify(record)); await retained.sync();} finally {await retained.close();}
        this.invocations.set(key, record);
        this.executionMessage = "Running the claimed input. Closing or reloading does not safely cancel execution; the exact request is retained.";
        await this.publish();
        try {
            const result = await this.executionClient.invokeClaim(request, key);
            record.result = result;
            await fs.promises.writeFile(path.join(this.journalDir, key + ".invocation-result.json"), JSON.stringify(result), {flag: "wx", mode: 0o600});
            this.executionMessage = result.state === "reconciliation_required" ? "Runtime requires reconciliation of the original launch. Inspect its state; no automatic retry." : `Runtime execution ${result.state}. Inspect its linked Run, Attempts and artifacts.`;
            await this.observeInvocation(record);
        } catch (error) {
            this.executionMessage = record.state === "uncertain" ? "Execution outcome is uncertain. The original request is retained. Inspect retained execution; no automatic retry or replacement claim." : "Runtime returned an execution result, but linked state could not be read. Refresh to inspect it.";
            throw error;
        }
    }
    private async observeInvocation(record: InvocationJournal): Promise<void> {
        const queue = this.queues.find(value => isDeepStrictEqual(value.queue, record.request.claim.queue));
        if (!queue) throw Error("Discover the original authorized queue before inspecting this retained execution.");
        this.queue = queue; this.clearSelection();
        this.item = (await this.call("items.get", {item_id: record.request.claim.item_id})).item as Item;
        if (!isDeepStrictEqual(this.item.snapshot, record.request.snapshot)) throw Error("Retained execution snapshot no longer matches the authoritative input.");
        this.snapshot = this.item.snapshot;
        const id = record.result?.runId;
        if (id) {
            if (!this.item.run_ids.includes(id)) throw Error("Runtime execution Run is not linked to the original input. Retain the request for reconciliation.");
            this.run = (await this.call("runs.get", {run_id: id})).run as Run;
            if (!isDeepStrictEqual(this.run.snapshot, record.request.snapshot)) throw Error("Runtime Run snapshot differs from the requested immutable selection.");
            const attempt = (this.run.attempts as {id: string; epoch: number; state: string}[]).find(value => value.id === record.result.attemptId && value.epoch === record.result.attemptEpoch);
            if (!attempt) throw Error("Runtime execution Attempt is not linked to the original Run. Retain the request for reconciliation.");
            const terminal = record.result.state === "completed" ? "succeeded" : record.result.state === "failed" ? "failed" : undefined;
            if (terminal) {
                if (this.run.state !== terminal || attempt.state !== terminal) throw Error("Runtime execution response and authoritative Run/Attempt states disagree. Retain the request.");
                if (record.state !== "confirmed") {
                    await fs.promises.writeFile(path.join(this.journalDir, record.key + ".invocation-confirmed.json"), JSON.stringify({runId: id, attemptId: attempt.id}), {flag: "wx", mode: 0o600});
                    record.state = "confirmed";
                }
            }
        } else {
            this.executionMessage = "Read the original input and its linked Runs below. The public API does not map a lost invocation response to an exact request/claim epoch; this request remains uncertain. It has not been retried.";
        }
        await this.publish();
    }
    private async dispatch(message: Record<string, any>): Promise<void> {
        const op = message.op;
        if (op === "managed.connect") {await this.connect(); return;}
        if (op === "managed.refresh") {await this.refresh(); return;}
        if (!this.client) throw Error("Connect a canonical managed Runtime first.");
        if (op === "managed.discoverExecutions") {
            await this.discoverExecutions();
        } else if (op === "managed.application") {
            const selected = this.applications.find(value => value.applicationId === message.id);
            if (!selected) throw Error("Select an actually discovered authorized application.");
            this.application = selected; this.descriptor = undefined; this.descriptors = [];
            this.descriptors = await this.executionClient.descriptors(selected.applicationId);
            this.executionMessage = this.descriptors.length ? "Select a capability to pin its exact admitted revision. No input is claimed or executed." : "No authorized generic capability was returned. Admission, grants or an active revision may be unavailable.";
        } else if (op === "managed.capability") {
            const selected = this.descriptors.find(value => value.bindingId === message.id);
            if (!selected) throw Error("Select an actually discovered capability.");
            const queue = this.queues.find(value => isDeepStrictEqual(value.queue, selected.inputQueue));
            if (!queue) throw Error("This capability has no discovered managed input queue. Standalone execution is not enabled by this queue editor; no queue or snapshot is invented.");
            this.queue = queue; this.clearSelection(); await this.loadQueue();
            this.descriptor = selected; this.snapshot = selected.snapshot;
            this.executionMessage = "Exact capability selected. Prepare and enqueue an input, explicitly claim it, then Run claimed input.";
        } else if (op === "managed.invoke") {
            await this.invokeSelected(); return;
        } else if (op === "managed.inspectInvocation") {
            const record = this.invocations.get(message.key);
            if (!record) throw Error("No retained execution with this identity.");
            await this.observeInvocation(record); return;
        } else if (op === "managed.moreQueues") {
            if (!this.queueCursor) throw Error("No additional queue page.");
            const page = await this.call("queues.list", {cursor: this.queueCursor});
            this.queues.push(...page.queues as Queue[]); this.queueCursor = page.next_cursor as string | undefined;
        } else if (op === "managed.moreItems") {
            if (!this.cursor) throw Error("No additional item page.");
            const page = await this.call("items.list", {cursor: this.cursor});
            this.items.push(...page.items as Item[]); this.cursor = page.next_cursor as string | undefined;
        } else if (op === "managed.moreReviews") {
            if (!this.reviewCursor) throw Error("No additional review page.");
            const page = await this.call("reviews.list", {cursor: this.reviewCursor});
            this.reviews.push(...page.reviews as Review[]); this.reviewCursor = page.next_cursor as string | undefined;
        } else if (op === "managed.queue") {
            this.queue = this.queues.find(queue => JSON.stringify(queue.queue) === message.queue);
            if (!this.queue) throw Error("Select an actually discovered authorized queue.");
            this.clearSelection(); this.descriptor = undefined; await this.loadQueue();
        } else if (op === "managed.item") {
            if (!this.items.some(item => item.id === message.id)) throw Error("Select a discovered item.");
            this.item = (await this.call("items.get", {item_id: message.id})).item as Item;
            this.review = undefined; this.run = undefined; this.logs = undefined; this.snapshot = this.item.snapshot;
        } else if (op === "managed.review") {
            this.review = this.reviews.find(review => review.proposal.review_id === message.id);
            if (!this.review) throw Error("Select a discovered review proposal.");
            this.item = undefined; this.run = undefined; this.logs = undefined;
        } else if (op === "managed.run" || op === "managed.logs") {
            const allowed = [...(this.item?.run_ids || []), ...(this.review ? [this.review.proposal.binding.run_id] : [])];
            if (!allowed.includes(message.id)) throw Error("Run identity is not linked to this selected item/review.");
            const result = await this.call(op === "managed.run" ? "runs.get" : "runs.logs", {run_id: message.id, ...(message.cursor ? {cursor: message.cursor} : {})});
            if (op === "managed.run") this.run = result.run as Run; else this.logs = result;
        } else if (op === "managed.snapshot") {
            const source = await vscode.window.showOpenDialog({canSelectMany: false, openLabel: "Load admitted execution snapshot"});
            if (!source?.length) {await this.publish("Snapshot selection cancelled. Existing snapshot unchanged."); return;}
            const info = await vscode.workspace.fs.stat(source[0]);
            if (info.size > 512 * 1024) throw Error("Snapshot exceeds the protocol limit.");
            this.snapshot = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(source[0])).toString("utf8"));
        } else if (op === "managed.enqueue") {
            if (this.queue?.mode === "reviewed") throw Error("This is a reviewed queue. Approve its exact pending proposal; direct enqueue cannot create an approval.");
            if (!this.snapshot) throw Error("Select an authorized application and capability to pin its admitted snapshot before enqueue.");
            await this.mutate("items.enqueue", {snapshot: this.snapshot, payload: message.payload}); return;
        } else if (op === "managed.decide") {
            if (!this.review || !["approve", "reject"].includes(message.decision)) throw Error("Select an exact review proposal and decision.");
            await this.mutate("reviews.decide", {proposal: this.review.proposal, decision: message.decision}); return;
        } else if (op === "managed.claim") {
            await this.mutate("items.claim", {lease_seconds: message.lease_seconds}); return;
        } else if (op === "managed.renew" || op === "managed.complete") {
            if (!this.item?.claim) throw Error("This item has no actual current claim.");
            const fields = op === "managed.renew" ? {lease_seconds: message.lease_seconds} : {outcome: message.outcome, output_payloads: [], run_ids: this.item.run_ids};
            await this.mutate(op === "managed.renew" ? "items.renew" : "items.complete", {claim: this.item.claim, ...fields}); return;
        } else if (op === "managed.retry" || op === "managed.cancel") {
            if (!this.item) throw Error("Select an actual Work Item.");
            if (!this.item.claim) throw Error("This contract omits terminal Work Item epoch. No expected epoch is guessed; a compatible Runtime contract update is required.");
            await this.mutate(op === "managed.retry" ? "items.retry" : "items.cancel", {item_id: this.item.id, expected_epoch: this.item.claim.epoch, reason: message.reason,
                ...(message.reconciliation_receipt ? {reconciliation_receipt: message.reconciliation_receipt} : {})}); return;
        } else if (op === "managed.reconcile") {
            const record = this.pending.get(message.key);
            if (!record || record.state !== "uncertain") throw Error("No retained uncertain request with this identity.");
            const queue = this.queues.find(value => JSON.stringify(value.queue) === JSON.stringify(record.command.queue));
            if (!queue) throw Error("Discover the original authorized queue before reconciling this retained request.");
            this.queue = queue; this.clearSelection();
            await this.mutate(record.command.operation, {}, record); return;
        } else if (op === "managed.artifact") {
            const artifact = this.run?.artifacts.find(value => value.handle === message.handle);
            if (!artifact) throw Error("Select an actual artifact linked to this Run.");
            const target = await vscode.window.showSaveDialog({saveLabel: "Save verified Runtime artifact copy"});
            if (!target) {await this.publish("Artifact save cancelled. No file was written."); return;}
            const temporary = target.fsPath + ".partial-" + randomUUID();
            const output = await fs.promises.open(temporary, "wx", 0o600);
            const hash = createHash("sha256"); let offset = 0, cursor: string | undefined, pages = 0;
            try {
                do {
                    const result: any = await this.call("artifacts.read", {artifact_handle: artifact.handle, ...(cursor ? {cursor} : {})});
                    if (++pages > 2048 || result.offset !== offset || ["handle", "run_id", "digest", "size"].some(key => result.artifact[key] !== artifact[key])) throw Error("Artifact identity/offset changed during download.");
                    const bytes = Buffer.from(result.data_base64, "base64"); offset += bytes.length;
                    if (offset > artifact.size || offset > 64 * 1024 * 1024 || (!result.eof && (!result.next_cursor || !bytes.length))) throw Error("Invalid bounded artifact stream.");
                    hash.update(bytes); await output.writeFile(bytes); cursor = result.eof ? undefined : result.next_cursor;
                } while (cursor);
                if (offset !== artifact.size || "sha256:" + hash.digest("hex") !== artifact.digest) throw Error("Artifact digest/size mismatch.");
                await output.close();
                await fs.promises.copyFile(temporary, target.fsPath, fs.constants.COPYFILE_EXCL);
            } finally {await output.close().catch(() => undefined); await fs.promises.unlink(temporary).catch(() => undefined);}
        } else throw Error("Unsupported canonical managed UI operation.");
        await this.publish();
    }
}
