import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { createHash, randomUUID } from "crypto";
import { ManagedWorkItemsClient, ManagedCommand, MANAGED_VERSION, MANAGED_PERMISSIONS, QueueRef } from "./managedWorkItemsClient";
import { RuntimeHTTPError } from "./workItemsRuntimeClient";

// DTOs are validated against the exact Actions-owned schema in the client.
interface Queue {queue: QueueRef; label: string; mode: string; permissions: string[]; counts: Record<string, number>;}
interface Item {id: string; queue: QueueRef; payload: unknown; snapshot: Record<string, unknown>; claim: {epoch: number; [key: string]: unknown} | null; run_ids: string[]; [key: string]: unknown;}
interface Review {proposal: {review_id: string; binding: {run_id: string; [key: string]: unknown}; [key: string]: unknown}; state: string; [key: string]: unknown;}
interface Run {id: string; artifacts: {handle: string; digest: string; size: number; run_id: string}[]; [key: string]: unknown;}
interface Journal {key: string; command: ManagedCommand; state: "uncertain" | "confirmed" | "denied";}

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
    private snapshot?: Record<string, unknown>;
    private logs?: unknown;
    private pending = new Map<string, Journal>();
    private journalDir?: string;
    private cursor?: string;
    private queueCursor?: string;
    private reviewCursor?: string;
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
        await this.post({type: "managed-state", endpoint: this.client?.endpoint, workspace: this.client?.workspace,
            capabilities: this.client?.capabilities(), queues: this.queues, queue: this.queue, items: this.items,
            reviews: this.reviews, item: this.item, review: this.review, run: this.run, logs: this.logs,
            snapshot: this.snapshot, itemCursor: this.cursor, queueCursor: this.queueCursor, reviewCursor: this.reviewCursor,
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
    private clearProjection(): void {this.queues = []; this.queue = undefined; this.clearSelection();}
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
        if (!endpoint) return;
        const workspace = await vscode.window.showInputBox({prompt: "Workspace UUID granted by this Runtime", value: this.context.workspaceState.get("managed.workspace." + this.manifest, ""), ignoreFocusOut: true});
        if (!workspace) return;
        const namespace = createHash("sha256").update(this.manifest + "\n" + endpoint + "\n" + workspace).digest("hex");
        const secretKey = "managed.token." + namespace;
        const stored = await this.context.secrets.get(secretKey);
        const entered = await vscode.window.showInputBox({prompt: stored ? "Managed API token; empty reuses this scope's stored token, Escape cancels" : "Managed API token", password: true, ignoreFocusOut: true});
        if (entered === undefined) return;
        const token = entered || stored;
        if (!token) throw Error("A managed API token is required.");
        this.client = undefined; this.clearProjection(); this.pending.clear();
        const client = new ManagedWorkItemsClient(endpoint, token, workspace);
        await client.negotiate();
        this.client = client;
        await this.context.secrets.store(secretKey, token);
        await this.context.workspaceState.update("managed.endpoint." + this.manifest, endpoint);
        await this.context.workspaceState.update("managed.workspace." + this.manifest, workspace);
        this.journalDir = path.join(this.context.globalStorageUri.fsPath, "managed-work-items", namespace);
        await fs.promises.mkdir(this.journalDir, {recursive: true});
        for (const name of await fs.promises.readdir(this.journalDir)) if (/^[0-9a-f-]{36}\.request\.json$/.test(name)) {
            const key = name.slice(0, -13);
            const command = JSON.parse(await fs.promises.readFile(path.join(this.journalDir, name), "utf8"));
            if (command.idempotency_key !== key) throw Error("Retained request identity mismatch; preserve the journal and inspect it.");
            const receipt = path.join(this.journalDir, key + ".receipt.json");
            try {await fs.promises.access(receipt);} catch {this.pending.set(key, {key, command, state: "uncertain"});}
        }
        await this.refresh();
    }
    private async mutate(operation: string, fields: Record<string, unknown>, retained?: Journal): Promise<void> {
        if (!this.client || !this.journalDir || !this.permitted(operation)) throw Error("This managed operation is not granted.");
        if (!retained && [...this.pending.values()].some(record => record.state === "uncertain")) throw Error("Reconcile the retained uncertain request before issuing another mutation. Its idempotency key must be preserved.");
        const key = retained?.key || randomUUID();
        const command = retained?.command || {schema_version: MANAGED_VERSION, operation, queue: this.queue?.queue, idempotency_key: key, ...fields};
        this.client.validateCommand(command);
        const confirmed = await vscode.window.showWarningMessage(
            `${retained ? "Reconcile the exact retained" : "Execute"} ${operation} request at ${this.client.endpoint}? Queue ${command.queue?.queue_id}; key ${key}. Review the exact target/binding in the editor.`,
            {modal: true}, retained ? "Reconcile exact request" : "Execute request");
        if (!confirmed) return;
        if (!retained) await fs.promises.writeFile(path.join(this.journalDir, key + ".request.json"), JSON.stringify(command), {flag: "wx", mode: 0o600});
        const record: Journal = {key, command, state: "uncertain"}; this.pending.set(key, record);
        try {
            const result = await this.client.execute(command);
            await fs.promises.writeFile(path.join(this.journalDir, key + ".receipt.json"), JSON.stringify(result), {flag: "wx", mode: 0o600});
            record.state = "confirmed";
            await this.refresh();
        } catch (error) {
            if (error instanceof RuntimeHTTPError && [401, 403, 404, 413, 422].includes(error.status)) {
                record.state = "denied";
                await fs.promises.writeFile(path.join(this.journalDir, key + ".receipt.json"), JSON.stringify({denied: true, status: error.status, code: error.code}), {flag: "wx", mode: 0o600});
                if ([401, 403].includes(error.status)) this.clearProjection();
            }
            await this.publish(record.state === "uncertain" ? "Outcome is uncertain. The exact request/key is retained; do not create a replacement or assume failure." : error.message);
            throw error;
        }
    }
    async handle(message: Record<string, any>): Promise<void> {
        try {await this.dispatch(message);} catch (error) {
            if (!this.client?.capabilities()) this.clearProjection();
            await this.publish(error.message + ([...this.pending.values()].some(record => record.state === "uncertain") ? " Exact uncertain request/key retained; reconcile before another mutation." : ""));
            throw error;
        }
    }
    private async dispatch(message: Record<string, any>): Promise<void> {
        const op = message.op;
        if (op === "managed.connect") {await this.connect(); return;}
        if (op === "managed.refresh") {await this.refresh(); return;}
        if (!this.client) throw Error("Connect a canonical managed Runtime first.");
        if (op === "managed.moreQueues") {
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
            this.clearSelection(); await this.loadQueue();
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
            if (!source?.length) return;
            const info = await vscode.workspace.fs.stat(source[0]);
            if (info.size > 512 * 1024) throw Error("Snapshot exceeds the protocol limit.");
            this.snapshot = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(source[0])).toString("utf8"));
        } else if (op === "managed.enqueue") {
            if (!this.snapshot) throw Error("An existing admitted execution snapshot is required. Select an admitted item or load the exact registered snapshot; the client cannot invent one.");
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
            if (!target) return;
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
