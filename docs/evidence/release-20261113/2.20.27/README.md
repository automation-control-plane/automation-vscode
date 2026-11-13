# 2.20.27 candidate qualification

This candidate contains merged runtime Python path and optional editor integration fixes
from PRs #7/#8. It is not published. See [source and gate ledger](qualification.json).

The final integrated Windows run failed before activation, despite successful packaging,
installation registration, payload identity and unit contracts. Its artifact and failure
remain attributed to their original source and hash. No product regression was proven.

The existing sole Windows lab owner identified the passing harness sequence: controller-local
Code API import, exact native UI workspace trust, product registration, then lazy import of
the unchanged original acceptance harness. Qualification now follows that sequence and
pins the same Python/debugpy inputs without extension-pack dependencies. Prepared Python
is explicitly available only on Code's child PATH. No global PATH, trust/registry/security
setting or original workload assertion was changed. Native CI must prove this new sequence;
its pending status is not a pass and the exited lab has not been restarted.

[Fresh Linux evidence](linux-qualification.json) verifies the exact 2.20.27 VSIX with official
checksum-pinned Code, compares all 753 source/archive/installed payloads, and runs discovery,
metadata/input and mocked optional-integration contracts against installed code. It is not
GUI, debugger or cold-RCC acceptance. The artifact is preserved outside the repository at
`/tmp/automation-2.20.27/953932d6/automation-vscode-2.20.27-linux-x64.vsix`.

Full Node 24 coverage is 179/179 after updating stale tool identity assertions to the
currently published RCC/Runtime pins and aligning the codegen test inventory. Acceptance
assertions were retained, including fail-closed trust/import tests. Historical lab proofs,
provider-matrix gaps, broader UI and cold-reset limits remain separate.

Release remains gated on fresh native Windows artifact/installed acceptance, matching
source/payload checks, final asset checksums and parent-owned consequential approvals.
