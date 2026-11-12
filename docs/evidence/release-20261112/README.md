> Latest exact-byte acceptance: [2.20.24 final installed ledger](2.20.24/README.md).
> Earlier checkpoint evidence below remains version-specific and preserved.

# Installed native Work Items checkpoint — 2.20.22

Runtime payload commit: `a31a9dfd3e147d91ac37aca7d058c22135af4631`.
The exact VSIX is 2,213,794 bytes, SHA-256
`af8ab7b68c3533be7f2ffbb02f1385f7fbb104fa249239c785cb38a54581ba91`.
All 752 archive payloads match the installed extension and source. VSCE normalizes
`README.md` to `readme.md`; Code adds only installation metadata to package.json.
The immutable 2.20.20 and intermediate 2.20.21 VSIX artifacts are preserved.

## Executed acceptance

Official Code 1.146.0, isolated task-owned profile, normal Extension Host mode,
sandboxed headless Electron; no sandbox-disable flags or workspace-trust bypass.
Only the synthetic workspace was trusted through the ordinary native trust UI.
The acceptance controller selects real package-tree entries and opens the actual
installed extension. Playwright drives its actual webview and native pickers;
no VS Code host, SDK, queue, or workload substitute supplies these results.

The supported Microsoft Python/debugger extensions are installed in that private
profile. Both Action and Robot File/SQLite Run and Debug pass: eight distinct
native launches, four real breakpoint events and continues, exit zero, exact
output values, and SQLite COMPLETED inputs with authoritative output parent_id.
[Exact receipts, output projections, hashes, and test scope](qualification.json)
are retained separately from earlier CLI/DAP evidence. Native file-picker upload,
attachment-copy Run, read-only output, Save to a new file, and edited replay also
pass with exact unchanged source/attachment bytes; see
[native attachment/replay receipts](native-attachment-replay.json).

Source checks: 163 Node tests pass. Focused Python checks pass 56 with one
historical workflow-retirement skip. Three historical vendor-service tests could
not configure CI_ENDPOINT; they are not passing acceptance. Both new missing-
debugger regressions failed before their respective fixes and passed afterward.
Read-only review found a second code-lens caller needing the same cancellation
guard; it is fixed and covered. The native source did not require a broader UI
change. Headless viewport and post-debug frame errors were harness defects;
completed executions were inspected by their original receipts, never retried
for a screenshot.

## Remaining release gates

Pinned RCC Doctor/Bootstrap and 247 Toolkit tests (5 skips) pass for the local
fixture at Actions `b3d41af2c5c4fa01c2821e48521326b3737f7a92`. The exact installed
managed HTTP client accepts its schema/capabilities; unauthenticated schema reads
return 401, authenticated reads return 200. Live MCP protocol, server identity,
model visibility and all three required input schemas negotiate exactly. Native
secure connection and queue selection pass. Read-only `canvas_open` returns an
explicit error, so execution discovery and all native managed mutations remain
unqualified. No enqueue, claim or invoke was sent. The Actions owner is inspecting
the fixture's canonical discovery setup; no client authority/schema guard changed.
[Live read-only receipts](managed-readonly.json) retain the exact scope. The owner then
corrected its fixture at `b3e20f961b5a8c8170c8bf35f1cf82657ccd9205`: it now authors a
real active Canvas application and exact admitted Robot binding. Read-only
application/descriptor discovery succeeds, but the genuine snapshot has runtime
kind `direct`. The installed selector deliberately supports `rcc` only and refuses
that selection. [Direct-scope refusal evidence](managed-direct-scope-refusal.json)
is separate from managed RCC acceptance. No direct expansion was compiled,
packaged, installed, committed, or pushed. The owner is preparing a genuinely
pinned RCC 18.19.8 fixture; no direct receipt is relabeled as RCC. The NVIDIA source Runtime/direct Robot probe is separate
evidence, not this extension's native Run acceptance or installed Runtime/RCC
proof. No historical endpoint is adopted. Negotiate live tools, schemas, protocol,
model authority and queue-specific capabilities before execution. Preserve
uncertain requests after dropped responses or reload, with no duplicate invoke.

The Actions Runtime/Core 1.1.0 and Work Items 0.5.0 artifacts remain planned rather
than verified published dependencies at this checkpoint. Existing published Core
1.0.3 transitive libraries, Runtime 1.0.4/RCC composition mismatch, standalone-only
invocation not exposed by this queue editor, Windows/macOS/Java acceptance, and
isolated Holotree archive export remain explicitly bounded. This is not a full-
scope or cross-platform release claim.

The owned release path is [manual GitHub VSIX assets](../../release.md), with an
`automation-vscode-v<version>` tag. No legacy vendor publication workflow was
run. This checkpoint is not merged or published.
