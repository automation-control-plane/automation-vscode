# Managed request feedback — 2.20.16

## Reported defects and correction

The existing native desktop tester reported two defects in installed 2.20.15:
canceling `items.claim` confirmation left **Working…** until Refresh, and a
successful `runs.logs` response with `lines=[]` rendered blank. The tester also
reported real fixture-backed review/approval, exact artifact Save, and missing
auth 401 / wrong-workspace 403. Those are 2.20.15 observations, not acceptance of
this replacement. The live claim mutation remains unexecuted after an approval
denial; its narrow test approval is still pending with the owner.

The host posted `loading` before dispatch, but cancellation returned without a
settling message. The controller now publishes its existing projection and an
explicit cancellation message without refreshing, making an HTTP request, or
creating a journal entry. The common mutation path covers claim and other
confirmed operations; cancellation of retained-request reconciliation leaves
that request/key unchanged. Connection, snapshot and artifact dialog cancellations
use the same completion behavior. Confirmation and authorization remain required.

The logs renderer distinguishes no request yet from a returned empty page:
**No log lines were returned for this page.** An empty page with a cursor still
allows More logs. Nonempty lines remain literal text; selection changes clear the
earlier response. There is no generated log content or automatic log request.

## Local evidence

- Two expected failures before the fix: no cancellation state message and blank
  log guidance (`tests-before.txt`).
- Full npm suite, including TypeScript compile: **146 passed**, no failures/skips.
- Selected Python compatibility/Inspector/launch regressions: **65 passed**, no
  failures/skips. No Python behavior changed.
- Tests exercise compiled controller/client, real loopback HTTP/files, and real
  editor scripts with synthetic Runtime DTO, VS Code dialog and DOM peers. They
  do not qualify a native Extension Host, live managed SQL worker or claim.
- Cancellation checks require zero new HTTP calls and journal files, unchanged
  selection/snapshot/logs, and preserved uncertain request identity. Renderer
  tests cover busy-state cleanup, payload draft preservation, empty logs,
  pagination and literal text.
- Exact schema pin, capability/permission logic and published Runtime transport
  remain unchanged. Full npm tests retain their authentication/schema negatives.

Commands from `sema4ai`, with `/workspace/.setup/activate.sh` sourced:

```sh
npm test
poetry run pytest tests/sema4ai_code_tests/inspector/test_failure_states.py tests/sema4ai_code_tests/test_published_toolchain.py tests/sema4ai_code_tests/test_action_work_items.py tests/sema4ai_code_tests/test_compute_launch.py tests/sema4ai_code_tests/test_robot_completion.py tests/sema4ai_code_tests/test_pre_run_scripts.py -q
npm run vsce:package -- --target linux-x64 --out /tmp/automation-managed-feedback-20261025/automation-vscode-2.20.16-linux-x64.vsix
```

## Minimal installed desktop retest

1. Preserve 2.20.15 and install the exact new VSIX from the handoff manifest in
   the existing isolated profile. Use the existing authorized synthetic backend.
2. Open the existing claim confirmation and choose **Cancel** or Escape. Verify
   Working clears immediately, cancellation is visible, no `items.claim` HTTP
   request or journal entry exists, and selected item/payload remains intact.
   **Do not confirm/execute claim while the owner's test approval is pending.**
3. Fetch logs for the known linked Run with `lines=[]`. Verify explicit empty
   acknowledgment and no fabricated lines. Regress a nonempty log response and
   pagination if the fixture supplies them.
4. Cancel artifact Save, snapshot selection or reconnect; the existing projection
   remains visible and busy state clears. Regress already authorized review/Save
   and 401/403 behavior without changing endpoint authority or credentials.

Native retest of these bytes is pending. Windows/macOS are untested. No hosted CI,
merge, publication, backend edits or system/security changes were performed.
