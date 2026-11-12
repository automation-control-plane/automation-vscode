# Native managed execution: verified API and remaining wiring

## Corrected source lookup

Actions **#327 is an issue**, and **#328 is the integration PR**. The former
pulls/327 404 was the wrong resource type, not lack of Actions access. Reads of
the issue, PR and committed consumer recipe succeeded on October 25.

- Installed recipe/runtime source: `f332a8284e78844abcf6700a600d2891d742b682`,
  Runtime 1.1.0a38, Core 1.1.0a3, SDK 0.5.0a2, Python MCP client 2.3.0.
- Read-only integration head: `deedbcd50c570cd93df9db46a14acece435d6e3c` on
  `release/327-invoice-vertical-20261020`; this is not the installed a38 source.
- Recipe: `docs/program/evidence/actions-next-327/recovery-a38/managed-installed-consumer/qualify.py`,
  blob `8af14773e631260e03de77445dadc6c6c73f7983`; README blob
  `c3d4841628dadb29d68417cb87e3478ebb32f2fb`.
- At installed source, `foundry/generic_execution_port.py` blob
  `32ca2a7bd0c6baecc9f38ac6767cede3c72cb333` defines the typed invocation.
- `foundry/invocation_discovery.py` blob
  `e8c6c6c1a3a16e2358eda745c96c804bb010b744` and `foundry/bootstrap.py` blob
  `3d9826f891b037fae26826afe1051f044e5cca74` are unchanged at the inspected head.
  Authoring and generated-result verification have other current-head changes.

Backend paths above are under `action_server/src/actions/server/`. No upstream
files, grants or services were changed or executed by this inspection.

## Canonical selection path

The recipe authenticates streamable HTTP MCP at the configured origin's **/mcp**
with the existing bearer, discovers the server, then calls public tools:

1. `canvas_open({})` returns structuredContent.applications with applicationId,
   title and nullable activeRevisionId. It is read-only, subject to inspect_library
   authorization and server Workspace filtering.
2. `canvas_inspect({appId})` requires inspect_application. Its structured content
   includes activeRevisionId and invocationDescriptors for authorized active
   bindings, plus invocationAvailability and invocationReadiness: "not-checked".
3. A descriptor contains bindingId, mode: "generic", exact snapshot, inputMode
   (none/optional/required/claim), nullable inputQueue, standaloneAllowed, and bounded
   inputSchema. Defaults/examples are omitted by the backend. These references
   neither register admission nor grant execution.
4. The host retains the exact descriptor/revision; the webview sends only selection
   identity. Refresh must not silently switch to a newly active revision. Selection
   and rendering never invoke or claim.

Discovery checks exact Run execute and Package/profile grants, plus applicable
input read/claim and output read/enqueue. Missing authority omits a descriptor.
Input mode and standalone eligibility are independent server projections, not
client-derived grants or readiness guarantees.

The existing fourteen-operation managed HTTP protocol remains separate and
strictly pinned. It supplies queue/item/claim/Run/Attempt/log/artifact projection;
it has no invocation operation. No managed operation is invented.

## Typed invocation and audience

The proven consumer uses this existing MCP request:

```text
capability_invoke({mode: "generic", snapshot: selectedDescriptor.snapshot,
                   claim: actualSelectedItem.claim})
```

No payload, idempotency key, actor, audience or worker override is added to that
claim variant. A separate standalone variant accepts inputs and idempotencyKey;
it must not be substituted for required/claimed input.

Ordinary bootstrap verifies the bearer and assigns the saved actor/Workspace and
**model audience on the server**. Caller audience/Workspace/principal headers confer
no authority. capability_invoke is model-only; app-session tokens cannot become
model authority. The extension must not create CanvasCaller, profile/grants or
use private View metadata as discovery.

The server re-resolves and compares the exact snapshot, requires the actual
input QueueRef/trusted-worker claim owner, then dispatches with the claim epoch.
It executes RCC or returns retained state. A retained uncertain launch yields
reconciliation_required, not permission to retry or claim again.

structuredContent.execution returns state, Run/Attempt IDs and epoch, Work Item
ID/epoch/state, and optional output handles. Inspect must re-read authoritative
managed state. Desktop QA's reported external MCP execution plus native
DONE/Run/Attempt/four artifacts is not a native Run-button pass. Released claims
keep Complete disabled; no terminal epoch or acknowledgment is manufactured.

## Implemented native boundary (2.20.18)

The native panel now offers Discover executions, an authorized application and
capability picker, Enqueue input, explicit Claim next item, and Run claimed input.
No snapshot JSON file is required for that flow. Advanced import remains available
for compatibility. The same multiline typed payload form is preserved.

`managedExecutionClient.ts` implements only the three reviewed tools over the
actual MCP 2.3.0 stateless protocol (2026-07-28). Every required input schema is
compared in full against the source-derived pin; unknown contracts, absent tools,
app-only visibility and unknown protocol/server identity deny native execution.
No initialization fallback, arbitrary tool caller, actor header or shell exists.
The published Runtime 1.0.4 client and the managed HTTP schema are unchanged.

`managedWorkItemsView.ts` retains the exact host selection, serializes requests,
confirms execution, rechecks the same capability and actual claim, and writes and
syncs an exclusive request journal before invoking. Successful execution is
cross-checked against the original input's authoritative Run, Attempt ID/epoch,
snapshot and terminal state. Claim-next selects the actual returned item.
Cancellation settles busy state with no submission. A changed revision never
silently replaces the selected snapshot.

The recipe at Actions commit 9340bc8aac7a4534b50f27bef522f1a942f20afa references
source 7e0fa8d09be0f152d2aa82bea24fe0bb3209e2dd (Runtime a40/Core a5). The extension
does not install or upgrade that candidate automatically. Source-derived schema
construction is in `scripts/build-managed-mcp-contract.js`; schema references
reuse the exact separately reviewed managed-v1 definitions. An independent real
Pydantic generation check and real MCP 2.3 server wire smoke pass locally. These
are synthetic execution tests, not native Runtime/RCC acceptance.

## Exact remaining backend/acceptance boundaries

Request journals use the same validated canonical Runtime origin as transport
and credentials. Each known hash directory records a validated manifest,
Workspace, original spelling, and canonical origin binding. Reconnection copies
matching raw-origin journals without deleting originals; conflicting identities
stop reconnect. Unattributed directories with unresolved or corrupt journals
block connection until the original origin is supplied; validated foreign scopes
are left untouched. Missing receipts and legacy denial receipts remain uncertain.
Malformed receipts, scope mismatches, and journal I/O errors stop activation and
require preserving the files for inspection. Failed reconciliation never resolves
an already uncertain request. Successful exact-key replay appends a separate
validated recovery receipt and preserves the original denial. Restored managed
responses are checked against pinned command/result schemas and exact queue,
Deployment, item, and claim identity. Historical valid Runtime versions remain
readable. Invocation request, result epochs/IDs, and confirmation IDs use the same
validators as the live MCP path.

- If an invocation response is lost, Inspect retained execution reads only the
  original input and linked Runs. It never resubmits capability_invoke. The
  public API does not expose an exact invocation-request/claim-epoch-to-Run lookup
  or nonexecution receipt. The request therefore remains uncertain and blocks
  another mutation. A server-owned read/reconciliation contract is needed to
  clear that outcome safely; a new claim or a terminal item alone is not proof.
- Standalone descriptors are discovered but this queue editor exposes only the
  existing-claim invocation. No input queue is invented for standalone-only
  capabilities. Standalone execution/lookup requires its own form and recovery
  coverage before it can be enabled.
- Native installed desktop discovery → enqueue → claim → Run → linked
  Run/Attempt/artifacts is pending on exact 2.20.18 bytes. Prior external harness
  execution and prior VSIX screenshots do not qualify this native flow.
- Permissions, admission, leases, provider access and actual execution remain
  canonical Runtime authority. Published 1.0.4 is still not a durable managed
  queue substitute.
