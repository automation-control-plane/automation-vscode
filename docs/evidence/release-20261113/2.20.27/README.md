# 2.20.27 release candidate qualification

This candidate delivers the merged runtime Python path and optional editor fixes from
PRs #7/#8. It is not published. [Source and asset ledger](qualification.json).

## Fresh native Windows

[Run43442026636](https://github.com/automation-control-plane/automation-vscode/actions/runs/43442026636)
passed for branch ec84e799. Its tested merge source has the identical complete tree.
The exact [installed-host receipt](windows/installed-host.json) proves eight
Action/Robot × File/SQLite × Run/Debug cases, four real breakpoint cases, attachments,
edited replay, flat/src Action input creation and metadata, cold RCC/LS startup,
pinned tool downloads, Runtime startup/stop and untouched occupied-listener refusal.
All753 source/archive/installed payloads match. Raw Windows VSIX bytes are retained.

The prior integrated run43431154086 failed before product activation. The corrected
harness explicitly supplies prepared Python only on the Code child PATH and uses a
controller-local bootstrap to grant exact-workspace native UI trust before importing
the unchanged acceptance harness. Providers are pinned to the observed lab setup.
[Entry receipt](windows/trust-entry.json) and [qualification receipt](windows/qualification.json)
record the original harness hash and enforced trust/identity gates. No global PATH,
registry, firewall, trust store or product assertion was changed. The fresh hosted pass
qualifies this recipe; it is not a relabeling of the older independent lab passes.

## Fresh Linux

[Linux receipt](linux-qualification.json) verifies the exact2.20.27 VSIX using official
checksum-pinned Code, all753 source/archive/installed payloads, installed-backend
listing/metadata/input contracts and installed-JS optional-integration unit contracts.
It does not claim GUI, debugger or cold-RCC acceptance. Source953932d6 differs from the
qualified Windows branch only in excluded evidence files. [Cross-platform comparison](payload-comparison.json)
finds only320 CRLF text-member differences; neither asset was normalized or repacked.

Full Node24 coverage passes179/179. Focused Python checks pass23/23; harness boundaries
pass9/9 and trust/import unit checks4/4. Stale tool identity expectations were updated
to verified published RCC/Runtime pins; exact assertions and codegen parity are retained.

## Limits and remaining approval

The installed optional-provider matrix, Linux GUI/debugger/cold-RCC, Windows managed UI,
Mac and broader UI gates remain separate. No release-wide or universal feature claim
is made. Previous release limitations and backend-owned defects remain unchanged.
The exited independent lab has not been restarted and its sole owner retains control.

The release packet contains the two exact qualified VSIXs, sanitized QA receipts and
checksums. Parent approval to merge PR9 and publish the owned release remains required.
No tag, Marketplace or public release action has been performed.
