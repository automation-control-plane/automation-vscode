# Native Work Items private candidate 2.20.6

**ALL FEATURES NOT COMPLETE.** This is the first native UI/SDK/published REST implementation checkpoint, with final installed executable proof. Managed canonical lifecycle and native desktop editor acceptance remain required for this release.

## Artifact and source

- Source and verified remote: `55daabf45244c73a27682ef36a1f643a0afb7489`, existing branch `port/published-rcc-actions-20261022`, draft PR1.
- Private VSIX: Library `libfile_7e551ff032d481919a0a4722fdca43b3`, 2,038,581 bytes, SHA256 `7a2fa7c2d35a8967a57c6a886d36e5ef6198e0bc594cf9038bee67e34f85766b`.
- Synthetic Action/Robot fixture and instructions ZIP: Library `libfile_2038f6a2a5f881919475965163654e2f`.
- Official Code CLI installed into a fresh task-owned profile. All **717 installed payload files match** the ZIP after normalizing only Code's `package.json.__metadata`; **716 source payload files match**. README is transformed by VSCE. The native editor resource, compiled client/service and Python bridge are present. 2.20.4 and 2.20.5 remain preserved.

## Executed final checks

- `source /workspace/.setup/activate.sh; cd sema4ai; npm test`: TypeScript compilation and **28 Node passes**. Editor DOM/message flow is simulated; Runtime client authentication/version/denial tests use an isolated HTTP fixture. These are not native Code UI proof.
- Owned RCC Action interpreter running `tests/test_native_work_items_sdk.py`: **seven actual published SDK tests pass**. File snapshot/attachments/save-conflict, SQLite success/failure/replay, separate worker-process restart, real reserve/release, lineage, expired-claim recovery and declared type/isolation/path negatives. Only the isolated recovery test sets a zero-minute orphan timeout; production keeps SDK configuration/default30minutes.
- Compatibility pytest command retained from 2.20.5, final source: **56 passes / one legacy-version skip**, 23.00seconds.
- `poetry run python tests/native_work_items_smoke.py --rcc <verified-rcc> --prepared-root <task-owned-prepared-root> --extension-root <installed-2.20.6> --output <new-scratch>`: **eight real cells**, Action and Robot × File/SQLite × run/debug. Owned SDK0.4.4, actual debugpy breakpoint/continue, exit0 and observed7. Robot now explicitly includes the owned SDK. Real SDK SQLite output IDs retain parent input IDs and completed state. Existing independent RCC18.19.7 homes/caches are reused; this is warm-cache CLI/DAP proof, not GUI or cold-download proof.
- `poetry run python tests/native_runtime_api_smoke.py --runtime <verified-published-wrapper> --prepared-root <task-owned-prepared-root> --extension-root <installed-2.20.6> --output <new-scratch>`: actual Runtime1.0.4, authenticated compiled client connect/enqueue/list/upload/download;17-byte synthetic attachment, no-token403, invalid-payload422. Actual full OpenAPI route inventory retained. With API-key mode this Runtime does not expose the local shutdown endpoint (404); cleanup sends SIGTERM only to the wrapper spawned by this harness, which exits1. No unrelated listener is contacted or killed. First harness run failed on the real authentication error's non-JSON body; parser was corrected and the final installed run passes.
- Installed `tests/runtime_restart_smoke.js`: real wrapper **16291 exited before16341**, response `Hello Restart QA`, no errors. Code terminal events are simulated. Parent separately reports the actual native 2.20.5 Restart button passed twice; new editor tests must use2.20.6.

Selected commands/results/source/paths are in adjacent JSON/text. Raw environment/server logs remain task scratch; synthetic API token values are not copied into source/evidence.

## Build failure and resolution

Ordinary restricted execution returned an empty string with exit0 from Node `child_process.exec('npm -v')` and the npm dependency inventory. Consequently VSCE reported a missing entrypoint although compilation and `vsce ls --no-dependencies` contained it. Repeating the known TMPDIR setting did not resolve this. Running the same authorized package build through normal reviewed native execution returned the correct dependency inventory and packaged successfully. No dependencies, lock resolution, sandbox permission bits or network/security settings were changed; dependencies were not omitted to make packaging pass. Official CLI emits its existing Node url.parse deprecation warning.

## Remaining authority and acceptance gates

The original119 command IDs remain, plus the new owned native-editor command. Local receipts are UI provenance, not canonical Runs/Attempts. SQLite selection is a FIFO preview with no exclusive selected-ID binding; the SDK's actual parent IDs remain authoritative. In-place queue payload edits are refused because published SDK has no conditional edit. The editor clearly distinguishes its local state from published Runtime REST storage.

Canonical managed contract arrived after this artifact: Actions commit `1520f348c31b68a8faf5a3f813bea6cf5146897b`, Runtime1.1.0a13 / fencedSDK0.5.0a1 floor, `actions.managed-work-items/v1`. Router creation alone is not server/bootstrap acceptance. Extension adapter/UI integration, actual SQL/auth-backed Runtime endpoint and installed desktop managed workflows/negatives remain open. Published1.0.4, Core1.0.3, WorkItems0.4.4 and extension-owned RCC18.19.7 remain the local baseline; Runtime's internal RCC18.19.3 composition remains an explicit separate gate.

See [native user flow and desktop instructions](../../native-work-items.md) and [full capability/mode/owner matrix](../../work-items-implementation.md). No public publication, merge, deployment, live credential, owner-data migration/deletion or unrelated repository mutation occurred.
