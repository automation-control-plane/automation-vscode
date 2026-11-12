# Windows/Linux release continuation

Native Windows acceptance is blocked until repository Actions is enabled with
owner approval. The repository currently has Actions disabled and zero
self-hosted runners; no linked Windows host exists.

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
