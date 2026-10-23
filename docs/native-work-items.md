# Native Work Items

Open **Automation → Package Resources → Work Items**, or run **Automation: Open Native Work Items** after selecting an Action Package or Robot Task. Existing command/configuration identifiers and legacy Robot fixture tooling remain compatible. The owned SDK path opens the dedicated editor from New Work Item and item clicks; legacy Robots without the owned SDK keep the earlier fixture creation flow.

## Local test files

1. Select **Local test files**, enter a payload object and choose **Create input**. The editor creates a unique new fixture, selects it and preserves all existing files.
2. Add attachments with **Add attachment**; filenames and sizes are validated, and an existing attachment is never overwritten. A file button saves a copy to a new destination.
3. Optionally expand **Required payload field types** and declare a map such as `{"value":"integer"}`. These are required top-level types; extra fields are allowed. This deliberately bounded contract is not full JSON Schema. It is package-local and separate from Action parameter types. Invalid types block create/save/launch.
4. Set Action parameters in the separate section, select **Run** or **Debug**, then choose the Action or Robot task. There is no first-run parameter-file generation/relaunch step. The extension uses its existing interpreter resolution and debugger.
5. Refresh to inspect outputs and linked execution receipts. File launches use an immutable private snapshot of the selected input and its attachments; the authored input remains unchanged. Outputs are read-only; **Replay as new input** creates a distinct copy and records its source.

The editor edits payloads rather than exposing the fixture envelope and attachment-path schema. Its backend runs with the selected package interpreter and requires **actions-work-items==0.4.4** for both new Action and Robot flows. Action dependency checks specifically require the owned library; a vendor or legacy library cannot satisfy them. Legacy Robot commands remain available separately.

## SDK SQLite development queue

Select **SDK SQLite queue** and name a queue (default `input`). Storage is private to the package under `devdata/automation-work-items`: `queue.db`, attachment files, payload contract, local execution receipts and replay provenance. All queue operations use public published `SQLiteAdapter` APIs; the extension contains no SQL, queue scheduler or worker authority.

Create seeds an input; a workload reserves it and reports completion/failure through the SDK. Outputs retain actual SDK `parent_id`, item IDs, queue and state. Refresh/reopening reads persistent SDK state. Replay makes a new input rather than resetting a terminal item. Published SQLite has no conditional payload edit, so the editor refuses in-place queue edits and offers replay. It does not pretend a read-before-write check is a fenced mutation.

**Consumption is FIFO.** Select the oldest pending input before Run/Debug. The published API cannot reserve an arbitrary selected ID. The editor checks the preview and refuses a newer selection, but another concurrent consumer could claim between preview and launch. Use this mode for a single local development consumer; the execution receipt labels the selection as a preview. SDK parent IDs are authoritative. Named queue discovery is limited to explicit names; there is no supported all-queues API in this published adapter. A canonical managed queue must supply atomic item binding, scope and fencing.

**Recover expired claims** explicitly invokes the SDK's public orphan recovery using its configured timeout (default 30 minutes), with confirmation. It applies across this package database. Stopping a local execution does not mark its business item completed or pretend to perform a managed cancellation. No unknown process is adopted or stopped. Existing operator Work Items environment overrides cause a clear launch conflict instead of being overwritten.

## Authenticated published Runtime

Select **Managed Runtime**, then **Connect / reconnect Runtime**. Use an explicit HTTPS origin, or loopback HTTP, and an API token. The host verifies `/config` version **1.0.4**, authentication enabled and an authorized Work Items read before enabling mutations. Tokens are stored in VS Code SecretStorage scoped to package plus origin, never in workspace files, webview messages or logs. Empty token input can reuse that package's stored token; Escape cancels.

Published support: list a named queue, seed an input with explicit confirmation, inspect server-owned identity/state/payload/files, upload with confirmation and download attachments. Reads are bounded; redirects are not followed. Authentication denial, unavailable capability, invalid payload, version mismatch and connection failures remain explicit; the client never falls back to a local queue.

**Not implemented/available as a canonical managed contract:** item-specific Run dispatch, Run/Attempt linkage, fenced lease/heartbeat, retry/dead-letter, cancellation, review/approval, resource-scoped workspace authorization and linked logs/results/artifacts. Published Runtime 1.0.4's Work Items router does not expose them. Candidate APIs are rejected until their exact authenticated capability/schema contract is integrated and tested. The Actions #132/#327 sole integrator owns these server contracts; the extension owns the client. No proprietary Control Room/Studio substitution or direct server-database access is used.

## Qualification and desktop handoff

Source regressions distinguish the real SDK/process tests from simulated editor/HTTP tests. `tests/native_work_items_smoke.py` executes owned Action and Robot File/SQLite run and real debugpy breakpoint/continue using independent RCC homes. `tests/native_runtime_api_smoke.py` starts the checksum-verified actual published Runtime with synthetic authenticated storage and exercises the compiled client. Neither proves the installed native editor UI.

Desktop QA must install the exact replacement VSIX and repeat both fixture packages from `sema4ai/tests/fixtures/native_work_items/` in a task-owned workspace:

- Action **and** Robot: create payload 7, attach a synthetic file, select, Run, Debug with breakpoint at `value = item.payload`, continue and observe output 7. Repeat File and SQLite modes; verify interpreter/home paths and actual input/output IDs.
- Save a declared integer contract and reject a string payload; preserve invalid edits until corrected. Reject stale fixture revisions, traversal names, attachment conflicts and cross-package paths.
- Observe execution/session/exit provenance and input-to-output navigation; close/reopen the editor while running, refresh after stop and retain SDK state. Stop only the extension-owned session. After an Extension Host restart, old sessions are explicitly untracked and are never adopted.
- SQLite: fail a synthetic item, replay with new identity, restart and recover only expired claims under explicit confirmation; demonstrate FIFO limitation and package/queue isolation.
- Authenticated Runtime: synthetic token connect, enqueue/list/files, invalid payload, bad token/revocation, offline/reconnect, and unknown candidate version. Managed lifecycle/scoped-denial/artifact workflows remain blocked until canonical server contracts exist; do not substitute the published subset for full acceptance.

Retain genuine original and boxed captures bound to the exact source and VSIX digest. Windows/macOS path semantics are preserved but these new executions are Linux-only. **ALL FEATURES NOT COMPLETE.**
