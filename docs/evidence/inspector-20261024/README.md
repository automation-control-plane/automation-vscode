# 2.20.13 — retained Web Inspector failures and owned cleanup

This is a focused correction from the sole native tester's exact 2.20.12 report:
Web Inspector Start on its owned Runtime URL failed because Playwright Chromium
1169 was absent and download returned ECONNREFUSED/ENETUNREACH. The view then lost
that cause. The source commit containing this report identifies the fix.

## Root cause and changes

1. WebInspector.page() swallowed browser creation exceptions and requested an
   automatic thread reignition. Its failed-page cleanup could call browser() and
   trigger another installation/launch. It now emits the original error with the
   existing closed state, resets picking, settles the failed command and awaits an
   explicit new Start. It never calls a browser factory to clean up a missing page.
2. The host discarded failed configure/start results. Both Python forwarding layers
   also discarded them and configuration did not wait. Configure now waits for its
   worker; configure/start results survive their RPC envelope. The host refuses to
   start after failed configuration and renders request failures as existing
   browserState events. Void success acknowledgements remain compatible and do not
   imply a browser opened.
3. The maintained Inspector shell preserves the failure through closed/initializing
   states and navigation. It shows the original error as inert text plus browser
   prerequisite/logs/explicit Start guidance. Only a real opened event clears it.
   The frozen Inspector and Output templates retain their existing SHA256 values;
   there is no generated-bundle patch or new frontend framework.
4. Failed creation could allocate Playwright before a page existed. Cleanup now runs
   unconditionally in that worker. Its callback registry is thread-local, matching
   the cached objects, so an old worker cannot stop a replacement's driver. Shutdown
   releases the manager reference once, including repeated cleanup callbacks.

## Verified evidence

- Final compile and **138 Node tests pass**, no failures/skips. Includes shell DOM
  error retention/escaping, route changes, configuration failure preventing Start,
  host notification forwarding and existing regression suite. VS Code/DOM peers in
  these tests are simulated; they do not establish native visual acceptance.
- **56 Python tests pass**, no skips. Includes failing-first reproductions, real
  worker command/error transport, no-page cleanup, two-worker teardown isolation,
  idempotent shutdown, malformed/error RPC responses, image cancellation baseline,
  and the 45 existing published tooling/Work Items/launch/terminal regressions.
- Poetry's locked test Playwright is **1.63.0**; no dependency resolution changed.
  A separate real driver test ran with the actual prepared language-server
  **Python 3.11.10 / Playwright 1.52.0**. Two explicitly requested missing-browser
  attempts produced closed/error notifications, no automatic reignition, and two
  confirmed owned driver exits. Downloads were disabled in the test's launcher
  configuration and guarded against invocation; no network policy was changed.
- The inherited browser wrapper has separate public and internal launch configs;
  this negative harness sets the existing internal no-install option as well.
  Production launch configuration, browser manifests and download policy are not
  changed or silently qualified by that setup.
- Two qualification commands were initially invoked from the repository root rather
  than sema4ai and failed before running tests. Their logs are retained. The commands
  below were rerun from the correct directory and passed on final version 2.20.13.

## Image cancellation: investigation, no speculative production patch

Escape already serializes `Aborted by user`; ImageBridge emits closed before
raising, and the host forwards snippingToolState/closed to the existing frontend.
The bridge and host regression verify that path without a synthetic picked image.
The remaining native distinction is whether Escape removed the purple overlay and
whether Automation output recorded imageInspectorState/closed before Stop Snapshot.
That precise detail was requested from QA. Canvas-only Escape/focus-before-map is a
possible key-delivery issue, **not a confirmed root cause**. Image production behavior
is unchanged and native Escape acceptance remains open.

## Minimal affected native retest

1. Install the separately hashed exact 2.20.13 artifact in the existing isolated
   desktop profile. Preserve 2.20.12, its successful 8/8 GUI/attachment proof and
   original Inspector failure logs/screens; those do not qualify new UI bytes.
2. If the same browser prerequisite still fails naturally, explicitly Start Web
   Inspector and verify an enduring error panel contains the actual Chromium/
   connection error and actionable prerequisite/Start guidance. Closed/initializing
   events and switching Web → Image → Web must not erase it. Logs retain the cause.
   Do not change network policy or retry a denied download to manufacture a pass.
3. With already permitted browser prerequisites, explicitly Start, capture/validate
   a real locator and confirm opened clears the old failure. Stop/close and explicitly
   Start again; no orphan owned drivers or unrequested restart should appear.
4. Image: capture → Escape, record whether overlay disappears and whether closed is
   logged; then repeat explicit Stop Snapshot and a new capture. This remains a
   diagnostic gate until the key-delivery/UI boundary is identified.
5. Spot-check the existing Action/Robot run/debug and Runtime ownership flows. Full
   canonical managed lifecycle remains blocked separately; Actions Next stays paused.

## Commands

From `sema4ai` after `source /workspace/.setup/activate.sh`:

```sh
npm test
poetry run pytest tests/sema4ai_code_tests/inspector/test_failure_states.py tests/sema4ai_code_tests/test_published_toolchain.py tests/sema4ai_code_tests/test_action_work_items.py tests/sema4ai_code_tests/test_compute_launch.py tests/sema4ai_code_tests/test_robot_completion.py tests/sema4ai_code_tests/test_pre_run_scripts.py -q
npm run vsce:package -- --target linux-x64 --out /tmp/automation-inspector-20261024/automation-vscode-2.20.13-linux-x64.vsix
# Run in the prepared LSP interpreter/environment; use a NEW task-owned output:
python tests/inspector_failure_smoke.py --extension-root <exact-installed-extension> --output <new-negative-smoke-directory>
```

The artifact packet supplies exact install/smoke commands and hashes. No new native
screenshots or GUI pass are claimed by this executor. No merge/publication, hosted
CI, credentials, cache deletion, sandbox or network-policy change was performed.
