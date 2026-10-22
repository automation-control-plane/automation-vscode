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
Node 24.19.0, Python 3.12.14 and no Poetry. No lockfiles were regenerated.

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
| Actions Runtime 1.0.4 | `joshyorko/actions@d222f94edca26953c1506ab258adc458ded17c56` | `d3c450a2b10b226613588cc40cc6ec18873b23c7427958b0752711e4531a1de4` | Embedded native child returned `1.0.4` |

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
- Each RCC process receives `ROBOCORP_HOME` for its selected kind and
  `RCC_HOLOTREE_MODE=private`. Extension environment metadata and mutex names are
  partitioned by that home. Colliding home aliases fail before data creation.
- `sema4ai.rcc.location` / `AUTOMATION_RCC_LOCATION` and
  `sema4ai.actionServer.location` / `ACTIONS_RUNTIME_LOCATION` select explicit tools.
- Action Server state is below `ACTIONS_HOME/action-server`. Runtime 1.0.4's Go
  wrapper separately extracts its executable cache under the OS user home.
  That extraction cache ignores `ACTIONS_HOME`; no owner data was moved to work
  around this behavior.

## Feature acceptance ledger

| Feature area | Current evidence | Remaining work or gate |
| --- | --- | --- |
| Published RCC acquisition and identity | Verified Linux artifact/version/help; digest and preservation regression checks | Exercise activation download in Extension Development Host |
| Runtime acquisition and identity | Verified release digest; native child version, template listing and creation executed through extension backend | Outer wrapper cannot create `/home/agent/.actions` on this cloud filesystem |
| Separate Action/Robot homes | TS/Python policy checks and captured process regression checks | Real environment/run/debug isolation proof |
| Action creation | Real Runtime minimal template created through `ActionServer.create_action_package` | Verify final template pin adaptation and all templates |
| Action discovery, lint and code lenses | Core import adapter implemented; legacy imports retained | Real Core environment collection/lint and extension UI checks |
| Action run and debug | Core launch adapter implemented | Execute and debug through final source |
| Robot creation, run and debug | RCC flags adapted; existing paths retained | Real Robot task and debugger proof |
| Environment creation / interpreter resolution | Real RCC package build attempted | Micromamba tried `/home/agent/.mamba/pkgs` and `/home/agent/.conda/environments.txt`; cloud user home is read-only |
| Language server and terminals | Private startup environment routing; configured RCC honored; terminal paths quoted | LSP integration and isolated Extension Development Host activation |
| Work Items | Existing local listing/editing code retained | Published Work Items 0.4.4 execution and UI regression checks |
| Web/image/Windows/Java inspectors and recorder | Existing implementations retained | Linux functional checks; Windows/macOS operator checks |
| Control Room, authentication, Vault, publishing | Existing commands retained | Verify published CLI/API contracts and authorized service access; do not infer compatibility from versions |
| Data Server integration | Existing integration retained | Identify published replacement contract or an owner backend decision |
| Agent creation/import/build and Studio integration | Existing commands retained | Current adapter requires vendor Agent CLI v2.3.3. No matching executable is in the requested published release set. Automatic vendor acquisition is blocked with an explicit error, not replaced with a fake binary |
| VSIX and private installation | Build and package validation pending | Inspect contents, hash artifact, activate isolated host, document Dakota installation |

All feature areas remain in scope. A blocked row is not waived or accepted.
Windows and macOS have not been executed in this Linux environment.

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
- Two attempted build commands ran from the repository root instead of `sema4ai`
  and failed to find `package.json` / `pyproject.toml`; subsequent checks use the
  documented project directory.

## Checks for this checkpoint

```bash
source /workspace/.setup/activate.sh
cd /workspace/automation-vscode/sema4ai
npm run compile
node tests/runtime_paths.test.js
poetry run pytest tests/sema4ai_code_tests/test_published_toolchain.py tests/sema4ai_code_tests/test_pre_run_scripts.py -q
```

The current checkpoint compiled TypeScript and passed three Node regression
checks plus 24 Python tests, including real local TCP language-server Work Items
and code-lens checks. Those tests did not run Action/Robot workloads.

Most new regression checks use temporary files and captured process arguments;
they are not substitutes for real executable, debugger, inspector or UI acceptance.
