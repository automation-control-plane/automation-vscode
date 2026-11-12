# Release Automation Control Plane for VS Code

This fork publishes qualified VSIX files as assets in
[automation-control-plane/automation-vscode releases](https://github.com/automation-control-plane/automation-vscode/releases).
The extension ID is `automation-control-plane.automation-vscode`.
Use tags named `automation-vscode-v<version>`. The existing `sema4ai-*` tag
workflows publish through the historical upstream Marketplace path; do not run
them for this release. Marketplace and Open VSX publication require separate
verification of the owned publisher and credentials.

## Qualify the exact artifact

Run development and packaging commands in the repository's `sema4ai` directory,
using its Node 24 and Python 3.11 development environments. Preserve existing
candidates and operator homes. Use a fresh task-owned Code profile and synthetic
Action and Robot packages.

1. Set the same candidate version in `package.json`, root package-lock metadata,
   `pyproject.toml`, and `src/sema4ai_code/__init__.py`.
2. Run `npm test` and the focused owned Python regressions. Record exclusions
   and skipped checks separately from passes.
3. Package separate `linux-x64` and `win32-x64` assets with
   `npm run vsce:package -- --target <platform> --out <new-vsix-path>`.
   Windows packaging alone is not Windows acceptance. Preserve already released
   assets; change the version when product payloads change.
4. Install those exact bytes in the isolated profile. Verify the archive and
   installed payloads, identity, version, and hash. Install the supported
   `ms-python.python` debugger prerequisite in that profile for native Action
   Run and Python debugging.
5. Exercise actual native Action/Robot File/SQLite execution and output lineage.
   CLI/DAP and simulated webview tests are separate evidence.
6. Against the Actions owner's verified synthetic managed endpoint, negotiate
   live `tools/list`, protocol, server identity, and managed schema. Qualify
   discovery, enqueue, claim, Run, linked Run/Attempt/artifacts, a second input,
   intentional failure, cancellation, stale selection, and lost-response/reload
   with no duplicate invocation. Never clear an uncertain request from a 404.
7. Record exact dependency artifacts and platform scope. A source version or
   planned upstream release is not a published artifact. Document standalone
   and exceptional recovery limitations explicitly.

## Publish the qualified bytes

After the qualification gates pass, update the current release PR with evidence and remaining
supported-scope limitations, then merge the reviewed head. Preserve the qualified
VSIX instead of rebuilding it after merge. Record its source commit, the merged
commit, SHA-256, installed-payload comparison, and sanitized QA receipts.

Create a draft GitHub release at the merged commit with the owned tag, the exact
VSIX, checksum file, and sanitized QA archive. Review the draft asset hashes and
release notes, then publish the release. Verify the public release and asset
URLs and report them. Do not advertise Windows/macOS or Java acceptance from a
Linux run. Do not dispatch the obsolete environment publishing workflow.

## Native Windows qualification

The owned `qualify-owned-windows.yml` workflow runs one `windows-2025` job with
read-only contents permission, immutable action revisions and no secrets. The
driver filters inherited process environments before invoking build or desktop
tools. It packages and installs the exact Windows VSIX, verifies all payloads,
uses the installed cold RCC bootstrap, and runs actual native debug sessions.
Only its allowlisted public receipts and candidate VSIX are uploaded. Logs,
profiles, environments, credentials and databases stay outside the artifact.

The workflow does not publish or create a Marketplace account. Its successful
artifact, source SHA and actual receipts must be reviewed before the manual
GitHub release. Windows recovery after host reload remains fail-closed because
the process-identity verifier is currently Linux-only. Live-terminal startup/stop
is tested separately. Managed Windows UI and Java require separate acceptance.

Historical vendor/integration test workflows are manual opt-ins. Enabling Actions
must not automatically run their unrelated matrices or historical secret-backed
tests. Repository Actions enablement and any new persistent permission require
owner approval; committing this workflow does not grant that approval.
