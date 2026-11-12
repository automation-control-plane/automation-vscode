# Windows/Linux release continuation

Josh approved restricted repository Actions enablement. The exact four-action
policy is now independently verified in [the approval receipt](actions-approval.json).
Native Windows acceptance remains pending the actual hosted run. The initial
disabled state below is historical evidence, not the current permission state.

[Initial status and exact permission proposal](initial-status.json) records the
upstream Sema4AI distribution pattern, immutable action revisions, acceptance
gates and unqualified surfaces. The owned fork uses separate Windows/Linux VSIX
assets on GitHub, with no Marketplace account, credential scope or Mac work.

The 2.20.25 Linux release remains unchanged. Candidate 2.20.26 is a new immutable
version; packaging is not Windows acceptance. The native workflow must install
and exercise its exact Windows artifact before publication. Windows Runtime
recovery after reload remains fail-closed because the process-identity verifier
is Linux-only; live-terminal startup/stop is a separate gate.

Portable harness checks pass for environment filtering, archive traversal and
symlink refusal. They do not qualify Windows. Source syntax/packaging and exact
artifact hashes are recorded separately from actual native results.

Historical vendor test/lint workflows are manual opt-ins to avoid unrelated
Linux matrices and secret-backed tests when the new owned workflow runs. The
workflow has contents:read, no secrets and no publishing step.

[Exact candidate hashes and payload comparison](candidate-artifacts.json) show
all752 Windows/Linux extension payloads match each other. Compared with the
verified2.20.25 Linux release, only package.json and __init__.py version metadata
changed. These Windows bytes were cross-packaged onLinux and remain UNQUALIFIED;
the final Windows release must use the exact artifact installed/tested by CI.

## First native Windows failure and correction

[The retained failure receipt](windows-install-failure.json) identifies the first
fatal gate as VSIX installation. The official, hash-verified Code1.146.0 Windows
archive places cli.js in a versioned resources directory; the driver had assumed
the older unversioned layout. Its own bin/code.cmd confirms the actual path.
The corrected lookup requires exactly one existing CLI entry and refuses missing
or ambiguous layouts. The regression failed before the fix; all five harness
boundary/layout checks pass afterward, including a check against the actual
official archive. No acceptance guard was relaxed. Native acceptance still
requires the next exact-head run; the failed artifact remains unqualified.

## Native workspace trust setup

[The second native receipt](windows-workspace-trust-failure.json) confirms VSIX
installation and all752 installed/source payloads passed. The actual extension
host then correctly refused the fresh untrusted synthetic workspace. The
correction grants only that task-owned folder through Code UI, requires its
exact path, rejects selected parent trust, and retains both trust enforcement
and the isTrusted assertion. No trust-store edits or disable flags are used.
Native validation of this UI setup remains pending the next exact-head run.

## Native trust UI binding correction

[The retained UI receipt](windows-trust-binding-failure.json) confirms loopback
UI connection but no rendered full-path match or trust-button click. The
corrected helper requires a matching canonical path digest from the real Code
workspace API, which first asserts one exact synthetic folder. Display text
remains diagnostic. Parent trust is refused, trust enforcement stays enabled,
and the actual isTrusted assertion remains mandatory. Six portable boundary/
layout/binding tests pass; native execution remains pending the next run.

## Native trust passed; extension identity diagnosis

[Run43307242916 evidence](windows-extension-discovery-failure.json) proves the
real trust UI grant passed without parent trust or disabled enforcement. The
next combined discovery/path assertion failed before activation. The next run
records registry identity separately, waits boundedly for post-trust discovery,
and requires the exact canonical verified install directory, version and
manifest digest. The previous receipt does not establish timing versus path
mismatch, so neither is claimed as the cause. No native workload ran.

## Native activation and platform probes passed

[Run43308046985](windows-native-adapter-failure.json) passed exact registry/
manifest identity, cold Windows bootstrap/LSP activation, verified Windows tool
downloads and scoped native Win32 inspection. The first workload hit the native
debug adapter error hook, whose old handler discarded the underlying exception.
The next diagnostic run retains scrubbed exception/response/exit metadata and
command names only. No launch environment/arguments are dumped and no workload
assertion is relaxed. The underlying adapter cause remains unestablished until
that actual receipt is available. Three diagnostic security regressions pass.

## Adapter process failure boundary

[Run43309267663](windows-adapter-read-error.json) identifies the first case as
Action/File Run. The python adapter accepted initialize/launch, then reported
read error and exited1. No lower-level exception was supplied by the tracker.
The next run uses standard private debugpy logs and retains only bounded scrubbed
fatal lines, never complete logs or launch environments. No SDK or adapter type
change is guessed. Four diagnostic security tests and six harness boundary tests
pass; actual native workload acceptance remains pending.

## Adapter and native terminal diagnostics

[Run43310745992](windows-adapter-channel-close.json) retained a launcher channel
WinError10038 and no initiating exception. The target Python identity matches.
The collector regression exposed discarded JSON-encoded diagnostic text; the
fix decodes only explicit diagnostic scalar fields and adds bounded owned
ptyhost tails. Stable shell-integration observation retains scrubbed fatal lines
from test-owned terminals without reading command-line data. The regression
failed before the collector fix; all five diagnostic tests pass afterward.
This remains diagnosis, not a speculative product fix or Windows acceptance.
