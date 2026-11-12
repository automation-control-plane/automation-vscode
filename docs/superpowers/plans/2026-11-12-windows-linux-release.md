# Windows and Linux release implementation plan

**Goal:** Publish separately qualified Windows x64 and Linux x64 VSIX assets.
Preserve the immutable 2.20.25 Linux release. No Mac or Marketplace work.

**Architecture:** Use a single native Windows GitHub-hosted job with read-only
repository permission. Package and install its exact VSIX in official Code,
bootstrap the installed extension through RCC, and exercise actual native debug
sessions. Publish manually through the existing owned GitHub release path only
after qualifying the exact assets. Linux carries forward unchanged payload proof.

**Execution:** Sole coordinator implements and verifies; no additional workers.
Josh has authorized completion and publication. Persistent Actions permission
changes require his approval before execution.

## Tasks

- [x] Inspect upstream distribution and repository runner availability.
  Upstream creates win32-x64 and linux-x64 VSIXs, then uses Marketplace accounts.
  This fork keeps the owned GitHub release path and needs no publisher account.
- [ ] Add the owned native Windows workflow and portable acceptance driver.
  Pin actions, set contents:read, disable checkout credential persistence, pass
  no secrets, and allowlist every test subprocess environment. Existing vendor
  test workflows become explicit manual jobs so enabling Actions does not launch
  unrelated historical matrices or secret-backed tests.
- [ ] Build version 2.20.26 artifacts. Compare Linux payloads with 2.20.25;
  rerun only checks justified by changed bytes. Preserve every earlier artifact.
- [ ] On native Windows, verify official Code and tool digests, Win32 x64 VSIX
  identity, archive/installed/source payload equality, cold RCC bootstrap and
  actual Extension Host/LSP activation. Do not substitute configured Python for
  cold-bootstrap proof or relabel Linux CLI evidence as Windows acceptance.
- [ ] Execute actual Action/Robot File/SQLite Run/Debug through VS Code's native
  debug system, with real breakpoint/continue/exit events and output lineage.
  Verify attachments/replay through the installed bridge and scoped Win32 APIs.
- [ ] Record Windows Runtime start/owned stop and negative unknown-listener
  behavior. Keep generic lost-response uncertainty and RCC-only gates unchanged.
- [ ] Publish both immutable assets only after their gates pass; download and
  verify release assets. Record exact hashes, source/run links, failures and
  limitations in the PR/release because T3 reads may be incompatible.

## Current infrastructure blocker

The repository reports Actions enabled=false and zero self-hosted runners.
No linked Windows machine is available. Native Windows acceptance therefore
requires approved repository Actions enablement. Do not claim Windows qualified
or publish its candidate as accepted while this remains unresolved.

The proposed permission change enables Actions with only the four immutable
GitHub-owned actions named by the new workflow. It does not add credentials,
publisher accounts, repository visibility changes or write permissions to jobs.

## Review focus and explicit bounds

- Windows executable suffixes, drive paths, path casing and short socket paths.
- Child environment isolation, separated Action/Robot homes and no bearer output.
- Actual native debug terminal events, not a standalone adapter proxy.
- No persistent Windows registry, firewall, service or global credential changes.
- Full Windows managed-server/UI, Java inspector and unexecuted integration
  surfaces remain explicitly bounded until their own actual acceptance exists.
