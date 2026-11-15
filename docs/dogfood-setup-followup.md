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

## Action Package YAML schema

The extension previously contributed no YAML schema for `package.yaml`. The
diagnostic source label `yaml-schema: package.yaml` does not expose the selected
schema URI, so this checkout cannot establish which prior schema produced the
reported errors. The extension now contributes its local
`resources/action-package.schema.json` for `**/package.yaml`; it types PyPI,
conda-forge, and local-wheel dependency entries as arrays of strings. It does
not associate a schema with other filenames or change a user's package file.

The Red Hat YAML extension documents the `yamlValidation` contribution and
relative schema URL resolution at
<https://github.com/redhat-developer/vscode-yaml/blob/main/README.md#using-the-yamlvalidation-contribution-point>.
Its documented priority places modelines, inline `$schema`, contributor API,
schema-disable settings, and `yaml.schemas` above `yamlValidation`, while
placing SchemaStore below it:
<https://github.com/redhat-developer/vscode-yaml/blob/main/README.md#schema-resolution-priority>.
Thus the contribution can replace a conflicting SchemaStore match without
overriding an explicit operator-selected schema. This is source-backed
association precedence, not proof of the screenshot's unknown prior URI.

Synthetic PyYAML fixtures were accepted/rejected by both JSON Schema Draft 7
validation and the repository's `PackageYamlAnalyzer`; they covered the two
listed requirements and malformed scalar/object/number entries. No private
workspace file was read.

## Targeted PyPI updates

The language server emitted newer-version warnings but its code-action handler
handled only agent-package diagnostics. The new PyPI quick fix revalidates the
selected simple pin against the current document and available PyPI versions.
It returns a versioned edit for that dependency alone. Quotes, comments, line
endings, other entries, and unrelated constraints remain unchanged. Unsupported
requirements, stale or forged diagnostic ranges, and failed lookups produce no
edit. Eight synthetic code-action tests cover discovery and applying the edit;
they do not install or upgrade a package.

## Settings branding without migration

The settings contribution now has two real categories with branded titles and
IDs matching the existing setting prefixes. VS Code's configuration registration
uses those category IDs, and its settings formatter removes matching prefixes
from visible headings. The three code-lens settings have their own editor
category; the remaining settings use the main category.

All 19 property schemas compare exactly with checkpoint `703d6161`, including
keys, types, defaults, descriptions, and scope metadata. No new alias, migration,
precedence rule, configuration write, or settings reader is introduced. Existing
user/workspace values and VS Code's existing scope precedence therefore keep
their original keys. JSON and copy-setting IDs intentionally remain
`sema4ai.*`; actual third-party identifiers remain intact. Independent review
checked the current VS Code registration and formatting source. An installed
Settings UI screenshot has not been verified.

## Nested Action discovery

The package tree's internal listing command uses the AST scanner, not a running
Runtime. The scanner previously rejected Python files before parsing unless
their basenames matched a short list. It now examines ordinary Python source
files under the package and identifies the supported decorators using AST only.
Traversal prunes recognized environments, caches, and generated/build output;
it does not follow symlinked modules or directories. Filesystem and syntax
errors do not stop discovery of the remaining files.

Three synthetic regressions exercise `server_actions/search_discovery.py`,
`browser.py`, and `apply.py` with `@action`, the tree's internal command,
flat and `src/` layouts, existing query/predict decorators, a no-execution marker,
custom environments with `pyvenv.cfg`, malformed modules, and symlink cycles.
Independent comparison with the original scanner preserved all six records in
the existing Action/query/predict/datasource fixture. Actions inside excluded
directories or symlinked modules remain undiscovered by design.

## Verification

The pre-change Linux Node baseline passed 204 tests. New focused regressions
demonstrated the download and diagnostic failures before their fixes. Python
retry regressions demonstrated five failures before the cache fix.

After integrating the schema and settings changes, `cd sema4ai && npm test`
passed 215 tests on Linux. The isolated Python 3.11 environment passed 37
focused tests, including schema, quick-fix, candidate-manifest isolation, and
tree-consumed AST discovery.
The original 21 retry and version-discovery tests run with:

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
coverage. The candidate-manifest staging test runs only on Linux; the directory
symlink test is skipped on Windows where it requires additional privileges.
Local VM, macOS, Marketplace, and managed lifecycle qualification are
outside this follow-up.

No user cache is deleted, existing artifact overwritten, OAuth reference
migrated, or published asset replaced.
