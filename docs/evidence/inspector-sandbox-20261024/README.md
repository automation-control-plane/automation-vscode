# 2.20.14 — sandboxed Inspector launches and retained validation

## Findings and bounded changes

The sole native tester recovered Web Inspector and captured/saved a locator in
2.20.13, but observed `--no-sandbox` without supplying flags. The inherited browser
wrapper omitted `chromium_sandbox`. The installed Playwright 1.52.0 driver adds
`--no-sandbox` unless `chromiumSandbox` is exactly true. The
[official launch reference](https://playwright.dev/python/docs/api/class-browsertype#browser-type-launch-option-chromium-sandbox)
documents the false default. Prior capture proves functionality, not sandboxing.

The wrapper now explicitly requests sandboxing for Chromium, Chrome and Edge;
Firefox and WebKit do not receive this Chromium-specific option. Operator browser
paths and headless/viewport options remain intact. A failed sandbox launch remains
failed with its original diagnostic. Automatic browser installation now applies
only to a missing Playwright-managed executable, not sandbox, permission, generic
launch or explicitly configured executable failures. No insecure retry or new
sandbox-disable setting is introduced. Existing explicitly requested installation
behavior is unchanged.

Validate Strategy's frozen frontend displayed only a transient snackbar. The host
also discarded zero-valued data and dereferenced an absent RPC result on transport
failure. The maintained shell now shows a persistent **Last strategy validation**
result, with exact selector and requested page. Zero matches, errors and pending
states are distinct. RPC failures settle the request. Newer requests supersede old
responses; results clear after page/browser changes. A pending validation may itself
open/navigate the browser (including normalization or redirects), so pending
requests retain their identity through navigation. Results explicitly label the
requested page, not an assertion about the current browser location.
The frozen Inspector and Output bundles are unchanged. Image Escape remains
unqualified and unchanged; no speculation-based Image patch was made.

## Coding VM sandbox capability: blocked, not bypassed

One real sandbox-only probe used the actual prepared LSP interpreter (Python
3.11.10 / Playwright 1.52.0), the existing operator-executable facility pointing to
`/usr/bin/chromium`, `headless=True`, `chromium_sandbox=True`, and a 15-second timeout.
It failed before loading a page. The exact logs are retained beside this report.
The launch command has no `--no-sandbox`. Chromium reported:

> The SUID sandbox helper binary was found, but is not configured correctly.

`/usr/lib/chromium/chrome-sandbox` is mode 4755 but owned by `nobody:nogroup` in this
coding VM. Chromium requires root ownership for that helper. No chmod/chown,
sandbox flag, user namespace, network-policy or other system setting was changed.
The known failed browser was not retried. Its process exited. This finding does
not establish the capability of the parent's separate native desktop.

Permitted next step: the existing desktop tester checks its already installed,
supported Chromium installation with sandboxing enabled. If its sandbox also
fails, retain the exact error and stop browser launch; an administrator-provided
supported installation is an operator dependency. Do not use `--no-sandbox`, change
security permissions, or count the previous unsandboxed capture as this gate.

## Qualification

- Final version 2.20.14: TypeScript compilation and **141 Node tests pass**;
  **65 Python tests pass**, zero failures/skips in those selected gates.
- Tests cover Chromium-family defaults, Firefox/WebKit compatibility, missing
  managed installation, explicit executable failure, sandbox failure with one
  attempt/no install, zero matches, transport/malformed results, inert text,
  persistent display, request supersession and validation-owned navigation.
- Node host/DOM tests simulate VS Code and browser results; they are not native
  Extension Host or successful real locator validation evidence.
- A real Playwright **1.52.0** driver launched a task-owned argv recorder through
  the actual wrapper. It recorded one attempt, no sandbox-disable argument,
  preserved the launch-failure notification and exited its owned driver. This
  proves driver argument propagation/cleanup, not a functioning Chromium sandbox.
- Poetry's locked test environment uses Playwright **1.63.0**. Dependencies and
  manifests were not re-resolved or modified beyond extension version metadata.
- The first compile found BrowserLocator union typing and a missing ActionResult
  field in the new host code; these were corrected before the final full Node gate.
- All-project Python tests were not run: unrelated inherited integration tests
  include vendor/network/native prerequisites outside this bounded authorized
  test. Their absence is not a pass. Windows/macOS remain untested.

## Exact local commands

From `sema4ai`, after `source /workspace/.setup/activate.sh`:

```sh
npm test
poetry run pytest tests/sema4ai_code_tests/inspector/test_failure_states.py tests/sema4ai_code_tests/test_published_toolchain.py tests/sema4ai_code_tests/test_action_work_items.py tests/sema4ai_code_tests/test_compute_launch.py tests/sema4ai_code_tests/test_robot_completion.py tests/sema4ai_code_tests/test_pre_run_scripts.py -q
npm run vsce:package -- --target linux-x64 --out /tmp/automation-sandbox-20261024/automation-vscode-2.20.14-linux-x64.vsix
# Actual prepared LSP interpreter/environment; NEW isolated output directory:
python tests/inspector_sandbox_smoke.py --extension-root <exact-installed-extension> --output <new-recorder-directory>
```

## Minimal native retest

1. Install exact hashed 2.20.14 in the existing isolated desktop profile. Retain
   2.20.13 and prior evidence. Opening Inspector must not launch a browser.
2. Explicit Start on a synthetic owned page. Verify actual Chromium process args
   contain no sandbox-disable flags. If the sandbox cannot initialize, confirm
   persistent original failure/guidance and no download loop or insecure fallback;
   stop and report the supported-installation dependency.
3. Only on sandbox success: capture and save a real locator. Validate a matching
   strategy, a no-match strategy and malformed selector. Persistent Last strategy
   validation must show the exact selector/page and real count/error, remain after
   the snackbar disappears, and survive Web → Image → Web navigation.
4. Validate after closing the browser or requesting another synthetic page;
   confirm the pending request settles. Change page afterwards and verify the old
   result clears. Confirm browser/driver cleanup and explicit restart.
5. The parent retains separate bootstrap/retry/sidebar and full view acceptance.
   Prior 8/8 native workload/32 attachment hashes/Runtime ownership/recovery proof
   is valuable prior-candidate evidence, not a new 2.20.14 native pass. Canonical
   managed lifecycle remains incomplete; Actions Next remains paused.

No merge, publication, hosted CI, live data, credentials or system/network changes.
