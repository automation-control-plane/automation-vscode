# Native Work Items

Open **Automation → Package Resources → Work Items**, or run **Automation: Open Native Work Items** after selecting an Action Package or Robot Task. Existing command/configuration identifiers and legacy Robot fixture tooling remain compatible. The owned SDK path opens the dedicated editor from New Work Item and item clicks; legacy Robots without the owned SDK keep the earlier fixture creation flow.

## Create and edit with forms

1. Select **Local inputs**, then **New input**. The default payload is an empty field form.
2. Click **Add field**, name it `value`, select **number**, and enter `7`. Choose **Create input**. No JSON or schema authoring is required.
3. Choose **Add attachment** and select a synthetic file. Existing files are never overwritten. Attachment buttons save a copy to a new destination.
4. Choose **Run** or **Debug**, then select the Action or Robot task. The supplied demos need no Action parameters. Other Action parameters have their own field form, separate from the Work Item payload.
5. Inspect the output through its field form and linked execution history. File launches use a private snapshot of the selected payload and attachments. Outputs show values without editing controls. **Replay as new input** opens an editable draft; **Create input** (or **Add to queue**) then copies attachments through the SDK into a distinct input and retains its source identity. Editing the replay never mutates the original.

Each field supports string, number, boolean, null, object or array. Objects have **Add field / Remove field** controls; arrays have **Add item / Remove item** controls. Existing values provide their actual types. Existing package constraints provide field hints when available; there is no schema-creation prerequisite. A Work Item payload contract is never inferred from an Action argument schema.

**Advanced JSON** is an optional, collapsed view. Applying it roundtrips supported JSON values through the same form. Malformed JSON, duplicate names (including escaped-equivalent names), non-finite numbers and integers outside JavaScript's exact range are rejected. Use strings for very large identifiers. Own keys such as `__proto__` and `constructor` remain data in containers without a prototype; they never become executable HTML or prototype assignments. Backend parsing also rejects duplicate/non-finite JSON.

Unsaved form drafts, names, invalid values and replay sources survive refresh, metadata updates, closing/reopening the panel and Extension Host recreation through VS Code workspace state. State is isolated by package, mode and queue; restoring it never launches a workload, requests a model or authenticates a Runtime. A draft keeps its original saved revision so external changes cannot be overwritten silently. **Reload saved values** explicitly discards that draft and reads current data. Invalid edits remain visible for correction.

The editor's bridge runs with the selected package interpreter and requires **actions-work-items==0.4.4** for new Action and Robot flows. Action dependency checks specifically require the owned library. Legacy Robot commands remain compatible separately.


## Panel layout and execution status

The package and storage selector stay in a compact header. **Inputs / Outputs** select the sidebar list; selection, fields and attachments occupy the main editor. **Run** is the primary action for an executable input, with **Debug** secondary. Run/Debug save local fixture edits before launch. A new draft uses **Create input**; an output uses **Replay as new input** and hides editing/launch controls. Full IDs and source records remain under item details, with short names in the list.

**Result** belongs to the selected item, including its actual linked outputs and receipt. A new or unrun item shows **Not run**, even if another input succeeded. **All execution history** retains every receipt separately, each linked to its originating input. These local receipts remain distinct from Runtime Runs.

Queue selection and recovery are in **Storage settings (···)** only for relevant modes. Runtime connection appears only in Runtime modes. Optional Action inputs, advanced JSON and AI proposals are collapsed. **New input** restores an existing unsaved draft; **Discard draft…** requires confirmation. SQLite saved payloads remain immutable through this editor; replay opens the editable copy before enqueueing.

## Optional field proposals

Expand **Suggest fields with AI…**, describe the desired names/values in ordinary text and choose **Generate proposal**. The extension uses only models already exposed through VS Code's supported language-model API, with explicit model selection/consent. It does not configure a new service, credentials or billing. Only the entered description is sent; package files, existing payloads and attachments are not automatically included.

Review and edit the proposed fields, then explicitly **Apply to draft**. This changes only the in-memory draft. Saving, running, claiming, enqueueing and approving remain separate actions. A proposal cannot apply to another mode/item after navigation. No tools are supplied to the model. Missing providers, denied consent, cancellation, timeout and malformed proposals leave the existing draft intact. Actual provider invocation requires an already available authorized provider; coding tests use a model fixture and make no paid/model-service calls.

## SDK SQLite development queue

Select **Local queue** and name a queue (default `input`). Storage is private to the package under `devdata/automation-work-items`: `queue.db`, attachment files, payload contract, local execution receipts and replay provenance. All queue operations use public published `SQLiteAdapter` APIs; the extension contains no SQL, queue scheduler or worker authority.

**Add to queue** seeds an input; a workload reserves it and reports completion/failure through the SDK. Outputs retain actual SDK `parent_id`, item IDs, queue and state. Refresh/reopening reads persistent SDK state. Replay opens an editable draft and saves a new input. It never resets a terminal item. Published SQLite has no conditional payload edit, so the editor refuses in-place queue edits and offers replay. It does not pretend a read-before-write check is a fenced mutation.

**Consumption is FIFO.** Select the oldest pending input before Run/Debug. The published API cannot reserve an arbitrary selected ID. The editor checks the preview and refuses a newer selection, but another concurrent consumer could claim between preview and launch. Use this mode for a single local development consumer; the execution receipt labels the selection as a preview. SDK parent IDs are authoritative. Named queue discovery is limited to explicit names; there is no supported all-queues API in this published adapter. A canonical managed queue must supply atomic item binding, scope and fencing.

**Storage settings (···) → Recover interrupted items** explicitly invokes the SDK's public orphan recovery using its configured timeout (default 30 minutes), with confirmation. It applies across this package database. Stopping a local execution does not mark its business item completed or pretend to perform a managed cancellation. No unknown process is adopted or stopped. Existing operator Work Items environment overrides cause a clear launch conflict instead of being overwritten.

## Published Runtime storage versus canonical managed mode

**Runtime storage** (published 1.0.4) explicitly exposes the published `/api/work-items` item/attachment API. Connect with an explicit HTTPS origin (or loopback HTTP) and a token. The client verifies version/authentication and an authorized read before mutations. Tokens remain in VS Code SecretStorage, scoped to package plus origin, never in workspace data, webview messages or logs. Enqueue/upload require explicit confirmation; reads/downloads preserve exact bytes, including JSON attachments. Errors never trigger local fallback.

**Managed queues** is a separate client for `actions.managed-work-items/v1`, pinned to the reviewed Actions commit `f1b11838674494cd6a34d343b97404cbb1537004`, schema blob `3a34f69c7770de072427fddb79bf0d4cc39da06f`. It negotiates the exact generated schema, Runtime1.1.0a13 / fencedSDK0.5.0a1 floor, installed operations, permissions, workspace and database time. These are unreleased candidates, not published 1.0.4 or SDK 0.4.4. Local modes do not depend on them. The recursively sorted complete schema must match; object-key order alone is irrelevant, but unknown additions and the former candidate schema remain denied. The schema's protocol floors are not claims that every older Runtime implements this exact schema.

`required-input` is displayed as **Input required**. It describes the generic policy's required existing input; it grants neither enqueue nor claim and does not launch execution. The existing **Claim next item** operation remains next-pending, not a claim of the selected row. Enqueue requires an exact admitted snapshot, an advertised operation and the selected queue grant. Generic adapters do not advertise review or retry; those controls remain denied. The server supplies worker identity and remains responsible for current authority and fences.

Snapshots may explicitly carry `capability_authority: "package-revision"` or `"legacy-action"`. Omission means legacy action in the backend. The extension displays that authority read-only and never inserts the default, strips an explicit value, substitutes a snapshot, or rewrites retained idempotency journals. Unknown authority values are rejected by the pinned schema. A mode, descriptor or schema match alone is not execution readiness.

The native client projects discovered queues, separate queue/business states, exact review proposals, admitted snapshots, actual Runs/Attempts, logs and verified artifacts. Only advertised/granted operations are enabled, and the server rechecks live scoped authority. Explicit mutations retain the exact idempotency key/body before submission. Uncertain results remain retained across reconnect for explicit reconciliation with the same key; there is no automatic retry, new key, local lease loop, queue scheduler or SQL access. Review approval uses the exact server proposal/binding; direct enqueue cannot create an approval. Artifact copies check identity, offsets, size and digest and never overwrite an existing destination.

**Managed acceptance remains incomplete.** The reviewed current backend supplies canonical SQL/auth service adapters; live ordinary startup, installed server capabilities and exact installed-VSIX workflows require the coordinated native test. The former unmounted-router finding is historical, not a statement about this current candidate. The contract also lacks an authoritative terminal item epoch for retry/cancel after a claim is released; no epoch is guessed. An empty direct-enqueue queue needs an admitted snapshot source. Managed Work Item attachment upload/list/download operations are absent; read-only Run artifact operations do not supply that capability. These are explicit Actions #132/#327 dependencies. Client transport/controller/renderer fixtures do not establish real server execution, scoped grants, leases, retry/review semantics or artifacts.

## Robot Run completion

Robot **Run** retains the original RCC task command. The existing terminal PID wrapper already waits for that exact RCC child; it now records its actual child PID/exit code in a task-owned exclusive receipt and removes the private control variable before launching the task. DAP waits briefly for that receipt and sends `exited` before `terminated`. Direct Popen mode reports its actual wait status. No terminal text is parsed and no success is inferred from output existence.

Native receipt tracking preserves `EXITED/<actual code>` through the later session termination event. If a platform fails to provide completion evidence, it shows `TERMINATED` with unknown exit code; it does not claim the user clicked Stop. Actual user cancellation stays distinct. Action/Robot **Debug** retains the existing debugpy path. Windows/macOS lifecycle execution remains untested.

## Qualification and desktop handoff

Source regressions distinguish the real SDK/process tests from simulated editor/HTTP tests. `tests/native_work_items_smoke.py` executes owned Action and Robot File/SQLite run and real debugpy breakpoint/continue using independent RCC homes. `tests/native_runtime_api_smoke.py` starts the checksum-verified actual published Runtime with synthetic authenticated storage and exercises the compiled client. Neither proves the installed native editor UI.

Desktop QA must install the exact replacement VSIX and repeat both fixture packages from `sema4ai/tests/fixtures/native_work_items/` in a task-owned workspace:

- Action **and** Robot: start with an empty item, use Add field / number / value7 without touching JSON or a schema, create, attach a synthetic file, select, Run, Debug with breakpoint at `value = item.payload`, continue and observe output 7. Repeat File and SQLite modes; verify interpreter/home paths and actual input/output IDs.
- Exercise nested objects/arrays and basic types, duplicate names, optional advanced JSON roundtrip and an already-declared integer constraint; preserve invalid and unsaved drafts through refresh/metadata updates and Ctrl+W / reopen, including after an Extension Host restart. Select a fresh input after a successful run and verify **Not run**; replay an output, edit the copy, save and prove the original/attachments stay unchanged. Reject stale fixture revisions, traversal names, attachment conflicts and cross-package paths.
- Observe execution/session/exit provenance and input-to-output navigation; close/reopen the editor while running, refresh after stop and retain SDK state. Stop only the extension-owned session. After an Extension Host restart, old sessions are explicitly untracked and are never adopted.
- SQLite: fail a synthetic item, replay with new identity, restart and recover only expired claims under explicit confirmation; demonstrate FIFO limitation and package/queue isolation.
- Authenticated Runtime: synthetic token connect, enqueue/list/files, invalid payload, bad token/revocation, offline/reconnect, and unknown candidate version. Managed lifecycle/scoped-denial/artifact workflows remain blocked until canonical server contracts exist; do not substitute the published subset for full acceptance.

Retain genuine original and boxed captures bound to the exact source and VSIX digest. Windows/macOS path semantics are preserved but these new executions are Linux-only. **ALL FEATURES NOT COMPLETE.**
