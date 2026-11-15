# Isolated hosted Windows candidate qualification

## Verified result

[Candidate run 43759647473](https://github.com/automation-control-plane/automation-vscode/actions/runs/43759647473)
passed on feature head `9f48b12d1a575efbff7aa599758f25ac6e2e794d`. Its synthetic
merge source `37d97f893171aa60094b0149ed8bd488580186f6` has exactly the same Git
tree as that feature head. The candidate step ran; the production-pinned step
was skipped. [Retained receipts](success-9f48b12d/qualification.json) verify:

- Exact candidate RCC 18.19.11 and Runtime 1.1.1 versions and asset digests.
- All 758 source/VSIX/installed payloads, exact native extension registration,
  and trust granted only to the synthetic workspace.
- All eight Action/Robot file/SQLite run/debug cases exit 0, including four
  real breakpoints and output, attachment and edited-replay preservation.
- Action input metadata in flat and `src/` layouts, Runtime terminal start/stop,
  and occupied-listener refusal without adopting the listener.
- The actual private Windows Runtime bundle contains `rcc-18.19.8.exe`, SHA-256
  `f5e868af05382731f6675d98ed6ead7c7e95b250466bc5fee054b41817280a89`.

The exact installed VSIX is SHA-256
`f8db0d3e8c78b980a831727b33140404a30aae0c1216dfe65ca4a2f0861901f9`.
Its acceptance-harness digest matches the reviewed source after Git's Windows
checkout filtering; raw LF/CRLF hashes are not conflated. Transport/adapter-close
diagnostics remain in the receipt after successful target completion; this is
not a claim of clean adapter exit codes.

This qualifies the conventional candidate workloads above, not canonical
managed lifecycle, Settings UI, Java/recording, Windows host-reload recovery,
or every optional integration. The released native managed provider remains
Linux-only, and the missing supported retry grant is documented separately.
Production pins and ready PR #14 remain unchanged. No merge or publication is
implied by this result.

This work uses the separate qualification branch, not ready PR #14. The opt-in
workflow verifies GitHub release tags/source commits and asset digests, downloads
and verifies the bytes, then changes only a private archived source copy's tool
manifest. Production pins remain unchanged. Candidate assets are:

| Tool | Source commit | Windows SHA-256 |
| --- | --- | --- |
| RCC 18.19.11 | `953eda18d3d1f4a286c17709f282315a2ed16a16` | `58f43a3b3c54032740f224cb4a8bbf68c47c865cf2652084fb139b8ecc01cfd0` |
| Runtime 1.1.1 | `9bfc6ca5337dac14851e5ef3b2ea3a41485c81b2` | `0388d7f2e4080ba5c3a800bb556f8f01a65aa4834f3698eceb240888288fd8d2` |

## First attempt: harness context failure

[Run 43756618856](https://github.com/automation-control-plane/automation-vscode/actions/runs/43756618856)
at `e7fe79c4cd5ac1a2bac15765cc9dfddf3fbf55e1` verified both candidate assets and
staged provenance, but failed `driver-boundaries` before packaging or workloads.
The unchanged checkout-integrity test requires `git cat-file`; the staged source
archive deliberately contains no Git repository. Running that test from the
archive therefore failed with Git exit 128. A local Git-less archive reproduced
the same named test failure.

The correction runs those unchanged Git-dependent boundary tests from the
authoritative checkout. Packaging, exact source/VSIX/installed comparison and
all installed workloads still use the provenance-verified candidate source.
The boundary and candidate tests pass; native candidate workload acceptance
requires the subsequent hosted run and its receipts. No workload assertion or
security guard was removed.

Candidate mode also sets Windows `USERPROFILE`, AppData and temp paths beneath
the owned test root. The Go wrapper uses `LOCALAPPDATA` on Windows and
`os.UserHomeDir` on Linux/macOS, so setting `HOME` alone would not isolate its
Windows extraction cache. The receipt measures the
Runtime's extracted RCC separately from the outer candidate RCC after installed
workloads finish; it does not infer composition from version pins alone.

## Second attempt: duplicated download versions

[Run 43757393446](https://github.com/automation-control-plane/automation-vscode/actions/runs/43757393446)
at `7dfc62527dd62c3d937ba66cb365fb4df69defa2` verified the candidate releases,
packaged/installed the candidate VSIX, and verified 758 payloads. Native workspace
trust, exact extension registration and cold language-server bootstrap passed.
It stopped at the first explicit tool-acquisition assertion before any workload
cases ran; the normal production-pinned PR checks passed separately and do not
establish candidate acceptance.

The Python RCC download wrapper still requested literal `v18.19.8`, while the
candidate manifest declared `v18.19.11`. The shared downloader correctly rejected
that mismatch. An isolated verified-file fixture reproduced the same ValueError
before any network or file modification. The Action Server wrapper had the same
latent mismatch (`1.1.0` versus candidate `1.1.1`). This is duplicated version
metadata in the extension, not proof that either released binary is incompatible.

Default download versions must come from the manifest. Explicit mismatched
requests must still fail closed, and existing artifact preservation, SHA checks,
installed payload equality and workload assertions remain required. Failure
receipts are retained with the `-7dfc6252` suffix. New acquisition diagnostics
retain only the tool name and an already-scrubbed failure message.

The correction resolves both default versions from the selected manifest at
call time. Current production defaults remain unchanged, explicit incompatible
requests still fail closed, and verified/mismatched existing files retain their
previous admission/preservation behavior. The combined Python regressions pass
79 tests, including the new metadata cases and existing OAuth/cache boundaries;
seven diagnostic-redaction tests also pass. Independent review found no blockers.

The qualification PR's Windows check now selects the candidate path directly.
Other PR branches and an ordinary dispatch still select production pins. This
prevents a green pinned control check from concealing a failed out-of-band
candidate run; candidate acceptance still requires the actual workload receipt.

## Third attempt: workloads pass, composition lookup fails

[Run 43758865947](https://github.com/automation-control-plane/automation-vscode/actions/runs/43758865947)
tested feature head `ab98362cf5dc4fb99094f63215a24cc1a3dcdd01` through merge
source `9cbfe22ab6804412522236df128b865e0c5d28ec`. Its candidate receipts verify
758 payloads, both candidate asset hashes and versions, all eight exit-zero
Action/Robot run/debug cases, four real breakpoints, and output, attachment and
replay preservation. Runtime terminal start/stop and occupied-listener refusal
also passed. These workload results are retained with the `-ab98362c` suffix.

The overall job still failed: the new bundled-RCC measurement used the Linux
`HOME/.actions` layout. The actual Windows wrapper uses
`LOCALAPPDATA/actions/bin/action-server/internal/<version>`; see the
[released platform switch](https://github.com/joshyorko/actions/blob/9bfc6ca5337dac14851e5ef3b2ea3a41485c81b2/action_server/go-wrapper/main.go#L343-L362).
The correction derives that path from the already private `LOCALAPPDATA` and
still refuses missing configuration or missing bundled artifacts. It does not
search live/runner caches or suppress the composition check. A regression checks
the Windows layout and rejects a HOME-only environment. Overall qualification
requires the corrected measurement to complete in the next hosted run.

## Dispatch

```sh
gh workflow run qualify-owned-windows.yml \
  --ref qualify/rcc-18.19.11-runtime-1.1.1 \
  -f candidate_qualification=true
```

The default input is false, retaining the production-pinned path. Artifacts with
the `-candidate` suffix retain the exact candidate manifest, verified provenance,
VSIX and sanitized native receipts. Canonical managed lifecycle is separate:
the released native private-provider bootstrap is Linux-only.
