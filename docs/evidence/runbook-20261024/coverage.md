# Exact-candidate surface coverage

All native screenshots and rendered visual comparisons are **pending** for 2.20.11.
This table describes source/protocol checks separately from actual GUI interaction.
Implementation paths and acceptance details remain in `docs/runbook-view-checklist.md`.

| Owned surface | Executed evidence | Native desktop gate / screenshot caption |
| --- | --- | --- |
| Flat Automation navigation | Runbook model/host tests | Packages, Environments, Work Items, Runs, Inspectors, Settings; selected/focus states |
| Packages tree and discovery | Real packaged LSP discovers Action and Robot | Own sidebar package selection, type/path, empty/error/cancel |
| Package workspace and creation/configuration | Host/form model tests | Create both kinds, actual runnable/config/dependency/export controls |
| Package Content and Resources trees | Selection and exact-SDK regressions | Context follows Action/Robot selection; Work Items and inspectors visible |
| Action arguments | Nested typed form, V2/V3 metadata/OAuth preservation tests | Create/edit/run without JSON, metadata refresh and validation |
| Environments and Runtime | Real separate RCC interpreters; actual Runtime identity/reconnect harness | Actual interpreter/version/home display; explicit build, startup and Reload Window |
| Work Items FileAdapter | 4 real CLI/DAP cells, output attachments/replay/negatives | No-JSON creation, forms, fields, attachment controls, run/debug and selected results |
| Work Items SQLite | 4 real CLI/DAP cells, SDK lineage/replay/negatives; active-claim regression | Queue selection, IN_PROGRESS guidance, actual stop/expiry recovery without stealing |
| Runtime 1.0.4 storage | Real authenticated client HTTP lifecycle and byte downloads | Connect/denied/unavailable and explicit storage-only limits |
| Canonical managed mode | Simulated schema/permission/epoch/controller tests only | Backend contract and mounted authenticated service blocked; no success fabricated |
| Runs workspace | Real workload receipts plus selection/model tests | Actual retained log navigation and selection-specific outcome |
| Task/Action Output | Immutable engine/hash and shell regressions | Streaming, success/failure, expansion, links and webview console |
| Inspector Manager | Shell/host/package context regressions | Locator list/edit/save/delete, copy/refresh, Action/Robot package context |
| Web Inspector | Shell/backend wiring tests; no new browser picker run here | Actual explicit start/pick/validate/stop; no mount side effect |
| Image Inspector | Shell tests; host has no display | Capture/cancel/confidence and honest unsupported state |
| Windows Inspector | Platform gating retained | Linux unavailable state; Windows execution untested |
| Java Inspector | Platform/backend gating retained | Linux unavailable state; supported Java Access Bridge host untested |
| Playwright Recorder | Selection/host regression coverage | Explicit launch/cancel, package isolation, failure guidance |
| Settings | Full metadata/form/navigation tests | Native scoped setting update/reset, default/override, keyboard |
| MCP configuration | Form/source regressions | Stdio/HTTP validation/save/cancel; no fake server startup |
| Private issue form | Form/source regressions | Validation, local log preview and explicit browser draft boundary |
| Native dialogs/editor/debug/terminal/status | Actual DAP/RCC subprocesses; Code peer simulated | Real Code integration, correct status/interpreter, breakpoints and termination |
| Agent/Data/OAuth compatibility | Explicit gates preserved; no credentials used | Honest missing backend/denied states; no proprietary backend relabeling |
| Proprietary Studio/Control Room/publishing | Owned default menu regressions | Confirm hidden in default navigation and no vendor publishing links |
| Cross-cutting themes and lifecycle | DOM state/form/duplicate-key/nested/selection tests | Dark/light/high-contrast, narrow width, keyboard, loading/empty/error/denied, drafts across close/reload |

No row is a native visual pass. Full release completion also requires managed backend
decisions and platform-specific gates, independently of the private local candidate.
