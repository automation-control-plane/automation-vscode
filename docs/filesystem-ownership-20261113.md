# Extension filesystem ownership audit (#12)

Scope: TypeScript, Python, authoritative/vendored language-server core,
generated JavaScript, manifest/codegen, packaged helpers, browser assets and
templates/resources. Module names, command IDs, settings and genuine vendor
protocols are not storage ownership. Windows and Linux are release targets.

## Owned storage contract

`sema4ai/vscode-client/src/extensionStorage.ts` and
`sema4ai/src/sema4ai_code/storage.py` resolve the same boundary without creating
directories just to inspect a path:

| Precedence | Root |
| --- | --- |
| Explicit `AUTOMATION_EXTENSION_STORAGE` | Exact supplied directory |
| Existing `ROBOCORP_CODE_USER_HOME` override | Supplied **base** plus `.automation-vscode` |
| Windows fallback | `%LOCALAPPDATA%/automation-vscode` |
| Linux fallback | `$XDG_STATE_HOME/automation-vscode`, otherwise `$HOME/.local/state/automation-vscode` |

The editor supplies its extension-owned `ExtensionContext.globalStorageUri`
when neither explicit override is set. It passes the effective root to Python
with `AUTOMATION_EXTENSION_STORAGE`, including managed execution subprocesses.
The editor resolves that root to an absolute path before binding it, so typed
Action input paths and Python cache paths remain anchored to the same directory
when the workload uses a different working directory. Standalone Python callers
also resolve relative overrides to an absolute path in their own process.
The compatibility override remains a base directory; it no longer creates a
vendor-named child. No setting, environment variable or user directory is
rewritten as part of resolution.

Language-server cache lives under `cache`; private per-launch input snapshots
under `inputs/launch-*`; environment failure logs under `logs`; native Action
artifacts under `action-artifacts/run-action-*`. Starting another Action retains
all earlier artifact directories. Input snapshots use distinct directories so
concurrent same-name Actions cannot overwrite each other's inputs.

Execution metadata lives under `.automation-vscode` in the **selected** Actions
or Robots runtime home. Existing runtime-home overrides and distinct-home checks
remain authoritative. This directory is independent from the persistent editor
root; a profile/home change cannot reuse another target's interpreter metadata.

## Inventory and dispositions

Locations are source symbols; the scanner records current line numbers for
source and exact archive members, including generated JavaScript.

| Source location | Effective path / purpose | Owner and disposition |
| --- | --- | --- |
| `robocorp_language_server.py::RobocorpLanguageServer.__init__` | Former user-home vendor cache → owned root `/cache` | Extension. Move normal cache reads/writes together through the single resolver. |
| `rcc.py::Rcc.get_robocorp_code_datadir` | Selected runtime home `/.automation-vscode` | Extension interpreter/space metadata. Rebuild disposable metadata; retain old directory untouched. |
| `_language_server_oauth2.py::_OAuth2._collect_info` and `get_action_server_for_oauth2` | `extension_storage()/oauth2/<sha256(resolved Actions home)>/{cwd,datadir}` | Persistent OAuth reference ID and Action Server state. New state is per selected Actions home and outside disposable metadata cleanup. |
| `rcc.ts::getBaseAsZipDownloadLocation` | Target metadata directory plus prebuilt archive name | Extension-owned optional vendor prebuilt cache. New namespace; acquisition remains integration-gated. |
| `rcc.ts::collectBaseEnv` | Target metadata directory `/vscode-base-*/rcc-env-info.json` and `last_usage` | Extension bootstrap metadata. Reader/writer/validation use the same new path; no old metadata copy. |
| `clear.ts::clearRobocorpCodeCaches` | Selected target's new metadata directory only | Extension cleanup. Await completion; absent root is harmless; refuse linked/non-directory roots. Never clean the old directory or either runtime parent recursively. |
| `robo/actionPackage.ts::runAction` input preparation | Owned root `/inputs/launch-*/input.json` | Extension-generated typed input snapshot. Unique private directory; no legacy temporary-file overwrite or deletion. |
| `resolve_interpreter.py` environment-error callback | Owned root `/logs/environment-error-*.log` | Extension diagnostics. Preserve existing error-document behavior. |
| `robo/launch_actions.py::main` | Owned root `/action-artifacts/run-action-*` | Extension-native Action artifacts. Keep all prior runs and original output lineage. |
| `rcc.py::make_numbered_in_temp` | Owned root `/tmp/automation-vscode-<user>/rcc-*`; explicit temporary base still honored | Extension helper, no production caller found. New naming; numbered cleanup affects only its new namespace. |
| `tools.py::_tool_info_map` | Historical mutex-name metadata | Extension. Owned names; operational downloads already use `automation-download-*`. |
| `runtimePaths.ts::vendorStudioHome`, `runtime_paths.py::vendor_studio_home` | Explicit vendor override or existing Studio home | Genuine separately installed vendor integration. Retain read-only resolution; no directory creation. |
| `extension.ts` publish-to-Studio handler | Vendor Studio `/sema4ai-studio/version.txt` | Vendor-owned compatibility read. Explicit integration only; preserve vendor files. |
| `robocorp_language_server.py::m_get_external_api_url` | Vendor Studio `/sema4ai-studio/external-api-server.pid` | Vendor-owned compatibility read. Missing installation returns unavailable without creating it. |
| `robo/importActions.ts`, `robo/actionPackage.ts::handleAgentLevelPackageCreation` | Workspace `/actions/Sema4.ai` for explicit Gallery imports | Deliberately imported vendor content namespace. Retain; do not rename existing user/project data. Local imports use their existing independent namespace. |
| `robocorp_language_server.py::m_text_document__did_save` | Existing Gallery namespace edit-warning reader | Vendor content contract. Retain consistently with explicit Gallery imports. |
| `runtimePaths.ts::runtimeHomes`, `runtime_paths.py::runtime_homes` | Actions/Robots homes; historical home settings treated as an explicit base | Operator configuration. Preserve precedence and exact explicit overrides. A deliberately vendor-named operator override is not an extension-created default. |
| `playwright/robocorp_browser/_engines.py::browsers_path` | `PLAYWRIGHT_BROWSERS_PATH` or Actions home `/playwright` | Execution/browser assets. Already owned; retain explicit browser override and existing target resolver. |
| `vendored_deps/url_callback_server.py::_get_action_server_user_sema4_path`, `action_server.py::get_default_action_server_settings_dir` | Actions home `/action-server` | Execution-owned callback certificate/settings directory. Already migrated; retain despite historical function names. |
| `rccTerminal.ts::createTempFile` | Effective runtime home `/temp/env-vars-*` | Target execution environment files. Existing owned target path and exit cleanup remain. |
| `scripts/prepare-package.js`, `sema4ai_code/__init__.py::import_robocorp_ls_core`, TS Python helper launchers | Installed extension module/resource paths | Packaged code identity. Retain Python module directories and resource-relative paths. Packaging refreshes vendored core from its authoritative source. |
| `__main__.py`, debug-adapter/inspector entrypoints, core observer fallback logging | Explicit log destination or error-only home files with existing non-Sema4ai names | Extension diagnostic fallback, not vendor storage. No default Sema4ai directory. Explicit log destinations remain operator-owned. |
| `codegen/settings.py` language-server log example; generated manifest | User-chosen log argument example | Documentation/configuration, not unconditional storage. Keep generated manifest aligned with source; no automatic log setting mutation. |

No additional default Sema4ai storage creator was found in authoritative/vendored
core, packaged templates, bootstrap descriptors or resource assets. Old module,
protocol and display strings remain where they do not construct filesystem paths.

OAuth is a persistent consumer of the former runtime metadata accessor: the
`.vscode_reference_id` in `cwd` is passed to Action Server login, status and
logout, while `datadir` is passed to the Action Server OAuth service. New state
uses the extension-owned persistent root and a hash of the resolved Actions
home, keeping distinct home overrides separate. The normal cache cleanup only
removes the selected runtime home's `.automation-vscode` metadata and therefore
does not remove OAuth state.

For compatibility, an existing legacy `Actions home/.sema4ai_code/oauth2`
store is used in place only when `cwd` and `datadir` are real directories and
`cwd/.vscode_reference_id` is an existing regular file; symlinked components do
not qualify. This preserves that exact reference and its associated data
without copying or deleting anything. When the complete legacy store is absent,
the resolver does not create or probe by creating any vendor directory; it
creates new state only under the extension-owned root. This preserves the
established local reference contract without claiming that any token or
certificate was migrated or validated.

## Existing data and migration

The former user cache is **not entirely disposable**. Its `DirCache` includes
Vault workspace selection, workspace/package history, arbitrary named LRUs,
Conda index data and progress timings. Hash-based filenames alone do not prove
exclusive ownership, and its parent can contain genuine vendor/private records.

The extension does not copy or delete any legacy vendor/shared cache. New
disposable metadata is rebuilt. Saved legacy selection/history stays recoverable
at its original location; the new extension cache starts independently. Restarts
preserve values written to the new cache. Re-select a legacy connected workspace
explicitly if using that optional integration. There is no automatic profile,
certificate, token or cross-home migration.

Old temporary inputs, error logs and Action artifacts also remain untouched.
Cleanup only targets the new selected-home extension metadata. It does not
delete either runtime home, the persistent root, unrelated vendor data or
previous Action artifacts.

## Repeatable checks

Run in the repository's configured Node 24/Python development environment, from
`sema4ai/`. Keep candidates and reports in fresh task-owned paths.

```sh
node --test tests/extension_storage.test.js
python -m pytest --noconftest tests/test_extension_storage.py tests/test_filesystem_ownership_scan.py -q
python tests/scan_filesystem_ownership.py --source-root .. --vsix /path/to/candidate-linux-x64.vsix --vsix /path/to/candidate-win32-x64.vsix --output /tmp/automation-filesystem-inventory.json
```

The scan records every Sema4ai-name match with location and disposition. It
rejects known old owned-path literals, a literal user-home `sema4ai_code`
directory, and unresolved assignments of a vendor namespace that could be
composed into a path. Line-local path constructors also require review unless
they have a narrow ownership classification; arbitrary module-name substrings
do not grant the installed-resource exemption. That exemption is limited to
the exact source-tree-relative language-server core and vendored core paths,
the exact extension-relative debug adapter and Work Items helper paths, the
two package-preparation source/destination paths, and generated `commands.py`
and `settings.py` paths. Those anchors identify code resources, not user data.

Read-only Studio discovery is retained only for the exact POSIX/Windows home
expressions in `runtime_paths.py` and `runtimePaths.ts`; the version and PID
compatibility reads are classified by their exact marker filenames. Gallery
classification remains limited to the existing `Sema4.ai` workspace namespace
and its explicit reader. The `ACCOUNT_NAME` and imported Gallery `action_kind`
values are non-path identity values. Source and archive identities are
distinct inputs. This is a static ownership gate, not proof that a native
editor flow executed.

The source-plus-generated scan on this change's source tree read 461 files and
classified 3,396 marker matches: 3,331 identifier/display values, 30 comments
or documentation lines, 10 installed-module resource paths, 9 read-only Studio
discovery paths, 5 Gallery namespace paths/readers, 10 target-execution storage
paths, and the 1 legacy OAuth compatibility root. It reported 0 forbidden or
unreviewed paths. The reviewed installed-module anchors are exactly:

| Location | Classification reason |
| --- | --- |
| `sema4ai_code/__init__.py` source checkout `sema4ai-python-ls-core/src` | Development import root, checked as an existing directory and added to `sys.path`; no user data is written there. |
| `sema4ai_code/__init__.py` `src_folder/sema4ai_code/vendored` | Packaged vendored Python module import root; code resources only. |
| `debugger.ts` and `workItemsNative.ts`, plus compiled `out` copies | Exact extension-relative debug adapter and Work Items Python entrypoints. |
| `scripts/prepare-package.js` source/destination | Copies the authoritative core package into the extension's vendored module tree during packaging. |
| `codegen/codegen_package.py` `commands.py` and `settings.py` | Generates Python modules under the extension source package. |

The scanner also preserves the exact Studio home reads on POSIX and Windows,
the `sema4ai-studio/version.txt` and `external-api-server.pid` compatibility
reads, and the two explicit `actions/Sema4.ai` import/use paths plus the
existing edit-warning reader. Compiled JavaScript copies receive the same narrow
classification as their source modules. New uses outside these exact anchors
remain review-required.

The focused filesystem checks instantiate the actual language-server constructor
in separate processes, verify cache store/load across restarts, default/explicit/
legacy-base roots, untouched synthetic private/vendor records, target-specific
metadata resolution, distinct editor/workload working directories for both
relative override forms, absolute input filenames, unique input directories,
OAuth legacy-reference selection, persistent OAuth data outside cache cleanup,
no legacy-directory creation, awaited cleanup and refusal to follow a linked
metadata root. The standalone native Action launcher helper is also exercised
without changing workload `PYTHONPATH` precedence. Scanner regressions reject
both computed vendor paths and user-home `sema4ai_code` directories while
retaining only the explicitly classified read-only Studio, Gallery and
installation-resource cases.

Release acceptance additionally requires exact installed Windows/Linux payload
checks and native activation/run/inspector/cleanup flows with isolated homes.
Record those receipts separately; source tests or the released 2.20.27 archive
scan do not qualify modified candidate bytes.
