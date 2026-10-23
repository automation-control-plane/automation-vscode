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

## Implementation order

1. Preserve and push final 2.20.5 proof. Build package-scoped local SDK service with strict Action ownership/version checks, supported FileAdapter/SQLiteAdapter APIs, attachment validation, no SQL or authority duplication.
2. Reuse Automation resource tree to open one native editor with explicit File, SQLite and managed modes; validate payload and attachments, select input, launch existing run/debug, refresh actual outputs/state and local execution receipt.
3. Prove owned SDK Action and Robot fixtures and public queue lifecycle/restart/replay. Add invalid payload, path, isolation and conflict regressions.
4. Implement authenticated managed client only against verified canonical contracts; published unsupported/denied states stay explicit. No guessed mutation routes, fake lease/status, copied credentials or local SQL access to server storage.
5. Build a new private candidate, install exact bytes on selected desktop and qualify each requested flow. Continue full feature ledger; do not declare release complete while any required row is open.

Local execution receipts are UI provenance, never a queue scheduler or a claim of canonical Runtime Run/Attempt identity. Work Item payload schema is separate from Action parameter schema. Data/Knowledge operations do not substitute for queue lifecycle.
