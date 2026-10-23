# Owned default workflow and desktop follow-up: 2.20.4

This candidate combines the owner's vendor-workflow correction with the actual desktop QA findings on 2.20.3. Full extension acceptance remains open.

## Product behavior

| Operation | Default Automation behavior | Qualification / gap |
| --- | --- | --- |
| Action/Robot creation, environment loading, run/debug, terminals | Retained local published-tool workflows; independent Action and Robot homes | Earlier installed 2.20.3 smoke passed; final 2.20.4 executable/UI retests recorded separately |
| Action ZIP build and metadata preview | Retained local published Runtime operations; no hosted publishing | Existing real build/metadata smoke retained; new candidate retest required |
| Actions Runtime | Local loopback service with configurable port and occupied-listener protection | Earlier actual Runtime smoke passed; desktop 18083 launch is a separate QA gate |
| Work Items | Action/Robot resource tree exposes Work Items; same local input/consume/output adapters | Compiled resource-provider regressions cover selections and unsupported messages; desktop retest required |
| Interpreter selection | Synchronize public ms-python Python and Python Environments APIs using the current resource | Mocked regression reproduces and fixes separate storage; actual Microsoft discovery may still refuse an interpreter and is never faked |
| Issue reporting | Private repository draft opened for user review; logs stay local | Compiled handler regression; no vendor feedback upload |
| Control Room, Studio publishing, vendor gallery | Hidden from normal palette, views, menus and package tree; compatible IDs retained behind explicit legacy opt-in | No owned orchestration/publishing backend is implemented by the requested releases; no vendor call is relabeled as owned |
| Data Server / Agent CLI | No automatic vendor install/acquisition or owned backend claim | Requested artifacts lack these backend contracts; configured legacy compatibility requires operator intent |
| SDK vendor telemetry / Studio discovery | Disabled by default; explicit compatibility switch controls legacy calls | Node and Python regressions; operator-provided environment remains intact |
| Profiles, other template workloads, native inspectors/platforms | Scope retained | Full ledger still records unqualified features; Windows/macOS are untested |

The compatibility setting is `sema4ai.legacyVendorIntegrations.enabled`, default false. It exposes the original third party integrations only when explicitly enabled. Their names remain accurate. All 119 contributed command IDs, setting IDs and legal attribution remain. `legacy-integrations.json` drives both generated menu/command gating and the client command boundary. The Control Room view also has a visibility condition and its provider performs no default backend lookup. Local ZIP build, Runtime, metadata and private issue commands are not gated.

Action, Robot and Agent command trees remove vendor publish/upload entries by default. Action import offers local ZIP import; vendor gallery is opt-in. Work Items help and converter guidance point at owned repository documentation. Windows long-path help points to Microsoft's documentation. Existing operator data is not moved, cleared or overwritten.

## Interpreter root cause

Read-only inspection of Microsoft Python **v2026.10.0**, commit `caec4653e06e167b02f879df5adf184ec4699252`, confirms that public `environments.updateActiveEnvironmentPath` writes the legacy interpreter path service. Its own UI additionally calls `setInterpreterLegacy`, which resolves the executable through Python Environments and calls `setEnvironment(resource, resolvedEnvironment)`. Python Environments can own the status display while the old path storage already matches RCC. The auto-update's former equality check therefore skipped the necessary second selection.

The fix queries Python Environments selection when that API is enabled and present. Selection updates both public APIs, scoped to the supplied file/project URI, and awaits completion. It passes Microsoft's resolved environment object unchanged. An unresolved result only writes a diagnostic; it never clears a selection, manufactures a version/manager or updates an undefined/global scope. Explicit disable settings are respected. The legacy default false is not mistaken for an explicit opt-out, matching Microsoft's activation logic. Older API paths remain.

Primary source references: https://github.com/microsoft/vscode-python/blob/caec4653e06e167b02f879df5adf184ec4699252/src/client/environmentApi.ts ; https://github.com/microsoft/vscode-python/blob/caec4653e06e167b02f879df5adf184ec4699252/src/client/envExt/api.legacy.ts . Public companion API documentation was inspected read-only at https://github.com/microsoft/vscode-python-environments/tree/b50a8d836d0865699757d0f74f65b85f628b6922/docs . No dependency or upstream source was modified.

## Executed regressions

Prepared Node 24.21.0 / Python 3.11.17 / Poetry 2.1.3, activated with `/workspace/.setup/activate.sh`; commands run from `sema4ai/`.

- `npm test`: TypeScript compile, **24 passed**, zero skipped. Static contributions, actual compiled tree/handler code with mocked VS Code APIs, and real loopback sockets are distinguished from GUI tests.
- `CI_ENDPOINT=http://127.0.0.1:1 ACTIONS_RUNTIME_LOCATION=/workspace/port-acceptance/qualified-871151ce/downloads/actions-runtime-1.0.4-linux64 poetry run pytest tests/sema4ai_code_tests/test_published_toolchain.py tests/sema4ai_code_tests/test_pre_run_scripts.py tests/sema4ai_code_tests/test_compute_launch.py tests/sema4ai_code_tests/robo/test_list_actions.py tests/sema4ai_code_tests/test_work_items.py tests/sema4ai_code_tests/test_action_work_items.py -q`: **56 passed, 1 skipped in 20.29s**. Skip is the existing legacy Actions <=1.0.1 complex metadata case.
- `git diff --check`: passed. All 119 contributed command IDs match the prior candidate. Lock changes are version metadata only.

## Failures and limits retained

- Before the synchronization fix, focused Python API regressions returned 4 passes / 2 failures: separate Environments storage was not selected, and unresolved discovery had no diagnostic. After implementation they pass. The resource-tree regression first failed on missing ActionPackage Work Items while the unsupported-package check passed; the compiled provider now exposes and routes both package kinds.
- An intermediate owned-workflow test used an incorrect expected command ID `sema4ai.actionServerStart`; the existing real ID is `sema4ai.startActionServer`, and the corrected assertion passes. A Runtime test initially lacked the newly imported policy's VS Code mock; that fixture was corrected. These were test defects, not executable failures.
- Automatic approval review rejected a proposed deletion of old prebuilt-environment helper code, citing possible feature removal. The command did not execute and was not retried. Helpers remain; the vendor archive download boundary is gated off by default. No security/network settings or permissions were changed, and no vendor binary was used or bundled.
- Screenshot Library `libfile_304223fa73748191a3c97709df004013` resolved to `branded-action-interpreter-boxed.png`, but the supported transfer helper returned `library file transfer failed: download failed`. No further retry was made. Pixel review remains with desktop QA; this coding worker does not claim to have viewed it.
- Parent-reported actual native desktop 2.20.3 Action run/debug passed at line 13 with `Hello Cloud Desktop QA` and actual actions-home Python 3.12.12; branding and 711 payload files matched. Those facts do not imply new-candidate GUI acceptance. Work Items UI was still hidden in 2.20.3 and is corrected here.
- Published Runtime 1.0.4 still bundles RCC 18.19.3 and its adapter rejects 18.19.7. The version/digest checks were not weakened. Compatible published composition and Agent/Data backend contracts remain full-port architecture gates.
