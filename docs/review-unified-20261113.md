# Independent review ledger

Reviewed head: `45bb223815978823c8bbd41baf4ad47b3a5c177e`.
Base: `0c6ea4698a645022e715d0f6c1cf947099773885`.
Independent reviewer: GPT-6.1 Sol, high reasoning. Parent independently reran
the three synthetic repros; all reproduced. No native acceptance is implied.

| Finding | Disposition | Required correction and proof |
| --- | --- | --- |
| P2 relative storage overrides resolve differently in editor and workload working directories | Accepted; implemented in working tree | Editor binds an absolute root; absolute per-launch input paths and propagated root are tested across distinct editor/workload CWDs for both override forms. Standalone Python resolution is absolute. |
| P2 relocated metadata accessor also serves persistent OAuth reference/data | Accepted; implemented in working tree | New OAuth reference/datadir state is persistent under the extension-owned root and keyed by resolved Actions home. Exact established legacy reference+datadir pairs are retained in place; incomplete/absent legacy state is not created or copied. Synthetic reference/data, cleanup separation, no-vendor-creation and target separation are tested; no authentication or token migration is claimed. |
| P2 ownership scanner accepts computed vendor paths and misclassifies user directories as module resources | Accepted; implemented in working tree | Unresolved vendor literals and user-home `sema4ai_code` paths require review. Installed-resource and vendor discovery exceptions are tied to exact anchors and documented. Regressions cover both reproduced false passes; the source-plus-generated scan classified 461 files and 3,396 marker matches with 0 forbidden or unreviewed paths. |

Focused tests, the integrated Node suite and source-plus-generated ownership
scan are complete in this working tree. Next: independently re-review the exact
resulting diff. Performance selection, candidate packaging, native Windows and
Linux qualification, final-head review, merge and publication remain pending.

Parent integration check: 204 Node tests, 38 focused Python tests, and the
source/generated filesystem scan passed before removing the now-deferred native
harness experiments. Nine portable Windows-driver boundary checks also passed.
The final source check and independent re-review are recorded in the release QA
packet. Native Windows and performance gates are explicitly waived for dogfooding
by Josh on November 15, not represented as passed.
