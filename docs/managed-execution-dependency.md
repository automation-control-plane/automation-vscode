# Native managed execution: bounded API dependency

## Verified current boundary

The owned client pins `resources/work-items/managed-v1.json` to Actions commit
`f1b11838674494cd6a34d343b97404cbb1537004`, blob
`3a34f69c7770de072427fddb79bf0d4cc39da06f`. This contract has fourteen operations;
it has no execution invocation or independent admitted-snapshot discovery operation.

- `queues.list` returns QueueView: counts, label, mode, permissions and QueueRef.
  It does not return an execution snapshot or a capability catalog.
- `items.list` / `items.get` return ItemView.snapshot. The controller already
  assigns the exact selected item's snapshot in `managed.item`.
- `runs.get` returns RunView.snapshot for a Run linked to the selected item/review.
  The controller currently displays it, without making it an enqueue selection.
- `managed.snapshot` imports an existing admitted snapshot from a selected file.
  It cannot register, synthesize or authorize an execution.
- Enqueue checks exact Deployment revision scope. Claims and execution are
  separate. Runtime supplies worker/actor authority; the extension must not mint it.

Source: `sema4ai/vscode-client/src/managedWorkItemsView.ts` (`managed.item`,
`managed.run`, `managed.snapshot`); `managedWorkItemsClient.ts`
(`validateCommand`, response scope checks); `resources/work-items/managed-editor.js`.

Desktop QA reported ordinary a38 native enqueue/claim, then real RCC execution via
the documented external `capability_invoke` harness. Native Inspect showed DONE,
Run/Attempt and four artifacts. That proves the backend path, not a native Run
button. Completion remains disabled when execution already released the claim;
do not manufacture a terminal epoch or treat external completion acknowledgment
as button acceptance.

## Smallest proposed UX, without new authority

1. Keep the existing connection/workspace, queue list and form. Add an **Execution**
   selection inside Prepare, showing authorized deployment/revision and capability
   names returned by canonical discovery. Select only server-admitted immutable
   snapshots; show revision/provenance in details. Selection never invokes or claims.
2. Where an existing authorized item or linked Run is the source, offer an explicit
   **Use this execution** selection using its exact validated snapshot, unchanged.
   This can reuse the verified current APIs. An empty queue needs canonical
   discovery of admitted executions; queue labels/metadata cannot supply authority.
3. Add one explicit managed **Run** using the canonical typed invocation ingress
   and existing authenticated connection only after its actor/audience contract is
   verified. Keep action arguments separate from Work Item fields. Preserve exact
   immutable selection, correlation/idempotency semantics and returned Run identity.
4. Project returned Run/Attempt/logs/artifacts through existing Inspect. Denied,
   incompatible and uncertain outcomes remain explicit; no arbitrary shell, new
   scheduler, automatic claim, guessed snapshot, implicit approval or endpoint fallback.

## Contract needed from the Actions integrator through parent

Before implementing new ingress, supply the exact a38 commit and the successful
synthetic harness/source locations, with no credentials:

- Discovery transport, paths/tool names, generated request/response schema,
  pagination and availability/version negotiation. Identify which response supplies
  the authoritative admitted snapshot and immutable revision/capability identifiers.
- `capability_invoke` transport and typed schema, including argument versus Work
  Item binding, claim/fence requirements, output Run identity and polling/result
  contract. Confirm whether execution consumes an existing claim or obtains one;
  the client must not infer it.
- Required actor/audience/grants and how the existing Runtime token is admitted.
  Confirm scoped denial behavior, idempotency/reconciliation, cancellation and
  timeout semantics. No authorization downgrade or new credential service.
- A synthetic deployment/recipe for no-manual-JSON selection → explicit native Run
  → actual RCC → authoritative Run/Attempt/artifact acceptance, plus denied cases.

The supported read of `https://api.github.com/repos/joshyorko/actions/pulls/327`
on October 25 returned **404 Not Found**. This does not identify its cause or prove
the absence of a38 APIs. No alternate access route was attempted. Additional a38
discovery/invocation semantics remain unverified; parent/integrator handoff was
requested while the independent multiline fix proceeded.

## Bounded file ownership / implementation plan

One extension source owner, existing PR #1; parent retains the sole native tester.

- `vscode-client/src/managedWorkItemsClient.ts`: retain exact fourteen-operation
  protocol and scope checks. Do not add invented operations to its schema.
- A small typed execution client beside it, **only if the verified canonical
  invocation uses a separate ingress**, reusing RuntimeTransport and its secure
  origin/auth/error handling. Pin only reviewed schema/version/capabilities.
- `vscode-client/src/managedWorkItemsView.ts`: discovery selection, exact snapshot
  provenance, explicit invocation and returned Run projection; no actor fabrication.
- `resources/work-items/managed-editor.js` / `panel.html` / `panel.css`: compact
  execution selector, form arguments, explicit Run and accurate loading/denied/result
  states using existing Runbook components. Keep Advanced JSON optional.
- Client/controller/editor tests: immutable selection, scope/permission/version
  negatives, zero automatic execution, exact invocation and uncertain outcome.
- Existing native tester: exact installed VSIX, no JSON file/schema authoring,
  real selected capability execution and artifact/lineage proof.

This is required current-release work. The proposal does not change production
discovery or execution until the actual canonical contract is supplied and reviewed.
