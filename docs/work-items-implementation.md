# Native Work Items release ledger

Owner directive: [PR1 comment6366927805](https://github.com/automation-control-plane/automation-vscode/pull/1#issuecomment-6366927805). **ALL FEATURES NOT COMPLETE.** This is implementation scope, not a deferred UX proposal. Existing 2.20.4 and qualified restart candidate 2.20.5 remain available.

| Capability / mode | Owner | SHA / PR | Evidence | Blocker | Next action |
| --- | --- | --- | --- | --- | --- |
| Installed Action/Robot creation, environment, run/debug; independent homes | Extension writer | 4ca10b8a / PR1 | 11 installed Linux stages; parent native desktop 2.20.4 run/debug | Windows/macOS untested | Preserve regressions, retest new UI in desktop |
| Runtime restart | Extension writer; desktop QA | 4ca10b8a / PR1 | Real wrapper11169→11255, installed compiled extension; simulated terminal-close race | Actual desktop Restart button retest pending | Desktop install exact 2.20.5 |
| FileAdapter Action input/output | Extension writer | 4ca10b8a / PR1 | Installed LSP and desktop 7→7 | Raw JSON UX; no execution lineage | Dedicated editor and linked launch/output UI |
| FileAdapter Robot owned SDK consume/produce | Extension writer | PR1 pending implementation | Existing Robot run/debug only | Prior Robot fixture lacks Work Items SDK | Owned SDK Robot fixture and real run/debug |
| Native payload/attachments, validation, sidebar selection, lineage, loading/error states | Extension writer | PR1 pending implementation | Existing tree/create/picker is partial | No dedicated editor | Reuse resource tree + scoped VS Code webview, no new UI framework |
| SDK SQLite seed/reserve/done/fail/output/files/replay/restart | Extension writer; SDK owns queue | Published Work Items0.4.4, c8462043 | Public SQLiteAdapter APIs inspected | Native integration absent; reserve_input claims FIFO, not arbitrary ID | Package-scoped helper using SDK APIs only; explicit FIFO semantics |
| Published managed list/seed/stats/detail/files | Actions integrator owns API; extension owns client | Runtime1.0.4 d222f94e | /api/work-items source; actual binary capability probe pending | Must verify runtime availability/auth; no full durable graph | Probe actual binary; authenticated mode-aware client |
| Managed item→Run→Attempt, lease, retry/dead-letter, cancel, review/approval, artifacts/logs | Actions #132/#327 sole integrator | PR328 candidate6f26e4a is unreleased | Published and inspected candidate Work Items router lacks these contracts | Canonical authenticated capability/schema contract missing | Integrator handoff [#327 comment6367182477](https://github.com/joshyorko/actions/issues/327#issuecomment-6367182477); implement client against returned contract |
| Invalid payload, denied scope, isolation, restart/cancel/retry/lineage negatives | Extension writer + server integrator | PR1 pending | Existing home/unknown-listener regressions | New mode coverage absent | Boundary tests + real SDK/API negatives, then installed desktop scenarios |

## Current checkpoint: 2.20.6

Source `55daabf45244c73a27682ef36a1f643a0afb7489`, pushed and remotely verified. Private VSIX Library `libfile_7e551ff032d481919a0a4722fdca43b3`, SHA256 `7a2fa7c2d35a8967a57c6a886d36e5ef6198e0bc594cf9038bee67e34f85766b`.

Fixture/instruction ZIP: `libfile_2038f6a2a5f881919475965163654e2f`. Official Code CLI installed exact bytes; all 717 installed payload files match and 716 source payload files match. Final source: 28 Node passes, seven real SDK passes, 56 Python passes / one legacy skip. Final installed code passed eight Action/Robot File/SQLite run/debug cells, actual authenticated published Runtime enqueue/list/upload/download with403/422 negatives, and real Runtime restart16291→16341. GUI editor acceptance is pending; these do not replace it.

Canonical managed handoff is now available at Actions commit `1520f348c31b68a8faf5a3f813bea6cf5146897b`: `docs/program/actions-next-managed-work-items-132.md`, `docs/contracts/work-items/managed-v1.json`, source `managed_work_items/contracts.py` and `api.py`. Runtime floor1.1.0a13, fenced SDK0.5.0a1, protocol `actions.managed-work-items/v1`. The router factory is **not mounted on ordinary startup** and the real SQL/auth service integration is still integrator-owned. Extension integration proceeds against that exact contract, separately from published1.0.4 local CRUD; no automatic fallback.

## Implementation order

1. Preserve and push final 2.20.5 proof. Build package-scoped local SDK service with strict Action ownership/version checks, supported FileAdapter/SQLiteAdapter APIs, attachment validation, no SQL or authority duplication.
2. Reuse Automation resource tree to open one native editor with explicit File, SQLite and managed modes; validate payload and attachments, select input, launch existing run/debug, refresh actual outputs/state and local execution receipt.
3. Prove owned SDK Action and Robot fixtures and public queue lifecycle/restart/replay. Add invalid payload, path, isolation and conflict regressions.
4. Implement authenticated managed client only against verified canonical contracts; published unsupported/denied states stay explicit. No guessed mutation routes, fake lease/status, copied credentials or local SQL access to server storage.
5. Build a new private candidate, install exact bytes on selected desktop and qualify each requested flow. Continue full feature ledger; do not declare release complete while any required row is open.

Local execution receipts are UI provenance, never a queue scheduler or a claim of canonical Runtime Run/Attempt identity. Work Item payload schema is separate from Action parameter schema. Data/Knowledge operations do not substitute for queue lifecycle.
