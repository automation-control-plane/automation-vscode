# Setup retry and environment version follow-up

This follow-up starts from `d0eace0cd1e4959364a0268de7bb959c596726c0`,
the merged PR #13 release source on `origin/master`. GitHub had no open issues
or pull requests when this work began. This change does not publish a release.

## Confirmed defects

- `Rcc.get_robot_yaml_env_info` remembered failed setup indefinitely, including
  cancellation. `Rcc.holotree_hash` independently remembered failed commands.
  Failed requests now remain retryable; successful cache reuse stays intact.
- `getRccLocation` returned the expected executable path after an unsuccessful
  download. Setup now checks the resulting artifact and its pinned digest.
  Existing mismatched files are preserved and rejected.
- `runConfigDiagnostics` could replace a subprocess failure with a `TypeError`
  while reading output that had never been assigned.
- Download progress was blank until the first progress callback. Each attempt
  now reports its start before requesting bytes.
- The Environments page contained literal historical Runtime and RCC versions.
  Version declarations must come from the installed extension manifest, remain
  distinct from executable observations and Runtime's bundled RCC, and never
  establish compatibility or lifecycle qualification by themselves.

## Scope and evidence limits

`sema4ai/published-tools.json` remains the dependency authority. Candidate
RCC 18.19.11 and Runtime 1.1.1 qualification is separate from changing those pins.
The candidate evidence belongs in `docs/evidence/dogfood-setup-20261115/`.

An isolated candidate RCC diagnostic reported a blank endpoint failure in
category 4020. That is not evidence of a category 4040 canary failure. Network
diagnostics remain visible; no TLS, certificate, proxy, or authentication policy
is weakened. The existing Sema4.ai troubleshooting destination remains in place:
an HTTPS fetch on 2026-11-15 returned HTTP 200 at the unchanged destination,
with the title “Firewall and network proxy requirements | Robocorp documentation”.
`diagnostics_help.test.js` retains malformed-URL and rejected-open coverage.

Josh identified `api-jokes` as likely his own code. No screenshot, package, or
resolution evidence was available in this checkout. Legacy SDK import failures
and a local `actions.py` fallback do not establish an extension or Runtime defect.
Existing owned-SDK version-discovery and shadow-module regressions run unchanged.

## Verification

The pre-change Linux Node baseline passed 204 tests. New focused regressions
demonstrated the download and diagnostic failures before their fixes. Python
retry regressions demonstrated five failures before the cache fix.

After integrating the view changes, `cd sema4ai && npm test` passed 214 tests
on Linux. The isolated Python 3.11 environment passed 21 tests with:

```sh
PYTHONPATH=sema4ai/src:sema4ai-python-ls-core/src /tmp/automation-vscode-dogfood-venv/bin/python -m pytest --noconftest sema4ai/tests/test_package_pythonpath.py sema4ai/tests/sema4ai_code_tests/robo/test_action_runtime.py sema4ai/tests/sema4ai_code_tests/test_rcc_retry_cache.py -q
```

The temporary interpreter contains pytest, pytest-timeout, PyYAML, and the
repository's `actions-core==1.1.0` dependency. It does not alter host packages.

An independent high-reasoning review found the new test harness initially used
Unix-only module paths. The harness now normalizes those paths. Final focused
review covered setup, help, profiles, and view state/rendering; no must-fix
production findings remained. Hosted results remain separate from local proof.

The hosted setup workflow runs the complete Node suite on Linux and focused
portable setup, help, and environment-view tests on Windows. Both platforms run
Python retry, package-path, and SDK-discovery regressions. The existing installed
Windows VSIX workflow is retained separately. Several older full-suite Node
mocks use Unix-specific paths, so the focused Windows suite is not full Node
coverage. Local VM, macOS, Marketplace, and managed lifecycle qualification are
outside this follow-up.

No user cache is deleted, existing artifact overwritten, OAuth reference
migrated, or published asset replaced.
