# RCC and Actions Runtime candidate qualification

## Result

The exact Linux release assets RCC 18.19.11 and Actions Runtime 1.1.1 passed an isolated synthetic Action/Robot workflow. The run created an Action Package with the extension backend, resolved and executed it with `actions-core` 1.1.0 and `actions-work-items` 0.4.4 installed, resolved and ran a Robot task, verified separate Actions and Robots homes, exercised Action and Robot breakpoints, started Runtime 1.1.1, posted an Action over HTTP, and built package and metadata artifacts.

The Runtime HTTP Action returned `Hello HTTP Dakota`; `/config` reported 1.1.1; `/api/shutdown/` returned HTTP 200; the process was not force-terminated. The process exit code was 1. The captured Runtime log has no reported exception after Action registration, but the non-zero exit is unexplained and is not called a clean exit.

Runtime 1.1.1 extracted `rcc-18.19.8` in its isolated home. Its SHA-256, `ea8dc96e66d7a81536b03a344b4eaf44bbd94122585954e70290bd466f5de4b6`, matches the RCC 18.19.8 Linux asset in the checkout's current manifest; the binary reports `v18.19.8`. The qualified pair therefore uses outer RCC 18.19.11 for package and Robot resolution and embedded RCC 18.19.8 inside Runtime 1.1.1.

This is synthetic Linux qualification, not API-Jokes project acceptance. The API-Jokes source is not present in this repository. No Windows or macOS qualification was run with the 18.19.11/1.1.1 candidate manifest, and canonical managed Runtime acceptance remains open. The current production pins in `sema4ai/published-tools.json` remain RCC 18.19.8 and Runtime 1.1.0; this evidence alone does not justify changing them.

## Provenance and source identity

Release tag and immutable source commit identities:

| Artifact | Tag | Source commit | Linux asset SHA-256 |
| --- | --- | --- | --- |
| RCC 18.19.11 | `v18.19.11` | `953eda18d3d1f4a286c17709f282315a2ed16a16` | `4d68609044d3a39a1728d571d54c77a6174215adb40eb9acd69ce5ad34a6db1f` |
| Actions Runtime 1.1.1 | `actions-runtime-1.1.1` | `9bfc6ca5337dac14851e5ef3b2ea3a41485c81b2` | `8c27fbed198aef16c98cdc7a45230fbc4708b06dff1c3523aeddfcdf7840efd0` |

GitHub's release asset digests matched the downloaded Linux binaries. Both binaries reported the corresponding release versions. [`candidate-tools.json`](candidate-tools.json) contains the Linux-only test override; it does not change `sema4ai/published-tools.json`.

The successful run began at commit `d0eace0cd1e4959364a0268de7bb959c596726c0` with a dirty working tree. The production files loaded by the smoke were later committed at checkpoint `703d6161ffde858bb8d3ee9d8cd60378658a40e4`; their hashes are recorded in `qualification.json`. The run used temporary copies of the smoke scripts with the candidate Runtime and current authored SDK versions selected. Their hashes and the candidate manifest hash used by that run are also recorded there. It did not use the later `--candidate-tools` CLI helper below.

## Reproduction

Run on a Linux host with the repository's Sema4.ai Poetry interpreter. The smoke creates private HOME, Actions, Robots, RCC, Python, and temporary directories below `--work-root`. It does not use the operator's live RCC homes or edit TLS/OAuth settings. Use the disk-backed repository cache; a previous `/tmp` tmpfs attempt consumed several GB.

```sh
mkdir -p .cache/dogfood-qualification
work_root=$(mktemp -d .cache/dogfood-qualification/candidate-XXXXXX)
curl --fail --location https://github.com/joshyorko/rcc/releases/download/v18.19.11/rcc-linux64 -o "$work_root/rcc-linux64"
curl --fail --location https://github.com/joshyorko/actions/releases/download/actions-runtime-1.1.1/actions-runtime-1.1.1-linux64 -o "$work_root/actions-runtime-1.1.1-linux64"
sha256sum "$work_root/rcc-linux64" "$work_root/actions-runtime-1.1.1-linux64"
chmod 700 "$work_root/rcc-linux64" "$work_root/actions-runtime-1.1.1-linux64"
poetry -C sema4ai run python sema4ai/tests/published_smoke.py \
  --rcc "$work_root/rcc-linux64" \
  --runtime "$work_root/actions-runtime-1.1.1-linux64" \
  --candidate-tools docs/evidence/dogfood-setup-20261115/candidate-tools.json \
  --work-root "$work_root"
```

The recorded successful execution used the same release assets and equivalent temporary candidate manifest, before the checked-in `--candidate-tools` staging path was added. That staging path has not been re-run as a full cold qualification because its initial retry exhausted `/tmp`; the focused staging test verifies its manifest and source boundaries. The completed raw run remains in the ignored `.cache/dogfood-qualification/initial-work-root` directory for local review; raw environment and diagnostic output are not included in this evidence directory.

## Diagnostics note

A separate direct RCC diagnostics run in an empty private home returned 35 `ok` checks and one network check failure, category 4020: `Endpoint '' must start with https:// prefix.` The extension setting `sema4ai.rcc.endpoint` defaults to empty, and the extension adds an RCC `--endpoint` argument only when that setting is non-empty. This isolated result records an unconfigured endpoint; it is not a pass and is not treated as evidence of an RCC/Runtime compatibility failure. No endpoint or TLS policy was changed.
