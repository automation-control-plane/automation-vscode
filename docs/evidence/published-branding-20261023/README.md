# Automation branding candidate 2.20.2

Same private branch and draft PR #1. Owner explicitly requested owned visible branding. Product metadata, activity bar, command categories, debugger labels, output/progress/status messages, inspector title, issue UI and README now use Automation Control Plane / Automation. New authored SVG/PNG icons replace vendor display artwork. Control Room remains visible as a legacy integration; Studio/Gallery/Data references retain their accurate backend identities. All 119 command IDs, activation events, debugger/task types, settings keys, view IDs, menus and keybindings are preserved. Apache/copyright/third party notices match the repository originals. Locked dependency resolutions are unchanged; only package version metadata changed.

## Executed checks

Prepared toolchain: `source /workspace/.setup/activate.sh`, Node 24.21.0, Python 3.11.17, Poetry 2.1.3. Commands run from `sema4ai/`.

- `npm run compile`: exit 0. Initial compilation found missing CollectedLogs type import; corrected before all final checks.
- `npm test` with permitted local IPC/network: 8 passed, 0 failed. Six home/tool policy tests and two new branding/private issue draft regressions; these use mocks/static assets, not GUI acceptance.
- `CI_ENDPOINT=http://127.0.0.1:1 ACTIONS_RUNTIME_LOCATION=/workspace/port-acceptance/qualified-871151ce/downloads/actions-runtime-1.0.4-linux64 poetry run pytest tests/sema4ai_code_tests/test_published_toolchain.py tests/sema4ai_code_tests/test_pre_run_scripts.py tests/sema4ai_code_tests/test_compute_launch.py tests/sema4ai_code_tests/robo/test_list_actions.py -q`: 45 passed, 1 skipped in 19.15s. Skip: legacy Actions <=1.0.1 complex metadata scenario. A preceding run without CI_ENDPOINT ended 44 passed, 1 skipped, 1 fixture error. The loopback fixture endpoint does not authenticate to a cloud backend.
- `npm run vsce:package -- --target linux-x64 --out /workspace/artifacts/automation-vscode-2.20.2-linux-x64.vsix`: exit 0. VSCE performance warning: 712 files / 247 JavaScript files; no bundling rewrite in this change.
- ZIP audit: owned manifest/icon/README, old vendor display assets excluded, no ELF/PE in bin, legal notices match and no locked dependency changes.
- `git diff --check`: exit 0.

## Review boundaries

The issue command now opens a reviewable GitHub issue draft in this private repository. It does not send vendor feedback, look up an account, upload logs or submit an issue automatically. Browser submission remains the user's action. A mocked regression checks the actual compiled UI handler and destination.

The owner screenshot Library libfile_2b5db648ea6c8191b59d0d1997747124 / 1830.png was resolved through supported Library materialization, but its signed transfer GET returned HTTP 403 in both restricted and native network routes. Library read returned metadata/OCR and an image pointer, not pixels. No further download retries or access-policy changes were made. Desktop QA has inspected the actual image; this coding worker does not claim pixel review of it. The new authored icon was viewed locally.

Actual installed GUI run/debug and screenshots for these new bytes remain pending desktop QA. Earlier workload, DAP and inspector results apply to the previous qualified candidate, not automatic acceptance of 2.20.2. Runtime 1.0.4 / RCC 18.19.7 artifact-adapter mismatch remains open. Full feature scope and platform gates remain in the main ledger.
