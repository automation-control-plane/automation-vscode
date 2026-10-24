# Runbook 2.20.11 — installed CLI/DAP qualification

**Private candidate; native visual acceptance blocked; full managed functionality incomplete.**

Candidate source: `aec537ebaadbf80aa95f22bf4a466fb514be2683` on existing PR #1,
`port/published-rcc-actions-20261022`. It follows the complete Runbook redesign
`80b96ee5379a76e094a695cbf3b339d411a790f6`, tree
`069fe8ccb0527efdfca6cc66a617c22482f14bb4`. Later commits containing this report
change only tests/documentation; the VSIX payload is unchanged.

VSIX: `automation-vscode-2.20.11-linux-x64.vsix`, 2,191,400 bytes.
SHA256: `0a4d50b4b5a1679ed62d064cf767f1be1e7302e659ff7d0dd37145bddc1a62cb`.
Official Code CLI installation passed. All **747 payload files** match the archive
and committed source; only Code-added `package.json.__metadata` was normalized.
No native RCC/Runtime/vendor executable, credential file or virtual environment is
included. The previous candidate and existing user data were preserved.

## Changes and tests

- Native Work Items discovery and creation now require the same exact owned
  `actions-work-items==0.4.4` as the Python bridge. Actions reject legacy-only SDKs
  and incompatible owned versions; explicitly supported legacy Robot workflows remain.
- SQLite active claim guidance recognizes public SDK state `IN_PROGRESS`, retaining
  compatibility with `RESERVED`. It identifies the item and real default 30-minute
  orphan timeout; no release/expiry/state is fabricated.
- **116 Node tests, 45 Python tests passed**, no skips: 32 published-tooling/discovery/
  launch tests plus 13 terminal-completion/pre-run tests. Node tests include simulated
  VS Code/DOM/transport and actual Linux process tests; these are not native GUI tests.
- Installed-byte real Action/Robot × FileAdapter/SQLite × Run/Debug: **8/8 passed**,
  four actual debugpy breakpoints. Every cell validates output attachment bytes,
  input/output identity, replay identity and original attachment preservation.
  **8/8 negative executions** reject missing or incorrect attachment bytes.
- Real custom terminal adapter + RCC Run reports actual success `EXITED/0` and
  intentional failure `EXITED/10`, `exited` before `terminated`. The Code terminal
  protocol peer is simulated; RCC and adapter subprocesses are real.
- Packaged language server initializes over stdio, discovers both package kinds and
  resolves distinct Action/Robot home interpreters with `RCC_VERSION=v18.19.7`.
- Actual Runtime 1.0.4 wrapper: unauthenticated storage access rejects with 403;
  compiled client connects, seeds/lists input, uploads/downloads text and JSON bytes;
  malformed payload rejects with 422. Its shutdown endpoint was absent (404), so the
  harness terminated only its own process (exit 1); this is not a graceful-shutdown pass.
- Actual Runtime + real Linux process/socket ownership: unknown listener is never
  contacted/adopted, simulated module reload preserves serialized ownership,
  explicit reconnect retains the PID, restart waits for old exit before new launch,
  and actual Action returns `Hello Restart QA`. **VS Code terminals/Memento/reload are
  simulated**; actual Reload Window remains a native desktop gate.

## Versions, isolation and execution conditions

Prepared build toolchain: `/workspace/.setup/activate.sh`, Node 24.21.0,
Python 3.11.17, Poetry 2.1.3. Package interpreters are Python 3.12.12 with
actions-work-items 0.4.4; Action Core 1.0.3; Robot robocorp-tasks 4.1.1;
debugpy 1.8.22. Core identity is owned; the Robot task runner is an explicit
separate dependency, not accepted as a substitute Work Items SDK.

RCC 18.19.7 SHA256:
`f8e0394be7f47ee84d6f4cd734822b87b492a4d6102f977f6a18f29453703d48`.
Published Runtime 1.0.4 wrapper SHA256:
`d3c450a2b10b226613588cc40cc6ec18873b23c7427958b0752711e4531a1de4`.
RCC help supports `--robocorp`, not `--sema4ai`. The Runtime wrapper's own bundled
RCC 18.19.3 remains a distinct published implementation detail; it is never relabeled
18.19.7 or used for extension environment acceptance.

Checks used previously prepared **warm** task-owned caches, a writable process HOME,
independent ACTIONS_HOME/ROBOTS_HOME and matching ROBOCORP_HOME per package. New
synthetic data went under `/tmp/automation-release-20261024`; no owner data moved
or deleted. Cold GUI download/bootstrap, Windows and macOS remain unqualified.

One initial unconfigured RCC version probe warned about read-only OS-home locking;
the recorded successful probe uses explicit task homes. One restricted VSCE run
received empty nested npm output because subprocess IPC returned EPERM. Repeating
with the supported per-command permission produced the valid package; no dependency,
lockfile resolution, network policy or VSCE workaround was changed. A remote-check
command assumed an origin tracking ref absent from this single-branch clone; normal
non-force push succeeded, and independent `ls-remote` verified the exact head.

## Native blocker and remaining work

Sandbox-preserving Code 1.143.0 GUI launch exited **-5 before Extension Host**:
the extracted `chrome-sandbox` is owned by UID1000; Electron requires root ownership.
No display session, Xvfb or supported system Code install is available. Exact command
and stderr: `native-startup.json`. The later Code CLI install is a separate successful
gate (`cli-install.json`). No sandbox bypass or ownership/security changes were made.

The supported next action is **one tester on the already authorized parent cloud
desktop**, with a properly installed Code/display, installing the exact bytes above.
This does not require Josh to perform QA. If this coding executor must host GUI,
the platform operator must supply a supported official Code installation and display.
No new screenshots exist for this candidate; old screenshots do not qualify it.

Use [the full view checklist](../../runbook-view-checklist.md) and
[coverage below](coverage.md). Capture Automation's own navigation and every view,
then repeat actual creation/run/debug/forms/drafts/attachments/replay and new Runtime
start → Reload Window → reconnect/restart. Compare actual captures against the
approved image at matching viewport/state; `design-qa.md` remains blocked.

Managed mode is not a published-1.0.4 durable queue. The pinned candidate protocol is
`actions.managed-work-items/v1`, schema
`360923ed094302e1cc6dd556d2c9117b445fbf8046b5684145c9eb2c2682123e`,
minimum Runtime 1.1.0a13 / SDK 0.5.0a1. Required `/schema`, workspace-scoped
`/capabilities` and `/operations` beneath `/api/managed-work-items/v1` remain gated.
Missing contracts: authoritative terminal epoch after claim release, admitted snapshot
discovery for an empty queue, and Work Item attachment upload/list/download. Mounted
SQL/auth, canonical Run/Attempt/review/artifact qualification are unproved. The Actions
repository was neither modified nor resumed; no competing authority was added.

No hosted CI was invoked. No merge, public release, Marketplace upload, spending,
production change, live credential or tunnel was involved.
