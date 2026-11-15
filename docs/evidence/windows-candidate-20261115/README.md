# Isolated hosted Windows candidate qualification

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
the owned test root. The Go wrapper calls `os.UserHomeDir`, so setting `HOME`
alone would not isolate its Windows extraction cache. The receipt measures the
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
