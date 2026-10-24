# 2.20.12 — actionable language-service bootstrap failure

Parent native QA reproduced this in exact 2.20.11 on a cold desktop: RCC/micromamba
could not connect/download dependencies. The Packages workspace then displayed a
secondary missing `sema4ai.localListRobots.internal` command instead of the bootstrap
cause. That command exists in the package but is advertised only by a ready Python
language server. The containing source commit identifies this focused fix.

## Root cause and changes

- RCC rejects with `{error, stdout, stderr}`. The existing subprocess layer retains
  its original command/error and streams stdout/stderr to Automation output.
- Activation already registered the views before waiting for language-server
  readiness. Runbook discovery invoked a backend command that had not been registered.
- Shared in-memory `starting / ready / failed` state now gates package discovery
  before cached tree reads, and gates package actions. No fake/placeholder backend
  command is registered. Startup reaches ready only after `LanguageClient.onReady`.
- Known process-error fields classify connection/download failures. The view gets
  a bounded plain-language explanation, not raw output, URLs, credentials or internal
  command names. Other startup failures get honest environment/server guidance.
  A later generic LanguageClient error cannot replace the first bootstrap cause.
- The themed failure state offers **Retry startup**, **Diagnostic logs**, and
  **Open Settings**. Starting state waits; it does not auto-retry or execute work.
  Settings/diagnostics remain accessible. Retry explicitly invokes Reload Window;
  it does not clear caches, delete environments, change policy or retry downloads
  silently. Native VS Code handles unsaved editors during reload.
- The existing, separate operator-invoked environment-maintenance command also
  updates readiness so it cannot leave a recovered server blocked or mark failed
  maintenance successful. It is not called by the new Retry action. No maintenance
  or deletion was executed during this qualification.

## Local evidence and limits

- Red-first host/DOM tests: 27 tests, 18 pass / 9 expected failures on the prior
  compiled host; all 16 existing tests passed. Tree regression also failed before
  the fix because it still performed discovery. Retained logs are adjacent.
- Final TypeScript compilation and **131 Node tests pass**, including startup
  classification, progress/failure UI, no raw command leak, no discovery/execution
  during failure, explicit reload only, ready recovery and stale package rejection.
- **45 Python tests pass**, no skips: published tooling, Action Work Items,
  launch computation, actual terminal completion and pre-run behavior.
- Tests use simulated VS Code host/DOM plus the existing real-process regressions.
  They do not qualify the actual native failure screen or repair desktop networking.
- Keep 2.20.11 and its evidence available. Parent's sole native tester must install
  the separately hashed 2.20.12 candidate before declaring this UI defect fixed.
  Label cold versus permitted warm-cache results separately.

Commands from `sema4ai` after `source /workspace/.setup/activate.sh`:

```sh
npm test
poetry run pytest tests/sema4ai_code_tests/test_published_toolchain.py tests/sema4ai_code_tests/test_action_work_items.py tests/sema4ai_code_tests/test_compute_launch.py tests/sema4ai_code_tests/test_robot_completion.py tests/sema4ai_code_tests/test_pre_run_scripts.py -q
npm run vsce:package -- --target linux-x64 --out /tmp/automation-bootstrap-20261024/automation-vscode-2.20.12-linux-x64.vsix
```

## Exact native retest

1. Preserve the old profile/candidate and install the exact new artifact in the
   tester's task profile. Match source/VSIX/payload hashes.
2. For a naturally failing cold bootstrap, open Automation → Packages. Expect
   preparing status, then the actionable connection/bootstrap explanation. Confirm
   the original micromamba error remains in diagnostic logs and the internal command
   name is absent from the owned error view. Do not alter network policy to force failure.
3. Test Diagnostic logs and Settings. Refresh must not initiate another environment
   build. Explicit Retry startup must Reload Window and retry ordinary activation,
   with existing homes/data preserved. No cache-clearing command may run.
4. With approved normal dependency access or separately labelled exact warm homes,
   confirm ready state, Action/Robot discovery and native run/debug resume. Recheck
   Work Items and the full Runbook surface checklist on exact installed bytes.

Canonical managed capabilities and the broader native visual gates are unchanged.
Actions Next remains paused. Separately observed existing global fast-cache identity
does not include effective home/RCC settings; changed-home cache qualification remains
a follow-up and was not silently repaired by this error-state patch.
