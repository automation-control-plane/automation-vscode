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

## Prepared boundary and remaining coordination

`sema4ai/vscode-client/src/managedExecutionSelection.ts` is a pure typed boundary:
it validates application/descriptor projections, freezes exact host selections,
and constructs only the existing claim invocation for a matching live selected
item. It has **no network, UI registration, claim or invocation side effects**.
Tests cover immutable identity/defaults, duplicate IDs, size bounds, unknown
mode/authority, and cross-scope/stale-item/claim refusal.

Parent requested integrator confirmation of the consumer contract. Remaining
coordination before introducing ingress:

- Supported MCP client/protocol negotiation for this Runtime, public tools/list
  schemas/metadata and rejection of unavailable/changed invocation contracts.
  Do not guess a legacy handshake or reuse the HTTP schema as the MCP schema.
- Synchronous invocation request retention/reconciliation, transport interruption
  and timeout semantics. No automatic retry, duplicate claim or false failure
  after uncertain dispatch.
- Existing synthetic consumer handoff for exact installed native tests; no secrets
  or datadir transfer. Actor/audience and discovery above are now source-grounded.

## Integration files and acceptance

One extension source owner, same PR #1, existing native tester:

- Small typed MCP client beside managedWorkItemsClient.ts, preserving secure origin,
  authentication and no fallback. Keep its fourteen-operation protocol intact.
- managedWorkItemsView.ts: host-retained selection, explicit confirmed invocation
  and exact result correlation using managedExecutionSelection.ts.
- managed-editor.js / panel.html / panel.css: compact application/capability
  selection, existing forms, explicit Run and accurate loading/denied/result states.
  Keep standalone arguments separate from claimed Work Item payloads.
- Tests: contract negotiation, immutable selection, zero automatic mutations,
  audience/scope/grant negatives, exact request and uncertain result retention.
- Native acceptance: empty-queue discovery without internal JSON files, form input,
  explicit authorized enqueue/claim/Run, real RCC, Run/Attempt/output/artifact
  lineage and denied cases. Retry/Robot/backend gaps remain explicit.

2.20.17 stays unchanged for desktop multiline retest. This preparation checkpoint
creates no replacement VSIX, new ingress or release-completion claim.
