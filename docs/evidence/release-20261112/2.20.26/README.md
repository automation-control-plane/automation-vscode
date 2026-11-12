# 2.20.26 Windows and Linux release evidence

This release supplies separate Windows x64 and Linux x64 VSIXs through the owned
private GitHub release path. Linux 2.20.25 remains unchanged. No Mac or Marketplace
publication is claimed.

[Exact artifacts and qualification](qualification.json) record the passing
[native Windows run](https://github.com/automation-control-plane/automation-vscode/actions/runs/43314945520).
Its tested merge tree equals the qualified branch tree. Final evidence-only
commits do not rebuild or replace the tested artifact.

## Actual native Windows acceptance

The [installed host receipt](windows/installed-host.json) passes all eight
Action/Robot × File/SQLite × Run/Debug cases, with four real breakpoint/continue
events, exit zero, authoritative SQLite lineage, exact attachments and edited
replay preserving original outputs. These use the real installed extension host,
registered debug adapters and SDK bridge, not simulated VS Code APIs. They are
not Work Items panel-button acceptance.

Official Code 1.146.0 installed the exact Windows VSIX. All 752 source/archive/
installed payloads match. Cold RCC bootstrap, real language-server activation,
verified Windows RCC/Runtime downloads, a scoped native Win32 window inspection,
Runtime live-terminal startup/stop and occupied-listener refusal pass. Workspace
trust enforcement remains enabled; only the canonical synthetic workspace was
trusted through Code UI, without parent trust or private trust-store edits.

Eight transport read closures remain disclosed. Each was observed only after
native target exit zero and DAP termination. Early read errors, nonzero targets,
missing completion markers and other errors remain fatal. Native session end
and every output/attachment/lineage/replay assertion remained mandatory. Adapter
transport exit is not relabeled as target exit or clean adapter shutdown.

## Linux acceptance carried forward

[Fresh Linux installation](linux-install.json) passes actual Code installation
and all 752 installed/archive comparisons. Compared with qualified 2.20.25,
only package.json and __init__.py version metadata differ. The unchanged native
local/managed evidence remains attributed to [2.20.25](../2.20.25/README.md) and
[2.20.24](../2.20.24/README.md). No matrix was rerun merely for status, and no
historical execution was relabeled as a new 2.20.26 execution.

[Payload comparison](payload-comparison.json) records Windows checkout/compiler
CRLF differences in 319 text members. The real Windows artifact is preserved
unchanged; comparison did not normalize or repack either release asset.

## Known limits remain explicit

[Complete limitations](limitations.json) include the owner-verified published
SDK direct-JSON failure-cleanup defect in both 0.4.4 and 0.5.0. It can mask the
original task failure with AttributeError; this release does not fix or certify
that path. SDK 0.5.0 alone is not a remedy. A secondary exception is neither
success nor proof of nonexecution; do not blindly retry uncertain work.

Windows Runtime recovery after reload remains fail-closed because process
identity verification is Linux-only. Windows managed UI/server and Java remain
unqualified. General invocation reconciliation, standalone-only execution,
legacy shared Holotree export and other explicitly unexecuted integrations retain
their bounds. Public Runtime artifacts are Linux/Windows only.

The owned workflow uses the approved four immutable actions, contents:read and
allowlisted subprocess environments. Raw logs, credentials, profiles and databases
are absent from the release QA packet. No publisher account, credential scope,
global Windows registry/service/firewall change or backend workstream was added.
