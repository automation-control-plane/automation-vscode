# Approved Runbook: complete extension surface checklist

Visual truth: `exec-9045ec88-84ec-46c5-aa25-55c8d78b9d0d.png` (1488 × 1059), approved combined Runbook concept. The invoice content is illustrative only; implementation reads actual package, item, receipt and log identities.

Starting source: c81c72c08611b6d2c01149cb7cb2fa2b2674eac8. All changes use the existing TypeScript host and HTML/CSS/JavaScript webviews. No replacement server, queue, framework or VS Code chrome.

| Surface | Implementation / preserved capability | Required actual capture and interaction |
|---|---|---|
| Workspace navigation | Six flat native rows: Packages, Environments, Work Items, Runs, Inspectors, Settings | Selected row, keyboard activation, narrow sidebar |
| Packages sidebar | Existing native Action/Robot/Agent discovery; readable type + path disambiguation; existing task/action/context commands | Duplicate names, empty workspace, selected package, create Action and Robot |
| Package Content | Existing filesystem provider; collapsed secondary native section | Files, open/create/rename/delete confirmations and scope |
| Package Resources | Existing Work Items and locator providers preserved | Action and Robot visibility, selected package isolation |
| Legacy Control Room | Existing stable IDs and opt-in gate; hidden by default | Default absence, explicit compatibility state only |
| Package workspace | Actual discovered runnable Actions/tasks, configuration/dependency summary, local export/metadata, native source links | Prepare, Run, Debug; Action and Robot; no sample data |
| Action argument editor | Named V2/V3 cases, nested form editing, metadata/signature/OAuth preservation, advanced JSON fallback | Existing and new inputs; conflict, invalid form, refresh/reopen drafts |
| Environments | Explicit Python check/build, exact interpreter result, separated homes, honest Runtime identity/status/reconnect | Unchecked/loading/ready/error; overrides; old unowned listener stays unowned |
| Work Items local File | Shared Prepare/Run/Inspect, context, payload, attachments, receipts, read-only outputs and replay | Action/Robot Run/Debug; selected result, attachment byte identity and lineage |
| Work Items SDK SQLite | Same UI plus actual SDK states and reserved identity guidance | FIFO/claim, expiry, replay, restart, draft retention |
| Work Items Runtime 1.0.4 | Explicit authenticated published storage capability and limits | Connect/denied/unavailable; no managed lifecycle success invented |
| Work Items managed | Existing pinned capability/permission/epoch client retained with coherent hierarchy | Canonical API integration remains incomplete and separate-owner gated |
| Runs workspace | Actual retained log sessions only; explicit IDs, no inferred success or Work Item association | Empty/list/selected log, reload distinction |
| Task/Action Output | Immutable upstream engine with maintainable token/shell source; streaming, selection/source links preserved | Empty, running, finished, expanded actual output; CSP console |
| Inspector Manager | Immutable engine + editable shell, correct package type/path, labeled route navigation | Empty/populated, refresh/copy, locator edit/delete/save |
| Web Inspector | Actual engine/backend; readable controls and shared tokens | Explicit start/stop/pick/validate/cancel, no start on mount |
| Image Inspector | Actual capture/confidence/validate/save workflow | Empty, capture/cancel, confidence, unavailable display |
| Windows Inspector | Native backend retained, accurate platform gate | Unsupported Linux; Windows qualification separate |
| Java Inspector | Native backend retained, accurate Java Access Bridge/platform gate | Unsupported Linux; supported native host separate |
| Playwright Recorder | Existing separate recorder, forced selected package context | Explicit launch only, cancellation/error; no other package fallback |
| Settings | Friendly complete settings inventory, native scope/validation/reset editor; stable compatibility keys preserved | Default/override, keyboard, narrow/light/high-contrast |
| MCP server form | Shared slate/amber form theme, explicit configuration-only save statement; transport/secret types unchanged | Validation, stdio/http fields, explicit save/cancel/error |
| Private issue form | Shared layout/theme, local logs and explicit browser draft boundary | Empty/validation, log preview, private draft; no automatic upload |
| Native dialogs/editor/debug/terminal/status | Preserve native geometry and actual launch semantics; labels/context improved only where owned | Create/cancel, interpreter, debug breakpoints, exit status, source/log links |
| Backend-gated Agent/Data/OAuth | Existing capability boundaries and configuration retained | Honest missing backend; no credentials or backend qualification inferred |

## Blocking acceptance

- All view routes must be captured from the exact installed VSIX, not only a DOM fixture.
- Match reference viewport/content region, compare combined source+implementation and focused regions; fix P0/P1/P2, recapture.
- Native Action/Robot × File/SQLite × Run/Debug eight-cell regression remains mandatory.
- Keep managed canonical SQL/auth completion, non-Linux Inspectors and external credentials as explicit distinct gates.
- Existing old Runtime without a persisted ownership record must not be adopted. A new recorded Runtime launch is needed before reload/reconnect can be qualified.
