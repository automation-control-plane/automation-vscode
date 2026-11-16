# 2.20.29 private dogfood release preparation

## Status

This packet records the frozen release preparation and scope, not a publication assertion. Final publication status, exact source/merge identities, asset hashes and sanitized qualification receipts belong to the [owned GitHub release](https://github.com/automation-control-plane/automation-vscode/releases/tag/automation-vscode-v2.20.29). Do not treat candidate evidence from an earlier source/version as exact-artifact acceptance. A [preparation notes draft](RELEASE_NOTES_DRAFT.md) is retained separately from final GitHub release notes.

The following identity surfaces are synchronized to 2.20.29: `sema4ai/package.json`, root `package-lock.json`, `package-lock.json`'s root package entry, `sema4ai/pyproject.toml`, and `sema4ai/src/sema4ai_code/__init__.py`. `codegen_package.py` derives generated package versions from `__version__`.

## Tool pins staged for 2.20.29

[`sema4ai/published-tools.json`](../../../../sema4ai/published-tools.json) is the download authority. The RCC and Runtime pins are:

| Tool | Version | Source commit | Linux SHA-256 | Windows SHA-256 |
| --- | --- | --- | --- | --- |
| RCC | 18.19.11 | `953eda18d3d1f4a286c17709f282315a2ed16a16` | `4d68609044d3a39a1728d571d54c77a6174215adb40eb9acd69ce5ad34a6db1f` | `58f43a3b3c54032740f224cb4a8bbf68c47c865cf2652084fb139b8ecc01cfd0` |
| Actions Runtime | 1.1.1 | `9bfc6ca5337dac14851e5ef3b2ea3a41485c81b2` | `8c27fbed198aef16c98cdc7a45230fbc4708b06dff1c3523aeddfcdf7840efd0` | `0388d7f2e4080ba5c3a800bb556f8f01a65aa4834f3698eceb240888288fd8d2` |

RCC also retains the `darwin-arm64` asset and tag `v18.19.11`, with SHA-256 `23c665387951289b16a3d9be3103498598dce94d55327e103758df944ca067e7`. That digest is from GitHub release metadata only; no Mac download, execution, packaging, or VSIX test was performed. Runtime 1.1.1 remains a Linux/Windows asset set. Its embedded RCC 18.19.8 is distinct from the outer RCC 18.19.11 pin.

## Evidence carried forward

- The isolated Linux candidate smoke is recorded in [`dogfood-setup-20261115`](../../dogfood-setup-20261115/README.md). It used RCC 18.19.11 and Runtime 1.1.1 for synthetic Action/Robot CLI/backend execution, not the exact 2.20.29 VSIX or a Linux GUI.
- The native Windows candidate run is recorded in [`windows-candidate-20261115`](../../windows-candidate-20261115/README.md). It passed for an earlier extension source/version and verified candidate RCC 18.19.11 and Runtime 1.1.1. It does not prove the not-yet-built 2.20.29 VSIX.
- The Runtime 1.1.1 shutdown investigation is recorded in [`runtime-shutdown-20261115`](../../runtime-shutdown-20261115/README.md). The opt-in HTTP shutdown returns 200 and exits with source-defined status 1 without forced termination; it is not a code-0 exit claim.

The authored `actions-core` package remains 1.1.0. This release does not redesign Runtime authentication.

## Scope and required gates

This is a private GitHub dogfood pre-release scope. Marketplace publication is excluded. The exact 2.20.29 Linux and Windows VSIX bytes require packaging, hash capture, installed-payload comparison, and platform-specific acceptance. Linux acceptance scope is CLI/backend evidence, not GUI or native editor debugger acceptance. No macOS qualification is claimed.

The full canonical managed retry remains unsupported and was not passed. Josh authorized this limited dogfood release preparation as an exception to [release gate 6](../../../release.md); this exception is not a pass, general support claim, or expansion of the release scope. The remaining standalone/canonical managed limitation must stay visible in release notes.

No tag, draft release, Marketplace upload, merge, or publication is created by this preparation.

## Preparation checks

- Node 24.21.0 `npm test`: 217 passed, 0 failed, 0 skipped. The complete log is retained in the ignored `.cache/release-tools/release-2.20.29-node.log`.
- Python release/pin checks: `test_published_toolchain.py` 17 passed; `test_tool_download_versions.py` 6 passed; `test_runtime_shutdown_driver.py` 4 passed.
- Version consistency across `package.json`, both package-lock version fields, `pyproject.toml`, and generated-code source `__version__`: passed.

These are source-level preparation checks. They do not replace building, hashing, and installing the exact 2.20.29 Linux and Windows VSIX artifacts.

The final integrated preparation run passed 217 Node tests and 86 focused Python tests. Exact artifact qualification and publication outcomes are recorded with the GitHub release, without rewriting already-qualified product payloads.
