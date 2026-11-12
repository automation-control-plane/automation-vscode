# Fresh supported cloud desktop — exact 2.20.11 QA

This packet contains **no producer caches or environments**. Consumer paths are
new task-owned paths on the supported desktop. Preserve its standard sandbox and
use the existing single UI tester. Do not change network policy or install a
vendor binary to make a blocked path pass.

## Inputs

- VSIX SHA256 `0a4d50b4b5a1679ed62d064cf767f1be1e7302e659ff7d0dd37145bddc1a62cb`,
  2,191,400 bytes, source `aec537ebaadbf80aa95f22bf4a466fb514be2683`.
- Fixture directories `fixtures/action` and `fixtures/robot`; create fresh copies.
- `fixtures/attachment-proof.txt`: 47 bytes, SHA256
  `f99ed98ea2dbf6908dc185741fb7aedcc6b0d938c4f08a2014defb9f5ac799c1`.
- RCC asset `rcc-linux64` from `joshyorko/rcc` release `v18.19.7`, SHA256
  `f8e0394be7f47ee84d6f4cd734822b87b492a4d6102f977f6a18f29453703d48`.
- Runtime asset `actions-runtime-1.0.4-linux64` from `joshyorko/actions` release
  `actions-runtime-1.0.4`, SHA256
  `d3c450a2b10b226613588cc40cc6ec18873b23c7427958b0752711e4531a1de4`.
  Use supported GitHub release acquisition or the extension's verified downloader.
  Do not substitute an extracted child or an unreleased Actions build.

Fixture manifests pin Python 3.12.12, uv 0.8.17, actions-work-items 0.4.4,
debugpy 1.8.22. Action additionally pins actions-core 1.0.3; Robot pins
robocorp-tasks 4.1.1. Actual UI debug requires the supported Microsoft Python/debugpy
extensions installed only into this isolated profile. The producer build toolchain
was Node 24.21.0 / Python 3.11.17 / Poetry 2.1.3; these are not package interpreter
versions. The extension can create its own language-server environment through RCC.

## Isolated profile and setup

After materializing the packet and VSIX locally, verify their manifests/hashes.
Choose a **new** QA directory; never reuse or overwrite a user workspace. The
following illustrates paths to set on the consumer, not existing producer paths:

```sh
qa_root=$(mktemp -d /tmp/automation-ui-2.20.11.XXXXXX)
mkdir -p "$qa_root/os-home" "$qa_root/actions-home" "$qa_root/robots-home" "$qa_root/workspace"
# Copy the packet's fixtures/action and fixtures/robot into qa_root/workspace.
# Set candidate_vsix, verified_rcc, verified_runtime to verified consumer-local files.
code --user-data-dir "$qa_root/profile" --extensions-dir "$qa_root/extensions" \
  --install-extension "$candidate_vsix"
```

Install `ms-python.python` and `ms-python.debugpy` through the approved official
route into that same profile. If installation/download is blocked, retain the exact
error; do not silently use another profile or proxy/security workaround.

Launch supported Code using per-process environment overrides:

```sh
env HOME="$qa_root/os-home" ACTIONS_HOME="$qa_root/actions-home" \
  ROBOTS_HOME="$qa_root/robots-home" ROBOCORP_HOME="$qa_root/actions-home" \
  RCC_HOLOTREE_MODE=private AUTOMATION_RCC_LOCATION="$verified_rcc" \
  ACTIONS_RUNTIME_LOCATION="$verified_runtime" \
  code --user-data-dir "$qa_root/profile" --extensions-dir "$qa_root/extensions" \
  --new-window "$qa_root/workspace"
```

Use native Settings to set `sema4ai.rcc.location` and
`sema4ai.actionServer.location` to those exact files. Set
`sema4ai.actionServer.port` to a verified free loopback port (for example 18083
only if free). Do not kill or adopt another listener. Preserve compatibility keys;
the installed product is `automation-control-plane.automation-vscode`.
The Runtime wrapper may extract beneath the task-owned HOME even with ACTIONS_HOME;
this must not touch the desktop user's actual home. Its internal bundled RCC 18.19.3
is separate from the extension's required RCC 18.19.7.

Record cold environment creation separately. If approved downloads must prewarm
the same exact task-owned homes, label subsequent GUI testing **warm cache**.
Do not copy proxy credentials or apply trusted-host/security exceptions.

## Actual UI acceptance sequence

1. Verify installed version/digest/payload; open Automation's own activity sidebar.
   Capture six navigation entries and Action/Robot package discovery.
2. Exercise each surface in `docs/runbook-view-checklist.md` and `evidence/coverage.md`.
   Use the approved slate/amber combined reference for real visual comparison;
   capture originals before drawing evidence boxes. Screenshots must retain selected
   package/item/runtime context and be captioned as rendered-only or exercised.
3. For both fixture packages, open Work Items from Automation's own tree. In Local
   inputs create an empty item, add number field `value=7`, attach the proof file.
   Keep advanced JSON collapsed. Test refresh, close/reopen and Reload Window draft
   retention; nested types, duplicate keys and invalid values must retain drafts.
4. Choose `copy_attachment` / `Copy Work Item Attachment`, Run; then create a fresh
   input and Debug at the marked breakpoint, inspect real per-package `sys.executable`,
   continue. Repeat in Local queue with a new queue per cell (eight cells total).
5. Verify read-only output `observed=7`, download `copied-proof.txt` to a new destination,
   verify hash/47 bytes, check source identity and SQLite `parent_id`. Replay creates
   a distinct input and preserves original bytes. Replay output payload is not
   automatically valid input for the copy workload; do not auto-run it.
6. Missing/corrupt attachments must fail truthfully. Empty selection cannot run.
   Selecting a fresh item must not display another input's success. Stop only an
   owned debug session; SDK claims remain authoritative. Never shorten the real
   30-minute orphan expiry or change DB timestamps to manufacture recovery.
7. Start Runtime explicitly from the selected Action package, then Reload Window.
   Inspect verified ownership, explicitly reconnect if available, restart and verify
   old process exit/new PID/action result. A missing terminal or old unrecorded
   listener must produce honest guidance, not adoption.
8. Capture Output and all Inspector routes, settings, argument forms and empty/error/
   denied states. Windows/Java unsupported-platform states on Linux are distinct
   from real platform execution. Check dark/light/high-contrast and keyboard focus.

## Standalone published storage check

Published Runtime 1.0.4 is **storage mode**, not the canonical managed queue. Its
verified CLI supports `start --address=127.0.0.1 --port=<free-port>
--datadir=<new-task-directory> --api-key=<ephemeral-test-token>`. Generate the token
in memory for a synthetic local server; never use real credentials or place it in
the report. Use the same isolated environment and fixture package as cwd. Confirm
`/config` version 1.0.4/auth enabled, unauthenticated `/api/work-items` denial, then
authenticated enqueue/list/attachment byte roundtrip. The packet's
`tests/native_runtime_api_smoke.py` implements those exact checks and stops only
the process it created. It requires a prepared-root shape documented in that script;
do not assume producer paths exist. Shutdown API may be absent (404).

Canonical managed mode remains blocked on the paused Actions candidate's mounted
SQL/auth contract, terminal epoch, snapshot discovery and Work Item attachment APIs.
Do not start or modify Actions Next for this desktop test, weaken version gates,
or count transport mocks / Runtime 1.0.4 storage as canonical managed acceptance.
