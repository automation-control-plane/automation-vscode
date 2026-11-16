# Automation Control Plane 2.20.29

**Private GitHub dogfood pre-release draft.** Do not publish until the exact 2.20.29 Linux and Windows VSIX artifacts are packaged, hashed, and qualified.

## What changed

- Failed or cancelled environment setup can be retried. Download progress and diagnostic failures remain visible.
- RCC and Actions Runtime acquisition defaults come from the published-tool manifest and continue to verify artifact hashes. This release stages RCC 18.19.11 and Actions Runtime 1.1.1.
- Action discovery now scans ordinary nested Python modules by supported AST decorators, so Actions in `server_actions/search_discovery.py`, `browser.py`, and `apply.py` appear without importing or executing package code.
- `package.yaml` receives the local dependency schema, and supported simple PyPI pins can be updated with a targeted version action.
- Settings sections have consistent titles while existing setting keys and user values remain intact.

The authored Action SDK remains `actions-core` 1.1.0. Runtime 1.1.1 embeds RCC 18.19.8; that internal binary is distinct from the extension's outer RCC 18.19.11 pin. Runtime authentication behavior is unchanged.

## Qualification and limitations

The prior Linux candidate run covered synthetic CLI/backend Action and Robot execution, not Linux GUI or debugger acceptance. The prior native Windows candidate run passed for an earlier extension source/version; it does not certify the exact 2.20.29 VSIX. The exact release artifacts still need packaging and installed-payload verification. No macOS qualification or Marketplace publication is included.

The full canonical managed retry remains unsupported and was not passed. This private dogfood preparation uses Josh's scoped exception to release gate 6; that exception is not a pass or a general compatibility claim. See the [release evidence ledger](README.md) for exact scope and provenance.
