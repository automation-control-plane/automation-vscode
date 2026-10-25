# Multiline payload forms — 2.20.17

## Defect and bounded correction

The desktop tester found that pasting two NDJSON lines into a string field in
2.20.16 stripped the newline and concatenated the records. String values used
single-line HTML inputs. The recursive form now uses a two-row, vertically
resizable textarea for strings, including nested objects, arrays and scalar
payloads. Numeric values and field names remain single-line. Read-only outputs
remain text, without editable controls. No JSON editor, schema, new framework,
protocol change or authentication change is introduced.

Tests first reproduced the exact lost line separators in local and managed form
submission with a DOM peer that models single-line input sanitization. Final
source passes **149 Node tests** (including compilation) and **65 selected Python
regressions**. The focused gate passes **31 tests**. Coverage includes newlines,
trailing newline, Unicode, quotes/backslashes, nested strings, create/save/run/debug
payloads, draft close/reopen, managed enqueue and real loopback HTTP serialization.
No live managed mutation was performed by these tests. Browser paste/native UI
acceptance of these new bytes remains for the existing desktop tester.

The first test-run attempt in the restricted shell returned only generic Node
child-process test failures. Running with the already supported per-command
network/IPC permission produced the two meaningful assertion failures retained
in `tests-before.txt`; no persistent environment/security setting was changed.

## Commands

From `sema4ai`, after `source /workspace/.setup/activate.sh`:

```sh
node --test tests/work_items_form.test.js tests/work_items_editor.test.js tests/managed_work_items_editor.test.js tests/managed_work_items_client.test.js
npm test
poetry run pytest tests/sema4ai_code_tests/inspector/test_failure_states.py tests/sema4ai_code_tests/test_published_toolchain.py tests/sema4ai_code_tests/test_action_work_items.py tests/sema4ai_code_tests/test_compute_launch.py tests/sema4ai_code_tests/test_robot_completion.py tests/sema4ai_code_tests/test_pre_run_scripts.py -q
npm run vsce:package -- --target linux-x64 --out /tmp/automation-multiline-20261025/automation-vscode-2.20.17-linux-x64.vsix
```

## Minimal native retest

1. Preserve 2.20.16. Install the exact hashed 2.20.17 VSIX into the existing
   isolated profile. Keep the authorized synthetic backend and fixtures.
2. Starting from an empty form, add the recipe's string field. Paste the supplied
   two-line `multiline-records.ndjson` into the value textarea, with Advanced JSON
   closed. Verify both records, Unicode, quotes and trailing newline remain.
3. Refresh, close/reopen, save/submit explicitly under existing authorization,
   and compare the actual payload string with the fixture bytes. Repeat a nested
   string and a local FileAdapter save; verify read-only output stays read-only.
4. Regress numeric/boolean inputs, cancellation feedback and empty logs. Do not
   infer native execution acceptance from external harness execution.

Current ordinary a38 Run/Attempt/artifact proof was reported by desktop QA with
external `capability_invoke` harness execution. Native execution/discovery remains
required; its API dependency and proposed file ownership are in
`../../managed-execution-dependency.md`. This VSIX does not add that ingress.

No hosted CI, merge, publication, upstream/backend mutation or security changes.
Windows/macOS and actual native paste on this build remain untested here.
