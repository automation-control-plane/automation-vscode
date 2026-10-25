# 2.20.15 — reviewed managed candidate compatibility

Source comparison used immutable Actions commit
`f1b11838674494cd6a34d343b97404cbb1537004` through the authorized read connector.
No Actions files, services, credentials or system settings were changed.

## Exact contract

- Path: `docs/contracts/work-items/managed-v1.json`
- Git blob: `3a34f69c7770de072427fddb79bf0d4cc39da06f`
- Exact bytes: 193802; SHA256 `d8eb71c42f0b544dd15638420305eda6013b413a0b2c03b9894dd0900fab047d`
- Recursively sorted compact JSON SHA256: `f815b507681e5ed0a3bfe761a3d12aed47d84d4fef4b74413431ddd138401d69`

The semantic diff is retained in `schema-semantic-diff.json`. It has only eleven
paths: optional ExecutionSnapshot capability_authority added in commands and nine
result definitions, and required-input appended to QueueView.mode. No permission,
operation, required-field, fence, lease, attachment or retry schema changed.

Reviewed backend source at that commit:

- `action_server/src/actions/server/run_outputs/types.py`, blob
  `ece29a18a0f4b2d78efbafdbba5239483ea7d1a8`: the authority enum is legacy-action or
  package-revision. Default is legacy-action and its serializer omits that default.
- `action_server/src/actions/server/managed_work_items/contracts.py`, blob
  `85003076ffc32890f6b597a43a102f8de803d285`: both capabilities and QueueView admit
  required-input. Capability mode none remains valid but is not a queue mode.
- `action_server/src/actions/server/managed_work_items/generic_service.py`, blob
  `badc537ba0227185c0ab083a10ef152ada8f2758`: required policy maps to required-input;
  explicit grants control enqueue; server worker identity also controls claim,
  renew and completion. Generic service advertises no review/retry. Discovery
  does not enqueue, claim, run or create authority.

## Correction and regression evidence

The exact checked-in pin is updated, not replaced with permissive matching.
Unknown semantics and the old differing candidate fail before capabilities or
mutations. Reordering JSON object keys still negotiates. Queue mode types and the
capabilities allowlist include required-input; response queues must have an
advertised mode. The renderer explains Input required and displays snapshot
capability authority read-only. Omitted legacy authority remains omitted in actual
serialized requests, and explicit legacy/package-revision values remain unchanged.
No default insertion or journal migration occurs.

Final source: compile plus **144 Node tests** and **65 Python tests**, no failures
or skips in these selected gates. The retained first run shows four expected red
regressions before the correction. Tests use real compiled transport/controllers,
loopback HTTP, files and the maintained editor script with synthetic server/VS
Code/DOM peers. They are not a live canonical Runtime/SQL/worker or native GUI pass.

Coverage includes required-input discovery, explicit authority DTOs, zero automatic
mutations, readonly/global-vs-queue grant separation, worker operation grants,
unknown schemas/modes/authority, raw required mode refusal, cross-workspace/queue
fences, 403 admission clearing, uncertain exact-key replay and retained terminal
epoch refusal. Published Runtime 1.0.4 client/auth/attachments tests remain separate;
no candidate protocol becomes a local/published dependency or fallback.

## Exact commands

From `sema4ai`, after `source /workspace/.setup/activate.sh`:

```sh
npm test
poetry run pytest tests/sema4ai_code_tests/inspector/test_failure_states.py tests/sema4ai_code_tests/test_published_toolchain.py tests/sema4ai_code_tests/test_action_work_items.py tests/sema4ai_code_tests/test_compute_launch.py tests/sema4ai_code_tests/test_robot_completion.py tests/sema4ai_code_tests/test_pre_run_scripts.py -q
npm run vsce:package -- --target linux-x64 --out /tmp/automation-managed-20261025/automation-vscode-2.20.15-linux-x64.vsix
```

## Affected native retest

1. Keep the existing 2.20.14 artifact/evidence. Install exact new hashed bytes in
   the existing isolated desktop profile, without changing the backend endpoint
   or real credentials as a side effect of installation.
2. Connect to the parent's authenticated synthetic a37 Runtime whose exact schema
   matches the recorded hash. Confirm required-input queues load, display Input
   required, and selection itself causes no mutation or execution.
3. With read-only authority, enqueue/claim/retry/review remain disabled. With
   separately granted operations and an admitted snapshot, explicitly enqueue or
   claim only as supported by that live service. Required input is not approval,
   execution readiness or a claim of the selected item.
4. Inspect legacy and package-revision snapshots; verify authority labels and
   exact request/journal bytes. Unknown schema/mode/authority must stay denied;
   401/403 must clear admission without local/published fallback.
5. Regress existing published 1.0.4 storage and local Action/Robot paths. Live
   canonical lifecycle, artifacts and review must be qualified through the real
   backend separately. No fake epoch, snapshot, worker or unsupported operation.

Upstream disposition: none (reviewed contract evolution; extension compatibility
correction). Canonical documentation updated in `docs/native-work-items.md` and
`docs/work-items-implementation.md` to replace stale pin/unmounted-router claims.
Windows/macOS remain untested. No merge, publication, hosted CI or spending.
