# 2.20.25 public dependency composition

This successor preserves the original 2.20.24 VSIX and acceptance receipts.
It updates default acquisition to public Runtime/Core 1.1.0 and RCC 18.19.8.
The local File/SQLite bridge retains SDK 0.4.4; managed backend proof uses public
SDK 0.5.0. Existing user environments are not migrated.

[Exact qualification and limits](qualification.json) and
[installed payload identity](payload-identity.json) record all 752 matching
source/archive/installed files. Only six shipped files differ from 2.20.24.
Native Work Items, managed clients, journals, webviews and debugger code are
byte-identical. Their earlier actual eight-case local matrix and full managed
acceptance remain attributed to [2.20.24](../2.20.24/README.md), not relabeled as
new executions.

## Public provenance and affected native checks

[Runtime provenance](published-runtime-provenance.json) records independent
downloads and hashes of all four Linux/Windows PyPI wheels, the sdist, both
native executables and their checksum file. All 333 Python modules in the public
Linux CPython 3.12 wheel match the qualified backend wheel. Published and qualified
complete Git trees match. An additional explicit 479-file production/build
comparison against the original QA source has no differences. The public Runtime
tag is a lightweight commit reference; no signature claim is made.

[Core](../2.20.24/published-core-1.1.0.json) and
[SDK](../2.20.24/published-sdk-0.5.0.json) public wheels are byte-identical to the
qualified backend wheels. The regenerated Poetry lock uses Core 1.1.0 and no
longer includes its former robocorp-log or robocorp-truststore dependencies.

[Actual installed Code commands](native-composition.json) passed default verified
RCC/Runtime downloads, package creation with Core 1.1.0, interpreter resolution
and execution through the installed owned Action launcher.
[Actual native Runtime lifecycle](native-runtime-lifecycle.json) passed terminal
startup, HTTP 200 OpenAPI, process ownership and owned-terminal listener shutdown.
The first QA attempt used a preserved symlink alias and correctly failed the
Runtime storage guard. The passing retry used canonical disk-backed Runtime
homes. No guard or product code changed for that retry.

Focused changed-composition checks passed: 24 Python tests and two Node tests.
The prior Astra xhigh review and Luna fixes remain preserved. No new worker,
formal GitHub approval or hosted CI success is claimed.

## Delivery scope

The extension asset is Linux x64. Runtime publishes Linux x86-64 and Windows
AMD64 only; no Mac Runtime artifact is advertised or substituted. Missing
platforms fail closed. Standalone-only invocation, general lost-invocation
reconciliation, Windows/macOS extension and Java acceptance, and isolated legacy
Holotree archive export retain the explicit limits in qualification.json.

Publication uses the [owned manual GitHub release path](../../../release.md).
The obsolete vendor workflows and Marketplace/Open VSX publishing are not used.
