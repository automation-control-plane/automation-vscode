# Published tooling compatibility port

This branch is an incomplete port of the full extension feature set. An installable
VSIX is a checkpoint, not feature acceptance. No extension or release assets are
published by this work. Apache-2.0 and upstream attribution remain in place.

## Reproduce the prepared baseline

The repository is `/workspace/automation-vscode`. A fresh `git fetch --prune origin`
confirmed master at `1c6842c813aba0fa6eff63fa2917c7da2a1eb26a` on 2026-10-22.
The isolated branch is `port/published-rcc-actions-20261022`.
No repository `AGENTS.md` or `.agents/skills` were found.

Use `source /workspace/.setup/activate.sh` in this prepared cloud environment.
It selects Node 24.21.0, Python 3.11.17 and Poetry 2.1.3. The shell defaults were
Node 24.19.0, Python 3.12.14 and no Poetry. Dependency resolutions were preserved; package-lock metadata was updated for the private extension identity.

From `sema4ai`, the following starting-tree checks passed:

```bash
npm run compile
poetry run pytest tests/sema4ai_code_tests/agents/test_agent_spec_analysis.py -q
poetry run pytest ../sema4ai-python-ls-core/tests/sema4ai_ls_core_tests/pyls_jsonrpc_tests/test_endpoint.py ../sema4ai-python-ls-core/tests/sema4ai_ls_core_tests/pyls_jsonrpc_tests/test_streams.py ../sema4ai-python-ls-core/tests/sema4ai_ls_core_tests/test_document.py ../sema4ai-python-ls-core/tests/sema4ai_ls_core_tests/test_python_ls.py ../sema4ai-python-ls-core/tests/sema4ai_ls_core_tests/test_uris.py -q
```

Results were TypeScript 5.9.3 compilation, 20 backend tests passing, and 56 core
tests passing with six skips. These checks do not establish port acceptance.

## Executable provenance

`sema4ai/published-tools.json` is the shared artifact manifest. SHA-256 is checked
before downloaded executables are admitted. Existing mismatching executables are
preserved, including when a legacy caller supplies `force=True`. Explicitly
configured executables are operator owned and are neither downloaded nor replaced.

| Tool | Published source | Linux artifact SHA-256 | Real identity |
| --- | --- | --- | --- |
| RCC v18.19.7 | `joshyorko/rcc@758c97808bef8ae8bc5779d82c23ee11abfa47b3` | `f8e0394be7f47ee84d6f4cd734822b87b492a4d6102f977f6a18f29453703d48` | `rcc-linux64 --version` returned `v18.19.7` |
| Actions Runtime 1.0.4 | `joshyorko/actions@d222f94edca26953c1506ab258adc458ded17c56` | `d3c450a2b10b226613588cc40cc6ec18873b23c7427958b0752711e4531a1de4` | Unchanged outer wrapper returned `1.0.4` under a task-owned OS home |

Release metadata was read through the GitHub connector. Direct `gh api` requests
received proxy `Forbidden`; verified release downloads and read-only tag clones
succeeded. No network allowlist was changed.

RCC help confirms `--robocorp` and rejects the old `--sema4ai` spelling.
Runtime templates still reference Core 1.0.2; newly created packages are adapted
to published Core 1.0.3 and Work Items 0.4.4 where those dependencies occur.

## Home and executable policy

- `ACTIONS_HOME` defaults to `~/.actions`, and `ROBOTS_HOME` to `~/.robots`.
  Windows uses `%LOCALAPPDATA%/actions` and `%LOCALAPPDATA%/robots` to match Runtime.
- Explicit per-kind environment variables take precedence. Legacy `sema4ai.home`,
  `SEMA4AI_HOME`, or `ROBOCORP_HOME` roots receive separate `actions/` and `robots/`
  children. Existing directories are never migrated.
- RCC Control Room/credential commands use the Robot home; Runtime authentication
  uses Action state. Each RCC process receives `ROBOCORP_HOME` for its selected kind and
  `RCC_HOLOTREE_MODE=private`. Extension environment metadata and mutex names are
  partitioned by that home. Colliding home aliases fail before data creation.
- `sema4ai.rcc.location` / `AUTOMATION_RCC_LOCATION` and
  `sema4ai.actionServer.location` / `ACTIONS_RUNTIME_LOCATION` select explicit tools.
- Action Server state is below `ACTIONS_HOME/action-server`. Runtime 1.0.4's Go
  wrapper separately extracts its executable cache under the OS user home.
  That extraction cache ignores `ACTIONS_HOME`; no owner data was moved to work
  around this behavior.

## Feature acceptance ledger

All existing feature areas remain in scope. A blocked row is not waived or accepted.
The private candidate identifies as `automation-control-plane.automation-vscode`
2.20.1, while the existing command/settings namespace and upstream attribution stay
intact. Windows/macOS were not executed; path policy checks are static coverage.

| Feature area | Executed evidence | Remaining work or exact gate |
| --- | --- | --- |
| Published acquisition / executable choice | Linux release digests and real versions; configured paths and preservation regression checks | Automatic activation download in a working Extension Host |
| Action/Robot homes and Holotrees | Real environments and executions use independent roots; private Holotree mode; separate metadata, locks and failure caches | Installed-host terminal/debug environment display |
| Action Package creation, discovery, lint, run | All 6 published templates created through installed backend, Core pinned 1.0.3 and Work Items 0.4.4 where present; actual minimal-package collection/lint and `Hello Dakota` result | Functional workloads for other templates and installed UI flows |
| Robot creation and run | All 6 RCC templates created; `01-python` environment/run yielded `Robot Task passed` | Installed UI creation/run flows |
| Action and Robot debug | Real installed compute_launch profiles through debugpy DAP: exact source/line breakpoint, stack trace and exit 0 for both workloads; internalConsole used in headless client | Installed extension command and debug UI; Python debugger extension must be installed |
| Runtime / local service | Actual published outer wrapper HTTP server, OpenAPI, `/config` 1.0.4 and POST action result `Hello HTTP Dakota`; state under actions/action-server | **Runtime 1.0.4 bundles RCC 18.19.3.** Its artifact adapter rejects 18.19.7; owner/upstream decision required for a uniform 18.19.7 server composition |
| Work Items | Real Core/Work Items 0.4.4 FileAdapter roundtrip (7 → observed 7); TS RPA-to-RC controls translated, explicit RC controls preserved; local LSP listing tests | Installed Work Items editing/selection UI |
| Base environment / Python language server | Checked-in Linux bootstrap spec built by RCC 18.19.7; interpreter reports RCC_VERSION v18.19.7; 8 local TCP Work Items/code-lens tests passed | Installed artifact stdio initialize/discovery/interpreter resolution, real Core code lenses and action metadata passed; installed-host activation remains blocked |
| Terminals / interpreter configuration | Explicit language-server Python now honored; home routing, quoting and additional paths adapted | Actual installed-host terminal UI |
| Web inspector | Actual RCC bootstrap Python 3.11.10 / Playwright 1.52.0 with system Chromium 154.0.8037.57, HTTP page, picker injection and selected-button callback; original/boxed captures and real inspector-worker JSON-RPC passed | Installed Inspector UI and recorder; original file-URL tests hit managed browser policy |
| Image inspector / desktop recorder | Existing implementations retained | Graphical session required; no DISPLAY/WAYLAND_DISPLAY in this cloud |
| Windows / Java inspectors | Existing implementations retained | Windows UI automation / Java Access Bridge operator hosts required |
| OAuth / authentication | Actual `oauth2 actions-config` returned 2 providers and correct actions/action-server config path; callback path adapted | Provider login and credentialed service operations require authorized backend access |
| Control Room, Vault, robot publishing | Existing RCC command contracts retained; no vendor binary fallback | Service credentials and authorized sandbox workspace; uploads/publishing not executed |
| Action package build / metadata | Actual Runtime build and metadata passed after adapting missing output-directory creation; automatic ZIP override removed | Cloud upload/status/publish require service access/authorization |
| Data Server / data sources | Existing API integration retained | Requested published releases supply no standalone Data Server; identify compatible backend contract or owner-provided service |
| Agent creation/import/validation/build/registry | Existing commands retained; explicit operator executable setting supported | Requires Agent CLI project/package/registry contract (previously v2.3.3). No matching implementation is supplied by the requested published releases; automatic vendor download is refused |
| Studio integration | Discovery still uses configured original Studio home; local launch attaches existing Studio/Data backends only when discovered, preserves explicit environment and logs discovery errors; port homes remain separate | Installed Studio/backend interoperability and agent CLI decision |
| VSIX installation / Extension Host | VSIX built and ZIP/license/content checked; actual VS Code CLI successfully installed it in a fresh private profile | VS Code aborts before host startup because extracted SUID sandbox helper lacks root ownership/mode 4755. No security changes or sandbox-disable flags applied |

## Cloud host and screenshots

Official update/CDN routes returned HTTP 403. Microsoft's documented Debian
repository was accessible: `https://packages.microsoft.com/repos/code`. The exact
package selected from its Packages.gz index was VS Code **1.143.0-1792533444**, SHA256
`f045a886dbfd1aa47ec49dd6880d79a95570c9afde627510897b5cf692db5f2a`.
It was checksum-verified and extracted task-locally with `dpkg-deb -x`; no system
package, key, repository, permissions or network settings were changed.
`code --version` reported commit `2d0b7506a36c1d6db9a466440131a8e01eab2289`.

Actual CLI installation succeeded. Direct graphical process diagnosis then returned
signal 5 with:

```text
FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc:166
The SUID sandbox helper binary was found, but is not configured correctly.
... chrome-sandbox is owned by root and has mode 4755.
```

Smallest operator remedy: provide this cloud task a normally installed VS Code with
its supported sandbox helper and graphical/virtual display, without disabling the
sandbox. The owner forbids security-setting changes, so this task did not chown,
chmod 4755 or pass --no-sandbox/--disable-setuid-sandbox. Installed Extension Host
run/debug/terminal/UI/screenshots remain blocked, despite successful VSIX install.

The real web inspector was separately exercised against an authored loopback HTTP
page using `AUTOMATION_BROWSER_EXECUTABLE=/usr/bin/chromium`. Its original and boxed
screenshots show that browser test target only. They must not be presented as VS Code
UI or environment-loading acceptance. Existing file:// inspector tests failed with
`Page.goto: net::ERR_BLOCKED_BY_ADMINISTRATOR`; no browser policy was changed.

## Private installation and reproducible commands

Use a fresh VS Code profile and task-owned homes first. Preserve existing profiles,
Studio installation and action/robot state. For a prepared Linux workstation:

```bash
code --user-data-dir /path/to/private-profile --extensions-dir /path/to/private-extensions --install-extension /path/to/automation-vscode-2.20.1-linux-x64.vsix
```

Launch that same profile with explicit independent ACTIONS_HOME and ROBOTS_HOME in
the child environment. In Settings configure `sema4ai.rcc.location` and
`sema4ai.actionServer.location` to verified published executables if preinstalled.
The extension otherwise uses digest-verified release downloads. Optionally configure
`sema4ai.language-server.python` to an existing compatible Python. Install the
Microsoft Python debugger in this isolated profile for extension UI Python debug.
Candidate 2.20.2 uses the owned display name Automation Control Plane and Automation command category. Stable legacy setting/command IDs are retained; identify the private install by publisher/id.

```bash
source /workspace/.setup/activate.sh
cd /workspace/automation-vscode/sema4ai
npm test
poetry run pytest tests/sema4ai_code_tests/test_published_toolchain.py tests/sema4ai_code_tests/test_pre_run_scripts.py tests/sema4ai_code_tests/test_compute_launch.py tests/sema4ai_code_tests/robo/test_list_actions.py -q
npm run vsce:package -- --target linux-x64 --out /workspace/artifacts/automation-vscode-2.20.1-linux-x64.vsix
poetry run python tests/published_smoke.py --rcc /path/to/rcc-linux64 --runtime /path/to/actions-runtime-1.0.4-linux64 --work-root /path/to/task-scratch --extension-root /path/to/extracted-vsix/extension
poetry run python tests/web_inspector_smoke.py --extension-root /path/to/extracted-vsix/extension --output /path/to/new-evidence-directory
# Requires a normally installed VS Code, working display, and the prepared base Python:
AUTOMATION_VSCODE_EXECUTABLE=/path/to/code AUTOMATION_LS_PYTHON=/path/to/python AUTOMATION_SMOKE_WORKSPACE=/path/to/synthetic-workspace AUTOMATION_SMOKE_VSIX=/path/to/candidate.vsix npm run test:host
```

The smoke creates new private OS/action/robot homes; it never reuses owner homes.
Its full environment JSON and RCC logs can contain inherited process environment:
do not publish them. Share only selected-value reports, commands and redacted logs.
This cloud requires tool network permission for localhost and Node child-process IPC;
without it, VSCE's npm dependency enumeration silently returned an empty list and
packaging falsely reported a missing entrypoint. The permitted run packaged normally.

## Runtime version compatibility escalation

Read-only source inspection and an actual version check of the published adapter:

```bash
PYTHONPATH=/path/to/actions-source/action_server/src /path/to/target-python -c 'from pathlib import Path; from actions.server._rcc_runtime_adapter import verify_rcc_version; verify_rcc_version(Path("/path/to/rcc-linux64"))'
# exit 3 in the recorded harness:
# RccRuntimeError: RCC rcc failed: unsupported RCC version 'v18.19.7'
```

This is a published-release contract mismatch, not an extension flag spelling issue.
The extension's own environment/run paths use verified RCC 18.19.7. The successful
HTTP Runtime smoke uses its unchanged published 1.0.4 composition, including bundled
18.19.3; it is **not** proof that all Runtime-internal execution uses 18.19.7. No
bundled bytes were replaced and unreleased Actions Next was not used. Full scope
needs a published compatible Runtime release or an explicit owner composition decision.

## Recorded failures

- Initial RCC build reached real micromamba v2.5.0 and failed because the OS user
  home is read-only. A regression in the new error-reporting path initially hid
  that failure with `NameError: robocorp_home`; it was corrected.
- An initial downloader execution exposed a missing `progress_reporter` argument;
  the adapter now supplies the existing progress context.
- Restricted-network test execution could not open local TCP sockets. With network
  permission, local LSP tests then revealed that their common fixture eagerly
  downloaded unrelated vendor Agent CLI. That dependency is removed from local
  language-server initialization; backend-specific tests must request their tools.
- Several early build/check commands ran from the repository root instead of `sema4ai`
  and failed to find `package.json` / `pyproject.toml`; subsequent checks use the
  documented project directory.

## Initial checkpoint checks (45ac540)

```bash
source /workspace/.setup/activate.sh
cd /workspace/automation-vscode/sema4ai
npm run compile
node tests/runtime_paths.test.js
poetry run pytest tests/sema4ai_code_tests/test_published_toolchain.py tests/sema4ai_code_tests/test_pre_run_scripts.py -q
```

The initial checkpoint compiled TypeScript and passed three Node regression
checks plus 24 Python tests, including real local TCP language-server Work Items
and code-lens checks. Those tests did not run Action/Robot workloads.

Most new regression checks use temporary files and captured process arguments;
they are not substitutes for real executable, debugger, inspector or UI acceptance.

Final implementation checks passed 6 Node policy tests and 53 Python regression
tests with 1 skip (the legacy metadata scenario for Actions <=1.0.1). Most policy tests
use mocks or temporary files. The real executable/DAP/HTTP/browser smoke results
are recorded separately; no mocked result is counted as a live workload.

## Shutdown API compatibility

A real Runtime request exposed a redirect: POST `/api/shutdown` returns 307; Node's
HTTP client did not follow it. The extension and smoke now use the published
`/api/shutdown/` route and reject non-2xx API responses. That route returned 200 and
the unchanged outer wrapper stopped without forced termination. The wrapper returns
exit **1** after its normal shutdown API interruption; this is retained in evidence,
not normalized to a false exit 0 claim. Lifecycle exit-status compatibility remains
a published Runtime follow-up. Earlier HTTP smokes used a task-owned process
termination fallback after the unhandled redirect; those are not graceful-shutdown
acceptance.

## Qualified installed checkpoint (2026-10-22)

Implementation commit: `871151ceafc7b07dc59f7715d9c4f70153734794`.
Linux VSIX SHA256: `daa4c3ffefb635358c8e945e82034eb10475e75ca4e5ee92b1618b7637ab34b0`
(3,941,431 bytes, 713 ZIP entries). Actual Code CLI installation/extension listing
passed; 711 payload files matched the VSIX, with only Code's `__metadata` added to
the installed manifest. **All 11 live smoke stages then ran from this installed
extension tree**, including creation, RCC environments/run, Actions/Core/Work Items,
Action/Robot debugpy breakpoints, Runtime HTTP action and local package build.
These remain backend/CLI proofs, not Extension Host UI acceptance.

The private VSIX is in Library as `libfile_e4df12846b14819183182e285930de9f`.
Original/boxed Runtime UI and web-inspector images, selected-value reports, exact
commands and all 119 command IDs are archived in
[evidence/published-port-20261022](evidence/published-port-20261022/README.md).
The Runtime UI screenshot shows its real synthetic run history with a Passed row;
no VS Code success or environment-loading screenshot was fabricated.

### Full scope remains open

The command inventory confirms all 119 original command IDs remain registered;
debugger, task, menu, view and keybinding contributions remain present. This is a
preservation check, not acceptance of every handler. Besides the explicit backend
and operator blockers above, further verification/adaptation remains for profile
import/switch, both-home cache/diagnostic/rebuild operations, development tasks,
workspace editing/configuration, recorder and Studio/Agent/MCP/support flows.
Those areas are not silently dropped or declared optional. The requested full
feature port is **not complete**. Parent escalation should resolve the published
Runtime/RCC version contract and Agent/Data backend contracts while continuing
this ledger and the remaining feature qualification.

The final evidence-only repository update does not change VSIX runtime payload.
A focused policy-test cleanup removes an unused import; no installed behavior is
changed after the qualified implementation commit.

## Automation branding checkpoint (2026-10-23)

Candidate **2.20.2** applies the owner's explicit Automation Control Plane branding correction. See [executed checks and review boundaries](evidence/published-branding-20261023/README.md). This is an intermediate private candidate; the complete feature ledger and Runtime compatibility gate remain in scope. Desktop QA is exercising the actual installed VSIX on its supported Code installation; its earlier 2.20.1 Action run is not relabeled as acceptance of the new candidate.

Candidate **2.20.3** adapts actual desktop QA defects: current Microsoft Python interpreter APIs plus a truthful resolved-package status item; Action Package Work Items tree/run/debug routing with actions-work-items 0.4.4; and configurable loopback Runtime port with occupied-listener protection. See the same evidence report for exact mocked/filesystem/socket checks and outstanding actual GUI retests. Ordinary Work Items output retention is now non-destructive; explicit cleanup requests retain the legacy retention handler. Full scope remains open.
