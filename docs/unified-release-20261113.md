# Unified Windows/Linux release

Base: `origin/master`, `0c6ea4698a645022e715d0f6c1cf947099773885`.
GitHub verified the default branch and no open PRs before implementation.
Josh authorizes one merge and GitHub release after all gates below; Marketplace
and macOS are outside this train. Preserve prior releases and #7/#8 behavior.

## Coverage and execution plan

| Issue | Applicability | Implementation and required evidence | State |
| --- | --- | --- | --- |
| #3 | Open; 2.20.27 still opens relative diagnostics links directly | Resolve supported help paths, validate absolute web URLs, handle failed opens; installed Windows proof; no profile/TLS mutation | Source implemented; installed acceptance pending |
| #4 | Open; existing profile commands depend on LS and lack target selection | Reuse bundled RCC operations and execution home resolver, pre-LS recovery, sanitized Actions/Robots status, explicit import/switch; connected Runtime limitations; long-path enabled/disabled/skipped | Source implemented; installed acceptance pending |
| #10 | Open; reported paths are hypotheses, not measurements | Installed 2.20.27 baseline, repeated cold/warm samples and call counts; optimize one worst measured extension-owned path; race/invalidation regressions and identical candidate measurements | Baseline pending |
| #11 | Open; Action no-debug excluded from owned Robot fallback | Reuse resolved package launch and existing process ownership; preserve inputs/results/PYTHONPATH/artifacts/cancel/failure; actual debugger contribution checks; installed Windows absent-provider and breakpoint gates | Source implemented; native acceptance pending |
| #12 | Open; LS creates vendor-named cache at startup | Full source/packaged path inventory; one extension storage boundary; coherent readers/writers/cleanup/overrides; disposable-cache rebuild or narrow migration; vendor data preserved | Source implemented and scanned; packaged/native acceptance pending |

1. Establish isolated worktree, verify ownership/default/PRs, reproduce and run baseline tests.
2. Capture performance baseline before selecting its single optimization. Implement
   correctness fixes as small reviewable units; retain exact issue acceptance.
3. Run Node and focused Python checks; package a single new version for Windows/Linux.
4. Independently review at high reasoning, use Luna for valid substantive findings,
   re-review exact final head. Record findings and dispositions.
5. Verify source/archive/installed payload identity, fresh installed platform
   acceptance, filesystem isolation/restart/override/vendor-preservation checks,
   provider matrix and real debugger gates. Never reuse older artifact acceptance.
6. Ready and merge reviewed PR(s), associate one release with the verified merge
   source, upload the qualified bytes/checksums/QA, verify downloaded hashes.

## Ownership and operating boundaries

- This branch owns extension changes only. Runtime profile CLI work remains with
  `joshyorko/actions#359`; do not build a competing backend or arbitrary RCC API.
- Existing Windows lab owner is on linked environment
  `a3539d75-f6c4-4c0e-8e3e-28ee12826ef8`. Readiness requested; no new VM or guest
  policy changes authorized by that request. Hosted Windows qualification exists.
- Keep one heavy local job. Do not restart T3/services or disturb Homebrew.
- No silent elevation, TLS weakening, cross-home profile mutation, blanket vendor
  migration/deletion, interpreter-setting changes, or invented native evidence.

## Verification ledger

Existing Node checks passed 179/179 before integration. Integrated Node checks
passed 201/201, focused Python checks passed 31/31, and the complete source plus
generated-JS filesystem inventory passed with no unclassified path builders. Real pinned RCC 18.19.8 checks in fresh Linux
Actions/Robots homes passed status/import/separate-switch/TLS/other-home byte
preservation and unknown-profile/malformed-file failure checks. The initial
synthetic profile omitted RCC metadata and correctly reported default; the
corrected complete fixture passed. These are source checks, not installed UI proof.

No modified candidate is qualified or published yet. Benchmark, installed native,
packaged scan, independent review, final-head check, merge and publication remain
pending. Record exact commands, source SHA, artifact hashes and receipts as run.
