# Owned Runtime restart timing fix: 2.20.5

Native desktop QA reproduced a correctness failure in 2.20.4: Start on configured port 18083 succeeded, but Start again -> Restart removed the terminal and immediately rejected the still-bound old listener with EADDRINUSE. The known old Runtime later exited. Manual Start after that exit recovered; it was not Restart acceptance.

## Root cause and fix

The extension treated `onDidCloseTerminal` as proof that the published wrapper and its server had exited. VS Code can deliver that event before the old listener releases its port. The unchanged published Runtime 1.0.4 source at `d222f94edca26953c1506ab258adc458ded17c56` confirms its POSIX Go wrapper forwards SIGTERM to its same child and waits/reaps it (`action_server/go-wrapper/process.go:runChild`). Disposal therefore needs an asynchronous completion wait.

`vscode-client/src/actionServer.ts:stopActionServer` captures the owned terminal's process ID and original port, disposes only that terminal, waits for its close event and then calls `runtimeServerConfig.ts:waitForOwnedRuntimeStop`. The latter uses a monotonic 15-second deadline, a signal-0 existence probe of the recorded process and an exclusive loopback bind probe. Both process exit and port release are required when the process ID is available. It never sends a termination signal or HTTP shutdown request to a listener. An unrelated listener or still-alive recorded process causes a clear timeout and no replacement launch. A terminal-close timeout is also reported. Normal restart, explicit restart and the not-yet-ready owned-terminal path use the same wait.

No new server subsystem, scheduler, credential, network/security setting or backend dependency was added. Published wrapper/digest checks and the Runtime's bundled RCC 18.19.3 composition remain unchanged. Windows/macOS paths are retained but these lifecycle executions are Linux-only.

## Regression and real executable evidence

- The new compiled-extension regression first failed: simulated terminal close preceded listener release by 100ms and Start -> Restart created only one terminal. It now passes and creates the replacement after release.
- Real loopback tests retain an unrelated service and verify no shutdown/extra request and no replacement on timeout. A free port alone is insufficient while the recorded process is alive. Signal 0 is an existence check only.
- Final-source `npm test` compiled TypeScript and passed **26 Node tests**. Command/protocol/home/branding/Work Items/Python integration regressions remain green.
- Prepared Node 24.21.0 / Python 3.11.17 / Poetry 2.1.3; from `sema4ai/`: `CI_ENDPOINT=http://127.0.0.1:1 ACTIONS_RUNTIME_LOCATION=/workspace/port-acceptance/qualified-871151ce/downloads/actions-runtime-1.0.4-linux64 poetry run pytest tests/sema4ai_code_tests/test_published_toolchain.py tests/sema4ai_code_tests/test_pre_run_scripts.py tests/sema4ai_code_tests/test_compute_launch.py tests/sema4ai_code_tests/robo/test_list_actions.py tests/sema4ai_code_tests/test_work_items.py tests/sema4ai_code_tests/test_action_work_items.py -q`: **56 passed / 1 legacy-version skip in 22.57s**.
- Pre-package real wrapper smoke passed with wrapper PID 10501 exiting before replacement PID 10551 launched, and HTTP result `Hello Restart QA`. Both wrappers exited 1 on ordinary Runtime SIGTERM shutdown, matching existing composition evidence. This pre-package run is not final packaged acceptance.

`tests/runtime_restart_smoke.js` exercises the real unchanged published Linux wrapper and compiled extension, while simulating Code terminal events that arrive before process exit. It copies only authored synthetic Action source/package metadata and uses task-owned prepared homes; raw logs stay private scratch. Reproduce with `node tests/runtime_restart_smoke.js <extension-root> <verified-runtime-binary> <synthetic-action-fixture> <prepared-smoke-root> <scratch-parent>`. The final installed VSIX retest is recorded separately. Actual desktop Start -> click Restart -> replacement PID/OpenAPI/action-result acceptance remains a separate GUI gate.

## Capacity

Four additional unused task-created repodata caches from earlier completed 3fd375c9/276ee966 smoke runs were provenance/process/extension checked, checksummed and removed under the existing task-scratch cleanup authorization. This recovered 3,849,392,128 bytes before the final full check. Source, installed environments, authoritative qualified/prepared caches, all logs/proof and the existing 2.20.4 VSIX remain. Exact paths and hashes are in `task-cache-cleanup.json`.

## Installed final candidate

Source `4ca10b8a9c8f437c49b39757cba6bd42ca043860`, private VSIX **2.20.5**, SHA256 `0d7b553233dd24239c1eb78978812f9daf5ef8d193b792122b9d84814c267b68`, 2,021,832 bytes, Library `libfile_8e6b5bb89d2c8191b6239a5fd1045d8b`. Code CLI installed it into an isolated extensions directory; all 713 payload files matched the ZIP after excluding only Code's installation metadata. 712 packaged source files matched the final source tree; README undergoes VSCE's documented URL transform. Required legal files match. No bundled native vendor executables.

The installed code passed all 11 real Linux workload stages: RCC and wrapper identity, Action/Robot creation, execution and debugger breakpoints/continue, separate Holotrees, Work Items FileAdapter 7->7, actual Runtime HTTP execution/shutdown and local ZIP/metadata. Packaged LSP discovered both packages, resolved the independent homes and ran owned Work Items 0.4.4 through the Action launcher, 7->7.

The installed restart smoke passed with actual wrapper PID 11169 exiting before replacement PID 11255, response `Hello Restart QA`, no replacement errors. Terminal events were simulated; this does not replace desktop button acceptance. Exact commands, versions and paths are retained in `2.20.5-final-qualification.json` and the reusable smoke scripts. Raw environment logs remain private scratch and are not committed.

The subsequent owner directive [6366927805](https://github.com/automation-control-plane/automation-vscode/pull/1#issuecomment-6366927805) requires first-class Work Items implementation in this release. That work is **NOT COMPLETE**. This candidate fixes restart and preserves 2.20.4; it is not full feature acceptance. Published Runtime's bundled RCC mismatch and Windows/macOS qualification also remain explicit gates.
