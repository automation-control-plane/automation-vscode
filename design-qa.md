# Runbook visual qualification

final result: blocked

- Source visual truth: `/workspace/scratch/5e55918bc8f8/generated_images/exec-9045ec88-84ec-46c5-aa25-55c8d78b9d0d.png`.
- Source pixels: 1488 × 1059. Reference depicts native VS Code chrome plus extension-owned content; native chrome is intentionally unchanged.
- Implementation screenshot: pending exact-candidate install and capture by the exclusive cloud desktop QA owner.
- Viewport / CSS size / density normalization: pending actual matching capture. No assumed density normalization.
- State: all surfaces enumerated in `docs/runbook-view-checklist.md`; actual package/item/run data replace illustrative invoice content.
- Full-view comparison evidence: not yet available.
- Focused comparison evidence: not yet available; required for navigation, main header/context/result table, Inspector controls and Output.
- Primary interactions: simulated host/DOM/transport tests are tracked separately and do not establish native or visual acceptance.
- Console errors: native webview console not yet checked for this candidate.

## Findings

- [P1 — verification blocked] Actual installed implementation has not yet been visually compared to the selected reference. The cloud desktop QA transport currently fails read-only screenshots; no desktop reset, alternate profile or security bypass was used.
- [P2 — pending capture] Native tree geometry differs from the illustrative sidebar by platform constraint. Flat primary navigation, package type/path context and all working native tree operations are retained. Actual usability at narrow widths must be evaluated, not assumed.

## Required fidelity surfaces

Fonts/typography, spacing/layout rhythm, colors/tokens, icon/image quality and app-specific copy require a rendered comparison. Shared source tokens and immutable compatibility frontend tests alone are not a pass.

## Comparison history

1. Reference image opened and inspected at actual pixels before implementation. Current 2.20.9 native audit reviewed as rejected baseline, not acceptance evidence.
2. Source implementation and regression tests in progress. No implementation capture or visual comparison is claimed.

## Implementation checklist

1. Build and identify source SHA, VSIX SHA256 and installed payload.
2. Capture every checklist surface and primary interaction in the sole-owner desktop session.
3. Normalize and compose reference + current screenshots; evaluate full and focused comparisons.
4. Fix all P0/P1/P2 findings and repeat captures before changing this result to passed.

## October 24 installed candidate

2.20.11 source `aec537ebaadbf80aa95f22bf4a466fb514be2683` has a valid private VSIX,
747 matching installed payload files, 116 Node / 45 Python tests, and eight real
CLI/DAP attachment workflows. See `docs/evidence/runbook-20261024/`. These results
do not resolve visual findings. This coding executor's Code GUI aborts before
Extension Host because of sandbox-helper ownership and lacks a display. The parent
supported desktop has recovered; its existing sole tester still needs the exact
candidate for fresh native captures. No 2.20.9 screenshot qualifies this candidate.
