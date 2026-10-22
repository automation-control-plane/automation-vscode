# Installed published-tool checkpoint

This is an incomplete full-feature port, built from implementation
`871151ceafc7b07dc59f7715d9c4f70153734794`. The private Linux VSIX SHA256 is
`daa4c3ffefb635358c8e945e82034eb10475e75ca4e5ee92b1618b7637ab34b0`.

## Evidence index

- [qualification.json](qualification.json): exact artifact/install provenance,
  11 real installed-tree smoke stages, selected interpreter/home values, actual
  versions, debug profiles/results, all Action/Robot template creation, original
  and annotated screenshot hashes/Library IDs, failures and remaining blockers.
- [commands.json](commands.json): exact build, workload, debugger, language-server
  and browser commands. Full inherited environment JSON is intentionally absent.
- [command-inventory.json](command-inventory.json): all 119 original command IDs,
  grouped by feature area. Manifest/source preservation is not functional acceptance.
- [reproduction](reproduction): exact auxiliary scripts for this task-owned cloud
  state; use the path-parameterized scripts under `sema4ai/tests` for new scratch
  runs. Existing output/state is preserved, so use new output directories.
- [workloads](workloads): authored synthetic Action/Robot programs and dependency
  specifications. These contain no owner production data or credentials.
- [extension-host-blocker.txt](extension-host-blocker.txt): actual VS Code SUID
  helper abort. Official Debian acquisition and private VSIX install succeeded;
  Extension Host activation did not execute. No sandbox flags/permissions changed.

## Genuine screenshots

| Capture | Original | Boxed | What actually executed |
| --- | --- | --- | --- |
| Runtime | [original](automation-vscode-871151ce-runtime-original.png) | [boxed](automation-vscode-871151ce-runtime-boxed.png) | Actual Runtime 1.0.4 web run history after a synthetic HTTP Action returned `Hello Screenshot Dakota` |
| Web inspector | [original](automation-vscode-871151ce-web-inspector-original.png) | [boxed](automation-vscode-871151ce-web-inspector-boxed.png) | Actual installed web inspector using RCC-built Python 3.11.10 / Playwright 1.52.0 / system Chromium; picker callback returned the selected button |

Boxed captures use a visible DOM outline/overlay around an observed element before
capturing a second screenshot. The original PNGs remain unmodified. No values or
success claims were drawn into either UI. **These are not VS Code Extension Host
screenshots and do not satisfy that blocked acceptance gate.**

## Exact remaining operator gates

Provide this cloud task normally installed VS Code with its supported root-owned
sandbox helper and a graphical/virtual display if needed. Do not disable sandboxing.
Then use the isolated profile/extension directories and explicit published tool
paths to activate the installed VSIX, load both synthetic packages, run/debug both
through extension commands, stop on their source breakpoints, inspect terminal
home/Python/RCC values, edit/select Work Items, and exercise inspector/recorder and
configuration UIs. Capture actual VS Code environment/result panels with originals
and annotations tied to this VSIX digest. Dakota can repeat the same on an isolated
Linux desktop; that does not waive the requested cloud-host proof. Windows/macOS
require platform packages and separate execution; they are not tested here.

Full scope also needs a published Runtime composition compatible with RCC 18.19.7
(Runtime 1.0.4 actually bundles 18.19.3 and its artifact adapter rejects 18.19.7),
a compatible Agent CLI/Data Server contract, and authorized sandbox service access
for credentialed Control Room/Vault/OAuth/publishing. Environment profiles/cache/
diagnostics/rebuild and remaining development/editor/Studio/MCP flows still require
qualification/adaptation. No blocked or unqualified row is waived.

## Private Library deliverables

- VSIX: `libfile_e4df12846b14819183182e285930de9f`.
- Selected-value evidence report: `libfile_7ae3abce48608191808acc6d60535b73`.
- Runtime original: `libfile_568b7f22d2588191856bb8e4ed09065d`.
- Runtime boxed: `libfile_16b50075078c8191b03e0fa9268c1dce`.
- Web inspector original: `libfile_f238f472271c8191a0ce42163ebadceb`.
- Web inspector boxed: `libfile_494649768a7481918c612e2f2f077816`.

The real installed downloader also fetched and digest-verified both canonical Linux
release executables, then executed their version commands. Separate Action/Robot
metadata locks were held simultaneously without contention (about 9 ms), in their
independent home directories. Both results are in qualification.json. The final
source check matched 710 payload files byte for byte; VSCE separately transforms
README filename/Markdown links, recorded in payload-verification.json. Installed
files match all 711 VSIX payload entries, with only Code metadata added to package.json.
