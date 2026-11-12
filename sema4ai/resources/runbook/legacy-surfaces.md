# Inspector and Output presentation adapter

The checked-in `vscode-client/templates/inspector.html` and `output.html` are
upstream compatibility engines. Their locator protocol, native Inspector modes,
code generation, log decoder, virtualized tree, filtering, run selection and
source links are retained without modifying a byte of either template.

## Editable source

- `legacy-surfaces.css`: slate/amber tokens, typography, controls and responsive
  presentation. It overrides the engines' public `--color-*` theme tokens; it
  never targets generated styled-components class names.
- `inspector-shell.html`, `output-shell.html`: owned context and navigation.
- `legacy-shell.js`: existing-route navigation, selected-log context and persistent Web Inspector diagnostics. The
  shell never starts a picker, runs a package or turns a closed log stream into
  successful execution. All actual operations remain engine/host-owned.
- `vscode-client/src/legacySurface.ts`: injects maintained source into document
  boundaries outside executable script blocks. It preserves engine bytes,
  escapes JSON data, and hashes every executable inline script for the CSP.

The host reads these files at render time, so no extra frontend build system or
generated bundle is required. Shared `theme.css` and `codicon.css` are loaded
with the same document. Existing Apache/MIT attribution remains in the engines
and repository notices.

## Explicit structural contract

Inspector has no public semantic IDs for its outer frame. This adapter is pinned
to SHA256 `213867dbae25e817f15a6bbe70da8dd2daf9770b9a76e960c21249f7f7024fdc`.
Its `#root > div` frame contains header, optional info, divider and content.
The source shell replaces the first header (old icon-only navigation). On the
locators-manager route only, it also hides the first info row, which incorrectly
labels every selected package “Robot”. The source shell displays the actual
Action Package / Robot Task / Agent Package name and path instead. The second
info row, including Copy JSON and Refresh, is left intact. Locators, capture,
validation, generated actions and all dialogs are untouched.

Output uses existing semantic IDs/classes (`base-header`, `runStatusBadge`,
`columnTitles`, `locationLink`) rather than structural selectors. Its engine is
pinned to SHA256 `41cdf8b154eb30d43382462c44493358cd6e515dc7711149cb3d6c39b2945a1a`.
The shell displays an honest empty state when no host log identity is selected.
“Run Passed” inside the engine describes its log records, not a Work Item receipt.

## Verification and upgrade procedure

Run `npm run compile`, then `node --test tests/legacy_surfaces.test.js
tests/inspector_shell.test.js`, then `npm test` from `sema4ai`.
The tests check immutable engine bytes, retained executable bytes after document
decoration, exact-script CSP hashes, injection-safe JSON, known-route-only
navigation, correct package kinds, selected-log identity and stream-status
non-inference.

When updating either engine, do not simply update the pinned hashes. Recheck the
adapter contract and render every Inspector route, empty/active logs, dialogs,
light/dark/high-contrast and narrow layouts in the installed extension. Actual
native screenshots and host interaction evidence are the visual gate; these
unit tests alone do not establish visual fidelity or platform acceptance.

## Inspector failures

The maintained shell renders existing `browserState` failure messages as inert
text with browser prerequisite and explicit Start guidance. Ordinary closed or
initializing states do not erase the failure; a real opened state clears it.
Navigation hides the banner outside Web and restores it on return. No template
bytes or generated engine selectors changed, and the shell does not start/retry
a picker. The Python worker reports the original creation exception, closes its
thread-owned Playwright resources, and waits for a new explicit Start.
