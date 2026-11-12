# Owned bootstrap correction — 2.20.18

The 2.20.17 installed manifests incorrectly requested `sema4ai-http-helper==2.1.0`
and `sema4ai-common==0.1.0`. This was an executable dependency defect. It was not
just a label, and RCC's controller name alone did not prove a vendor service call.

## Replacement and provenance

All four `sema4ai/bin/create_env/conda*.yaml` descriptors now use the official
[actions-http-helper 1.0.3 PyPI release](https://pypi.org/project/actions-http-helper/1.0.3/).
No local wheel or upstream source checkout substitutes for that distribution.

- Wheel: `actions_http_helper-1.0.3-py3-none-any.whl`, 14,690 bytes.
- PyPI SHA256: `46ed7ce0e0d3e2e05456d937b5b24bc9dfa0d7d4b98f8119b9fdf00d4fa7e9f9`.
- Import: `actions_http`; metadata identifies Joshua Yorko and `joshyorko/actions`.
- Data Server compatibility calls use its actual `post` / `put` / response API.
  This transport replacement does not create an owned Data Server backend.
- The only production Common symbol was `run_in_thread` in `_lint.py`; Python's
  standard `ThreadPoolExecutor` now supplies the same concurrent linting role.
  There is no dependency on private Runtime Common internals or a new Common fork.
- The development lock uses owned `actions-core==1.0.3` and the owned helper.
  Historical vendor fixtures are explicitly separate in
  `sema4ai/tests/legacy-sdk-requirements.txt`, never installed by bootstrap or
  normal Poetry preparation. No existing virtual environment was cleaned or
  rewritten to hide installed legacy distributions.
- Python RCC/debug and TypeScript RCC/cleanup callers use `AutomationCode`.
  RCC 18.19.7's supported `--robocorp` switch remains. No metrics/auth endpoint,
  network profile, telemetry or security setting was changed.

## Local evidence and limitations

- 160 Node tests and 67 selected Python regressions passed. The Python helper
  test used a task-owned dependency overlay; that alone is not cold-bootstrap
  acceptance.
- Official Code CLI installed the private VSIX into fresh profile/extension
  directories. All 752 payload files matched source/archive/installed bytes.
- `tests/fresh_owned_bootstrap.py` ran verified RCC 18.19.7 against that installed
  Linux descriptor with newly empty task-owned HOME, ACTIONS_HOME, ROBOTS_HOME and
  cache, with private Holotree. Real environment creation exited 0. Fresh Python
  imported owned helper 1.0.3, imported the installed lint module, and executed
  the installed Data Server client's synthetic loopback query. Vendor HTTP and
  Common distributions/imports were absent. Robot home remained empty.
- Every owned helper source and METADATA file in that fresh interpreter matched
  the official PyPI wheel (installer-managed RECORD excluded).
- This is command/installed-Python evidence. Fresh native GUI activation and
  managed Run remain the existing desktop tester's gates on these exact bytes.
  Windows and macOS descriptor/source checks passed; execution is untested here.
- Existing homes/data remain untouched. The owned helper reads its documented
  `.actions` network-profile location; no legacy profile is moved or copied.
  Unconfigured RCC endpoint diagnostics are not resolved by inventing a vendor
  endpoint or changing network policy.

Exact artifact digest, source SHA, commands, safe inventory and receipts are in
the companion private QA packet. Raw host/user/install diagnostic identifiers
are excluded from the packet and this repository.
